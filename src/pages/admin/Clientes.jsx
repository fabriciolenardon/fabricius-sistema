// =============================================
// CLIENTES & CUENTA CORRIENTE
// =============================================
import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { parseNumero, fmtPrecio } from '../../lib/formatos'
import { imprimirHTML } from '../../lib/imprimir'
import { recomputarSaldoCliente, conSaldoCorriente } from '../../lib/ctaCorriente'
import { lunesDeLaSemana } from '../../lib/cierreAuto'
import { getEtiquetaLista } from '../../lib/listasPrecios'
import { vencidoPorCliente, setBloqueoCliente, setConfigCtaCte, plazoCliente, DIAS_BLOQUEO } from '../../lib/moraClientes'
import { useEsMovil } from '../../lib/useEsMovil'
import Paginador, { usePaginacion } from '../../components/Paginador'

// URL publica de produccion del portal — NO usar window.location.origin para evitar URLs de preview de Vercel
const PORTAL_URL = 'https://fabricius-sistema.vercel.app/login'

export function Clientes() {
  const [clientes, setClientes] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [remitos, setRemitos] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showPago, setShowPago] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [busquedaCliente, setBusquedaCliente] = useState('')   // filtro lista clientes
  const [filtroSaldo, setFiltroSaldo] = useState('todos')      // todos | con_deuda | al_dia
  const [pago, setPago] = useState({ importe: '', forma: 'efectivo', fecha: fechaHoyARG(), notas: '' })
  const [form, setForm] = useState({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '', titular: '', es_franquicia: false })
  // Modal de gestion del portal: { tipo: 'habilitar'|'credenciales'|'revocar', cliente, email, credenciales, loading }
  const [modalPortal, setModalPortal] = useState(null)
  // Reporte "Cobranzas por período": aísla las compras/pagos de un rango de fechas
  const [showCobranzas, setShowCobranzas] = useState(false)
  const [cobDesde, setCobDesde] = useState('')
  const [cobHasta, setCobHasta] = useState('')
  const [cobPagDesde, setCobPagDesde] = useState('') // rango de PAGOS (independiente: te pagan después)
  const [cobPagHasta, setCobPagHasta] = useState('')
  const [cobData, setCobData] = useState(null)
  const [cobLoading, setCobLoading] = useState(false)

  // 🕐 MORA vs deuda corriente (3 capas FIFO, pedido de Fabricio 04/08):
  //   1. CORRIENTE  = compras de ESTA semana (lun→hoy) — recién nace.
  //   2. SEMANA PASADA = aún NO vencida: el ciclo comercial es que el
  //      mayorista paga esta semana lo que compró la anterior.
  //   3. MORA REAL  = lo anterior a la semana pasada (plata en la calle).
  // FIFO implícito: los pagos cancelan primero lo más viejo, así que
  // mora = max(0, saldo − compras esta semana − compras semana pasada).
  const [debeSemana, setDebeSemana] = useState({}) // cliente_id → Σ debe (semana actual)
  const [debeSemanaPasada, setDebeSemanaPasada] = useState({}) // cliente_id → Σ debe (semana pasada, aún no vencida)
  // 🚫 BLOQUEO manual (mig 90): el flag clientes.bloqueo_ctacte lo marca
  // Fabricio. `vencidos` (cliente_id → $ con más de 15 días, FIFO) es el
  // detector que alimenta el ANUNCIO de sugerencias — el sistema nunca
  // bloquea solo. Ver lib/moraClientes.js.
  const [vencidos, setVencidos] = useState({})
  // Confirmación inline de bloqueo/desbloqueo: { cliente, bloquear, motivo }
  const [confirmBloq, setConfirmBloq] = useState(null)
  const [bloqLoading, setBloqLoading] = useState(false)
  // Config de crédito de la ficha abierta: input del plazo propio (días)
  const [plazoInput, setPlazoInput] = useState('')
  const [configLoading, setConfigLoading] = useState(false)

  useEffect(() => { fetchClientes() }, [])

  async function fetchClientes() {
    const { data } = await supabase.from('clientes').select('*').order('nombre')
    setClientes(data || [])
    // Compras (debe) de ESTA semana y de la SEMANA PASADA por cliente — pagina
    // con fetchAllRows por si el rango supera las 1000 filas de movimientos.
    const lunes = lunesDeLaSemana()
    const dLun = new Date(lunes + 'T12:00')
    dLun.setDate(dLun.getDate() - 7)
    const lunesPasado = dLun.toISOString().slice(0, 10)
    const { data: movs } = await fetchAllRows(() => supabase
      .from('movimientos_ctacte')
      .select('cliente_id, debe, fecha')
      .gte('fecha', lunesPasado)
      .gt('debe', 0))
    const m = {}, mp = {}
    for (const r of (movs || [])) {
      const dest = r.fecha >= lunes ? m : mp
      dest[r.cliente_id] = (dest[r.cliente_id] || 0) + (Number(r.debe) || 0)
    }
    setDebeSemana(m)
    setDebeSemanaPasada(mp)
    // Vencidos a 15 días (para el badge 🚫 Bloqueado de la lista)
    vencidoPorCliente(data || []).then(setVencidos).catch(() => {})
  }

  // Capas FIFO del saldo de un cliente (los pagos cancelan lo más viejo
  // primero): corriente = compras de ESTA semana · semana pasada = aún no
  // vencida (el mayorista la paga esta semana) · MORA = lo anterior a la
  // semana pasada (plata en la calle de verdad).
  const corrienteDe = (c) => {
    const saldo = Number(c.saldo) || 0
    if (saldo <= 0) return 0
    return Math.min(saldo, debeSemana[c.id] || 0)
  }
  const semanaPasadaDe = (c) => {
    const saldo = Number(c.saldo) || 0
    if (saldo <= 0) return 0
    return Math.min(Math.max(saldo - (debeSemana[c.id] || 0), 0), debeSemanaPasada[c.id] || 0)
  }
  const moraDe = (c) => {
    const saldo = Number(c.saldo) || 0
    if (saldo <= 0) return 0
    return Math.max(0, saldo - (debeSemana[c.id] || 0) - (debeSemanaPasada[c.id] || 0))
  }

  // Ejecutar el bloqueo/desbloqueo YA CONFIRMADO en la UI (confirmBloq).
  async function ejecutarBloqueo(cliente, bloquear, motivo) {
    setBloqLoading(true)
    const { error } = await setBloqueoCliente(cliente, bloquear, motivo)
    setBloqLoading(false)
    setConfirmBloq(null)
    if (error) { alert('❌ No se pudo actualizar el bloqueo: ' + error); return }
    // Refrescar lista y ficha abierta con el flag nuevo
    const actualizado = { ...cliente, bloqueo_ctacte: bloquear, bloqueo_motivo: bloquear ? (motivo || 'Bloqueo manual') : null }
    setClientes(prev => prev.map(c => c.id === cliente.id ? { ...c, ...actualizado } : c))
    if (seleccionado?.id === cliente.id) setSeleccionado(s => ({ ...s, ...actualizado }))
  }

  // Config de crédito desde la ficha: cuenta libre y plazo propio.
  // Sin confirmación extra (es reversible al toque) pero queda en auditoría.
  async function aplicarConfigCtaCte(cambios) {
    if (!seleccionado) return
    setConfigLoading(true)
    const { error } = await setConfigCtaCte(seleccionado, cambios)
    setConfigLoading(false)
    if (error) { alert('❌ No se pudo guardar la configuración: ' + error); return }
    const actualizado = {
      ...seleccionado,
      ...(cambios.libre !== undefined ? { ctacte_libre: cambios.libre } : {}),
      ...(cambios.dias !== undefined ? { ctacte_dias_plazo: cambios.dias } : {}),
    }
    setSeleccionado(actualizado)
    setClientes(prev => prev.map(c => c.id === actualizado.id ? { ...c, ...actualizado } : c))
    // Recalcular las sugerencias con la config nueva (plazo/libre cambian el vencido)
    vencidoPorCliente(clientes.map(c => c.id === actualizado.id ? { ...c, ...actualizado } : c)).then(setVencidos).catch(() => {})
  }

  function guardarPlazo() {
    const txt = String(plazoInput).trim()
    if (txt === '') { aplicarConfigCtaCte({ dias: null }); return }
    const dias = parseInt(txt)
    if (!dias || dias < 1 || dias > 365) { alert('El plazo tiene que ser entre 1 y 365 días (o vacío para volver al estándar de ' + DIAS_BLOQUEO + ').'); return }
    aplicarConfigCtaCte({ dias })
  }
