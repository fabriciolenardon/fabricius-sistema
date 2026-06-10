// Cheques.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { parseNumero, fmtPrecio } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'

// Reemplaza el fmt local por el helper centralizado que respeta decimales
const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

// Días que faltan para una fecha 'YYYY-MM-DD' (negativo = ya pasó)
function diasHasta(fecha) {
  if (!fecha) return null
  const hoy = new Date(fechaHoyARG() + 'T12:00')
  const f = new Date(fecha + 'T12:00')
  return Math.round((f - hoy) / (1000 * 60 * 60 * 24))
}
function fmtFecha(f) {
  if (!f) return '—'
  const [y, m, d] = String(f).substring(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const FORM_RECIBIDO = { numero: '', fechaRec: fechaHoyARG(), fechaPago: '', banco: '', clienteId: '', monto: '', destino: 'ctacte', proveedor: '', notas: '' }
const FORM_EMITIDO = { numero: '', fechaEmision: fechaHoyARG(), fechaPago: '', banco: '', beneficiario: '', monto: '', notas: '' }

const BANCOS = ['Banco Macro', 'Banco Nación', 'Banco Provincia', 'BBVA', 'Santander', 'Galicia', 'HSBC', 'ICBC', 'Credicoop', 'Otro']

export default function Cheques() {
  const [cheques, setCheques] = useState([])
  const [clientes, setClientes] = useState([])
  const [vista, setVista] = useState('recibidos') // 'recibidos' | 'emitidos'
  const [tipo, setTipo] = useState('fisico')
  const [tipoEm, setTipoEm] = useState('fisico')
  const [form, setForm] = useState(FORM_RECIBIDO)
  const [formEm, setFormEm] = useState(FORM_EMITIDO)
  const [alert, setAlert] = useState(null)

  const recibidos = cheques.filter(ch => ch.origen !== 'emitido')
  const emitidos = cheques.filter(ch => ch.origen === 'emitido')

  // Paginación de cada listado — el historial puede tener cientos de cheques
  const pag = usePaginacion(recibidos, 20)
  const pagEm = usePaginacion(emitidos, 20)

  useEffect(() => { fetchCheques(); fetchClientes() }, [])

  function fetchCheques() {
    supabase.from('cheques').select('*').order('fecha_recepcion', { ascending: false }).then(({ data }) => setCheques(data || []))
  }
  function fetchClientes() {
    supabase.from('clientes').select('id, nombre').order('nombre').then(({ data }) => setClientes(data || []))
  }

  function showAlert(msg, type = 'success') {
    setAlert({ type, msg })
    setTimeout(() => setAlert(null), 4000)
  }

  async function guardar() {
    if (!form.numero || !form.monto || !form.clienteId) { setAlert({ type: 'error', msg: 'Completá número, cliente y monto' }); return }
    const cliente = clientes.find(c => c.id === form.clienteId)
    const { error } = await supabase.from('cheques').insert({
      origen: 'recibido',
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
    showAlert(`✅ ${tipo === 'echeq' ? 'E-cheq' : 'Cheque'} #${form.numero} registrado`)
    setForm(f => ({ ...f, numero: '', monto: '', notas: '', banco: '' }))
    fetchCheques()
  }

  // Registrar un cheque EMITIDO PROPIO (entregado a un proveedor/tercero).
  // Queda 'pendiente' hasta que llegue su fecha y lo imputemos (= levantamos).
  async function guardarEmitido() {
    if (!formEm.numero || !formEm.monto || !formEm.fechaPago) { setAlert({ type: 'error', msg: 'Completá número, monto y fecha de pago' }); return }
    const { error } = await supabase.from('cheques').insert({
      origen: 'emitido', estado: 'pendiente',
      tipo: tipoEm, numero: formEm.numero,
      fecha_recepcion: formEm.fechaEmision,   // para emitidos = fecha de emisión
      fecha_pago: formEm.fechaPago,
      banco: formEm.banco,
      proveedor_nombre: formEm.beneficiario,  // beneficiario del cheque
      monto: parseNumero(formEm.monto), notas: formEm.notas,
    })
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    showAlert(`✅ Cheque propio #${formEm.numero} registrado — se debita el ${fmtFecha(formEm.fechaPago)}`)
    setFormEm(f => ({ ...f, numero: '', monto: '', notas: '', beneficiario: '' }))
    fetchCheques()
  }

  // Imputar = levantamos el cheque: cubrimos el gasto, los fondos están.
  async function imputar(ch) {
    if (!confirm(`¿Imputar el cheque #${ch.numero} por $${fmt(ch.monto)}?\n\nEsto marca que el cheque fue cubierto (levantado).`)) return
    const { error } = await supabase.from('cheques')
      .update({ estado: 'imputado', fecha_imputado: fechaHoyARG() })
      .eq('id', ch.id)
    if (error) { showAlert(error.message, 'error'); return }
    showAlert(`✅ Cheque #${ch.numero} imputado — gasto cubierto`)
    fetchCheques()
  }

  async function desimputar(ch) {
    if (!confirm(`¿Volver a PENDIENTE el cheque #${ch.numero}? (deshacer la imputación)`)) return
    const { error } = await supabase.from('cheques')
      .update({ estado: 'pendiente', fecha_imputado: null })
      .eq('id', ch.id)
    if (error) { showAlert(error.message, 'error'); return }
    showAlert(`↩️ Cheque #${ch.numero} vuelve a pendiente`)
    fetchCheques()
  }

  // Emitidos pendientes cuya fecha ya llegó (hoy o vencidos) → hay que cubrirlos
  const aCubrir = emitidos.filter(ch => ch.estado !== 'imputado' && diasHasta(ch.fecha_pago) !== null && diasHasta(ch.fecha_pago) <= 0)
  const porVencerEm = emitidos.filter(ch => {
    const d = diasHasta(ch.fecha_pago)
    return ch.estado !== 'imputado' && d !== null && d > 0 && d <= 7
  })

  return (
    <div>
      <div className="page-title">CHEQUES / E-CHEQ</div>
      <div className="page-sub">Recibidos de clientes y emitidos propios</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      {/* AVISO: cheques propios cuya fecha llegó — hay que levantarlos */}
      {aCubrir.length > 0 && (
        <div style={{ background: '#2a0e0e', border: '2px solid var(--red-light)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-light)', marginBottom: 6 }}>
            🚨 {aCubrir.length} cheque{aCubrir.length !== 1 ? 's' : ''} propio{aCubrir.length !== 1 ? 's' : ''} para cubrir — llegó la fecha de pago
          </div>
          {aCubrir.map(ch => (
            <div key={ch.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text2)', padding: '4px 0', flexWrap: 'wrap' }}>
              <span>#{ch.numero} — {ch.proveedor_nombre || 'sin beneficiario'} — <b style={{ color: 'var(--red-light)' }}>${fmt(ch.monto)}</b> — {diasHasta(ch.fecha_pago) === 0 ? 'se debita HOY' : `venció el ${fmtFecha(ch.fecha_pago)}`}</span>
              <button className="btn btn-gold btn-sm" onClick={() => imputar(ch)}>✅ Imputar (levantar)</button>
            </div>
          ))}
        </div>
      )}
      {porVencerEm.length > 0 && (
        <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>⚠️ Cheques propios próximos a debitarse</div>
          {porVencerEm.map(ch => (
            <div key={ch.id} style={{ fontSize: 12, color: 'var(--text2)' }}>
              #{ch.numero} — {ch.proveedor_nombre || 'sin beneficiario'} — ${fmt(ch.monto)} — en {diasHasta(ch.fecha_pago)} día{diasHasta(ch.fecha_pago) !== 1 ? 's' : ''} ({fmtFecha(ch.fecha_pago)})
            </div>
          ))}
        </div>
      )}

      {/* TABS Recibidos / Emitidos */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { id: 'recibidos', label: `📥 Recibidos (${recibidos.length})` },
          { id: 'emitidos', label: `📤 Emitidos propios (${emitidos.length})${aCubrir.length ? ` 🚨${aCubrir.length}` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setVista(t.id)}
            style={{ padding: '9px 18px', borderRadius: 8, border: `2px solid ${vista === t.id ? 'var(--gold)' : 'var(--border)'}`, background: vista === t.id ? 'var(--gold)' : 'transparent', color: vista === t.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'recibidos' ? (
      <div className="grid2">
        <div className="card">
          <div className="card-title">Registrar cheque recibido</div>
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
                {BANCOS.map(b => <option key={b}>{b}</option>)}
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
          <div className="card-title">Cheques recibidos ({recibidos.length})</div>
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
          {recibidos.length === 0 && <div className="empty">Sin cheques registrados</div>}
          <Paginador {...pag.controles} label="cheques" />
        </div>
      </div>
      ) : (
      <div className="grid2">
        {/* FORM EMITIDO PROPIO */}
        <div className="card">
          <div className="card-title">Registrar cheque emitido propio</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            Cheque que entregamos a un proveedor o tercero. Cuando llegue la fecha de pago aparece el aviso y el botón <b>Imputar</b> para marcar que lo levantamos (cubrimos el gasto).
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {['fisico', 'echeq'].map(t => (
              <button key={t} onClick={() => setTipoEm(t)}
                style={{ padding: '8px 18px', borderRadius: 8, border: `2px solid ${tipoEm === t ? (t === 'echeq' ? 'var(--purple)' : 'var(--blue)') : 'var(--border)'}`, background: tipoEm === t ? (t === 'echeq' ? '#2a1a3a' : '#1a2a3a') : 'transparent', color: tipoEm === t ? (t === 'echeq' ? '#c084fc' : '#93c5fd') : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
                {t === 'fisico' ? '📄 Cheque físico' : '📱 E-cheq'}
              </button>
            ))}
          </div>
          <div className="form-row">
            <div className="form-group"><label>Número de serie</label>
              <input value={formEm.numero} onChange={e => setFormEm(f => ({ ...f, numero: e.target.value }))} placeholder="00012345" />
            </div>
            <div className="form-group"><label>Fecha de emisión</label>
              <input type="date" value={formEm.fechaEmision} onChange={e => setFormEm(f => ({ ...f, fechaEmision: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Fecha de pago (se debita)</label>
              <input type="date" value={formEm.fechaPago} onChange={e => setFormEm(f => ({ ...f, fechaPago: e.target.value }))} />
            </div>
            <div className="form-group"><label>Banco (nuestro)</label>
              <select value={formEm.banco} onChange={e => setFormEm(f => ({ ...f, banco: e.target.value }))}>
                <option value="">— Seleccioná —</option>
                {BANCOS.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>Beneficiario (a quién se lo dimos)</label>
            <input value={formEm.beneficiario} onChange={e => setFormEm(f => ({ ...f, beneficiario: e.target.value }))} placeholder="Ej: PRETTO, contador, alquiler..." />
          </div>
          <div className="form-group"><label>Monto ($)</label>
            <input type="number" value={formEm.monto} onChange={e => setFormEm(f => ({ ...f, monto: e.target.value }))} />
          </div>
          <div className="form-group"><label>Notas</label>
            <input value={formEm.notas} onChange={e => setFormEm(f => ({ ...f, notas: e.target.value }))} placeholder="Qué pagamos con este cheque..." />
          </div>
          <button className="btn btn-gold" onClick={guardarEmitido}>✅ Registrar cheque propio</button>
        </div>

        {/* LISTADO EMITIDOS */}
        <div className="card">
          <div className="card-title">Cheques emitidos ({emitidos.length})</div>
          {pagEm.items.map(ch => {
            const d = diasHasta(ch.fecha_pago)
            const imputado = ch.estado === 'imputado'
            const vencido = !imputado && d !== null && d <= 0
            const proximo = !imputado && d !== null && d > 0 && d <= 7
            return (
              <div key={ch.id} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 10, border: vencido ? '1px solid var(--red-light)' : proximo ? '1px solid var(--amber)' : '1px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 18, color: 'var(--gold)' }}>{ch.tipo === 'echeq' ? '📱' : '📄'} #{ch.numero}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>→ {ch.proveedor_nombre || 'sin beneficiario'}{ch.banco ? ' · ' + ch.banco : ''}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Emitido {fmtFecha(ch.fecha_recepcion)} · paga {fmtFecha(ch.fecha_pago)}</div>
                    {ch.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{ch.notas}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: imputado ? 'var(--green)' : 'var(--red-light)' }}>−{fmt(ch.monto)}</div>
                    {imputado
                      ? <span className="badge badge-teal">✅ Imputado {ch.fecha_imputado ? fmtFecha(ch.fecha_imputado) : ''}</span>
                      : vencido
                        ? <span className="badge" style={{ background: '#3a1a1a', color: 'var(--red-light)', border: '1px solid var(--red-light)' }}>🚨 {d === 0 ? 'Se debita HOY' : `Venció hace ${-d}d`}</span>
                        : proximo
                          ? <span className="badge badge-amber">⏳ En {d} día{d !== 1 ? 's' : ''}</span>
                          : <span className="badge" style={{ background: '#1a2a3a', color: '#93c5fd' }}>Pendiente{d !== null ? ` · ${d}d` : ''}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                  {!imputado && (
                    <button className={vencido ? 'btn btn-gold btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => imputar(ch)}>
                      ✅ Imputar (levantar cheque)
                    </button>
                  )}
                  {imputado && (
                    <button className="btn btn-ghost btn-sm" onClick={() => desimputar(ch)} title="Deshacer imputación">↩️ Deshacer</button>
                  )}
                </div>
              </div>
            )
          })}
          {emitidos.length === 0 && <div className="empty">Sin cheques emitidos.<br /><span style={{ fontSize: 12 }}>Registrá acá los cheques que entregás a proveedores o terceros.</span></div>}
          <Paginador {...pagEm.controles} label="cheques" />
        </div>
      </div>
      )}
    </div>
  )
}
