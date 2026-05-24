import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import Paginador, { usePaginacion } from '../../components/Paginador'

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
const initialForm = {
  inicio: '', fin: '', compras: '', sueldos: '', gastos: '', socios: '',
  kgCarne: '', kgPollo: '', kgCerdo: '', kgMerma: '',
  kgRemanenteCarne: '', kgRemanentePollo: '', kgRemanenteCerdo: '',
  ventasCtacte: '',
  ...initialIngresos
}

function exportarExcel(semanasMes, totMes, mesLabel) {
  const rows = [
    ['CARNICERÍAS FABRICIUS — CIERRE MENSUAL'],
    [mesLabel.toUpperCase()],
    [],
    ['Período', 'Ventas', 'Ventas Cta.Cte.', 'Compras', 'Gastos', 'Sueldos', 'Ganancia', 'Kg Carne', 'Kg Pollo', 'Kg Cerdo', 'Rem. Carne', 'Rem. Pollo', 'Rem. Cerdo'],
    ...semanasMes.map(c => [
      `${new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR')} → ${new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR')}`,
      c.ventas, c.ventas_ctacte || 0, c.compras, c.gastos, c.sueldos, c.ganancia,
      c.kg_carne, c.kg_pollo, c.kg_cerdo,
      c.kg_remanente_carne || 0, c.kg_remanente_pollo || 0, c.kg_remanente_cerdo || 0
    ]),
    [],
    ['TOTAL', totMes.ventas, totMes.ventasCtacte, totMes.compras, totMes.gastos, totMes.sueldos, totMes.ganancia, totMes.kgCarne, totMes.kgPollo, totMes.kgCerdo],
    [],
    ['Distribución socios'],
    ['Fabricio Lenardon (85%)', totMes.ganancia * 0.85],
    ['Ariel Garrone (15%)', totMes.ganancia * 0.15],
  ]
  const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `cierre_${mesLabel.replace(/ /g, '_')}.csv`; a.click()
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
      .verde { color: #1a7a1a; } .rojo { color: #c0392b; } .oro { color: #b8860b; font-weight: 700; }
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
          <th>Período</th><th>Ventas</th><th>Vtas.CtaCte</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th><th>Kg Carne</th><th>Kg Pollo</th><th>Kg Cerdo</th>
        </tr></thead>
        <tbody>
          ${semanasMes.map(c => `<tr>
            <td>${new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} → ${new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
            <td class="verde">$${Math.round(c.ventas).toLocaleString('es-AR')}</td>
            <td>$${Math.round(c.ventas_ctacte || 0).toLocaleString('es-AR')}</td>
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
            <td>$${Math.round(totMes.ventasCtacte).toLocaleString('es-AR')}</td>
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
  const [editandoId, setEditandoId] = useState(null)
  // Paginación del historial de cierres semanales
  const pagCierres = usePaginacion(cierres, 20)

  useEffect(() => {
    fetchCierres()
    const hoy = new Date()
    const dia = hoy.getDay()
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() - (dia === 0 ? 6 : dia - 1))
    const sabado = new Date(lunes)
    sabado.setDate(lunes.getDate() + 5)
    // fechaHoyARG en lugar de toISOString — corrige el corrimiento de
     // un día que aparecía cuando se entraba después de las 21hs ARG.
    setForm(f => ({ ...f, inicio: fechaHoyARG(lunes), fin: fechaHoyARG(sabado) }))
  }, [])

  async function fetchCierres() {
    const { data } = await supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false })
    setCierres(data || [])
    if (data?.length) setMesSelector(data[0].mes)
  }

  // Al cargar el form de nuevo cierre, pre-cargar remanente del cierre anterior
  async function precargarRemanente() {
    const { data } = await supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false }).limit(1)
    if (data?.length) {
      const ultimo = data[0]
      setForm(f => ({
        ...f,
        kgRemanenteCarne: ultimo.kg_remanente_carne?.toString() || '0',
        kgRemanentePollo: ultimo.kg_remanente_pollo?.toString() || '0',
        kgRemanenteCerdo: ultimo.kg_remanente_cerdo?.toString() || '0',
      }))
      showAlert({ type: 'info', msg: `📦 Remanente cargado del cierre anterior — Carne: ${fmtKg(ultimo.kg_remanente_carne)} / Pollo: ${fmtKg(ultimo.kg_remanente_pollo)} / Cerdo: ${fmtKg(ultimo.kg_remanente_cerdo)}` })
    }
  }

  function showAlert(a) { setAlert(a); setTimeout(() => setAlert(null), 5000) }

  function calcular() {
    const totalIngresos = camposIngresos.reduce((s, c) => s + (parseFloat(form[c.id]) || 0), 0)
      - descuentos.reduce((s, c) => s + (parseFloat(form[c.id]) || 0), 0)
    const totalEgresos = ['compras', 'sueldos', 'gastos', 'socios'].reduce((s, k) => s + (parseFloat(form[k]) || 0), 0)
    return { totalIngresos, totalEgresos, ganancia: totalIngresos - totalEgresos }
  }

  async function guardarCierre() {
    if (!form.inicio || !form.fin) { showAlert({ type: 'error', msg: 'Seleccioná el período' }); return }
    setLoading(true)
    const { totalIngresos, totalEgresos, ganancia } = calcular()
    const mes = form.inicio.substring(0, 7)
    const ingresosCampos = Object.fromEntries([...camposIngresos, ...descuentos].map(c => [c.id, parseFloat(form[c.id]) || 0]))

    const datos = {
      semana_inicio: form.inicio, semana_fin: form.fin, mes,
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
      kg_remanente_carne: parseFloat(form.kgRemanenteCarne) || 0,
      kg_remanente_pollo: parseFloat(form.kgRemanentePollo) || 0,
      kg_remanente_cerdo: parseFloat(form.kgRemanenteCerdo) || 0,
      ventas_ctacte: parseFloat(form.ventasCtacte) || 0,
    }

    if (editandoId) {
      const { error } = await supabase.from('cierres_semanales').update(datos).eq('id', editandoId)
      if (error) { showAlert({ type: 'error', msg: 'Error al actualizar: ' + error.message }); setLoading(false); return }
      showAlert({ type: 'success', msg: '✅ Cierre actualizado correctamente' })
      setEditandoId(null)
    } else {
      const { error } = await supabase.from('cierres_semanales').insert(datos)
      if (error) { showAlert({ type: 'error', msg: 'Error al guardar: ' + error.message }); setLoading(false); return }
// Resetear stock con los remanentes ingresados
const stockUpdates = [
  { tipo: 'bovino_corte', kg: parseFloat(form.kgRemanenteCarne) || 0 },
  { tipo: 'bovino_pieza', kg: 0 },
  { tipo: 'bovino_mr', kg: 0 },
  { tipo: 'bovino_brosa', kg: 0 },
  { tipo: 'pollo', kg: parseFloat(form.kgRemanentePollo) || 0 },
  { tipo: 'cerdo', kg: parseFloat(form.kgRemanenteCerdo) || 0 },
  { tipo: 'embutido', kg: 0 },
]
for (const s of stockUpdates) {
  const { data: existe } = await supabase.from('stock_actual').select('id').eq('tipo', s.tipo).maybeSingle()
  if (existe) {
    await supabase.from('stock_actual').update({ kg_disponible: s.kg }).eq('tipo', s.tipo)
  } else {
    await supabase.from('stock_actual').insert({ tipo: s.tipo, kg_disponible: s.kg })
  }
}
      showAlert({ type: 'success', msg: '✅ Cierre semanal confirmado y guardado' })
    }

    setLoading(false)
    setForm(initialForm)
    fetchCierres()
  }

  function editarCierre(c) {
    const ing = c.ingresos || {}
    setForm({
      inicio: c.semana_inicio,
      fin: c.semana_fin,
      compras: c.compras?.toString() || '',
      sueldos: c.sueldos?.toString() || '',
      gastos: c.gastos?.toString() || '',
      socios: '',
      kgCarne: c.kg_carne?.toString() || '',
      kgPollo: c.kg_pollo?.toString() || '',
      kgCerdo: c.kg_cerdo?.toString() || '',
      kgMerma: c.kg_merma?.toString() || '',
      kgRemanenteCarne: c.kg_remanente_carne?.toString() || '0',
      kgRemanentePollo: c.kg_remanente_pollo?.toString() || '0',
      kgRemanenteCerdo: c.kg_remanente_cerdo?.toString() || '0',
      ventasCtacte: c.ventas_ctacte?.toString() || '0',
      ...Object.fromEntries([...camposIngresos, ...descuentos].map(cf => [cf.id, ing[cf.id]?.toString() || ''])),
    })
    setEditandoId(c.id)
    setTab('semanal')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function eliminarCierre(id) {
    if (!confirm('¿Eliminar este cierre semanal? Esta acción no se puede deshacer.')) return
    await supabase.from('cierres_semanales').delete().eq('id', id)
    showAlert({ type: 'success', msg: '🗑️ Cierre eliminado' })
    fetchCierres()
  }

  const { totalIngresos, totalEgresos, ganancia } = calcular()
  const meses = [...new Set(cierres.map(c => c.mes))].sort().reverse()
  const semanasMes = cierres.filter(c => c.mes === mesSelector)
  const totMes = { ventas: 0, compras: 0, gastos: 0, sueldos: 0, ganancia: 0, kgCarne: 0, kgPollo: 0, kgCerdo: 0, ventasCtacte: 0 }
  semanasMes.forEach(c => {
    totMes.ventas += c.ventas || 0
    totMes.compras += c.compras || 0
    totMes.gastos += c.gastos || 0
    totMes.sueldos += c.sueldos || 0
    totMes.ganancia += c.ganancia || 0
    totMes.kgCarne += c.kg_carne || 0
    totMes.kgPollo += c.kg_pollo || 0
    totMes.kgCerdo += c.kg_cerdo || 0
    totMes.ventasCtacte += c.ventas_ctacte || 0
  })
  const mesLabel = mesSelector ? new Date(mesSelector + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : ''

  return (
    <div>
      <div className="page-title">CIERRE SEMANAL / MENSUAL</div>
      <div className="page-sub">Registrá los resultados financieros de cada semana</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
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
            <div style={{ background: alert.type === 'error' ? '#3a1a1a' : alert.type === 'info' ? '#1a2a3a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : alert.type === 'info' ? '#2a4a6a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : alert.type === 'info' ? '#7db5ff' : '#7dff7d', fontWeight: 600 }}>
              {alert.msg}
            </div>
          )}

          {editandoId && (
            <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>✏️ Editando cierre existente</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditandoId(null); setForm(initialForm) }}>Cancelar edición</button>
            </div>
          )}

          {/* PERÍODO */}
          <div className="card">
            <div className="card-title">Período</div>
            <div className="form-row">
              <div className="form-group"><label>Semana inicio</label><input type="date" value={form.inicio} onChange={e => setForm(f => ({ ...f, inicio: e.target.value }))} /></div>
              <div className="form-group"><label>Semana fin</label><input type="date" value={form.fin} onChange={e => setForm(f => ({ ...f, fin: e.target.value }))} /></div>
            </div>
          </div>

          {/* INGRESOS */}
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

            {/* VENTAS CTA CTE DE LA SEMANA */}
            <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 10, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dff7d', marginBottom: 8 }}>📒 Ventas en Cuenta Corriente esta semana</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                Solo ingresá lo que se <strong>vendió</strong> esta semana en cta. cte. — no el saldo acumulado de los clientes. El historial de cada cliente se lleva por separado.
              </div>
              <div className="form-group">
                <label>Ventas cta. cte. de la semana ($)</label>
                <input type="number" placeholder="0" value={form.ventasCtacte}
                  onChange={e => setForm(f => ({ ...f, ventasCtacte: e.target.value }))}
                  style={{ borderColor: 'var(--green)' }} />
              </div>
            </div>
          </div>

          {/* EGRESOS */}
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

          {/* KILOGRAMOS Y REMANENTE */}
          <div className="card">
            <div className="card-title">⚖️ Kilogramos vendidos esta semana</div>
            <div className="form-row4">
              {[{ id: 'kgCarne', label: 'Carne bovino (kg)' }, { id: 'kgPollo', label: 'Pollo (kg)' }, { id: 'kgCerdo', label: 'Cerdo (kg)' }, { id: 'kgMerma', label: 'Grasa / Merma (kg)' }].map(c => (
                <div key={c.id} className="form-group">
                  <label>{c.label}</label>
                  <input type="number" step="0.1" placeholder="0" value={form[c.id]} onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))} />
                </div>
              ))}
            </div>

            {/* REMANENTE */}
            <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#7db5ff', marginBottom: 2 }}>📦 Remanente para la próxima semana</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Stock de carne que queda al cierre de esta semana y se acumula a la siguiente. Editá libremente — es aproximado hasta integrar la balanza.</div>
                </div>
                <button onClick={precargarRemanente} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap', marginLeft: 12 }}>
                  📋 Cargar del cierre anterior
                </button>
              </div>
              <div className="form-row">
                {[{ id: 'kgRemanenteCarne', label: '🥩 Remanente Carne (kg)' }, { id: 'kgRemanentePollo', label: '🍗 Remanente Pollo (kg)' }, { id: 'kgRemanenteCerdo', label: '🐷 Remanente Cerdo (kg)' }].map(c => (
                  <div key={c.id} className="form-group">
                    <label>{c.label}</label>
                    <input type="number" step="0.1" placeholder="0" value={form[c.id]}
                      onChange={e => setForm(f => ({ ...f, [c.id]: e.target.value }))}
                      style={{ borderColor: '#2a4a7a' }} />
                  </div>
                ))}
              </div>
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

            {/* REMANENTE RESUMEN */}
            {(parseFloat(form.kgRemanenteCarne) > 0 || parseFloat(form.kgRemanentePollo) > 0 || parseFloat(form.kgRemanenteCerdo) > 0) && (
              <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#7db5ff', fontWeight: 700 }}>📦 Remanente próxima semana:</span>
                <span style={{ fontSize: 12, color: 'var(--gold)' }}>🥩 {fmtKg(parseFloat(form.kgRemanenteCarne) || 0)}</span>
                <span style={{ fontSize: 12, color: 'var(--blue)' }}>🍗 {fmtKg(parseFloat(form.kgRemanentePollo) || 0)}</span>
                <span style={{ fontSize: 12, color: 'var(--amber)' }}>🐷 {fmtKg(parseFloat(form.kgRemanenteCerdo) || 0)}</span>
              </div>
            )}

            {parseFloat(form.ventasCtacte) > 0 && (
              <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#7dff7d', fontWeight: 700 }}>📒 Ventas cta. cte. esta semana: </span>
                <span style={{ fontSize: 14, color: '#7dff7d', fontWeight: 700 }}>{fmt(parseFloat(form.ventasCtacte) || 0)}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(incluido en total ventas, no acumula saldo)</span>
              </div>
            )}

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
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => { setForm(initialForm); setEditandoId(null) }}>Limpiar</button>
              <button className="btn btn-green" onClick={guardarCierre} disabled={loading}>
                {loading ? 'Guardando...' : editandoId ? '💾 Guardar cambios' : '✅ Confirmar cierre semanal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'mensual' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
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
              { label: 'Ventas cta. cte.', val: totMes.ventasCtacte, color: 'var(--teal)' },
              { label: 'Compras', val: totMes.compras, color: 'var(--red-light)' },
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
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr>
                  <th>Período</th><th>Ventas</th><th>Vtas.CtaCte</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th>
                  <th>Kg Carne</th><th>Kg Pollo</th><th>Kg Cerdo</th>
                  <th>Rem.Carne</th><th>Rem.Pollo</th><th>Rem.Cerdo</th>
                </tr></thead>
                <tbody>
                  {semanasMes.map(c => (
                    <tr key={c.id} style={{ background: c.ganancia < 0 ? 'rgba(192,57,43,0.05)' : 'rgba(39,174,96,0.03)' }}>
                      <td style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} →{' '}
                        {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </td>
                      <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                      <td style={{ color: 'var(--teal)' }}>{fmt(c.ventas_ctacte || 0)}</td>
                      <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                      <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                      <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                      <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                      <td>{fmtKg(c.kg_carne)}</td>
                      <td>{fmtKg(c.kg_pollo)}</td>
                      <td>{fmtKg(c.kg_cerdo)}</td>
                      <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_carne)}</td>
                      <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_pollo)}</td>
                      <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_cerdo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <td>TOTAL</td>
                    <td style={{ color: 'var(--green)' }}>{fmt(totMes.ventas)}</td>
                    <td style={{ color: 'var(--teal)' }}>{fmt(totMes.ventasCtacte)}</td>
                    <td style={{ color: 'var(--red-light)' }}>{fmt(totMes.compras)}</td>
                    <td style={{ color: 'var(--amber)' }}>{fmt(totMes.gastos)}</td>
                    <td style={{ color: 'var(--blue)' }}>{fmt(totMes.sueldos)}</td>
                    <td style={{ color: totMes.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)' }}>{fmt(totMes.ganancia)}</td>
                    <td>{fmtKg(totMes.kgCarne)}</td>
                    <td>{fmtKg(totMes.kgPollo)}</td>
                    <td>{fmtKg(totMes.kgCerdo)}</td>
                    <td>—</td><td>—</td><td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
            <div className="card-title" style={{ margin: 0 }}>Historial de cierres ({cierres.length})</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th>Período</th><th>Ventas</th><th>Vtas.CtaCte</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th>
                <th>Rem.Carne</th><th>Rem.Pollo</th><th>Rem.Cerdo</th><th>Acciones</th>
              </tr></thead>
              <tbody>
                {pagCierres.items.map(c => (
                  <tr key={c.id} style={{ background: c.ganancia < 0 ? 'rgba(192,57,43,0.05)' : undefined }}>
                    <td style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} →{' '}
                      {new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                    </td>
                    <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                    <td style={{ color: 'var(--teal)' }}>{fmt(c.ventas_ctacte || 0)}</td>
                    <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                    <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                    <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                    <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                    <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_carne)}</td>
                    <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_pollo)}</td>
                    <td style={{ color: '#7db5ff' }}>{fmtKg(c.kg_remanente_cerdo)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => editarCierre(c)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>✏️</button>
                        <button onClick={() => eliminarCierre(c.id)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador {...pagCierres.controles} label="cierres" />
        </div>
      )}
    </div>
  )
}