async function seleccionar(cliente) {
    setSeleccionado(cliente)
    setShowPago(false)
    setShowForm(false)
    setPlazoInput(cliente.ctacte_dias_plazo || '')
    // fetchAllRows: pagina de a 1000 → muestra TODO el historial del cliente aunque
    // tenga miles de movimientos/remitos (Supabase corta en 1000 sin esto).
    const { data: movs } = await fetchAllRows(() => supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id))
    setMovimientos(conSaldoCorriente(movs))
    const { data: rems } = await fetchAllRows(() => supabase.from('remitos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }))
    setRemitos(rems || [])
  }
  // Reporte de cobranzas por período: suma, por cliente, los remitos (compras) y
  // los pagos de un rango de fechas — aislado del saldo acumulado. Sirve para ver
  // qué te compraron una semana y quién ya pagó esa compra.
  async function calcularCobranzas() {
    if (!cobDesde || !cobHasta) { alert('Elegí el rango de COMPRAS (Desde y Hasta)'); return }
    // Rango de pagos: si no se completa, usa el mismo que compras.
    const pagDesde = cobPagDesde || cobDesde
    const pagHasta = cobPagHasta || cobHasta
    setCobLoading(true)
    // Paginado: el rango lo elige el usuario y puede abarcar meses/un año →
    // remitos y cobranzas superan las 1000 filas y Supabase corta en 1000,
    // subdeclarando lo comprado/pagado por cliente (ver lib/fetchAllRows.js).
    const [{ data: rems }, { data: movs }] = await Promise.all([
      fetchAllRows(() => supabase.from('remitos').select('cliente_id, total, fecha, eliminado').gte('fecha', cobDesde).lte('fecha', cobHasta)),
      fetchAllRows(() => supabase.from('movimientos_ctacte').select('cliente_id, haber, fecha').gte('fecha', pagDesde).lte('fecha', pagHasta).gt('haber', 0)),
    ])
    const map = {}
    ;(rems || []).forEach(r => {
      // Excluir remitos ANULADOS: un remito anulado no es una compra (ej. el remito
      // de Andrea Angaramo de $31,9M por error de tipeo, ya revertido en cta cte/stock).
      if (!r.cliente_id || r.eliminado) return
      const m = (map[r.cliente_id] = map[r.cliente_id] || { comprado: 0, pagado: 0 })
      m.comprado += Number(r.total) || 0
    })
    ;(movs || []).forEach(p => {
      if (!p.cliente_id) return
      const m = (map[p.cliente_id] = map[p.cliente_id] || { comprado: 0, pagado: 0 })
      m.pagado += Number(p.haber) || 0
    })
    const filas = Object.entries(map).map(([cid, v]) => {
      const cli = clientes.find(c => String(c.id) === String(cid))
      return {
        id: cid,
        nombre: cli?.nombre || '(cliente eliminado)',
        fantasia: cli?.nombre_fantasia || '',
        localidad: cli?.localidad || '',
        comprado: v.comprado,
        pagado: v.pagado,
        pendiente: Math.round((v.comprado - v.pagado) * 100) / 100,
        saldoActual: Number(cli?.saldo) || 0,
      }
    }).filter(f => f.comprado > 0 || f.pagado > 0)
    filas.sort((a, b) => b.pendiente - a.pendiente)
    setCobData(filas)
    setCobLoading(false)
  }

 async function anularRemitoCliente(remito) {
  if (!confirm(`¿Anular Remito N° ${String(remito.numero).padStart(5,'0')} por $${Math.round(remito.total).toLocaleString('es-AR')}?`)) return
  const { data: { user } } = await supabase.auth.getUser()
  const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
  const eliminadoPor = perfil?.nombre || user.email
  await supabase.from('remitos').update({
    eliminado: true,
    eliminado_por: eliminadoPor,
    eliminado_en: new Date().toISOString()
  }).eq('id', remito.id)
  await supabase.from('movimientos_ctacte').delete().eq('remito_id', remito.id)
  const nuevoSaldo = await recomputarSaldoCliente(seleccionado.id)
  setSeleccionado(prev => ({ ...prev, saldo: nuevoSaldo }))
  setClientes(prev => prev.map(c => c.id === seleccionado.id ? { ...c, saldo: nuevoSaldo } : c))
  const { data: rems } = await supabase.from('remitos').select('*').eq('cliente_id', seleccionado.id).order('created_at', { ascending: false })
  setRemitos(rems || [])
}
async function eliminarMovimiento(mov) {
  if (!confirm(`¿Eliminar este movimiento de ${fmt(mov.debe || mov.haber)}?`)) return
  await supabase.from('movimientos_ctacte').delete().eq('id', mov.id)
  // Recalcular el saldo desde el ledger (antes se ajustaba a mano; el caso del
  // pago hacía `saldo + mov.haber`, que con numeric=string CONCATENA en vez de sumar).
  const nuevoSaldo = await recomputarSaldoCliente(seleccionado.id)
  const { data: movs } = await fetchAllRows(() => supabase.from('movimientos_ctacte').select('*').eq('cliente_id', seleccionado.id))
  setMovimientos(conSaldoCorriente(movs))
  setSeleccionado(prev => ({ ...prev, saldo: nuevoSaldo }))
  setClientes(prev => prev.map(c => c.id === seleccionado.id ? { ...c, saldo: nuevoSaldo } : c))
}
  // ============================================================
  // PORTAL DE CLIENTES
  // ============================================================
  function abrirModalHabilitarPortal(cliente) {
    setModalPortal({ tipo: 'habilitar', cliente, email: cliente.email_portal || '', loading: false })
  }

  function abrirModalRevocarPortal(cliente) {
    setModalPortal({ tipo: 'revocar', cliente, loading: false })
  }

  function abrirModalCompartirAcceso(cliente) {
    setModalPortal({ tipo: 'compartir', cliente, password: '' })
  }

  async function habilitarPortal() {
    if (!modalPortal?.cliente) return
    const email = (modalPortal.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Email inválido')
      return
    }
    setModalPortal(m => ({ ...m, loading: true }))
    const { data, error } = await supabase.functions.invoke('crear-acceso-cliente', {
      body: { cliente_id: modalPortal.cliente.id, email }
    })
    if (error || !data?.ok) {
      const msg = data?.error || error?.message || 'Error desconocido al habilitar portal'
      alert('❌ ' + msg)
      setModalPortal(m => ({ ...m, loading: false }))
      return
    }
    // Mostrar credenciales y refrescar lista
    setModalPortal({ tipo: 'credenciales', cliente: modalPortal.cliente, credenciales: { email: data.email, password: data.password }, loading: false })
    await fetchClientes()
    if (seleccionado?.id === modalPortal.cliente.id) {
      setSeleccionado(prev => ({ ...prev, tiene_portal: true, email_portal: data.email }))
    }
  }

  async function revocarPortal() {
    if (!modalPortal?.cliente) return
    setModalPortal(m => ({ ...m, loading: true }))
    const { data, error } = await supabase.functions.invoke('revocar-acceso-cliente', {
      body: { cliente_id: modalPortal.cliente.id }
    })
    if (error || !data?.ok) {
      const msg = data?.error || error?.message || 'Error desconocido al revocar portal'
      alert('❌ ' + msg)
      setModalPortal(m => ({ ...m, loading: false }))
      return
    }
    await fetchClientes()
    if (seleccionado?.id === modalPortal.cliente.id) {
      setSeleccionado(prev => ({ ...prev, tiene_portal: false, email_portal: null }))
    }
    setModalPortal(null)
    alert('✅ Portal revocado')
  }

  function copiarTexto(texto) {
    navigator.clipboard.writeText(texto).then(() => {
      // feedback visual breve
    }).catch(() => alert('No se pudo copiar al portapapeles'))
  }

  function abrirFormNuevo() {
    setEditandoId(null)
    setForm({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '', titular: '', es_franquicia: false })
    setShowForm(true)
    setSeleccionado(null)
  }

  function abrirFormEditar(cliente) {
    setEditandoId(cliente.id)
    setForm({
      nombre: cliente.nombre || '',
      nombre_fantasia: cliente.nombre_fantasia || '',
      tipo: cliente.tipo || 'carniceria',
      telefono: cliente.telefono || '',
      localidad: cliente.localidad || '',
      domicilio: cliente.domicilio || '',
      cuit: cliente.cuit || '',
      lista_precios: cliente.lista_precios || 'carn',
      notas: cliente.notas || '',
      titular: cliente.titular || '',
      es_franquicia: !!cliente.es_franquicia
    })
    setShowForm(true)
  }

  async function guardarCliente() {
    if (!form.nombre) return
    if (editandoId) {
      await supabase.from('clientes').update({ ...form }).eq('id', editandoId)
      // Actualizar seleccionado si es el mismo
      if (seleccionado?.id === editandoId) {
        setSeleccionado(prev => ({ ...prev, ...form }))
      }
    } else {
      await supabase.from('clientes').insert({ ...form, saldo: 0 })
    }
    setForm({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '', titular: '', es_franquicia: false })
    setShowForm(false)
    setEditandoId(null)
    fetchClientes()
  }

  async function eliminarCliente(cliente) {
    if (!confirm(`¿Eliminar a ${cliente.nombre}? Esta acción no se puede deshacer.`)) return
    await supabase.from('clientes').delete().eq('id', cliente.id)
    if (seleccionado?.id === cliente.id) setSeleccionado(null)
    fetchClientes()
  }

  async function registrarPago() {
    if (!pago.importe || !seleccionado) return
    const importe = parseNumero(pago.importe)
    if (importe <= 0) {
      alert('❌ El importe debe ser mayor a 0')
      return
    }
    // Confirmación explícita con el monto formateado — evita typos
    // como "20" cuando querías "20000". Mostramos el número parseado tal
    // cual se va a guardar, en formato AR, antes de tocar la DB.
    const msg = `¿Confirmar pago de ${fmt(importe)} (${pago.forma}) a ${seleccionado.nombre}?\n\n` +
                `Saldo actual: ${fmt(seleccionado.saldo)}\n` +
                `Saldo después: ${fmt((seleccionado.saldo || 0) - importe)}`
    if (!confirm(msg)) return

    await supabase.from('movimientos_ctacte').insert({
      cliente_id: seleccionado.id,
      fecha: pago.fecha,
      tipo: 'pago',
      descripcion: `Pago — ${pago.forma}${pago.notas ? ' — ' + pago.notas : ''}`,
      debe: 0,
      haber: importe,
      saldo: 0
    })
    const nuevoSaldo = await recomputarSaldoCliente(seleccionado.id)
    setPago({ importe: '', forma: 'efectivo', fecha: fechaHoyARG(), notas: '' })
    setShowPago(false)
    await fetchClientes()
    await seleccionar({ ...seleccionado, saldo: nuevoSaldo })
  }

  // ✏️ Corrige la forma de pago / notas de un pago ya registrado ("puse
  // efectivo y era transferencia"). En movimientos_ctacte la forma vive
  // dentro de la descripción (no hay columna aparte), así que se reescribe
  // ese texto y nada más: importes y saldo NO se tocan.
  async function editarPago(mov, forma, notas) {
    const { error } = await supabase.from('movimientos_ctacte')
      .update({ descripcion: `Pago — ${forma}${notas ? ' — ' + notas : ''}` })
      .eq('id', mov.id)
    if (error) { alert('❌ No se pudo corregir el pago: ' + error.message); return false }
    await seleccionar(seleccionado)
    return true
  }

  // Anula un pago específico — invierte el efecto en saldo y elimina el movimiento.
  // Bajado desde eliminarMovimiento pero usable directamente desde la nueva
  // tabla de pagos.
  async function anularPago(mov) {
    if (mov.tipo !== 'pago' && mov.tipo !== 'cheque') return
    const msg = `¿Anular este pago de ${fmt(mov.haber)} (${mov.descripcion})?\n\n` +
                `El saldo del cliente subirá en ${fmt(mov.haber)}.`
    if (!confirm(msg)) return
    await supabase.from('movimientos_ctacte').delete().eq('id', mov.id)
    const nuevoSaldo = await recomputarSaldoCliente(seleccionado.id)
    await fetchClientes()
    await seleccionar({ ...seleccionado, saldo: nuevoSaldo })
  }

  function imprimirRemito(remito) {
    const items = remito.items || []
    // Fallback: si el remito viejo no tiene telefono/localidad, usar
    // los del cliente actual seleccionado (importante para remitos
    // generados antes de la migracion 37).
    const domicilio = remito.domicilio || seleccionado?.domicilio || ''
    const telefono  = remito.telefono  || seleccionado?.telefono  || ''
    const localidad = remito.localidad || seleccionado?.localidad || ''
    const html = `
      <html><head><title>Remito N° ${remito.numero}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; }
        .logo-title { font-size: 22px; font-weight: 900; letter-spacing: 2px; }
        .logo-sub { font-size: 9px; color: #555; }
        .doc-no-valido { font-size: 10px; font-weight: 700; border: 1px solid #000; padding: 2px 6px; margin-bottom: 4px; text-align:center; }
        .remito-title { font-size: 24px; font-weight: 900; font-style: italic; }
        .nro { font-size: 13px; font-weight: 700; }
        .campo { border-bottom: 1px solid #000; margin-bottom: 8px; padding-bottom: 2px; }
        .campo label { font-size: 10px; font-weight: 700; margin-right: 6px; }
        .reparto-box { background: #fffbe6; border: 2px solid #000; border-radius: 6px; padding: 8px 10px; margin: 10px 0; }
        .reparto-title { font-size: 10px; font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; }
        .reparto-row { font-size: 12px; margin: 2px 0; }
        .reparto-row strong { font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; }
        td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; }
        td.desc { text-align: left; }
        .total-row { display: flex; justify-content: flex-end; margin-top: 8px; }
        .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; }
        .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; }
        @media print { body { padding: 10px; } }
      </style></head>
      <body>
        <div class="header">
          <div>
            <div class="logo-title">FABRICIUS</div>
            <div class="logo-sub">CARNICERÍAS · PREMIUM QUALITY</div>
            <div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div>
            <div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div>
          </div>
          <div style="text-align:right">
            <div class="doc-no-valido">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div>
            <div class="remito-title">REMITO</div>
            <div class="nro">N° ${String(remito.numero).padStart(5, '0')}</div>
          </div>
        </div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div class="campo"><label>Señor/a:</label>${remito.cliente_nombre || ''}</div>

        <!-- BLOQUE DESTACADO PARA EL REPARTIDOR -->
        <div class="reparto-box">
          <div class="reparto-title">🚚 DATOS PARA REPARTO</div>
          <div class="reparto-row">📍 <strong>${domicilio || '— sin domicilio —'}</strong>${localidad ? `, ${localidad}` : ''}</div>
          ${telefono ? `<div class="reparto-row">📱 <strong>${telefono}</strong></div>` : ''}
        </div>

        <table>
          <thead><tr>
            <th style="width:40%">DESCRIPCIÓN</th>
            <th style="width:15%">KG</th>
            <th style="width:22%">PRECIO UNITARIO</th>
            <th style="width:23%">IMPORTE</th>
          </tr></thead>
          <tbody>
            ${items.map(item => `<tr>
              <td class="desc">${item.descripcion}</td>
              <td>${item.kg}</td>
              <td>$${Math.round(item.precio).toLocaleString('es-AR')}</td>
              <td>$${Math.round(item.importe).toLocaleString('es-AR')}</td>
            </tr>`).join('')}
            ${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}
          </tbody>
        </table>
        <div class="total-row"><div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div></div>
        <div class="firma">Firma y aclaración: ________________________________</div>
      </body></html>
    `
    imprimirHTML(html)
  }

  const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
  const esMovil = useEsMovil()
  const totalDeuda = clientes.filter(c => c.saldo > 0).reduce((s, c) => s + c.saldo, 0)
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div className="page-title">CLIENTES & CTA. CTE.</div>
          <div className="page-sub">Carnicerías, gastronómicos, sucursales</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowCobranzas(s => !s)}>📅 Cobranzas por período</button>
          <button className="btn btn-gold" onClick={abrirFormNuevo}>+ Nuevo cliente</button>
        </div>
      </div>

      {showCobranzas && (
        <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: 20 }}>
          <div className="card-title">📅 Cobranzas por período — qué te compraron y quién pagó</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Las <strong>compras</strong> y los <strong>pagos</strong> tienen rango propio: das fiado a una semana y te pagan después. Ej: compras <strong>25/05 → 31/05</strong> (lo de la semana pasada) y pagos <strong>25/05 → hoy</strong> (para captar el pago que te hicieron hoy por esa compra).
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>🧾 Compras (remitos)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div><label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Desde</label><input type="date" value={cobDesde} onChange={e => setCobDesde(e.target.value)} style={{ ...inp, width: 160 }} /></div>
                <div><label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Hasta</label><input type="date" value={cobHasta} onChange={e => setCobHasta(e.target.value)} style={{ ...inp, width: 160 }} /></div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>💵 Pagos <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(opcional — si lo dejás vacío usa el de compras)</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div><label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Desde</label><input type="date" value={cobPagDesde} onChange={e => setCobPagDesde(e.target.value)} style={{ ...inp, width: 160 }} /></div>
                <div><label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Hasta</label><input type="date" value={cobPagHasta} onChange={e => setCobPagHasta(e.target.value)} style={{ ...inp, width: 160 }} /></div>
              </div>
            </div>
            <button className="btn btn-gold" onClick={calcularCobranzas} disabled={cobLoading}>{cobLoading ? '⏳ Calculando...' : '🔍 Calcular'}</button>
          </div>

          {cobData && (() => {
            const tComprado = cobData.reduce((s, f) => s + f.comprado, 0)
            const tPagado = cobData.reduce((s, f) => s + f.pagado, 0)
            const tPendiente = cobData.reduce((s, f) => s + f.pendiente, 0)
            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                  <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>COMPRARON EN EL PERÍODO</div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--amber)' }}>{fmt(tComprado)}</div>
                  </div>
                  <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>PAGARON EN EL PERÍODO</div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--green)' }}>{fmt(tPagado)}</div>
                  </div>
                  <div style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid var(--red-light)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>POR COBRAR DEL PERÍODO</div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 30, color: 'var(--red-light)' }}>{fmt(tPendiente)}</div>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, minWidth: 640 }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                        <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cliente</th>
                        <th style={{ textAlign: 'right', padding: '8px 6px' }}>Comprado</th>
                        <th style={{ textAlign: 'right', padding: '8px 6px' }}>Pagado</th>
                        <th style={{ textAlign: 'right', padding: '8px 6px' }}>Pendiente período</th>
                        <th style={{ textAlign: 'right', padding: '8px 6px' }}>Saldo actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cobData.map(f => (
                        <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 6px' }}>
                            <div style={{ fontWeight: 600 }}>{f.nombre}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{[f.fantasia, f.localidad].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '7px 6px', color: 'var(--amber)' }}>{fmt(f.comprado)}</td>
                          <td style={{ textAlign: 'right', padding: '7px 6px', color: 'var(--green)' }}>{f.pagado > 0 ? fmt(f.pagado) : '—'}</td>
                          <td style={{ textAlign: 'right', padding: '7px 6px', fontWeight: 700, color: f.pendiente > 0.5 ? 'var(--red-light)' : 'var(--green)' }}>
                            {f.pendiente > 0.5 ? fmt(f.pendiente) : '✅ pagó'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '7px 6px', color: f.saldoActual > 0 ? 'var(--red-light)' : 'var(--muted)' }}>{fmt(f.saldoActual)}</td>
                        </tr>
                      ))}
                      {cobData.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Sin movimientos en ese período.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
                  "Pendiente período" = comprado (rango de compras) − pagado (rango de pagos). Poné el rango de pagos más amplio (ej. hasta hoy) para captar los pagos tardíos de esa compra. "Saldo actual" es la deuda total de hoy del cliente.
                </div>
              </>
            )
          })()}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 20 }}>
          <div className="card-title">{editandoId ? '✏️ Editar cliente' : 'Nuevo cliente'}</div>
          <div className="form-row">
            <div className="form-group"><label>Nombre</label><input style={inp} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></div>
            <div className="form-group"><label>Nombre Fantasía</label><input style={inp} value={form.nombre_fantasia} onChange={e => setForm(f => ({ ...f, nombre_fantasia: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                <option value="carniceria">🥩 Carnicería</option>
                <option value="mayorista">📦 Gastronómico / Mayorista</option>
                <option value="minorista">🛒 Minorista</option>
                <option value="sucursal">🏪 Sucursal</option>
              </select>
            </div>
            <div className="form-group"><label>CUIT</label><input style={inp} value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} placeholder="XX-XXXXXXXX-X" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Titular / dueño</label><input style={inp} value={form.titular} onChange={e => setForm(f => ({ ...f, titular: e.target.value }))} placeholder="Nombre del dueño (opcional)" /></div>
            <div className="form-group">
              <label>¿Es franquicia nuestra?</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--surface2)', border: `1px solid ${form.es_franquicia ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>
                <input type="checkbox" checked={form.es_franquicia} onChange={e => setForm(f => ({ ...f, es_franquicia: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
                🏪 Sí, es franquicia Fabricius
              </label>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Teléfono</label><input style={inp} value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} /></div>
            <div className="form-group"><label>Localidad</label><input style={inp} value={form.localidad} onChange={e => setForm(f => ({ ...f, localidad: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Domicilio</label><input style={inp} value={form.domicilio} onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))} /></div>
            <div className="form-group"><label>Lista de precios</label>
              <select style={inp} value={form.lista_precios} onChange={e => setForm(f => ({ ...f, lista_precios: e.target.value }))}>
                <option value="carn">🔴 Precio Carnicería</option>
                <option value="may">🟡 Precio Mayorista</option>
                <option value="min">🟢 Precio Minorista</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label>Notas</label><input style={inp} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditandoId(null) }}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarCliente}>{editandoId ? '💾 Guardar cambios' : 'Guardar cliente'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="stat"><div className="stat-label">Total adeudado</div><div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalDeuda)}</div></div>
        {(() => {
          // Desglose del total en 3 capas FIFO: corriente (esta semana) +
          // semana pasada (por cobrar esta semana, aún no vencida) + MORA
          // real (anterior a la semana pasada = plata en la calle).
          const totalCorriente = clientes.reduce((s, c) => s + corrienteDe(c), 0)
          const totalPasada = clientes.reduce((s, c) => s + semanaPasadaDe(c), 0)
          const totalMora = clientes.reduce((s, c) => s + moraDe(c), 0)
          const clientesConMora = clientes.filter(c => moraDe(c) > 0).length
          return (<>
            <div className="stat"><div className="stat-label">🟢 Corriente (esta semana)</div><div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totalCorriente)}</div></div>
            <div className="stat">
              <div className="stat-label">🔵 Por cobrar (semana pasada)</div>
              <div className="stat-value" style={{ color: '#7a9dff' }}>{fmt(totalPasada)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>vence esta semana</div>
            </div>
            <div className="stat">
              <div className="stat-label">🔴 En mora real (anterior)</div>
              <div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalMora)}</div>
              {clientesConMora > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{clientesConMora} cliente{clientesConMora === 1 ? '' : 's'} · anterior a la semana pasada</div>}
            </div>
          </>)
        })()}
        <div className="stat"><div className="stat-label">Clientes registrados</div><div className="stat-value" style={{ color: 'var(--gold)' }}>{clientes.length}</div></div>
      </div>

      {/* 🔔 ANUNCIO DE BLOQUEOS — el sistema detecta y SUGIERE, Fabricio decide.
          Cada acción pide confirmación inline (nada de window.confirm, iOS lo
          suprime) y queda registrada en auditoría. */}
      {(() => {
        const aBloquear = clientes.filter(c => vencidos[c.id] > 0 && !c.bloqueo_ctacte && !c.es_franquicia)
          .sort((a, b) => (vencidos[b.id] || 0) - (vencidos[a.id] || 0))
        const aDesbloquear = clientes.filter(c => c.bloqueo_ctacte && !(vencidos[c.id] > 0))
        if (aBloquear.length === 0 && aDesbloquear.length === 0) return null
        const filaBtn = (c, bloquear) => {
          const enConfirm = confirmBloq?.cliente?.id === c.id && confirmBloq?.bloquear === bloquear && confirmBloq?.origen === 'banner'
          const motivo = bloquear ? `Saldo vencido ${fmt(vencidos[c.id] || 0)} (más de ${plazoCliente(c)} días)` : null
          if (enConfirm) return (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 700 }}>¿Confirmás?</span>
              <button disabled={bloqLoading} onClick={() => ejecutarBloqueo(c, bloquear, motivo)}
                style={{ background: bloquear ? '#5a1a1a' : '#0f4220', border: `1px solid ${bloquear ? 'var(--red-light)' : 'var(--green)'}`, color: bloquear ? '#ff8b8b' : 'var(--green)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 800 }}>
                {bloqLoading ? '⏳' : bloquear ? 'Sí, bloquear' : 'Sí, desbloquear'}
              </button>
              <button disabled={bloqLoading} onClick={() => setConfirmBloq(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                Cancelar
              </button>
            </span>
          )
          return (
            <button onClick={() => setConfirmBloq({ cliente: c, bloquear, origen: 'banner' })}
              style={{ background: bloquear ? '#3a1a1a' : '#12301c', border: `1px solid ${bloquear ? '#5a2a2a' : '#2d5a2d'}`, color: bloquear ? 'var(--red-light)' : 'var(--green)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
              {bloquear ? '🚫 Bloquear' : '✅ Desbloquear'}
            </button>
          )
        }
        return (
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
            <div className="card-title" style={{ color: 'var(--amber)' }}>🔔 Cuentas corrientes para revisar</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
              El sistema detecta saldos vencidos (más viejos que el plazo de cada cliente — estándar {DIAS_BLOQUEO} días, semanas lun→dom)
              pero <b>no bloquea solo</b>: vos confirmás cada bloqueo. Desde la ficha podés bloquear/desbloquear a cualquiera,
              marcarlo como <b>cuenta libre</b> o darle un plazo propio.
            </div>
            {aBloquear.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => seleccionar(c)}>
                  <span style={{ fontWeight: 700 }}>{c.nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--red-light)', marginLeft: 8 }}>{fmt(vencidos[c.id])} vencidos</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>saldo {fmt(c.saldo)}{c.ctacte_dias_plazo ? ` · plazo ${c.ctacte_dias_plazo} días` : ''}</span>
                </div>
                {filaBtn(c, true)}
              </div>
            ))}
            {aDesbloquear.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => seleccionar(c)}>
                  <span style={{ fontWeight: 700 }}>{c.nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--green)', marginLeft: 8 }}>🚫 bloqueado pero sin vencido — regularizó</span>
                </div>
                {filaBtn(c, false)}
              </div>
            ))}
          </div>
        )
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : (seleccionado ? '1fr 2fr' : '1fr'), gap: 16 }}>
        <ListaClientes
          clientes={clientes}
          seleccionado={seleccionado}
          onSeleccionar={seleccionar}
          onEditar={abrirFormEditar}
          onEliminar={eliminarCliente}
          busqueda={busquedaCliente}
          setBusqueda={setBusquedaCliente}
          filtroSaldo={filtroSaldo}
          moraDe={moraDe}
          vencidos={vencidos}
          setFiltroSaldo={setFiltroSaldo}
          fmt={fmt}
        />

        {seleccionado && (
          <div>
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="card-title" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {seleccionado.nombre}
                    {seleccionado.es_franquicia && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, background: 'var(--gold)', color: '#000', borderRadius: 5, padding: '2px 8px' }}>🏪 FRANQUICIA</span>}
                    {seleccionado.bloqueo_ctacte && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, background: '#3a1a1a', color: '#ff6b6b', border: '1px solid var(--red-light)', borderRadius: 5, padding: '2px 8px' }}>🚫 CTA CTE BLOQUEADA</span>}
                  </div>
                  {seleccionado.nombre_fantasia && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>"{seleccionado.nombre_fantasia}"</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => abrirFormEditar(seleccionado)}>✏️ Editar</button>
                  <button className="btn btn-ghost" onClick={() => setSeleccionado(null)}>✕</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'CUIT', val: seleccionado.cuit || '—' },
                  { label: 'Teléfono', val: seleccionado.telefono || '—' },
                  { label: 'Localidad', val: seleccionado.localidad || '—' },
                  { label: 'Domicilio', val: seleccionado.domicilio || '—' },
                  { label: 'Lista precios', val: getEtiquetaLista(seleccionado.lista_precios) },
                  { label: 'Tipo', val: `${TIPO_INFO[seleccionado.tipo]?.icon || ''} ${TIPO_INFO[seleccionado.tipo]?.label || seleccionado.tipo}`.trim() },
                  { label: 'Titular', val: seleccionado.titular || '—' },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.val}</div>
                  </div>
                ))}
              </div>

              {/* BLOQUEO Y CRÉDITO DE CTA CTE — marca manual de Fabricio (mig 90).
                  Confirmación inline para bloquear; cuenta libre y plazo propio
                  se editan directo (reversibles, quedan en auditoría). El
                  despacho y el portal obedecen SOLO el flag de bloqueo. */}
              <div style={{ background: seleccionado.bloqueo_ctacte ? '#2a1414' : seleccionado.ctacte_libre ? '#12301c' : 'var(--surface2)', border: `1px solid ${seleccionado.bloqueo_ctacte ? 'var(--red-light)' : seleccionado.ctacte_libre ? '#2d5a2d' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: seleccionado.bloqueo_ctacte ? '#ff6b6b' : seleccionado.ctacte_libre ? 'var(--green)' : 'var(--muted)', marginBottom: 4 }}>
                    {seleccionado.bloqueo_ctacte ? '🚫 Cuenta corriente BLOQUEADA'
                      : seleccionado.ctacte_libre ? '🟢 Cuenta LIBRE — sin control de vencimiento'
                      : `💳 Cuenta corriente habilitada — plazo ${plazoCliente(seleccionado)} días${seleccionado.ctacte_dias_plazo ? ' (propio)' : ' (estándar)'}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {seleccionado.bloqueo_ctacte
                      ? (seleccionado.bloqueo_motivo || 'Bloqueo manual') + ' — no se le puede despachar a cta cte ni hacer pedidos por el portal.'
                      : seleccionado.ctacte_libre
                        ? 'El sistema nunca sugiere bloquear esta cuenta, deba lo que deba.'
                        : vencidos[seleccionado.id] > 0
                          ? `⚠️ Tiene ${fmt(vencidos[seleccionado.id])} más viejos que su plazo — el sistema sugiere bloquearlo.`
                          : 'Puede comprar a cuenta corriente con normalidad.'}
                  </div>
                </div>
                <div>
                  {confirmBloq?.cliente?.id === seleccionado.id && confirmBloq?.origen === 'ficha' ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>¿Confirmás?</span>
                      <button disabled={bloqLoading}
                        onClick={() => ejecutarBloqueo(seleccionado, !seleccionado.bloqueo_ctacte, !seleccionado.bloqueo_ctacte ? (vencidos[seleccionado.id] > 0 ? `Saldo vencido ${fmt(vencidos[seleccionado.id])} (más de ${plazoCliente(seleccionado)} días)` : 'Bloqueo manual') : null)}
                        style={{ background: seleccionado.bloqueo_ctacte ? '#0f4220' : '#5a1a1a', border: `1px solid ${seleccionado.bloqueo_ctacte ? 'var(--green)' : 'var(--red-light)'}`, color: seleccionado.bloqueo_ctacte ? 'var(--green)' : '#ff8b8b', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                        {bloqLoading ? '⏳' : seleccionado.bloqueo_ctacte ? 'Sí, desbloquear' : 'Sí, bloquear'}
                      </button>
                      <button disabled={bloqLoading} onClick={() => setConfirmBloq(null)}
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmBloq({ cliente: seleccionado, bloquear: !seleccionado.bloqueo_ctacte, origen: 'ficha' })}
                      style={{ background: seleccionado.bloqueo_ctacte ? '#12301c' : '#3a1a1a', border: `1px solid ${seleccionado.bloqueo_ctacte ? '#2d5a2d' : '#5a2a2a'}`, color: seleccionado.bloqueo_ctacte ? 'var(--green)' : 'var(--red-light)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                      {seleccionado.bloqueo_ctacte ? '✅ Desbloquear cta cte' : '🚫 Bloquear cta cte'}
                    </button>
                  )}
                </div>

                {/* Config de crédito: cuenta libre + plazo propio (mig 90) */}
                {!seleccionado.bloqueo_ctacte && (
                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: seleccionado.ctacte_libre ? 'var(--green)' : 'var(--text)' }}>
                      <input type="checkbox" checked={!!seleccionado.ctacte_libre}
                        disabled={configLoading}
                        onChange={e => aplicarConfigCtaCte({ libre: e.target.checked })}
                        style={{ width: 16, height: 16, cursor: 'pointer' }} />
                      🟢 Cuenta libre (sin control de vencimiento)
                    </label>
                    {!seleccionado.ctacte_libre && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>Plazo:</span>
                        <input type="number" min="1" max="365" value={plazoInput}
                          onChange={e => setPlazoInput(e.target.value)}
                          placeholder={String(DIAS_BLOQUEO)}
                          style={{ width: 64, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right' }} />
                        <span style={{ color: 'var(--muted)' }}>días</span>
                        {String(plazoInput || '') !== String(seleccionado.ctacte_dias_plazo || '') && (
                          <button disabled={configLoading} onClick={guardarPlazo}
                            style={{ background: 'var(--gold)', border: 'none', color: '#000', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 800 }}>
                            {configLoading ? '⏳' : '💾 Guardar'}
                          </button>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>(vacío = estándar {DIAS_BLOQUEO})</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* PORTAL DEL CLIENTE */}
              <div style={{ background: seleccionado.tiene_portal ? '#1a2a1a' : 'var(--surface2)', border: `1px solid ${seleccionado.tiene_portal ? '#2d5a2d' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: seleccionado.tiene_portal ? 'var(--green)' : 'var(--muted)', marginBottom: 4 }}>
                    {seleccionado.tiene_portal ? '📱 Portal HABILITADO' : '📱 Portal de cliente'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {seleccionado.tiene_portal
                      ? `Ingresa con: ${seleccionado.email_portal}`
                      : 'Permite que este cliente vea su cuenta y remitos online.'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {seleccionado.tiene_portal ? (
                    <>
                      <button onClick={() => abrirModalCompartirAcceso(seleccionado)} style={{ background: '#0f4220', border: '1px solid var(--green)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>💬 Compartir acceso</button>
                      <button onClick={() => abrirModalRevocarPortal(seleccionado)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>❌ Revocar acceso</button>
                    </>
                  ) : (
                    <button onClick={() => abrirModalHabilitarPortal(seleccionado)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>📱 Habilitar portal</button>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SALDO</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: seleccionado.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(seleccionado.saldo)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{seleccionado.saldo > 0 ? 'DEBE' : seleccionado.saldo < 0 ? 'A FAVOR' : 'AL DÍA'}</div>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>TOTAL COMPRAS</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--amber)' }}>{fmt(movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0))}</div>
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>TOTAL PAGADO</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--green)' }}>{fmt(movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0))}</div>
                </div>
              </div>

              <button className="btn btn-gold" onClick={() => setShowPago(!showPago)}>💵 Registrar pago</button>

              {showPago && (() => {
                const importeParseado = parseNumero(pago.importe)
                const saldoDespues = (seleccionado.saldo || 0) - importeParseado
                return (
                  <div style={{ marginTop: 16, padding: 16, background: 'var(--surface2)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div className="form-group">
                        <label>Importe ($)</label>
                        <input
                          style={inp}
                          type="text"
                          inputMode="decimal"
                          value={pago.importe}
                          onChange={e => setPago(p => ({ ...p, importe: e.target.value }))}
                          placeholder="Ej: 20000 o 20.000,50"
                          autoFocus
                        />
                      </div>
                      <div className="form-group"><label>Forma de pago</label>
                        <select style={inp} value={pago.forma} onChange={e => setPago(p => ({ ...p, forma: e.target.value }))}>
                          <option value="efectivo">Efectivo</option>
                          <option value="transferencia">Transferencia</option>
                          <option value="credito">Crédito</option>
                          <option value="cheque">Cheque</option>
                          <option value="echeq">E-cheq</option>
                        </select>
                      </div>
                      <div className="form-group"><label>Fecha</label><input style={inp} type="date" value={pago.fecha} onChange={e => setPago(p => ({ ...p, fecha: e.target.value }))} /></div>
                      <div className="form-group"><label>Notas</label><input style={inp} value={pago.notas} onChange={e => setPago(p => ({ ...p, notas: e.target.value }))} placeholder="Cheque nro., banco..." /></div>
                    </div>

                    {/* Preview anti-typo: muestra el monto parseado y el saldo después */}
                    {pago.importe && (
                      <div style={{
                        background: importeParseado > 0 ? '#1a2a1a' : '#3a1a1a',
                        border: `1px solid ${importeParseado > 0 ? 'var(--green)' : 'var(--red-light)'}`,
                        borderRadius: 8, padding: '10px 14px', marginBottom: 12,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                      }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>VAS A REGISTRAR</div>
                          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: importeParseado > 0 ? 'var(--green)' : 'var(--red-light)' }}>
                            {fmt(importeParseado)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>SALDO DESPUÉS DEL PAGO</div>
                          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: saldoDespues > 0 ? 'var(--red-light)' : 'var(--green)' }}>
                            {fmt(saldoDespues)} {saldoDespues > 0 ? 'debe' : saldoDespues < 0 ? 'a favor' : '✅ al día'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => setShowPago(false)}>Cancelar</button>
                      <button className="btn btn-gold" onClick={registrarPago} disabled={importeParseado <= 0}>
                        ✅ Confirmar pago{importeParseado > 0 ? ` de ${fmt(importeParseado)}` : ''}
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>

            <MovimientosCliente movimientos={movimientos} fmt={fmt} remitos={remitos} imprimirRemito={imprimirRemito} />
            <RemitosCliente remitos={remitos} imprimirRemito={imprimirRemito} />
            <PagosCliente movimientos={movimientos} onAnular={anularPago} onEditar={editarPago} fmt={fmt} />
{false && (
            <div className="card" style={{ marginBottom: 16 }}>
  <div className="card-title">🧾 Remitos</div>
  <table>
    <thead><tr><th>N° Remito</th><th>Fecha</th><th>Total</th><th>Imprimir</th></tr></thead>
    <tbody>
      {remitos.map(r => (
        <tr key={r.id} style={{ background: r.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: r.eliminado ? 0.8 : 1 }}>
          <td>
            <strong>N° {String(r.numero).padStart(5, '0')}</strong>
            {r.eliminado && <span style={{ marginLeft: 8, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO por {r.eliminado_por}</span>}
          </td>
          <td>{r.fecha}</td>
          <td style={{ color: r.eliminado ? 'var(--muted)' : 'var(--gold)', textDecoration: r.eliminado ? 'line-through' : 'none' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
          <td>{!r.eliminado && <button onClick={() => imprimirRemito(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>}</td>
        </tr>
      ))}
      {remitos.length === 0 && <tr><td colSpan={4} className="empty">Sin remitos</td></tr>}
    </tbody>
  </table>
</div>
)}
          </div>
        )}
      </div>

      {/* MODAL DE PORTAL DE CLIENTE */}
      {modalPortal && (
        <div onClick={() => !modalPortal.loading && setModalPortal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%' }}>
            {modalPortal.tipo === 'habilitar' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 8 }}>📱 Habilitar portal — {modalPortal.cliente.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  Ingresá un email para el cliente. El sistema generará una contraseña aleatoria que vas a poder copiar y pasarle por WhatsApp.
                </div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email del cliente</label>
                <input
                  type="email"
                  autoFocus
                  placeholder="cliente@ejemplo.com"
                  value={modalPortal.email}
                  onChange={e => setModalPortal(m => ({ ...m, email: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} disabled={modalPortal.loading} className="btn btn-ghost">Cancelar</button>
                  <button onClick={habilitarPortal} disabled={modalPortal.loading || !modalPortal.email} className="btn btn-gold">
                    {modalPortal.loading ? 'Creando...' : '✅ Crear acceso'}
                  </button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'credenciales' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--green)', letterSpacing: 1, marginBottom: 8 }}>✅ Portal habilitado</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Cliente: <strong>{modalPortal.cliente.nombre}</strong></div>
                <div style={{ background: '#2a1a0a', border: '1px solid var(--gold)', borderRadius: 10, padding: 16, marginTop: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>⚠️ COPIÁ ESTOS DATOS AHORA — la contraseña no se vuelve a mostrar</div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Email</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{modalPortal.credenciales.email}</div>
                      <button onClick={() => copiarTexto(modalPortal.credenciales.email)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>📋 Copiar</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Contraseña</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--gold)', letterSpacing: 1 }}>{modalPortal.credenciales.password}</div>
                      <button onClick={() => copiarTexto(modalPortal.credenciales.password)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>📋 Copiar</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Link del portal</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{PORTAL_URL}</div>
                      <button onClick={() => copiarTexto(PORTAL_URL)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>📋 Copiar</button>
                    </div>
                  </div>
                  <button
                    onClick={() => copiarTexto(`Hola ${modalPortal.cliente.nombre}, te habilité tu portal de cliente en Fabricius Carnes.\n\n🔗 Ingresá acá:\n${PORTAL_URL}\n\n🔐 Tus datos:\nEmail: ${modalPortal.credenciales.email}\nContraseña: ${modalPortal.credenciales.password}\n\nVas a poder ver tu saldo, remitos y movimientos cuando quieras.`)}
                    style={{ background: '#0f4220', border: '1px solid var(--green)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 12 }}
                  >💬 Copiar mensaje completo para WhatsApp</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} className="btn btn-gold">Listo</button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'compartir' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 8 }}>💬 Compartir acceso — {modalPortal.cliente.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                  El portal ya está habilitado. Escribí la contraseña que le diste al cliente para armar el mensaje de WhatsApp con todos los datos.
                  <br /><br />
                  <strong>La contraseña no se guarda</strong> — solo se usa para armar el mensaje.
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Email del cliente</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', background: 'var(--surface2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>{modalPortal.cliente.email_portal}</div>

                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Contraseña que le diste al cliente</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Escribí la contraseña..."
                  value={modalPortal.password}
                  onChange={e => setModalPortal(m => ({ ...m, password: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 12, fontFamily: 'monospace' }}
                />

                <div style={{ background: '#2a1a0a', border: '1px solid var(--gold)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Link del portal</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', flex: 1 }}>{PORTAL_URL}</div>
                    <button onClick={() => copiarTexto(PORTAL_URL)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>📋 Copiar</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} className="btn btn-ghost">Cerrar</button>
                  <button
                    onClick={() => copiarTexto(`Hola ${modalPortal.cliente.nombre}, te habilité tu portal de cliente en Fabricius Carnes.\n\n🔗 Ingresá acá:\n${PORTAL_URL}\n\n🔐 Tus datos:\nEmail: ${modalPortal.cliente.email_portal}\nContraseña: ${modalPortal.password}\n\nVas a poder ver tu saldo, remitos y movimientos cuando quieras.`)}
                    disabled={!modalPortal.password.trim()}
                    style={{ background: modalPortal.password.trim() ? 'var(--green)' : 'var(--surface2)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: modalPortal.password.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, color: modalPortal.password.trim() ? '#fff' : 'var(--muted)' }}
                  >💬 Copiar mensaje para WhatsApp</button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'revocar' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--red-light)', letterSpacing: 1, marginBottom: 8 }}>❌ Revocar acceso</div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>
                  Vas a revocar el acceso al portal de <strong>{modalPortal.cliente.nombre}</strong>. El cliente ya no podrá ingresar.
                  <br /><br />
                  El historial de cuenta corriente y remitos NO se borra. Podés volver a habilitarlo cuando quieras.
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} disabled={modalPortal.loading} className="btn btn-ghost">Cancelar</button>
                  <button onClick={revocarPortal} disabled={modalPortal.loading} style={{ background: 'var(--red-light)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                    {modalPortal.loading ? 'Revocando...' : '❌ Revocar acceso'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Sub-componente: lista paginada de remitos del cliente seleccionado.
// Antes mostraba 20 remitos máx; ahora pagina todos.
function RemitosCliente({ remitos, imprimirRemito }) {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const lista = remitos || []
  const hayFiltro = !!(desde || hasta)
  // Filtra por rango de fecha de emisión del remito.
  const filtrados = hayFiltro
    ? lista.filter(r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta))
    : lista
  // Total a cobrar del rango: SOLO remitos no anulados (un anulado no es una compra).
  const noAnulados = filtrados.filter(r => !r.eliminado)
  const totalRango = noAnulados.reduce((s, r) => s + (Number(r.total) || 0), 0)
  const pag = usePaginacion(filtrados, 20)
  const inpF = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', fontSize: 13 }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">🧾 Remitos ({lista.length})</div>
      {/* Buscador por fecha + total a cobrar del rango (para no sumar a mano) */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14, padding: 12, background: 'var(--surface2)', borderRadius: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>DESDE</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inpF} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>HASTA</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inpF} />
        </div>
        {hayFiltro && <button className="btn btn-ghost btn-sm" onClick={() => { setDesde(''); setHasta('') }}>Limpiar</button>}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: 0.5 }}>
            {hayFiltro ? `TOTAL A COBRAR DEL RANGO · ${noAnulados.length} boleta${noAnulados.length === 1 ? '' : 's'}` : `TOTAL · ${noAnulados.length} boleta${noAnulados.length === 1 ? '' : 's'}`}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, color: 'var(--gold)', lineHeight: 1 }}>${Math.round(totalRango).toLocaleString('es-AR')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>N° Remito</th><th>Fecha</th><th>Total</th><th>Imprimir</th></tr></thead>
        <tbody>
          {pag.items.map(r => (
            <tr key={r.id} style={{ background: r.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: r.eliminado ? 0.8 : 1 }}>
              <td>
                <strong>N° {String(r.numero).padStart(5, '0')}</strong>
                {r.eliminado && <span style={{ marginLeft: 8, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO por {r.eliminado_por}</span>}
              </td>
              <td>{r.fecha}</td>
              <td style={{ color: r.eliminado ? 'var(--muted)' : 'var(--gold)', textDecoration: r.eliminado ? 'line-through' : 'none' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
              <td>{!r.eliminado && <button onClick={() => imprimirRemito(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>}</td>
            </tr>
          ))}
          {filtrados.length === 0 && <tr><td colSpan={4} className="empty">{hayFiltro ? 'Sin remitos en ese rango' : 'Sin remitos'}</td></tr>}
        </tbody>
      </table>
      <Paginador {...pag.controles} label="remitos" />
    </div>
  )
}

// ============================================================
// LISTA DE CLIENTES — con búsqueda, filtro por saldo y paginación
// ============================================================
// Antes: render plano de todos los clientes (>100 filas). Lag y
// scroll molesto. Ahora: input de búsqueda + toggle "todos/deuda/al día"
// + paginador (20 por página).
// Tipos de cliente: orden, ícono y etiqueta para agrupar la lista en secciones.
const TIPO_INFO = {
  carniceria: { icon: '🥩', label: 'Carnicerías' },
  mayorista:  { icon: '📦', label: 'Mayoristas' },
  minorista:  { icon: '🛒', label: 'Minoristas' },
  sucursal:   { icon: '🏪', label: 'Sucursales' },
  otro:       { icon: '•',  label: 'Otros' },
}
const TIPO_ORDEN = ['carniceria', 'mayorista', 'minorista', 'sucursal', 'otro']
const ordenTipo = t => { const i = TIPO_ORDEN.indexOf(t); return i === -1 ? 99 : i }

function ListaClientes({ clientes, seleccionado, onSeleccionar, onEditar, onEliminar, busqueda, setBusqueda, filtroSaldo, setFiltroSaldo, fmt, moraDe = () => 0, vencidos = {} }) {
  // Solapa de tipo: 'todos' muestra las secciones agrupadas; cada otra aísla un tipo.
  const [filtroTipo, setFiltroTipo] = useState('todos')

  // Base = búsqueda + filtro de saldo (sin tipo). Sirve para contar por tipo.
  const base = useMemo(() => {
    const q = (busqueda || '').toLowerCase().trim()
    return clientes.filter(c => {
      if (q) {
        const hay = ((c.nombre || '') + ' ' + (c.nombre_fantasia || '') + ' ' + (c.localidad || '') + ' ' + (c.titular || '')).toLowerCase().includes(q)
        if (!hay) return false
      }
      if (filtroSaldo === 'con_deuda' && !(Number(c.saldo) > 0)) return false
      if (filtroSaldo === 'al_dia' && Number(c.saldo) > 0) return false
      if (filtroSaldo === 'con_mora' && !(moraDe(c) > 0)) return false
      if (filtroSaldo === 'bloqueados' && !c.bloqueo_ctacte) return false
      return true
    })
  }, [clientes, busqueda, filtroSaldo, moraDe, vencidos])

  // Conteo por tipo (para las solapas)
  const conteoTipo = useMemo(() => {
    const m = {}
    base.forEach(c => { const t = c.tipo || 'otro'; m[t] = (m[t] || 0) + 1 })
    return m
  }, [base])

  // Aplica solapa de tipo + ordena: por tipo, franquicias primero, luego nombre.
  const filtrados = useMemo(() => {
    const arr = filtroTipo === 'todos' ? base : base.filter(c => (c.tipo || 'otro') === filtroTipo)
    return arr.slice().sort((a, b) => {
      const ta = ordenTipo(a.tipo || 'otro'), tb = ordenTipo(b.tipo || 'otro')
      if (ta !== tb) return ta - tb
      const fa = a.es_franquicia ? 0 : 1, fb = b.es_franquicia ? 0 : 1
      if (fa !== fb) return fa - fb
      return (a.nombre || '').localeCompare(b.nombre || '')
    })
  }, [base, filtroTipo])

  const pag = usePaginacion(filtrados, 20)

  // Deuda total por tipo (sobre filtrados) para el encabezado de cada sección.
  const deudaTipo = useMemo(() => {
    const m = {}
    filtrados.forEach(c => { if (Number(c.saldo) > 0) { const t = c.tipo || 'otro'; m[t] = (m[t] || 0) + Number(c.saldo) } })
    return m
  }, [filtrados])
  const countTipoFiltrado = t => filtrados.filter(c => (c.tipo || 'otro') === t).length

  const solapas = [
    { id: 'todos', icon: '👥', label: 'Todos', n: base.length },
    ...TIPO_ORDEN.filter(t => conteoTipo[t]).map(t => ({ id: t, icon: TIPO_INFO[t].icon, label: TIPO_INFO[t].label, n: conteoTipo[t] })),
  ]

  let tipoPrev = null
  return (
    <div className="card">
      <div className="card-title">Clientes ({base.length}{base.length !== clientes.length ? ` de ${clientes.length}` : ''})</div>

      {/* Búsqueda */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="🔍 Buscar nombre, fantasía, titular o localidad..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ flex: 1, minWidth: 180, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}
        />
        {busqueda && (
          <button onClick={() => setBusqueda('')}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
        )}
      </div>

      {/* Solapas por TIPO de cliente */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {solapas.map(s => {
          const activa = filtroTipo === s.id
          return (
            <button key={s.id} onClick={() => setFiltroTipo(s.id)}
              style={{
                padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 5,
                border: `1px solid ${activa ? 'var(--gold)' : 'var(--border)'}`,
                background: activa ? 'var(--gold)' : 'transparent',
                color: activa ? '#000' : 'var(--text2)',
              }}>
              {s.icon} {s.label}
              <span style={{ background: activa ? 'rgba(0,0,0,0.15)' : 'var(--surface2)', borderRadius: 10, padding: '0 6px', fontSize: 10, fontWeight: 800 }}>{s.n}</span>
            </button>
          )
        })}
      </div>

      {/* Filtro por saldo */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { id: 'todos',     label: `Todos los saldos` },
          { id: 'con_deuda', label: `💳 Con deuda` },
          { id: 'con_mora',  label: `⏰ En mora` },
          { id: 'bloqueados', label: `🚫 Bloqueados` },
          { id: 'al_dia',    label: `✅ Al día` },
        ].map(opt => (
          <button key={opt.id} onClick={() => setFiltroSaldo(opt.id)}
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: `1px solid ${filtroSaldo === opt.id ? 'var(--text2)' : 'var(--border)'}`,
              background: filtroSaldo === opt.id ? 'var(--surface2)' : 'transparent',
              color: filtroSaldo === opt.id ? 'var(--text)' : 'var(--muted)',
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}>{opt.label}</button>
        ))}
      </div>

      {pag.items.map(c => {
        const t = c.tipo || 'otro'
        const mostrarHeader = t !== tipoPrev
        tipoPrev = t
        const info = TIPO_INFO[t] || TIPO_INFO.otro
        return (
          <Fragment key={c.id}>
            {mostrarHeader && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 6px', paddingBottom: 4, borderBottom: '2px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: 'var(--gold)' }}>{info.icon} {info.label.toUpperCase()} · {countTipoFiltrado(t)}</span>
                {deudaTipo[t] > 0 && <span style={{ fontSize: 10.5, color: 'var(--red-light)', fontWeight: 700 }}>{fmt(deudaTipo[t])} en deuda</span>}
              </div>
            )}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 8px', borderBottom: '1px solid var(--border)', borderRadius: 6, background: seleccionado?.id === c.id ? 'var(--surface2)' : 'transparent' }}>
              <div onClick={() => onSeleccionar(c)} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{c.nombre}</span>
                  {c.es_franquicia && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, background: 'var(--gold)', color: '#000', borderRadius: 4, padding: '1px 6px' }}>🏪 FRANQUICIA</span>}
                  {c.bloqueo_ctacte && (
                    <span title={c.bloqueo_motivo || 'Bloqueo manual'}
                      style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, background: '#3a1a1a', color: '#ff6b6b', border: '1px solid var(--red-light)', borderRadius: 4, padding: '1px 6px' }}>
                      🚫 BLOQUEADO
                    </span>
                  )}
                  {!c.bloqueo_ctacte && vencidos[c.id] > 0 && (
                    <span title={`${fmt(vencidos[c.id])} más viejos que su plazo — el sistema sugiere bloquearlo (ver anuncio arriba)`}
                      style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, background: '#2a1f0a', color: 'var(--amber)', border: '1px solid #6a5a2a', borderRadius: 4, padding: '1px 6px' }}>
                      ⚠️ VENCIDO
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.nombre_fantasia ? `"${c.nombre_fantasia}"` : '', c.titular ? `👤 ${c.titular}` : '', c.localidad].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.tiene_portal && <span title="Portal habilitado" style={{ fontSize: 13, color: 'var(--green)' }}>📱</span>}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: c.saldo > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
                    {c.saldo > 0 ? fmt(c.saldo) + ' debe' : c.saldo < 0 ? fmt(Math.abs(c.saldo)) + ' a favor' : '✅ Al día'}
                  </span>
                  {moraDe(c) > 0 && (
                    <div title="Deuda anterior a esta semana (las compras de la semana en curso no cuentan como mora)"
                      style={{ fontSize: 10, fontWeight: 800, color: 'var(--amber)', whiteSpace: 'nowrap', marginTop: 1 }}>
                      ⏰ {fmt(moraDe(c))} en mora
                    </div>
                  )}
                </div>
                <button onClick={() => onEditar(c)}
                  style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>✏️</button>
                <button onClick={() => onEliminar(c)}
                  style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
              </div>
            </div>
          </Fragment>
        )
      })}
      {filtrados.length === 0 && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
          {clientes.length === 0 ? 'Sin clientes registrados' : 'Ningún cliente con esos filtros'}
        </p>
      )}
      <Paginador {...pag.controles} label="clientes" />
    </div>
  )
}

// ============================================================
// PAGOS DEL CLIENTE — historial paginado con opción de anular
// ============================================================
// Antes los pagos se cargaban a movimientos_ctacte pero no había UI
// para verlos ni anularlos. Solo aparecían sumarizados en "TOTAL PAGADO".
// Ahora se muestran en una tabla espejo de la de remitos: paginada,
// con botón 🗑️ Anular que revierte el saldo al cliente.
// Cuenta corriente completa: debe / haber / saldo corrido (en orden de fecha,
// igual que el portal del cliente). 10 filas por página.
function MovimientosCliente({ movimientos, fmt, remitos = [], imprimirRemito }) {
  const pag = usePaginacion(movimientos, 10)
  // Abrir el remito directo desde el movimiento de la cta cte, sin ir a
  // buscarlo a Mayorista → Remitos (pedido de Fabricio 21/07).
  const remitoDe = (m) => m.remito_id ? remitos.find(r => r.id === m.remito_id && !r.eliminado) : null
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">📒 Cuenta corriente ({movimientos.length} movimientos)</div>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
        <tbody>
          {pag.items.map(m => (
            <tr key={m.id}>
              <td>{m.fecha}</td>
              <td><span className={`badge ${m.tipo === 'compra' ? 'badge-red' : 'badge-green'}`}>{m.tipo}</span></td>
              <td>
                {m.descripcion || '—'}
                {remitoDe(m) && imprimirRemito && (
                  <button onClick={() => imprimirRemito(remitoDe(m))} title="Ver / imprimir el remito"
                    style={{ marginLeft: 8, background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}>🖨️</button>
                )}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--red-light)' }}>{m.debe > 0 ? fmt(m.debe) : '—'}</td>
              <td style={{ textAlign: 'right', color: 'var(--green)' }}>{m.haber > 0 ? fmt(m.haber) : '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: m.saldoCalc > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(m.saldoCalc)}</td>
            </tr>
          ))}
          {movimientos.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos</td></tr>}
        </tbody>
      </table>
      <Paginador {...pag.controles} label="movimientos" />
    </div>
  )
}

const FORMAS_PAGO_CLI = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'credito', label: 'Crédito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'echeq', label: 'E-cheq' },
]

// La forma del pago vive incrustada en la descripción ("Pago — efectivo — nota").
// Se rescata de ahí para precargar el editor.
function partesPagoCli(desc) {
  const p = String(desc || '').split(' — ')
  const forma = FORMAS_PAGO_CLI.some(x => x.value === p[1]) ? p[1] : 'efectivo'
  return { forma, notas: p.slice(2).join(' — ') }
}

function PagosCliente({ movimientos, onAnular, onEditar, fmt }) {
  const pagos = useMemo(() =>
    (movimientos || []).filter(m => m.tipo === 'pago' || m.tipo === 'cheque'),
    [movimientos])
  const pag = usePaginacion(pagos, 20)
  // ✏️ Edición inline de forma de pago / notas (solo tipo 'pago'; los de
  // tipo 'cheque' los maneja el módulo de cheques). Importes NO se editan.
  const [edit, setEdit] = useState(null) // { id, forma, notas } | null
  const [guardando, setGuardando] = useState(false)

  async function guardarEdit(p) {
    setGuardando(true)
    const ok = await onEditar(p, edit.forma, edit.notas)
    setGuardando(false)
    if (ok) setEdit(null)
  }

  const inpMini = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">💵 Pagos ({pagos.length})</div>
      <table>
        <thead><tr>
          <th>Fecha</th>
          <th>Descripción</th>
          <th style={{ textAlign: 'right' }}>Importe</th>
          <th style={{ textAlign: 'center' }}>Acciones</th>
        </tr></thead>
        <tbody>
          {pag.items.map(p => (
            <tr key={p.id}>
              <td>{p.fecha}</td>
              <td>
                {p.descripcion || '—'}
                {edit?.id === p.id && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <select value={edit.forma} onChange={e => setEdit(x => ({ ...x, forma: e.target.value }))} style={inpMini}>
                      {FORMAS_PAGO_CLI.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <input value={edit.notas} onChange={e => setEdit(x => ({ ...x, notas: e.target.value }))}
                      placeholder="Notas (cheque nro...)" style={{ ...inpMini, width: 160 }} />
                    <button onClick={() => guardarEdit(p)} disabled={guardando}
                      style={{ background: 'var(--green)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>✓ Guardar</button>
                    <button onClick={() => setEdit(null)}
                      style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>✗</button>
                  </div>
                )}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--green)', fontWeight: 700 }}>{fmt(p.haber)}</td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                {p.tipo === 'pago' && (
                  <button
                    onClick={() => setEdit(edit?.id === p.id ? null : { id: p.id, ...partesPagoCli(p.descripcion) })}
                    title="Corregir forma de pago / notas"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginRight: 6 }}>
                    ✏️ Editar
                  </button>
                )}
                <button onClick={() => onAnular(p)}
                  title="Anular este pago (revierte el saldo)"
                  style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>
                  🗑️ Anular
                </button>
              </td>
            </tr>
          ))}
          {pagos.length === 0 && <tr><td colSpan={4} className="empty">Sin pagos registrados</td></tr>}
        </tbody>
      </table>
      <Paginador {...pag.controles} label="pagos" />
    </div>
  )
}

export default Clientes
