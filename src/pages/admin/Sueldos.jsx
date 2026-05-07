// Sueldos.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const FERIADOS_INAM = ['2026-01-01','2026-02-16','2026-02-17','2026-03-24','2026-04-02','2026-04-03','2026-05-01','2026-05-25','2026-06-20','2026-07-09','2026-08-17','2026-10-12','2026-11-20','2026-12-08','2026-12-25']
const FERIADOS_NOLAB = ['2026-04-17','2026-11-23']

function horasPorDia(fechaStr, horasDiarias = 9) {
  const d = new Date(fechaStr + 'T12:00:00')
  if (d.getDay() === 0) return 0
  if (FERIADOS_NOLAB.includes(fechaStr)) return horasDiarias / 2
  return horasDiarias
}

function fmt(n) { return '$' + Math.round(n || 0).toLocaleString('es-AR') }

export default function Sueldos() {
  const [tab, setTab] = useState('liquidacion')
  const [empleados, setEmpleados] = useState([])
  const [liquidaciones, setLiquidaciones] = useState([])
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')
  const [horas, setHoras] = useState({})
  const [boletas, setBoletas] = useState({})
  const [ventas, setVentas] = useState({})
  const [alert, setAlert] = useState(null)

  useEffect(() => {
    supabase.from('empleados').select('*').eq('activo', true).order('apellido').then(({ data }) => setEmpleados(data || []))
    supabase.from('liquidaciones_sueldos').select('*').order('semana_inicio', { ascending: false }).limit(30).then(({ data }) => setLiquidaciones(data || []))
    const hoy = new Date()
    const dia = hoy.getDay()
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - (dia === 0 ? 6 : dia - 1))
    const sabado = new Date(lunes); sabado.setDate(lunes.getDate() + 5)
    setInicio(lunes.toISOString().split('T')[0])
    setFin(sabado.toISOString().split('T')[0])
  }, [])

  function getDias() {
    if (!inicio || !fin) return []
    const dias = []
    let cur = new Date(inicio + 'T12:00'); const end = new Date(fin + 'T12:00')
    while (cur <= end) {
      const fs = cur.toISOString().split('T')[0]
      dias.push({ fecha: fs, horas: horasPorDia(fs) })
      cur.setDate(cur.getDate() + 1)
    }
    return dias
  }

  const dias = getDias()
  const totalHorasDisp = dias.reduce((s, d) => s + d.horas, 0)

  function calcNeto(emp) {
    const h = parseFloat(horas[emp.id] ?? totalHorasDisp) || 0
    const b = parseFloat(boletas[emp.id]) || 0
    const v = parseFloat(ventas[emp.id]) || 0
    let bruto = 0
    if (emp.modalidad === 'hora') bruto = h * emp.valor_hora
    else if (emp.modalidad === 'mixto') bruto = h * emp.valor_hora + (emp.fijo_semanal || 0)
    else bruto = v * (emp.comision_pct / 100)
    return { bruto, neto: Math.max(0, bruto - b), h, b }
  }

  async function guardarLiquidacion() {
    if (!inicio || !fin) { setAlert({ type: 'error', msg: 'Seleccioná el período' }); return }
    const rows = empleados.map(emp => {
      const { bruto, neto, h, b } = calcNeto(emp)
      return { semana_inicio: inicio, semana_fin: fin, empleado_id: emp.id, empleado_nombre: `${emp.apellido}, ${emp.nombre}`, horas: h, bruto, boletas: b, neto }
    }).filter(r => r.bruto > 0 || r.neto > 0)
    const { error } = await supabase.from('liquidaciones_sueldos').insert(rows)
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    setAlert({ type: 'success', msg: '✅ Liquidación confirmada' })
    supabase.from('liquidaciones_sueldos').select('*').order('semana_inicio', { ascending: false }).limit(30).then(({ data }) => setLiquidaciones(data || []))
    setTimeout(() => setAlert(null), 4000)
  }

  return (
    <div>
      <div className="page-title">SUELDOS</div>
      <div className="page-sub">Liquidación semanal con feriados argentinos</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[{ id: 'liquidacion', label: '💰 Liquidación' }, { id: 'empleados', label: '👥 Empleados' }, { id: 'historial', label: '📋 Historial' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? 'var(--purple)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

      {tab === 'liquidacion' && (
        <div>
          <div className="card">
            <div className="card-title">Período de la semana</div>
            <div className="form-row">
              <div className="form-group"><label>Inicio</label><input type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></div>
              <div className="form-group"><label>Fin</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Horas disponibles: <strong style={{ color: 'var(--gold)' }}>{totalHorasDisp}h</strong>
              {dias.some(d => FERIADOS_NOLAB.includes(d.fecha)) && <span className="badge badge-amber" style={{ marginLeft: 8 }}>Hay feriados no laborables esta semana</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {empleados.map(emp => {
              const { bruto, neto } = calcNeto(emp)
              const modalLabel = emp.modalidad === 'hora' ? `$${emp.valor_hora?.toLocaleString()}/h` : emp.modalidad === 'mixto' ? `$${emp.valor_hora?.toLocaleString()}/h + fijo` : `${emp.comision_pct}% ventas`
              return (
                <div key={emp.id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.apellido}, {emp.nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{modalLabel}</div>
                    </div>
                    <span className="badge badge-purple">{emp.modalidad === 'comision' ? 'COMISIÓN' : emp.modalidad === 'mixto' ? 'HORA+FIJO' : 'POR HORA'}</span>
                  </div>
                  {emp.modalidad === 'comision' ? (
                    <div className="form-group"><label>Total ventas semana ($)</label>
                      <input type="number" placeholder="0" value={ventas[emp.id] || ''} onChange={e => setVentas(v => ({ ...v, [emp.id]: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="form-group"><label>Horas trabajadas</label>
                      <input type="number" step="0.5" value={horas[emp.id] ?? totalHorasDisp} onChange={e => setHoras(h => ({ ...h, [emp.id]: e.target.value }))} />
                    </div>
                  )}
                  <div className="form-group"><label>Boletas / Descuentos ($)</label>
                    <input type="number" placeholder="0" value={boletas[emp.id] || ''} onChange={e => setBoletas(b => ({ ...b, [emp.id]: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Bruto: <strong>{fmt(bruto)}</strong></span>
                    <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)' }}>{fmt(neto)}</span>
                  </div>
                  {emp.cbu && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>📲 {emp.cbu}</div>}
                </div>
              )
            })}
          </div>

          <div className="card" style={{ borderColor: 'var(--purple)' }}>
            <div className="card-title">Resumen</div>
            <table>
              <thead><tr><th>Empleado</th><th>Horas</th><th>Bruto</th><th>Boletas</th><th>Neto</th></tr></thead>
              <tbody>
                {empleados.map(emp => {
                  const { bruto, neto, h, b } = calcNeto(emp)
                  return <tr key={emp.id}>
                    <td><strong>{emp.apellido}, {emp.nombre}</strong></td>
                    <td>{emp.modalidad === 'comision' ? '—' : h + 'h'}</td>
                    <td style={{ color: 'var(--purple)' }}>{fmt(bruto)}</td>
                    <td style={{ color: 'var(--red-light)' }}>{fmt(b)}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(neto)}</td>
                  </tr>
                })}
                <tr className="total-row">
                  <td colSpan={2}>TOTAL</td>
                  <td style={{ color: 'var(--purple)' }}>{fmt(empleados.reduce((s, e) => s + calcNeto(e).bruto, 0))}</td>
                  <td style={{ color: 'var(--red-light)' }}>{fmt(empleados.reduce((s, e) => s + calcNeto(e).b, 0))}</td>
                  <td style={{ color: 'var(--gold)' }}>{fmt(empleados.reduce((s, e) => s + calcNeto(e).neto, 0))}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--purple)', borderColor: 'var(--purple)' }} onClick={guardarLiquidacion}>✅ Confirmar liquidación</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'empleados' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {empleados.map(emp => (
            <div key={emp.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{emp.apellido}, {emp.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{emp.puesto}</div>
                </div>
                <span className="badge badge-purple">{emp.modalidad === 'comision' ? 'COMISIÓN' : 'POR HORA'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }}>
                {emp.dni && <span style={{ color: 'var(--muted)' }}>DNI: <strong style={{ color: 'var(--text2)' }}>{emp.dni}</strong></span>}
                {emp.sangre && <span style={{ color: 'var(--muted)' }}>Sangre: <strong style={{ color: 'var(--red-light)' }}>🩸 {emp.sangre}</strong></span>}
                {emp.telefono && <span style={{ color: 'var(--muted)' }}>Tel: {emp.telefono}</span>}
                {emp.ingreso && <span style={{ color: 'var(--muted)' }}>Ingreso: {emp.ingreso}</span>}
                {emp.cbu && <span style={{ color: 'var(--muted)', gridColumn: '1/-1' }}>📲 {emp.cbu}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <table>
            <thead><tr><th>Semana</th><th>Empleado</th><th>Horas</th><th>Bruto</th><th>Boletas</th><th>Neto</th></tr></thead>
            <tbody>
              {liquidaciones.map(l => (
                <tr key={l.id}>
                  <td style={{ fontSize: 12 }}>{l.semana_inicio} / {l.semana_fin}</td>
                  <td><strong>{l.empleado_nombre}</strong></td>
                  <td>{l.horas ? l.horas + 'h' : '—'}</td>
                  <td style={{ color: 'var(--purple)' }}>{fmt(l.bruto)}</td>
                  <td style={{ color: 'var(--red-light)' }}>{fmt(l.boletas)}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(l.neto)}</td>
                </tr>
              ))}
              {liquidaciones.length === 0 && <tr><td colSpan={6} className="empty">Sin liquidaciones</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
