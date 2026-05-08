// Franquicias.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'

function fmt(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

const FRANQUICIAS = [
  { nombre: 'ALVEAR', titular: 'Roxana', direccion: 'Carnicería Alvear' },
  { nombre: 'MONTE CRISTO', titular: 'Agustín', direccion: 'Monte Cristo' },
]

export default function Franquicias() {
  const [seleccionada, setSeleccionada] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [remitos, setRemitos] = useState([])
  const [showPago, setShowPago] = useState(false)
  const [pago, setPago] = useState({ importe: '', forma: 'efectivo', fecha: new Date().toISOString().split('T')[0], notas: '' })
  const [clientes, setClientes] = useState([])
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('clientes').select('*').order('nombre').then(({ data }) => setClientes(data || []))
  }, [])

  async function seleccionar(franquicia) {
    setSeleccionada(franquicia)
    setShowPago(false)
    setMsg(null)
    const { data: c } = await supabase.from('clientes').select('*').ilike('nombre', `%${franquicia.nombre}%`).single()
    setCliente(c || null)
    if (c) {
      const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('cliente_id', c.id).order('fecha', { ascending: false })
      setMovimientos(movs || [])
      const { data: rems } = await supabase.from('remitos').select('*').ilike('cliente_nombre', `%${franquicia.nombre}%`).order('created_at', { ascending: false })
      setRemitos(rems || [])
    } else {
      setMovimientos([])
      setRemitos([])
    }
  }

  async function registrarPago() {
    if (!pago.importe || !cliente) return
    const importe = parseFloat(pago.importe)
    const nuevoSaldo = (cliente.saldo || 0) - importe
    await supabase.from('movimientos_ctacte').insert({
      cliente_id: cliente.id, fecha: pago.fecha, tipo: 'pago',
      descripcion: `Pago — ${pago.forma}${pago.notas ? ' — ' + pago.notas : ''}`,
      debe: 0, haber: importe, saldo: nuevoSaldo
    })
    await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', cliente.id)
    setMsg({ type: 'success', msg: '✅ Pago registrado' })
    setPago({ importe: '', forma: 'efectivo', fecha: new Date().toISOString().split('T')[0], notas: '' })
    setShowPago(false)
    await seleccionar(seleccionada)
    setTimeout(() => setMsg(null), 3000)
  }

  function imprimirRemito(remito) {
    const items = remito.items || []
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Remito N° ${remito.numero}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin:
