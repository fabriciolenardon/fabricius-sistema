import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

function fmt(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }
function fmtKg(n) { return parseFloat(n || 0).toFixed(1) + ' kg' }

const camposIngresos = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transfMin', label: 'Transferencias minoristas' },
  { id: 'debito', label: 'Débito / QR (Payway + MP)' },
  { id: 'transfMay', label: 'Transferencias mayoristas' },
  { id: 'cheques', label: 'Cheques / E-cheq' },
  { id: 'ctacte', label: 'Cuentas corrientes cobradas' },
  { id: 'franquicias', label: 'Ventas a franquicias / sucursales' },
]
const descuentos = [
  { id: 'descMacro', label: 'Descuento Macro' },
  { id: 'descPayway', label: 'Descuento Payway' },
]

const initialIngresos = Object.fromEntries([...camposIngresos, ...descuentos].map(c => [c.id, '']))
const initialForm = { inicio: '', fin: '', compras: '', sueldos: '', gastos: '', socios: '', kgCarne: '', kgPollo: '', kgCerdo: '', kgMerma: '', ...initialIngresos }

export default function Cierre() {
  const [tab, setTab] = useState('semanal')
  const [form, setForm] = useState(initialForm)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState(null)
  const [mesSelector, setMesSelector] = useState('')

  useEffect(() => {
    fetchCierres()
    // Setear semana actual
    const hoy = new Date()
    const dia = hoy.getDay()
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() - (dia === 0 ? 6 : dia - 1))
    const sabado = new Date(lunes)
    sabado.setDate(lunes.getDate() + 5)
    setForm(f => ({ ...f, inicio: lunes.toISOString().split('T')[0], fin: sabado.toISOString().split('T')[0] }))
  }, [])

  async function fetchCierres() {
    const { data } = await supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false })
    setCierres(data || [])
    if (data?.length) setMesSelector(data[0].mes)
  }

  function calcular() {
    const totalIngresos = camposIngresos.reduce((s, c) => s + (parseFloat(form[c.id]) || 0), 0)
      - descuentos.reduce((s, c) => s + (parseFloat(form[c.id]) || 0), 0)
    const totalEgresos = ['compras', 'sueldos', 'gastos', 'socios'].reduce((s, k) => s + (parseFloat(form[k]) || 0), 0)
    return { totalIngresos, totalEgresos, ganancia: totalIngresos - totalEgresos }
  }

  async function guardarCierre() {
    if (!form.inicio || !form.fin) { setAlert({ type: 'error', msg: 'Seleccioná el período' }); return }
    setLoading(true)
    const { totalIngresos, totalEgresos, ganancia } = calcular()
    const mes = form.inicio.substring(0, 7)
    const ingresosCampos = Object.fromEntries([...camposIngresos, ...descuentos].map(c => [c.id, parseFloat(form[c.id]) || 0]))

    const { error } = await supabase.from('cierres_semanales').insert({
      semana_inicio: form.inicio,
      semana_fin: form.fin,
      mes,
      ventas: totalIngresos,
      compras: parseFloat(form.compras) || 0,
      gastos: (parseFloat(form.gastos) || 0) + (parseFloat(form.socios) || 0),
      sueldos: parseFloat(form.sueldos) || 0,
      ganancia,
      ingresos: ingresosCampos,
      kg_carne: parseFloat(form.kgCarne) || 0,
      kg_pollo: parseFloat(form.kgPollo) || 0,
      kg_cerdo: parseFloat(form.kgCerdo) || 0,
      kg_merma: parseFloat(form.kgMerma) || 0,
    })
    setLoading(false)
    if (error) { setAlert({ type: 'error', msg: 'Error al guardar: ' + error.message }); return }
    setAlert({ type: 'success', msg: '✅ Cierre semanal confirmado y guardado' })
    setForm(initialForm)
    fetchCierres()
    setTimeout(() => setAlert(null), 4000)
  }

  const { totalIngresos, totalEgresos, ganancia } = calcular()
  const meses = [...new Set(cierres.map(c => c.mes))].sort().reverse()
  const semanasMes = cierres.filter(c => c.mes === mesSelector)
  const totMes = { ventas: 0, compras: 0, gastos: 0, sueldos: 0, ganancia: 0, kgCarne: 0, kgPollo: 0, kgCerdo: 0 }
  semanasMes.forEach(c => { totMes.ventas += c.ventas; totMes.compras += c.compras; totMes.gastos += c.gastos; totMes.sueldos += c.sueldos; totMes.ganancia += c.ganancia; totMes.kgCarne += c.kg_carne; totMes.kgPollo += c.kg_pollo; totMes.kgCerdo += c.kg_cerdo })

  return (
    <div>
      <div className="page-title">CIERRE SEMANAL / MENSUAL</div>
      <div className="page-sub">Registrá los resultados financieros de cada semana</div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[{ id: 'semanal', label: '📋 Cierre semanal' }, { id: 'mensual', label: '📊 Cierre mensual' }, { id: 'historial', label: '📁 Historial' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? 'var(--green)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== SEMANAL ===== */}
      {tab === 'semanal' && (
        <div>
          {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

          <div className="card">
            <div className="card-title">Período</div>
            <div className="form-row">
              <div className="form-group"><label>Semana inicio</label><input type="date" value={form.inicio} onChange={e => setForm(f => ({ ...f, inicio: e.target.value }))} /></div>
              <div className="form-group"><label>Semana fin</label><input type="date" value={form.fin} onChange={e => setForm(f => ({ ...f, fin: e.target.value }))} /></div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">📥 Ingresos</div>
            <div className="form-row3">
              {camposIngresos.map(c => (
                <div key={c.id} className="form-group">
                  <label>{c.label}</label>
                  <input type="number" placeholder="0" value={form[c.id]} onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="form-row">
              {descuentos.map(c => (
                <div key={c.id} className="form-group">
                  <label>{c.label} (−)</label>
                  <input type="number" placeholder="0" value={form[c.id]} onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))} />
                </div>
              ))}
              <div className="form-group">
                <label>Total ingresos</label>
                <div style={{ padding: '9px 12px', background: 'var(--surface2)', border: '1px solid var(--green)', borderRadius: 8, fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--green)' }}>{fmt(totalIngresos)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">📤 Egresos</div>
            <div className="form-row4">
              {[{ id: 'compras', label: 'Compras proveedores' }, { id: 'sueldos', label: 'Sueldos' }, { id: 'gastos', label: 'Gastos operativos' }, { id: 'socios', label: 'Gastos Ariel + Fabri' }].map(c => (
                <div key={c.id} className="form-group">
                  <label>{c.label}</label>
                  <input type="number" placeholder="0" value={form[c.id]} onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Total egresos</label>
                <div style={{ padding: '9px 12px', background: 'var(--surface2)', border: '1px solid var(--red-light)', borderRadius: 8, fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--red-light)' }}>{fmt(totalEgresos)}</div>
              </div>
              <div className="form-group">
                <label>Ganancia neta</label>
                <div style={{ padding: '9px 12px', background: 'var(--surface2)', border: `1px solid ${ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)'}`, borderRadius: 8, fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)' }}>{fmt(ganancia)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">⚖️ Kilogramos</div>
            <div className="form-row4">
              {[{ id: 'kgCarne', label: 'Carne bovino (kg)' }, { id: 'kgPollo', label: 'Pollo (kg)' }, { id: 'kgCerdo', label: 'Cerdo (kg)' }, { id: 'kgMerma', label: 'Grasa / Merma (kg)' }].map(c => (
                <div key={c.id} className="form-group">
                  <label>{c.label}</label>
                  <input type="number" step="0.1" placeholder="0" value={form[c.id]} onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* RESULTADO */}
          <div className="card" style={{ borderColor: 'var(--gold)' }}>
            <div className="card-title">Resultado de la semana</div>
            <div className="grid4" style={{ marginBottom: 20 }}>
              {[
                { label: 'Ventas', val: totalIngresos, color: 'var(--green)' },
                { label: 'Compras', val: parseFloat(form.compras) || 0, color: 'var(--red-light)' },
                { label: 'Gastos + Socios', val: (parseFloat(form.gastos) || 0) + (parseFloat(form.socios) || 0), color: 'var(--amber)' },
                { label: 'Sueldos', val: parseFloat(form.sueldos) || 0, color: 'var(--blue)' },
              ].map(s => (
                <div key={s.label} className="stat">
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value" style={{ color: s.color }}>{fmt(s.val)}</div>
                </div>
              ))}
            </div>
            <div className="grid2" style={{ marginBottom: 16 }}>
              {[
                { nombre: '👑 Fabricio Lenardon', pct: 85, color: 'var(--gold)' },
                { nombre: '🤝 Ariel Garrone', pct: 15, color: 'var(--blue)' },
              ].map(s => (
                <div key={s.nombre} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{s.nombre}</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 40, color: s.color }}>{s.pct}%</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: ganancia >= 0 ? s.color : 'var(--red-light)' }}>{fmt(ganancia * s.pct / 100)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setForm(initialForm)}>Limpiar</button>
              <button className="btn btn-green" onClick={guardarCierre} disabled={loading}>
                {loading ? 'Guardando...' : '✅ Confirmar cierre semanal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MENSUAL ===== */}
      {tab === 'mensual' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
            <select value={mesSelector} onChange={e => setMesSelector(e.target.value)} style={{ width: 200 }}>
              {meses.map(m => <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</option>)}
            </select>
          </div>

          <div className="grid4" style={{ marginBottom: 24 }}>
            {[
              { label: 'Ventas del mes', val: totMes.ventas, color: 'var(--green)' },
              { label: 'Compras', val: totMes.compras, color: 'var(--red-light)' },
              { label: 'Gastos', val: totMes.gastos, color: 'var(--amber)' },
              { label: 'Ganancia', val: totMes.ganancia, color: totMes.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)' },
            ].map(s => (
              <div key={s.label} className="stat">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color }}>{fmt(s.val)}</div>
                <div className="stat-sub">{semanasMes.length} semanas</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">Semanas del mes</div>
            <table>
              <thead><tr><th>Período</th><th>Ventas</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th><th>Kg Carne</th><th>Kg Pollo</th><th>Kg Cerdo</th></tr></thead>
              <tbody>
                {semanasMes.map(c => (
                  <tr key={c.id} style={{ background: c.ganancia < 0 ? 'rgba(192,57,43,0.05)' : 'rgba(39,174,96,0.03)' }}>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>
                      {new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} →{' '}
                      {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                    </td>
                    <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                    <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                    <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                    <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                    <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                    <td>{fmtKg(c.kg_carne)}</td>
                    <td>{fmtKg(c.kg_pollo)}</td>
                    <td>{fmtKg(c.kg_cerdo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td>TOTAL</td>
                  <td style={{ color: 'var(--green)' }}>{fmt(totMes.ventas)}</td>
                  <td style={{ color: 'var(--red-light)' }}>{fmt(totMes.compras)}</td>
                  <td style={{ color: 'var(--amber)' }}>{fmt(totMes.gastos)}</td>
                  <td style={{ color: 'var(--blue)' }}>{fmt(totMes.sueldos)}</td>
                  <td style={{ color: totMes.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)' }}>{fmt(totMes.ganancia)}</td>
                  <td>{fmtKg(totMes.kgCarne)}</td>
                  <td>{fmtKg(totMes.kgPollo)}</td>
                  <td>{fmtKg(totMes.kgCerdo)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid2">
            <div className="card">
              <div className="card-title">Distribución socios</div>
              {[{ nombre: '👑 Fabricio (85%)', pct: 0.85, color: 'var(--gold)' }, { nombre: '🤝 Ariel (15%)', pct: 0.15, color: 'var(--blue)' }].map(s => (
                <div key={s.nombre} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span>{s.nombre}</span>
                    <span style={{ color: s.color, fontFamily: "'Bebas Neue', cursive", fontSize: 18 }}>{fmt(totMes.ganancia * s.pct)}</span>
                  </div>
                  <div style={{ background: 'var(--border)', borderRadius: 4, height: 8 }}>
                    <div style={{ height: 8, borderRadius: 4, background: s.color, width: (s.pct * 100) + '%' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-title">Kg totales del mes</div>
              {[
                { label: '🥩 Carne bovina', kg: totMes.kgCarne, color: 'var(--gold)' },
                { label: '🍗 Pollo', kg: totMes.kgPollo, color: 'var(--blue)' },
                { label: '🐷 Cerdo', kg: totMes.kgCerdo, color: 'var(--amber)' },
              ].map(k => {
                const total = totMes.kgCarne + totMes.kgPollo + totMes.kgCerdo || 1
                return (
                  <div key={k.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{k.label}</span><span style={{ color: k.color }}>{fmtKg(k.kg)}</span>
                    </div>
                    <div style={{ background: 'var(--border)', borderRadius: 4, height: 8 }}>
                      <div style={{ height: 8, borderRadius: 4, background: k.color, width: (k.kg / total * 100) + '%', transition: 'width 0.5s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== HISTORIAL ===== */}
      {tab === 'historial' && (
        <div className="card">
          <table>
            <thead><tr><th>Período</th><th>Ventas</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th></tr></thead>
            <tbody>
              {cierres.map(c => (
                <tr key={c.id} style={{ background: c.ganancia < 0 ? 'rgba(192,57,43,0.05)' : undefined }}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{c.semana_inicio} / {c.semana_fin}</td>
                  <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                  <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                  <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                  <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                  <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
