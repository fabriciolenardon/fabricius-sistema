import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { fmtPrecio, fmtKg as fmtKgAR, parseNumero } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { calcularCierreAuto, cierreAutoAFila, lunesDeLaSemana, domingoDeLaSemana } from '../../lib/cierreAuto'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
const fmtKg = n => fmtKgAR(Number(n) || 0)
const fmtFecha = s => s ? new Date(s + 'T12:00').toLocaleDateString('es-AR') : '—'

// ============================================================
// Excel + Print mensual (idénticos al esquema viejo — siguen
// funcionando porque los snapshots de cierres_semanales
// conservan los mismos campos: ventas, compras, gastos, etc.)
// ============================================================

function exportarExcel(semanasMes, totMes, mesLabel) {
  const rows = [
    ['CARNICERÍAS FABRICIUS — CIERRE MENSUAL'],
    [mesLabel.toUpperCase()],
    [],
    ['Período', 'Ventas', 'Vtas. CtaCte', 'Compras', 'Gastos', 'Sueldos', 'Ganancia', 'Kg Carne', 'Kg Pollo', 'Kg Cerdo'],
    ...semanasMes.map(c => [
      `${fmtFecha(c.semana_inicio)} → ${fmtFecha(c.semana_fin)}`,
      c.ventas, c.ventas_ctacte || 0, c.compras, c.gastos, c.sueldos, c.ganancia,
      c.kg_carne, c.kg_pollo, c.kg_cerdo,
    ]),
    [],
    ['TOTAL', totMes.ventas, totMes.ventasCtacte, totMes.compras, totMes.gastos, totMes.sueldos, totMes.ganancia, totMes.kgCarne, totMes.kgPollo, totMes.kgCerdo],
    [],
    ['Distribución socios'],
    ['Fabricio Lenardon (85%)', totMes.ganancia * 0.85],
    ['Ariel Garrone (15%)', totMes.ganancia * 0.15],
  ]
  const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
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
            <td>${(c.kg_carne || 0).toFixed(1)} kg</td>
            <td>${(c.kg_pollo || 0).toFixed(1)} kg</td>
            <td>${(c.kg_cerdo || 0).toFixed(1)} kg</td>
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
            <td>${(totMes.kgCarne || 0).toFixed(1)} kg</td>
            <td>${(totMes.kgPollo || 0).toFixed(1)} kg</td>
            <td>${(totMes.kgCerdo || 0).toFixed(1)} kg</td>
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

// ============================================================
// Componentes auxiliares
// ============================================================

// Input numérico inline para el modo edición manual. Es NO controlado
// (defaultValue) y commitea en onBlur usando parseNumero, así acepta coma o
// punto sin pelear con el tipeo. El `key` lo fuerza a refrescar cuando el valor
// de fondo cambia (recálculo / restaurar automáticos).
function InputNum({ value, color, onCommit, ancho = 130 }) {
  return (
    <input
      key={value}
      type="text"
      inputMode="decimal"
      defaultValue={Number(value) || 0}
      onFocus={e => e.target.select()}
      onBlur={e => onCommit(e.target.value)}
      style={{
        width: ancho, textAlign: 'right', fontWeight: 700,
        color: color || 'var(--text)', background: 'var(--surface)',
        border: '1px solid var(--gold)', borderRadius: 6, padding: '4px 8px',
        fontFamily: 'inherit', fontSize: 13
      }}
    />
  )
}

// Recalcula los valores DERIVADOS a partir de las hojas editables.
// Hojas: ventas.{caja,mayorista,pedidos}, cobrado.{efectivo,debito,
// transferencia,mayorista,cobranzasCta}, compras.total, pagadoProv.total,
// gastos.{fijos,variables,socios}, sueldos.total.
function recomputeDerived(c) {
  if (!c) return c
  const ventasTotal = (c.ventas.caja || 0) + (c.ventas.mayorista || 0) + (c.ventas.pedidos || 0)
  const cobradoTotal = (c.cobrado.efectivo || 0) + (c.cobrado.debito || 0) +
    (c.cobrado.transferencia || 0) + (c.cobrado.mayorista || 0) + (c.cobrado.cobranzasCta || 0)
  const gastosTotal = (c.gastos.fijos || 0) + (c.gastos.variables || 0) + (c.gastos.socios || 0)
  const sueldosTotal = c.sueldos.total || 0
  const comprasTotal = c.compras.total || 0
  const pagadoTotal = c.pagadoProv.total || 0
  return {
    ...c,
    ventas: { ...c.ventas, total: ventasTotal },
    cobrado: { ...c.cobrado, total: cobradoTotal },
    gastos: { ...c.gastos, total: gastosTotal },
    ganancia: {
      devengada: ventasTotal - comprasTotal - gastosTotal - sueldosTotal,
      cajaReal: cobradoTotal - pagadoTotal - gastosTotal - sueldosTotal,
    },
  }
}

function MetricCard({ label, value, color, sub, big, editable, rawValue, onCommit }) {
  return (
    <div style={{
      background: 'var(--surface2)', border: `1px solid ${editable ? 'var(--gold)' : (color || 'var(--border)')}`,
      borderRadius: 10, padding: '14px 18px', minWidth: 200, flex: '1 1 200px'
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>{label}</div>
      {editable ? (
        <div style={{ marginTop: 6 }}>
          <InputNum value={rawValue} color={color} onCommit={onCommit} ancho={160} />
        </div>
      ) : (
        <div style={{
          fontFamily: "'Bebas Neue', cursive",
          fontSize: big ? 28 : 22,
          color: color || 'var(--text)',
          marginTop: 4,
          lineHeight: 1.1
        }}>{value}</div>
      )}
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function FilaDesglose({ label, value, color, indent, editable, onCommit, esKg }) {
  const fmtFn = esKg ? fmtKg : fmt
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0',
      borderBottom: '1px dashed var(--border)', fontSize: 13,
      paddingLeft: indent ? 16 : 0
    }}>
      <span style={{ color: indent ? 'var(--muted)' : 'var(--text)' }}>{indent && '↳ '}{label}</span>
      {editable
        ? <InputNum value={value} color={color} onCommit={onCommit} />
        : <span style={{ color: color || 'var(--text)', fontWeight: 600 }}>{fmtFn(value)}</span>}
    </div>
  )
}

// ============================================================
// Pantalla principal
// ============================================================

export default function Cierre() {
  const { profile } = useAuth()
  // Edición manual TEMPORAL (período de integración): habilitada sólo para
  // el perfil de Fabricio. Permite ajustar cada valor del cierre a mano
  // mientras los cálculos automáticos terminan de cuadrar.
  const puedeEditar = (profile?.nombre || '').toLowerCase().includes('fabricio')

  const [tab, setTab] = useState('semanal')
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [calculando, setCalculando] = useState(false)
  const [alert, setAlert] = useState(null)
  const [mesSelector, setMesSelector] = useState('')

  // Estado del cierre auto en curso
  const [desde, setDesde] = useState(lunesDeLaSemana())
  const [hasta, setHasta] = useState(domingoDeLaSemana())
  const [cierreAuto, setCierreAuto] = useState(null)   // valores calculados (originales)
  const [cierreEdit, setCierreEdit] = useState(null)   // copia editable (lo que se muestra/guarda)
  const [editMode, setEditMode] = useState(false)

  // Lo que se renderiza y se guarda: la copia editable si existe, si no la auto.
  const view = cierreEdit || cierreAuto
  const editableNow = editMode && puedeEditar && !!cierreEdit
  // ¿Hay valores tocados a mano? (las listas no se editan, así que el JSON es comparable)
  const editado = !!cierreEdit && !!cierreAuto && JSON.stringify(cierreEdit) !== JSON.stringify(cierreAuto)

  const pagCierres = usePaginacion(cierres, 20)

  // Commitea una hoja editable (ej: 'ventas.caja') y recalcula derivados.
  function commitLeaf(path, raw) {
    const valor = parseNumero(raw)
    setCierreEdit(prev => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let o = next
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
      o[parts[parts.length - 1]] = valor
      return recomputeDerived(next)
    })
  }

  function restaurarAuto() {
    if (!cierreAuto) return
    setCierreEdit(JSON.parse(JSON.stringify(cierreAuto)))
    showAlert({ type: 'info', msg: '↩️ Valores automáticos restaurados' })
  }

  useEffect(() => { fetchCierres() }, [])
  // Recalcular cuando cambia el período
  useEffect(() => {
    if (desde && hasta && desde <= hasta) recalcular()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  async function fetchCierres() {
    const { data } = await supabase
      .from('cierres_semanales')
      .select('*')
      .order('semana_inicio', { ascending: false })
    setCierres(data || [])
    if (data?.length && !mesSelector) setMesSelector(data[0].mes)
  }

  async function recalcular() {
    setCalculando(true)
    try {
      const result = await calcularCierreAuto(desde, hasta)
      setCierreAuto(result)
      setCierreEdit(JSON.parse(JSON.stringify(result)))  // copia editable fresca
    } catch (e) {
      showAlert({ type: 'error', msg: 'Error calculando: ' + e.message })
    } finally {
      setCalculando(false)
    }
  }

  function showAlert(a) { setAlert(a); setTimeout(() => setAlert(null), 5000) }

  async function guardarCierre() {
    if (!view) return
    if (!confirm(`¿Confirmar y guardar cierre del ${fmtFecha(desde)} al ${fmtFecha(hasta)}?${editado ? '\n\n⚠️ Tiene valores EDITADOS A MANO.' : ''}\n\nVentas: ${fmt(view.ventas.total)}\nCompras: ${fmt(view.compras.total)}\nGanancia devengada: ${fmt(view.ganancia.devengada)}`)) return
    setLoading(true)
    const fila = cierreAutoAFila(view)
    // Trazabilidad: dejar registrado si el snapshot fue ajustado manualmente.
    fila.ingresos = { ...fila.ingresos, editado_manual: editado, editado_por: editado ? (profile?.nombre || null) : null }
    // Verificar si ya existe un cierre con esa misma semana
    const { data: ya } = await supabase
      .from('cierres_semanales')
      .select('id')
      .eq('semana_inicio', desde)
      .eq('semana_fin', hasta)
      .maybeSingle()

    let error
    if (ya) {
      const r = await supabase.from('cierres_semanales').update(fila).eq('id', ya.id)
      error = r.error
    } else {
      const r = await supabase.from('cierres_semanales').insert(fila)
      error = r.error
    }

    setLoading(false)
    if (error) {
      showAlert({ type: 'error', msg: 'Error al guardar: ' + error.message })
      return
    }
    showAlert({ type: 'success', msg: `✅ Cierre guardado (${ya ? 'actualizado' : 'nuevo'})` })
    fetchCierres()
  }

  async function eliminarCierre(id) {
    if (!confirm('¿Eliminar este cierre semanal? Esta acción no se puede deshacer.')) return
    await supabase.from('cierres_semanales').delete().eq('id', id)
    showAlert({ type: 'success', msg: '🗑️ Cierre eliminado' })
    fetchCierres()
  }

  // Atajos de período
  function setSemanaActual() {
    setDesde(lunesDeLaSemana()); setHasta(domingoDeLaSemana())
  }
  function setSemanaAnterior() {
    const lunesAnt = fechaRelativaARG(-7, new Date(lunesDeLaSemana() + 'T12:00'))
    const domAnt = fechaRelativaARG(-7, new Date(domingoDeLaSemana() + 'T12:00'))
    setDesde(lunesAnt); setHasta(domAnt)
  }
  function setMesActual() {
    const hoy = fechaHoyARG()
    const primerDiaMes = hoy.substring(0, 7) + '-01'
    setDesde(primerDiaMes); setHasta(hoy)
  }

  // ====== Datos para el tab Por Mes ======
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
      <div className="page-sub">El sistema calcula todo automáticamente desde tus ventas, compras, cobranzas y pagos.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'semanal', label: '⚡ Cierre Auto' },
          { id: 'mensual', label: '📊 Por Mes' },
          { id: 'historial', label: '📁 Historial' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)',
              background: tab === t.id ? 'var(--green)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600, fontSize: 13
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {alert && (
        <div style={{
          background: alert.type === 'error' ? '#3a1a1a' : alert.type === 'info' ? '#1a2a3a' : '#1a2a1a',
          border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : alert.type === 'info' ? '#2a4a6a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: alert.type === 'error' ? '#ff6b6b' : alert.type === 'info' ? '#7db5ff' : '#7dff7d',
          fontWeight: 600
        }}>
          {alert.msg}
        </div>
      )}

      {tab === 'semanal' && (
        <div>
          {/* SELECTOR DE PERÍODO */}
          <div className="card">
            <div className="card-title">📅 Período del cierre</div>
            <div className="form-row" style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label>Desde</label>
                <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Hasta</label>
                <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={setSemanaActual}>Semana actual</button>
                  <button className="btn btn-ghost btn-sm" onClick={setSemanaAnterior}>Semana anterior</button>
                  <button className="btn btn-ghost btn-sm" onClick={setMesActual}>Mes en curso</button>
                  <button className="btn btn-ghost btn-sm" onClick={recalcular} disabled={calculando}>🔄 Recalcular</button>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              {calculando
                ? '⏳ Calculando…'
                : cierreAuto
                  ? `📊 Período: ${fmtFecha(cierreAuto.periodo.desde)} → ${fmtFecha(cierreAuto.periodo.hasta)}`
                  : 'Seleccioná un período válido'}
            </div>
          </div>

          {cierreAuto && !calculando && (
            <>
              {/* BANNER EDICIÓN MANUAL (solo perfil Fabricio, período integración) */}
              {puedeEditar && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                  background: editMode ? 'rgba(201,168,76,0.12)' : 'var(--surface2)',
                  border: `1px solid ${editMode ? 'var(--gold)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '10px 16px', marginBottom: 14
                }}>
                  <div style={{ fontSize: 12.5 }}>
                    🔧 <strong>Edición manual</strong> <span style={{ color: 'var(--muted)' }}>(solo tu perfil · período de integración)</span>
                    {editado && <span style={{ marginLeft: 8, color: 'var(--gold)', fontWeight: 700 }}>✏️ valores editados</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {editMode && editado && (
                      <button className="btn btn-ghost btn-sm" onClick={restaurarAuto}>↩️ Restaurar automáticos</button>
                    )}
                    <button className="btn btn-sm" onClick={() => setEditMode(m => !m)}
                      style={{ background: editMode ? 'var(--gold)' : 'transparent', color: editMode ? '#1a1a1a' : 'var(--text)', border: '1px solid var(--gold)', fontWeight: 700 }}>
                      {editMode ? '✅ Terminar edición' : '✏️ Editar valores'}
                    </button>
                  </div>
                </div>
              )}

              {/* KPIs PRINCIPALES */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                <MetricCard label="💵 Ventas (facturado)" value={fmt(view.ventas.total)} color="var(--green)" big
                  sub={`${view.compras.cantEntradas} entradas · ${view.sueldos.cantLiquidaciones} liquidaciones`} />
                <MetricCard label="💰 Cobrado en el período" value={fmt(view.cobrado.total)} color="var(--teal)" big />
                <MetricCard label="📤 Por cobrar al cierre" value={fmt(view.porCobrar.total)} color="var(--amber)"
                  editable={editableNow} rawValue={view.porCobrar.total} onCommit={v => commitLeaf('porCobrar.total', v)}
                  sub={`${view.porCobrar.clientes.length} clientes con deuda`} />
                <MetricCard label="🛒 Compras" value={fmt(view.compras.total)} color="var(--red-light)" big
                  editable={editableNow} rawValue={view.compras.total} onCommit={v => commitLeaf('compras.total', v)} />
                <MetricCard label="💳 Pagado a proveedores" value={fmt(view.pagadoProv.total)} color="#c084fc"
                  editable={editableNow} rawValue={view.pagadoProv.total} onCommit={v => commitLeaf('pagadoProv.total', v)} />
                <MetricCard label="📥 Por pagar al cierre" value={fmt(view.porPagarProv.total)} color="var(--amber)"
                  editable={editableNow} rawValue={view.porPagarProv.total} onCommit={v => commitLeaf('porPagarProv.total', v)}
                  sub={`${view.porPagarProv.proveedores.length} proveedores con saldo`} />
              </div>

              {/* GANANCIA (siempre derivada de los valores de arriba) */}
              <div className="card" style={{ background: 'linear-gradient(135deg, #1a2a1a 0%, #1a1a2a 100%)' }}>
                <div className="card-title">📊 Ganancia del período {editableNow && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>(se recalcula sola al editar)</span>}</div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 280, background: 'var(--surface2)', border: `2px solid ${view.ganancia.devengada >= 0 ? 'var(--gold)' : 'var(--red-light)'}`, borderRadius: 10, padding: 18 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>📈 Ganancia DEVENGADA</div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, color: view.ganancia.devengada >= 0 ? 'var(--gold)' : 'var(--red-light)' }}>
                      {fmt(view.ganancia.devengada)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Facturado − Compras − Gastos − Sueldos</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 280, background: 'var(--surface2)', border: `2px solid ${view.ganancia.cajaReal >= 0 ? 'var(--teal)' : 'var(--red-light)'}`, borderRadius: 10, padding: 18 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>💵 Flujo de CAJA REAL</div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, color: view.ganancia.cajaReal >= 0 ? 'var(--teal)' : 'var(--red-light)' }}>
                      {fmt(view.ganancia.cajaReal)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Cobrado − Pagado prov. − Gastos − Sueldos</div>
                  </div>
                </div>
              </div>

              {/* DESGLOSES */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, marginTop: 14 }}>

                {/* VENTAS DETALLADAS */}
                <div className="card">
                  <div className="card-title">💵 Ventas — desglose</div>
                  <FilaDesglose label="Caja minorista" value={view.ventas.caja} color="var(--green)" editable={editableNow} onCommit={v => commitLeaf('ventas.caja', v)} />
                  <FilaDesglose label="Despachos mayorista" value={view.ventas.mayorista} color="var(--green)" editable={editableNow} onCommit={v => commitLeaf('ventas.mayorista', v)} />
                  <FilaDesglose label="Pedidos confirmados" value={view.ventas.pedidos} color="var(--green)" editable={editableNow} onCommit={v => commitLeaf('ventas.pedidos', v)} />
                  <FilaDesglose label="TOTAL FACTURADO" value={view.ventas.total} color="var(--gold)" />
                </div>

                {/* COBRADO DETALLADO */}
                <div className="card">
                  <div className="card-title">💰 Cobrado — desglose</div>
                  <FilaDesglose label="Efectivo caja" value={view.cobrado.efectivo} color="var(--teal)" editable={editableNow} onCommit={v => commitLeaf('cobrado.efectivo', v)} />
                  <FilaDesglose label="Débito / QR" value={view.cobrado.debito} color="var(--teal)" editable={editableNow} onCommit={v => commitLeaf('cobrado.debito', v)} />
                  <FilaDesglose label="Transferencias caja" value={view.cobrado.transferencia} color="var(--teal)" editable={editableNow} onCommit={v => commitLeaf('cobrado.transferencia', v)} />
                  <FilaDesglose label="Despachos cobrados al entregar" value={view.cobrado.mayorista} color="var(--teal)" editable={editableNow} onCommit={v => commitLeaf('cobrado.mayorista', v)} />
                  <FilaDesglose label="Cobranzas cta. cte." value={view.cobrado.cobranzasCta} color="var(--teal)" editable={editableNow} onCommit={v => commitLeaf('cobrado.cobranzasCta', v)} />
                  <FilaDesglose label="TOTAL COBRADO" value={view.cobrado.total} color="var(--gold)" />
                </div>

                {/* GASTOS DETALLADOS */}
                <div className="card">
                  <div className="card-title">💸 Gastos y sueldos</div>
                  <FilaDesglose label="Gastos fijos" value={view.gastos.fijos} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('gastos.fijos', v)} />
                  <FilaDesglose label="Gastos variables" value={view.gastos.variables} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('gastos.variables', v)} />
                  <FilaDesglose label="Retiros socios" value={view.gastos.socios} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('gastos.socios', v)} />
                  <FilaDesglose label="Sueldos liquidados" value={view.sueldos.total} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('sueldos.total', v)} />
                  <FilaDesglose label="TOTAL GASTOS + SUELDOS" value={view.gastos.total + view.sueldos.total} color="var(--amber)" />
                </div>

                {/* KG MOVIDOS */}
                <div className="card">
                  <div className="card-title">⚖️ Kg comprados (entradas)</div>
                  <FilaDesglose label="🥩 Carne" value={view.kg.carne} esKg editable={editableNow} onCommit={v => commitLeaf('kg.carne', v)} />
                  <FilaDesglose label="🍗 Pollo" value={view.kg.pollo} esKg editable={editableNow} onCommit={v => commitLeaf('kg.pollo', v)} />
                  <FilaDesglose label="🐷 Cerdo" value={view.kg.cerdo} esKg editable={editableNow} onCommit={v => commitLeaf('kg.cerdo', v)} />
                  <FilaDesglose label="🌭 Embutidos" value={view.kg.embutidos} esKg editable={editableNow} onCommit={v => commitLeaf('kg.embutidos', v)} />
                </div>

                {/* TOP DEUDORES */}
                {view.porCobrar.clientes.length > 0 && (
                  <div className="card">
                    <div className="card-title">📤 Top clientes por cobrar</div>
                    <div style={{ fontSize: 12 }}>
                      {view.porCobrar.clientes.slice(0, 8).map(c => (
                        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
                          <span>{c.nombre}</span>
                          <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(c.saldo)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TOP PROVEEDORES A PAGAR */}
                {view.porPagarProv.proveedores.length > 0 && (
                  <div className="card">
                    <div className="card-title">📥 Top proveedores a pagar</div>
                    <div style={{ fontSize: 12 }}>
                      {view.porPagarProv.proveedores.slice(0, 8).map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
                          <span>{p.nombre || '—'}</span>
                          <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(p.saldo)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* GUARDAR */}
              <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
                <button className="btn btn-primary" onClick={guardarCierre} disabled={loading}
                  style={{ fontSize: 14, padding: '12px 32px' }}>
                  {loading ? 'Guardando…' : '💾 CONFIRMAR Y GUARDAR CIERRE'}
                </button>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  Guarda un snapshot inmutable en el historial. Si ya existe un cierre con la misma fecha, se actualiza.
                  {editado && <span style={{ color: 'var(--gold)', fontWeight: 600 }}> · Se guardará con los valores editados a mano.</span>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ====================================================== */}
      {/*  TAB POR MES  — agrupa snapshots semanales              */}
      {/* ====================================================== */}
      {tab === 'mensual' && (
        <div>
          <div className="card">
            <div className="card-title">📅 Cierres por mes</div>
            <div className="form-row">
              <div className="form-group">
                <label>Seleccionar mes</label>
                <select value={mesSelector} onChange={e => setMesSelector(e.target.value)}>
                  {meses.map(m => (
                    <option key={m} value={m}>
                      {new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => imprimirCierreMensual(semanasMes, totMes, mesLabel)} disabled={!semanasMes.length}>
                    🖨️ Imprimir
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => exportarExcel(semanasMes, totMes, mesLabel)} disabled={!semanasMes.length}>
                    📊 Excel
                  </button>
                </div>
              </div>
            </div>
          </div>

          {!semanasMes.length && (
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
              No hay cierres cargados en este mes.
            </div>
          )}

          {!!semanasMes.length && (
            <>
              {/* KPIs DEL MES */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                <MetricCard label="Ventas del mes" value={fmt(totMes.ventas)} color="var(--green)" big />
                <MetricCard label="Compras" value={fmt(totMes.compras)} color="var(--red-light)" />
                <MetricCard label="Gastos + Sueldos" value={fmt(totMes.gastos + totMes.sueldos)} color="var(--amber)" />
                <MetricCard label="Ganancia neta" value={fmt(totMes.ganancia)} color={totMes.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)'} big />
              </div>

              {/* DISTRIBUCIÓN SOCIOS */}
              <div className="card">
                <div className="card-title">👥 Distribución entre socios</div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 280, background: 'var(--surface2)', border: '2px solid var(--gold)', borderRadius: 10, padding: 18 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>👑 Fabricio Lenardon (85%)</div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--gold)', marginTop: 4 }}>
                      {fmt(totMes.ganancia * 0.85)}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 280, background: 'var(--surface2)', border: '2px solid #4a7ac0', borderRadius: 10, padding: 18 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#7db5ff' }}>🤝 Ariel Garrone (15%)</div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: '#7db5ff', marginTop: 4 }}>
                      {fmt(totMes.ganancia * 0.15)}
                    </div>
                  </div>
                </div>
              </div>

              {/* TABLA SEMANAS */}
              <div className="card">
                <div className="card-title">📋 Semanas del mes</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Ventas</th>
                        <th>Compras</th>
                        <th>Gastos</th>
                        <th>Sueldos</th>
                        <th>Ganancia</th>
                        <th>Kg Carne</th>
                        <th>Kg Pollo</th>
                        <th>Kg Cerdo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semanasMes.map(c => (
                        <tr key={c.id}>
                          <td>{fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}</td>
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
              </div>
            </>
          )}
        </div>
      )}

      {/* ====================================================== */}
      {/*  TAB HISTORIAL                                          */}
      {/* ====================================================== */}
      {tab === 'historial' && (
        <div>
          <div className="card">
            <div className="card-title">📁 Historial de cierres semanales</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Ventas</th>
                    <th>Compras</th>
                    <th>Gastos</th>
                    <th>Sueldos</th>
                    <th>Ganancia</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagCierres.itemsActuales.map(c => (
                    <tr key={c.id}>
                      <td>{fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}</td>
                      <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                      <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                      <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                      <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                      <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => { setDesde(c.semana_inicio); setHasta(c.semana_fin); setTab('semanal') }}>
                          🔄 Recalcular
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => eliminarCierre(c.id)} style={{ color: 'var(--red-light)' }}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador {...pagCierres} />
          </div>
        </div>
      )}
    </div>
  )
}
