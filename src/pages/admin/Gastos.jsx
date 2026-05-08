// Gastos.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'

function fmt(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

export default function Gastos() {
  const [gastos, setGastos] = useState([])
  const [tipo, setTipo] = useState('variable')
  const [form, setForm] = useState({ fecha: new Date().toISOString().split('T')[0], categoria: '', descripcion: '', monto: '', forma: 'efectivo', socio: 'fabricio', origenIngreso: '', notas: '' })
  const [alert, setAlert] = useState(null)

  useEffect(() => { fetchGastos() }, [])
  async function fetchGastos() {
    const { data } = await supabase.from('gastos').select('*').order('fecha', { ascending: false }).limit(50)
    setGastos(data || [])
  }

  async function guardar() {
    if (!form.descripcion || !form.monto) { setAlert({ type: 'error', msg: 'Completá descripción y monto' }); return }
    const { error } = await supabase.from('gastos').insert({
      fecha: form.fecha, tipo, categoria: tipo === 'socio' ? '' : form.categoria,
      descripcion: form.descripcion, monto: parseFloat(form.monto),
      forma: form.forma, socio: tipo === 'socio' ? form.socio : null,
      origen_ingreso: tipo === 'ingreso' ? form.origenIngreso : null, notas: form.notas
    })
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    setAlert({ type: 'success', msg: '✅ Registrado' })
    setForm(f => ({ ...f, descripcion: '', monto: '', notas: '' }))
    fetchGastos()
    setTimeout(() => setAlert(null), 3000)
  }

  const totVar = gastos.filter(g => g.tipo === 'variable').reduce((s, g) => s + g.monto, 0)
  const totFijo = gastos.filter(g => g.tipo === 'fijo').reduce((s, g) => s + g.monto, 0)
  const totSocio = gastos.filter(g => g.tipo === 'socio').reduce((s, g) => s + g.monto, 0)
  const totIngreso = gastos.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + g.monto, 0)
  const tipos = [
    { id: 'variable', label: '💸 Variable', color: 'var(--red-light)' },
    { id: 'fijo', label: '📌 Fijo', color: 'var(--blue)' },
    { id: 'socio', label: '👤 Socio', color: 'var(--gold)' },
    { id: 'ingreso', label: '💰 Ingreso', color: 'var(--green)' }
  ]

  return (
    <div>
      <div className="page-title">GASTOS</div>
      <div className="page-sub">Variables, fijos, socios e ingresos extra</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      <div className="grid4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Variables', val: totVar, color: 'var(--red-light)' },
          { label: 'Fijos', val: totFijo, color: 'var(--blue)' },
          { label: 'Socios', val: totSocio, color: 'var(--gold)' },
          { label: 'Ingresos extra', val: totIngreso, color: 'var(--green)' }
        ].map(s => (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{fmt(s.val)}</div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Cargar registro</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {tipos.map(t => (
              <button key={t.id} onClick={() => setTipo(t.id)}
                style={{ padding: '7px 14px', borderRadius: 8, border: `2px solid ${tipo === t.id ? t.color : 'var(--border)'}`, background: tipo === t.id ? t.color + '22' : 'transparent', color: tipo === t.id ? t.color : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            <div className="form-group"><label>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            {tipo === 'socio' && (
              <div className="form-group"><label>Socio</label>
                <select value={form.socio} onChange={e => setForm(f => ({ ...f, socio: e.target.value }))}>
                  <option value="fabricio">Fabricio Lenardon</option>
                  <option value="ariel">Ariel Garrone</option>
                </select>
              </div>
            )}
            {tipo !== 'socio' && tipo !== 'ingreso' && (
              <div className="form-group"><label>Categoría</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                  <option value="">— Seleccioná —</option>
                  <option value="vehiculo">🚗 Vehículo</option>
                  <option value="peaje">🛣️ Peaje</option>
                  <option value="insumos">📦 Insumos</option>
                  <option value="limpieza">🧹 Limpieza</option>
                  <option value="tripas">🔗 Tripas</option>
                  <option value="art">🏥 ART</option>
                  <option value="impuestos">📋 Impuestos / ARCA</option>
                  <option value="luz">💡 Luz</option>
                  <option value="alquiler">🏠 Alquiler</option>
                  <option value="redes">📱 Diseño / Redes</option>
                  <option value="otro">📝 Otro</option>
                </select>
              </div>
            )}
            {tipo === 'ingreso' && (
              <div className="form-group"><label>Origen</label>
                <select value={form.origenIngreso} onChange={e => setForm(f => ({ ...f, origenIngreso: e.target.value }))}>
                  <option value="alquiler_sucursal">🏠 Alquiler Sucursal Barrio Sur</option>
                  <option value="alquiler_maquinas">⚙️ Alquiler máquinas</option>
                  <option value="contrato">📋 Pago contrato</option>
                  <option value="otro">💰 Otro ingreso</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-group"><label>Descripción</label>
            <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: Mecánico Kangoo, ART Roxana..." />
          </div>

          <div className="form-row">
            <div className="form-group"><label>Monto ($)</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
            </div>
            <div className="form-group"><label>Forma de pago</label>
              <select value={form.forma} onChange={e => setForm(f => ({ ...f, forma: e.target.value }))}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">📲 Transferencia</option>
                <option value="debito">💳 Débito</option>
                <option value="cheque">📄 Cheque</option>
              </select>
            </div>
          </div>

          <button className="btn btn-gold" onClick={guardar}>✅ Registrar</button>
        </div>

        <div className="card">
          <div className="card-title">Últimos registros</div>
          {gastos.slice(0, 15).map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{g.descripcion}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{g.fecha} · {g.tipo}{g.socio ? ' · ' + g.socio : ''}</div>
              </div>
              <span style={{ fontWeight: 700, color: g.tipo === 'ingreso' ? 'var(--green)' : 'var(--red-light)' }}>
                {g.tipo === 'ingreso' ? '+' : '−'}{fmt(g.monto)}
              </span>
            </div>
          ))}
          {gastos.length === 0 && <div className="empty">Sin registros</div>}
        </div>
      </div>
    </div>
  )
}
