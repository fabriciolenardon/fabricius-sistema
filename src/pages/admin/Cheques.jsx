// Cheques.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { parseNumero, fmtPrecio } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'

// Reemplaza el fmt local por el helper centralizado que respeta decimales
const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

export default function Cheques() {
  const [cheques, setCheques] = useState([])
  const [clientes, setClientes] = useState([])
  const [tipo, setTipo] = useState('fisico')
  const [form, setForm] = useState({ numero: '', fechaRec: fechaHoyARG(), fechaPago: '', banco: '', clienteId: '', monto: '', destino: 'ctacte', proveedor: '', notas: '' })
  const [alert, setAlert] = useState(null)
  // Paginación del listado — el historial puede tener cientos de cheques
  const pag = usePaginacion(cheques, 20)

  useEffect(() => {
    supabase.from('cheques').select('*').order('fecha_recepcion', { ascending: false }).then(({ data }) => setCheques(data || []))
    supabase.from('clientes').select('id, nombre').order('nombre').then(({ data }) => setClientes(data || []))
  }, [])

  async function guardar() {
    if (!form.numero || !form.monto || !form.clienteId) { setAlert({ type: 'error', msg: 'Completá número, cliente y monto' }); return }
    const cliente = clientes.find(c => c.id === form.clienteId)
    const { error } = await supabase.from('cheques').insert({
      tipo, numero: form.numero, fecha_recepcion: form.fechaRec, fecha_pago: form.fechaPago || null,
      banco: form.banco, cliente_id: form.clienteId, cliente_nombre: cliente?.nombre,
      monto: parseNumero(form.monto), destino: form.destino, proveedor_nombre: form.proveedor, notas: form.notas
    })
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    if (form.destino === 'ctacte') {
      const { data: clienteActual } = await supabase.from('clientes').select('saldo').eq('id', form.clienteId).single()
      const nuevoSaldo = (clienteActual?.saldo || 0) - parseNumero(form.monto)
      await supabase.from('movimientos_ctacte').insert({
        fecha: form.fechaRec, cliente_id: form.clienteId,
        tipo: 'cheque', descripcion: `${tipo === 'echeq' ? 'E-cheq' : 'Cheque'} Nro. ${form.numero}${form.banco ? ' — ' + form.banco : ''}`,
        debe: 0, haber: parseNumero(form.monto), saldo: nuevoSaldo
      })
      await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', form.clienteId)
    }
    setAlert({ type: 'success', msg: `✅ ${tipo === 'echeq' ? 'E-cheq' : 'Cheque'} #${form.numero} registrado` })
    setForm(f => ({ ...f, numero: '', monto: '', notas: '', banco: '' }))
    supabase.from('cheques').select('*').order('fecha_recepcion', { ascending: false }).then(({ data }) => setCheques(data || []))
    setTimeout(() => setAlert(null), 4000)
  }

  return (
    <div>
      <div className="page-title">CHEQUES / E-CHEQ</div>
      <div className="page-sub">Registro de cheques recibidos y su destino</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <div className="card-title">Registrar cheque</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {['fisico', 'echeq'].map(t => (
              <button key={t} onClick={() => setTipo(t)}
                style={{ padding: '8px 18px', borderRadius: 8, border: `2px solid ${tipo === t ? (t === 'echeq' ? 'var(--purple)' : 'var(--blue)') : 'var(--border)'}`, background: tipo === t ? (t === 'echeq' ? '#2a1a3a' : '#1a2a3a') : 'transparent', color: tipo === t ? (t === 'echeq' ? '#c084fc' : '#93c5fd') : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
                {t === 'fisico' ? '📄 Cheque físico' : '📱 E-cheq'}
              </button>
            ))}
          </div>
          <div className="form-row">
            <div className="form-group"><label>Número de serie</label>
              <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="00012345" />
            </div>
            <div className="form-group"><label>Fecha recepción</label>
              <input type="date" value={form.fechaRec} onChange={e => setForm(f => ({ ...f, fechaRec: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Fecha de pago / vto.</label>
              <input type="date" value={form.fechaPago} onChange={e => setForm(f => ({ ...f, fechaPago: e.target.value }))} />
            </div>
            <div className="form-group"><label>Banco</label>
              <select value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}>
                <option value="">— Seleccioná —</option>
                {['Banco Macro', 'Banco Nación', 'Banco Provincia', 'BBVA', 'Santander', 'Galicia', 'HSBC', 'ICBC', 'Credicoop', 'Otro'].map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>Cliente</label>
            <select value={form.clienteId} onChange={e => setForm(f => ({ ...f, clienteId: e.target.value }))}>
              <option value="">— Seleccioná —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Monto ($)</label>
            <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
          </div>
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}>
              <option value="ctacte">💳 Imputar a cuenta corriente del cliente</option>
              <option value="endoso">🔄 Endosar a proveedor</option>
            </select>
          </div>
          {form.destino === 'endoso' && (
            <div className="form-group"><label>Proveedor a endosar</label>
              <select value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}>
                <option value="">— Seleccioná —</option>
                {['PRETTO', 'LEO', 'BERTOSSI', 'INDACOR', 'BELMACO', 'CUBALA', 'LA AVENIDA'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          )}
          <div className="form-group"><label>Notas</label>
            <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
          <button className="btn btn-gold" onClick={guardar}>✅ Registrar cheque</button>
        </div>

        <div className="card">
          <div className="card-title">Cheques registrados ({cheques.length})</div>
          {pag.items.map(ch => (
            <div key={ch.id} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 18, color: 'var(--gold)' }}>{ch.tipo === 'echeq' ? '📱' : '📄'} #{ch.numero}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ch.cliente_nombre}{ch.banco ? ' · ' + ch.banco : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ch.fecha_recepcion}{ch.fecha_pago ? ' → ' + ch.fecha_pago : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--green)' }}>{fmt(ch.monto)}</div>
                  <span className={`badge ${ch.destino === 'endoso' ? 'badge-amber' : 'badge-teal'}`}>
                    {ch.destino === 'endoso' ? '→ ' + ch.proveedor_nombre : 'Cta. Cte.'}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {cheques.length === 0 && <div className="empty">Sin cheques registrados</div>}
          <Paginador {...pag.controles} label="cheques" />
        </div>
      </div>
    </div>
  )
}
