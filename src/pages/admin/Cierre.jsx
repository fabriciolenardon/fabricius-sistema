import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'

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

function exportarExcel(semanasMes, totMes, mesLabel) {
  const rows = [
    ['CARNICERÍAS FABRICIUS — CIERRE MENSUAL'],
    [mesLabel.toUpperCase()],
    [],
    ['Período', 'Ventas', 'Compras', 'Gastos', 'Sueldos', 'Ganancia', 'Kg Carne', 'Kg Pollo', 'Kg Cerdo'],
    ...semanasMes.map(c => [
      `${new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR')} → ${new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR')}`,
      c.ventas, c.compras, c.gastos, c.sueldos, c.ganancia, c.kg_carne, c.kg_pollo, c.kg_cerdo
    ]),
    [],
    ['TOTAL', totMes.ventas, totMes.compras, totMes.gastos, totMes.sueldos, totMes.ganancia, totMes.kgCarne, totMes.kgPollo, totMes.kgCerdo],
    [],
    ['Distribución socios'],
    ['Fabricio Lenardon (85%)', totMes.ganancia * 0.85],
    ['Ariel Garrone (15%)', totMes.ganancia * 0.15],
  ]

  const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cierre_${mesLabel.replace(/ /g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function imprimirCierreMensual(semanasMes, totMes, mesLabel) {
  const win = window.open('', '_blank')
  win.document.write(`
    <html><head><title>Cierre Mensual — ${mesLabel}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; color: #000; }
      .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 12px; }
      .logo { font-size: 28px; font-weight: 900; letter-spacing: 3px; }
      .sub { font-size: 11px; color: #555; }
      .titulo { font-size: 16px; font-weight: 700; margin: 12px 0 4px; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th { background: #000; color: #fff; padding: 6px 8px; text-align: center; font-size: 10px; }
      td { border: 1px solid #ccc; padding: 6px 8px; text-align: center; font-size: 11px; }
      td:first-child { text-align: left; font-weight: 600; }
      .total-row td { background: #f0f0f0; font-weight: 700; border-top: 2px solid #000; }
      .verde { color: #1a7a1a; }
      .rojo { color: #c0392b; }
      .oro { color: #b8860b; font-weight: 700; }
      .socios { display: flex; gap: 20px; margin-top: 16px; }
      .socio { flex: 1; border: 1px solid #000; padding: 12px; text-align: center; }
      .socio-nombre { font-weight: 700; font-size: 13px; }
      .socio-valor { font-size: 22px; font-weight: 900; margin-top: 4px; }
      @media print { body { padding: 10px; } }
    </style></head>
    <body>
      <div class="header">
        <div class="logo">FABRICIUS</div>
        <div class="sub">CARNICERÍAS · PREMIUM QUALITY · Río Primero, Córdoba</div>
        <div class="titulo">CIERRE MENSUAL — ${mesLabel.toUpperCase()}</div>
        <div class="sub">Generado: ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      </div>

      <table>
        <thead><tr>
          <th>Período</th><th>Ventas</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th><th>Kg Carne</th><th>Kg Pollo</th><th>Kg Cerdo</th>
        </tr></thead>
        <tbody>
          ${semanasMes.map(c => `<tr>
            <td>${new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} → ${new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
            <td class="verde">$${Math.round(c.ventas).toLocaleString('es-AR')}</td>
            <td class="rojo">$${Math.round(c.compras).toLocaleString('es-AR')}</td>
            <td>$${Math.round(c.gastos).toLocaleString('es-AR')}</td>
            <td>$${Math.round(c.sueldos).toLocaleString('es-AR')}</td>
            <td class="${c.ganancia >= 0 ? 'oro' : 'rojo'}">$${Math.round(c.ganancia).toLocaleString('es-AR')}</td>
            <td>${c.kg_carne?.toFixed(1)} kg</td>
            <td>${c.kg_pollo?.toFixed(1)} kg</td>
            <td>${c.kg_cerdo?.toFixed(1)} kg</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="verde">$${Math.round(totMes.ventas).toLocaleString('es-AR')}</td>
            <td class="rojo">$${Math.round(totMes.compras).toLocaleString('es-AR')}</td>
            <td>$${Math.round(totMes.gastos).toLocaleString('es-AR')}</td>
            <td>$${Math.round(totMes.sueldos).toLocaleString('es-AR')}</td>
            <td class="${totMes.ganancia >= 0 ? 'oro' : 'rojo'}">$${Math.round(totMes.ganancia).toLocaleString('es-AR')}</td>
            <td>${totMes.kgCarne?.toFixed(1)} kg</td>
            <td>${totMes.kgPollo?.toFixed(1)} kg</td>
            <td>${totMes.kgCerdo?.toFixed(1)} kg</td>
          </tr>
        </tfoot>
      </table>

      <div class="socios">
        <div class="socio">
          <div class="socio-nombre">👑 Fabricio Lenardon (85%)</div>
          <div class="socio-valor oro">$${Math.round(totMes.ganancia * 0.85).toLocaleString('es-AR')}</div>
        </div>
        <div class="socio">
          <div class="socio-nombre">🤝 Ariel Garrone (15%)</div>
          <div class="socio-valor" style="color:#1a3a7a">$${Math.round(totMes.ganancia * 0.15).toLocaleString('es-AR')}</div>
        </div>
      </div>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>
  `)
  win.document.close()
}

export default function Cierre() {
  const [tab, setTab] = useState('semanal')
  const [form, setForm] = useState(initialForm)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState(null)
  const [mesSelector, setMesSelector] = useState('')

  useEffect(() => {
    fetchCierres()
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
      semana_inicio: form.inicio, semana_fin: form.fin, mes,
      ventas: totalIngresos, compras: parseFloat(form.compras) || 0,
      gastos: (parseFloat(form.gastos) || 0) + (parseFloat(form.socios) || 0),
      sueldos: parseFloat(form.sueldos) || 0, ganancia,
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
  const mesLabel = mesSelector ? new Date(mesSelector + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : ''

  return (
    <div>
      <div className="page-title">CIERRE SEMANAL / MENSUAL</div>
      <div className="page-sub">Registrá los resultados financieros de cada semana</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[{ id: 'semanal', label: '📋 Cierre semanal' }, { id: 'mensual', label: '📊 Cierre mensual' }, { id: 'historial', label: '📁 Historial' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? 'var(--green)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'semanal' && (
        <div>
          {alert && (
            <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
              {alert.msg}
            </div>
          )}

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

      {tab === 'mensual' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
            <select value={mesSelector} onChange={e => setMesSelector(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14 }}>
              {meses.map(m => <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</option>)}
            </select>
            <button onClick={() => exportarExcel(semanasMes, totMes, mesLabel)}
              style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              📊 Exportar Excel
            </button>
            <button onClick={() => imprimirCierreMensual(semanasMes, totMes, mesLabel)}
              style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
              🖨️ Imprimir / PDF
            </button>
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

      {tab === 'historial' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="card-title" style={{ margin: 0 }}>Historial de cierres</div>
          </div>
          <table>
            <thead><tr><th>Período</th><th>Ventas</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th></tr></thead>
            <tbody>
              {cierres.map(c => (
                <tr key={c.id} style={{ background: c.ganancia < 0 ? 'rgba(192,57,43,0.05)' : undefined }}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} / {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
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
