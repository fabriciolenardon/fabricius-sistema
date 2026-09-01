import { useEffect, useState } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fechaHoyARG, fechaRelativaARG } from '../../lib/fechas'
import { fmtPrecio, fmtKg as fmtKgAR, parseNumero } from '../../lib/formatos'
import { imprimirHTML } from '../../lib/imprimir'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { calcularCierreAuto, cierreAutoAFila, lunesDeLaSemana, domingoDeLaSemana } from '../../lib/cierreAuto'
import { calcularControlSemanal, guardarSnapshotStock, nombreTipo } from '../../lib/controlSemanal'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
const fmtKg = n => fmtKgAR(Number(n) || 0)
const fmtFecha = s => s ? new Date(s + 'T12:00').toLocaleDateString('es-AR') : '—'
// Mes operativo: 'YYYY-MM-DD' → 'YYYY-MM' y su etiqueta legible.
const mesDe = d => String(d || '').substring(0, 7)
const mesLabelDe = m => m ? new Date(m + '-15T12:00').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : '—'

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

async function imprimirCierreMensual(semanasMes, totMes, mesLabel, trendMeses = []) {
  const fechaCorta = d => new Date(d + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  const capSocio = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Otros'

  // Retiros de socios por semana y por socio (tabla gastos, tipo='socio'). Estos
  // retiros YA están sumados dentro de la columna "Gastos"; esta tabla los abre
  // para ver cuánto sacó cada socio por semana y en el mes.
  const desde = [...semanasMes.map(s => s.semana_inicio)].sort()[0]
  const hasta = [...semanasMes.map(s => s.semana_fin)].sort().slice(-1)[0]
  const retirosPorSemana = {}   // semana_inicio → { socio: monto }
  const totalSocio = {}         // socio → total del mes
  if (desde && hasta) {
    const { data } = await fetchAllRows(() => supabase.from('gastos')
      .select('fecha, monto, socio, tipo, solo_balance')
      .eq('tipo', 'socio').gte('fecha', desde).lte('fecha', hasta))
    for (const g of (data || [])) {
      if (g.solo_balance) continue
      const socio = (g.socio || 'otros').toLowerCase()
      const wk = semanasMes.find(s => g.fecha >= s.semana_inicio && g.fecha <= s.semana_fin)
      if (wk) {
        retirosPorSemana[wk.semana_inicio] = retirosPorSemana[wk.semana_inicio] || {}
        retirosPorSemana[wk.semana_inicio][socio] = (retirosPorSemana[wk.semana_inicio][socio] || 0) + (Number(g.monto) || 0)
      }
      totalSocio[socio] = (totalSocio[socio] || 0) + (Number(g.monto) || 0)
    }
  }
  const socios = Object.keys(totalSocio).sort()
  const totalRetiros = socios.reduce((a, s) => a + totalSocio[s], 0)
  const tablaRetiros = socios.length ? `
      <div class="titulo" style="font-size:14px;margin-top:18px;">💸 Retiros de socios por semana</div>
      <table>
        <thead><tr><th>Período</th>${socios.map(s => `<th>${capSocio(s)}</th>`).join('')}<th>Total semana</th></tr></thead>
        <tbody>
          ${semanasMes.map(c => {
            const r = retirosPorSemana[c.semana_inicio] || {}
            const tot = socios.reduce((a, s) => a + (r[s] || 0), 0)
            return `<tr><td>${fechaCorta(c.semana_inicio)} → ${fechaCorta(c.semana_fin)}</td>${socios.map(s => `<td class="rojo">${fmtPrecio(r[s] || 0)}</td>`).join('')}<td class="rojo">${fmtPrecio(tot)}</td></tr>`
          }).join('')}
        </tbody>
        <tfoot><tr class="total-row"><td>TOTAL MES</td>${socios.map(s => `<td class="rojo">${fmtPrecio(totalSocio[s])}</td>`).join('')}<td class="rojo">${fmtPrecio(totalRetiros)}</td></tr></tfoot>
      </table>` : ''

  // Totales de ventas minorista / mayorista del mes (de cada snapshot semanal).
  const totMin = semanasMes.reduce((s, c) => s + (Number(c.ingresos?.ventas_caja) || 0), 0)
  const totMay = semanasMes.reduce((s, c) => s + (Number(c.ingresos?.ventas_mayorista) || 0), 0)

  // ── Gráficos (van abajo de la distribución por socio) ──
  const serieSem = [{ nombre: 'Ventas', color: CHART_COLORS.ventas }, { nombre: 'Compras', color: CHART_COLORS.compras }, { nombre: 'Ganancia', color: CHART_COLORS.ganancia }]
  const gruposSem = semanasMes.map(c => ({ label: fmtFechaCorta(c.semana_inicio), valores: [c.ventas || 0, c.compras || 0, c.ganancia || 0] }))
  const serieTrend = [{ nombre: 'Ventas', color: CHART_COLORS.ventas }, { nombre: 'Compras', color: CHART_COLORS.compras }]
  const composicion = [
    { nombre: 'Compras', valor: totMes.compras, color: CHART_COLORS.compras },
    { nombre: 'Sueldos', valor: totMes.sueldos, color: CHART_COLORS.sueldos },
    { nombre: 'Gastos', valor: totMes.gastos, color: CHART_COLORS.gastos },
    { nombre: 'Ganancia', valor: totMes.ganancia, color: CHART_COLORS.ganancia },
  ]
  // Margen del mes (torta): % sobre el total de ventas. Gastos engloba sueldos,
  // retiros de socios y todos los gastos. Ganancia = ventas − compras − gastos.
  const gastosTodo = (totMes.gastos || 0) + (totMes.sueldos || 0)
  const margenSeg = [
    { nombre: 'Compras', valor: totMes.compras || 0, color: CHART_COLORS.compras },
    { nombre: 'Gastos (sueldos + socios + otros)', valor: gastosTodo, color: CHART_COLORS.gastos },
    { nombre: 'Ganancia', valor: totMes.ganancia || 0, color: CHART_COLORS.ganancia },
  ]
  const margenPct = totMes.ventas > 0 ? (totMes.ganancia / totMes.ventas) * 100 : 0

  const graficos = `
      <div class="titulo" style="font-size:15px;margin-top:22px;border-top:1px solid #ccc;padding-top:14px;">📊 Gráficos del mes</div>
      <div class="chart-sub">Margen del mes — % sobre el total de ventas (${fmtPrecio(totMes.ventas)})</div>
      <div style="display:flex;align-items:center;gap:28px;justify-content:center;margin:6px 0 4px;">
        ${svgDonutStr(margenSeg, `${margenPct.toFixed(1).replace('.', ',')}%`, 'margen ganancia')}
        ${donutRefsStr(margenSeg)}
      </div>
      <div class="chart-sub">Semana a semana — Ventas / Compras / Ganancia</div>
      ${svgBarrasStr(gruposSem, serieSem)}
      ${leyendaStr(serieSem)}
      <div class="chart-sub">¿A dónde fue la plata? — sobre ventas de ${fmtPrecio(totMes.ventas)}</div>
      ${composicionStr(composicion)}
      ${trendMeses.length > 1 ? `<div class="chart-sub">Histórico mensual — Ventas vs Compras</div>${svgBarrasStr(trendMeses, serieTrend)}${leyendaStr(serieTrend)}` : ''}`

  const html = `
    <html><head><title>Cierre Mensual — ${mesLabel}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
      .chart-sub { font-size: 12px; font-weight: 700; margin: 12px 0 4px; }
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
          <th>Período</th><th>Vtas. Minorista</th><th>Vtas. Mayorista</th><th>Compras</th><th>Gastos</th><th>Sueldos</th><th>Ganancia</th><th>Kg Carne</th><th>Kg Pollo</th><th>Kg Cerdo</th>
        </tr></thead>
        <tbody>
          ${semanasMes.map(c => `<tr>
            <td>${new Date(c.semana_inicio + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} → ${new Date(c.semana_fin + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</td>
            <td class="verde">${fmtPrecio(c.ingresos?.ventas_caja || 0)}</td>
            <td class="verde">${fmtPrecio(c.ingresos?.ventas_mayorista || 0)}</td>
            <td class="rojo">${fmtPrecio(c.compras)}</td>
            <td>${fmtPrecio(c.gastos)}</td>
            <td>${fmtPrecio(c.sueldos)}</td>
            <td class="${c.ganancia >= 0 ? 'oro' : 'rojo'}">${fmtPrecio(c.ganancia)}</td>
            <td>${fmtKgAR(c.kg_carne || 0)}</td>
            <td>${fmtKgAR(c.kg_pollo || 0)}</td>
            <td>${fmtKgAR(c.kg_cerdo || 0)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="verde">${fmtPrecio(totMin)}</td>
            <td class="verde">${fmtPrecio(totMay)}</td>
            <td class="rojo">${fmtPrecio(totMes.compras)}</td>
            <td>${fmtPrecio(totMes.gastos)}</td>
            <td>${fmtPrecio(totMes.sueldos)}</td>
            <td class="${totMes.ganancia >= 0 ? 'oro' : 'rojo'}">${fmtPrecio(totMes.ganancia)}</td>
            <td>${fmtKgAR(totMes.kgCarne || 0)}</td>
            <td>${fmtKgAR(totMes.kgPollo || 0)}</td>
            <td>${fmtKgAR(totMes.kgCerdo || 0)}</td>
          </tr>
        </tfoot>
      </table>
      ${tablaRetiros}
      <div class="socios">
        <div class="socio">
          <div class="socio-nombre">👑 Fabricio Lenardon (85%)</div>
          <div class="socio-valor oro">${fmtPrecio(totMes.ganancia * 0.85)}</div>
        </div>
        <div class="socio">
          <div class="socio-nombre">🤝 Ariel Garrone (15%)</div>
          <div class="socio-valor" style="color:#1a3a7a">${fmtPrecio(totMes.ganancia * 0.15)}</div>
        </div>
      </div>
      ${graficos}
    </body></html>
  `
  imprimirHTML(html)
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
  const ventasTotal = (c.ventas.caja || 0) + (c.ventas.mayorista || 0)
  const cobradoTotal = (c.cobrado.efectivo || 0) + (c.cobrado.debito || 0) +
    (c.cobrado.transferencia || 0) + (c.cobrado.mayorista || 0) + (c.cobrado.cobranzasCta || 0)
  const gastosTotal = (c.gastos.fijos || 0) + (c.gastos.variables || 0) + (c.gastos.socios || 0)
  // Sueldos + aguinaldo + vacaciones: todo es costo del período para la ganancia.
  const sueldosTotal = (c.sueldos.total || 0) + (c.sueldos.aguinaldos || 0) + (c.sueldos.vacaciones || 0)
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
// CONFIG MESES OPERATIVOS — inicio y cierre de cada mes a mano
// (como se cierra por semanas enteras, el mes operativo no coincide
//  con el calendario). El "Mensual en vivo" del Ejecutivo usa estas fechas.
// ============================================================
// ============================================================
// GRÁFICOS DEL PRINT — generan SVG/HTML como string (van en la impresión
// del cierre mensual, no en la pantalla)
// ============================================================
const CHART_COLORS = { ventas: '#22c55e', compras: '#ef4444', ganancia: '#b8860b', sueldos: '#4a7ac0', gastos: '#f59e0b' }
const fmtFechaCorta = d => d ? new Date(d + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : ''

// Barras agrupadas como string SVG. grupos: [{ label, valores:[...] }]; series: [{ nombre, color }]
function svgBarrasStr(grupos, series, alto = 170) {
  if (!grupos.length) return ''
  const W = 720, H = alto, mTop = 12, mBot = 24, mL = 10, mR = 10
  const innerH = H - mTop - mBot, innerW = W - mL - mR
  const todos = grupos.flatMap(g => g.valores)
  const maxV = Math.max(1, ...todos.map(v => Math.max(0, v)))
  const minV = Math.min(0, ...todos.map(v => Math.min(0, v)))
  const rango = (maxV - minV) || 1
  const yOf = v => mTop + ((maxV - v) / rango) * innerH
  const y0 = yOf(0)
  const gW = innerW / grupos.length
  const nS = series.length, gap = 3
  const bW = Math.max(2, (gW - gap * (nS + 1)) / nS)
  let body = ''
  grupos.forEach((g, gi) => {
    const gx = mL + gi * gW
    g.valores.forEach((v, si) => {
      const yv = yOf(v)
      const x = gx + gap + si * (bW + gap)
      body += `<rect x="${x.toFixed(1)}" y="${Math.min(yv, y0).toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(1, Math.abs(yv - y0)).toFixed(1)}" rx="2" fill="${series[si].color}"/>`
    })
    body += `<text x="${(gx + gW / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="#555">${g.label}</text>`
  })
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
    <line x1="${mL}" y1="${y0.toFixed(1)}" x2="${W - mR}" y2="${y0.toFixed(1)}" stroke="#bbb" stroke-width="1"/>${body}</svg>`
}

function leyendaStr(series) {
  return `<div style="display:flex;gap:18px;justify-content:center;margin-top:4px;font-size:11px;color:#555;">${series.map(s => `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:11px;height:11px;border-radius:2px;background:${s.color};display:inline-block;"></span>${s.nombre}</span>`).join('')}</div>`
}

// Barra horizontal de composición (a dónde se fue la plata sobre las ventas).
function composicionStr(segmentos) {
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.valor), 0) || 1
  const barras = segmentos.filter(s => s.valor > 0).map(s => `<div style="width:${((s.valor / total) * 100).toFixed(2)}%;background:${s.color};"></div>`).join('')
  const refs = segmentos.map(s => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;margin-right:14px;"><span style="width:11px;height:11px;border-radius:2px;background:${s.color};display:inline-block;"></span>${s.nombre}: <b>${fmtPrecio(s.valor)}</b> (${((Math.max(0, s.valor) / total) * 100).toFixed(0)}%)</span>`).join('')
  return `<div style="display:flex;height:26px;border:1px solid #000;border-radius:6px;overflow:hidden;">${barras}</div><div style="margin-top:6px;">${refs}</div>`
}

// Torta/donut como string SVG. segmentos: [{ nombre, valor, color }].
// centroTop/centroBot: texto grande/chico del centro (ej. el % de margen).
function svgDonutStr(segmentos, centroTop, centroBot) {
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.valor), 0) || 1
  const size = 200, cx = size / 2, cy = size / 2, r = 70, w = 34, C = 2 * Math.PI * r
  let acc = 0, arcs = ''
  segmentos.forEach(s => {
    const f = Math.max(0, s.valor) / total
    if (f <= 0) return
    const rot = -90 + acc * 360
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-dasharray="${(f * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"/>`
    acc += f
  })
  return `<svg viewBox="0 0 ${size} ${size}" width="190" height="190" style="display:block">${arcs}<text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="28" font-weight="900" fill="#000">${centroTop}</text><text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="11" fill="#555">${centroBot}</text></svg>`
}

function donutRefsStr(segmentos) {
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.valor), 0) || 1
  return `<div style="display:flex;flex-direction:column;gap:8px;">${segmentos.map(s => `<div style="font-size:12px;display:flex;align-items:center;gap:7px;"><span style="width:13px;height:13px;border-radius:3px;background:${s.color};display:inline-block;"></span><b>${((Math.max(0, s.valor) / total) * 100).toFixed(1)}%</b> · ${s.nombre} <span style="color:#777;">(${fmtPrecio(s.valor)})</span></div>`).join('')}</div>`
}

function ConfigMesesOperativos() {
  const [meses, setMeses] = useState([])
  const [nuevo, setNuevo] = useState({ etiqueta: '', fecha_inicio: '', fecha_cierre: '' })
  const [msg, setMsg] = useState(null)

  async function cargar() {
    const { data } = await supabase.from('meses_operativos').select('*').order('fecha_inicio', { ascending: false })
    setMeses(data || [])
  }
  useEffect(() => { cargar() }, [])
  function aviso(m) { setMsg(m); setTimeout(() => setMsg(null), 4000) }
  function setFila(id, campo, val) { setMeses(ms => ms.map(m => m.id === id ? { ...m, [campo]: val } : m)) }

  // 'YYYY-MM' del mes operativo. NO usar el mes de fecha_inicio: como los meses
  // arrancan/terminan en semanas enteras, el inicio suele caer en el mes calendario
  // anterior (Septiembre arranca 31/08 → daría '2026-08', duplicado con Agosto).
  // El punto medio del rango siempre cae en el mes correcto.
  function mesDeRango(inicio, cierre) {
    const medio = new Date((new Date(inicio + 'T12:00:00Z').getTime() + new Date(cierre + 'T12:00:00Z').getTime()) / 2)
    return `${medio.getUTCFullYear()}-${String(medio.getUTCMonth() + 1).padStart(2, '0')}`
  }

  async function guardarFila(m) {
    if (!m.fecha_inicio || !m.fecha_cierre) return aviso('⚠️ Cargá inicio y cierre')
    const { error } = await supabase.from('meses_operativos')
      .update({ etiqueta: m.etiqueta, fecha_inicio: m.fecha_inicio, fecha_cierre: m.fecha_cierre, mes: mesDeRango(m.fecha_inicio, m.fecha_cierre) })
      .eq('id', m.id)
    aviso(error ? '❌ ' + error.message : '✅ Guardado'); if (!error) cargar()
  }
  async function borrar(id) {
    if (!window.confirm('¿Borrar este mes operativo?')) return
    const { error } = await supabase.from('meses_operativos').delete().eq('id', id)
    aviso(error ? '❌ ' + error.message : '🗑️ Borrado'); if (!error) cargar()
  }
  async function agregar() {
    if (!nuevo.etiqueta || !nuevo.fecha_inicio || !nuevo.fecha_cierre) return aviso('⚠️ Completá nombre, inicio y cierre')
    const { error } = await supabase.from('meses_operativos').insert({ ...nuevo, mes: mesDeRango(nuevo.fecha_inicio, nuevo.fecha_cierre) })
    if (error) return aviso('❌ ' + error.message)
    setNuevo({ etiqueta: '', fecha_inicio: '', fecha_cierre: '' }); aviso('✅ Mes agregado'); cargar()
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">📆 Meses operativos — inicio y cierre manual</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 14px' }}>
        Como cerrás por semanas enteras (lun→dom), el mes no coincide con el calendario.
        Definí desde y hasta qué fecha va cada mes. El <b>Mensual en vivo</b> del Ejecutivo cierra con estas fechas.
      </p>
      {msg && <div style={{ marginBottom: 10, fontWeight: 600, color: msg[0] === '✅' || msg[0] === '🗑' ? '#7dff7d' : '#ffb86b' }}>{msg}</div>}
      {meses.map(m => (
        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
            <label>Mes</label>
            <input value={m.etiqueta || ''} onChange={e => setFila(m.id, 'etiqueta', e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}><label>Inicio</label><input type="date" value={m.fecha_inicio || ''} onChange={e => setFila(m.id, 'fecha_inicio', e.target.value)} /></div>
          <div className="form-group" style={{ margin: 0 }}><label>Cierre</label><input type="date" value={m.fecha_cierre || ''} onChange={e => setFila(m.id, 'fecha_cierre', e.target.value)} /></div>
          <button className="btn btn-sm" onClick={() => guardarFila(m)}>💾 Guardar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => borrar(m.id)} title="Borrar">🗑️</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
        <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}><label>Nuevo mes</label><input placeholder="Ej: Agosto 2026" value={nuevo.etiqueta} onChange={e => setNuevo({ ...nuevo, etiqueta: e.target.value })} /></div>
        <div className="form-group" style={{ margin: 0 }}><label>Inicio</label><input type="date" value={nuevo.fecha_inicio} onChange={e => setNuevo({ ...nuevo, fecha_inicio: e.target.value })} /></div>
        <div className="form-group" style={{ margin: 0 }}><label>Cierre</label><input type="date" value={nuevo.fecha_cierre} onChange={e => setNuevo({ ...nuevo, fecha_cierre: e.target.value })} /></div>
        <button className="btn btn-sm" onClick={agregar}>➕ Agregar mes</button>
      </div>
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
  const [mesesOp, setMesesOp] = useState([])   // meses operativos (inicio/cierre manual)
  const [remitosHist, setRemitosHist] = useState([]) // para detectar cierres desactualizados
  const [gastosHist, setGastosHist] = useState([])
  const [entradasHist, setEntradasHist] = useState([])
  const [loading, setLoading] = useState(false)
  const [calculando, setCalculando] = useState(false)
  const [alert, setAlert] = useState(null)
  const [mesSelector, setMesSelector] = useState('')

  // Estado del cierre auto en curso
  const [desde, setDesde] = useState(lunesDeLaSemana())
  const [hasta, setHasta] = useState(domingoDeLaSemana())
  // Mes operativo al que se imputa esta semana (default = mes del LUNES; en
  // semanas de borde se puede mandar al mes vecino para cerrar por semanas enteras).
  const [mesOperativo, setMesOperativo] = useState(mesDe(lunesDeLaSemana()))
  const [cierreAuto, setCierreAuto] = useState(null)   // valores calculados (originales)
  const [cierreEdit, setCierreEdit] = useState(null)   // copia editable (lo que se muestra/guarda)
  const [control, setControl] = useState(null)         // control semanal (comprado/vendido/stock)
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
  // Meses operativos: los usa "Mes en curso" para respetar inicio/cierre manual.
  useEffect(() => {
    supabase.from('meses_operativos').select('*').order('fecha_inicio', { ascending: false })
      .then(({ data }) => setMesesOp(data || []))
  }, [])
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
    // Remitos desde el primer cierre, para detectar semanas cerradas a las que se
    // les cargaron remitos DESPUÉS (snapshot desactualizado).
    if (data?.length) {
      const minIni = data.map(c => c.semana_inicio).filter(Boolean).sort()[0]
      const [rems, gas, ent] = await Promise.all([
        fetchAllRows(() => supabase.from('remitos').select('fecha, total, created_at, eliminado, cobro, cliente_nombre, es_cobranza_terceros').gte('fecha', minIni)),
        fetchAllRows(() => supabase.from('gastos').select('fecha, monto, created_at, solo_balance, tipo').gte('fecha', minIni)),
        fetchAllRows(() => supabase.from('entradas_deposito').select('fecha, importe, kg, kg_real, precio_kg, created_at, eliminado, destino').gte('fecha', minIni)),
      ])
      setRemitosHist(rems.data || [])
      setGastosHist(gas.data || [])
      setEntradasHist(ent.data || [])
    }
  }

  async function recalcular() {
    setCalculando(true)
    try {
      const [result, ctrl] = await Promise.all([
        calcularCierreAuto(desde, hasta),
        calcularControlSemanal(desde, hasta),
      ])
      setCierreAuto(result)
      setCierreEdit(JSON.parse(JSON.stringify(result)))  // copia editable fresca
      setControl(ctrl)
    } catch (e) {
      showAlert({ type: 'error', msg: 'Error calculando: ' + e.message })
    } finally {
      setCalculando(false)
    }
  }

  function showAlert(a) { setAlert(a); setTimeout(() => setAlert(null), 5000) }

  // Al cambiar la semana, el mes operativo por defecto vuelve al mes del lunes.
  useEffect(() => { setMesOperativo(mesDe(desde)) }, [desde])
  // Meses que toca la semana (lunes y domingo): si difieren, es semana de borde.
  const opcionesMes = [...new Set([mesDe(desde), mesDe(hasta)])]

  // Mover una semana ya cerrada de un mes operativo al otro que toca.
  async function moverSemanaDeMes(c) {
    const opts = [...new Set([mesDe(c.semana_inicio), mesDe(c.semana_fin)])]
    const otro = opts.find(m => m !== c.mes) || opts[0]
    if (otro === c.mes) return
    if (!confirm(`¿Mover la semana ${fmtFecha(c.semana_inicio)} → ${fmtFecha(c.semana_fin)}\nde ${mesLabelDe(c.mes)} a ${mesLabelDe(otro)}?`)) return
    const { error } = await supabase.from('cierres_semanales').update({ mes: otro }).eq('id', c.id)
    if (error) { showAlert({ type: 'error', msg: 'Error al mover: ' + error.message }); return }
    showAlert({ type: 'success', msg: `✅ Semana movida a ${mesLabelDe(otro)}` })
    setMesSelector(otro)
    fetchCierres()
  }

  async function guardarCierre() {
    if (!view) return
    if (!confirm(`¿Confirmar y guardar cierre del ${fmtFecha(desde)} al ${fmtFecha(hasta)}?${editado ? '\n\n⚠️ Tiene valores EDITADOS A MANO.' : ''}\n\nVentas: ${fmt(view.ventas.total)}\nCompras: ${fmt(view.compras.total)}\nGanancia devengada: ${fmt(view.ganancia.devengada)}`)) return
    setLoading(true)
    const fila = cierreAutoAFila(view, mesOperativo)
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
      // Bump created_at: marca "recerrado ahora" para que el aviso de desactualizado
      // se limpie (compara datos cargados DESPUÉS de la fecha del cierre).
      const r = await supabase.from('cierres_semanales').update({ ...fila, created_at: new Date().toISOString() }).eq('id', ya.id)
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
    // Guardar la foto del stock del cierre (para el Control Semanal histórico).
    await guardarSnapshotStock(hasta, profile?.nombre)
    showAlert({ type: 'success', msg: `✅ Cierre guardado (${ya ? 'actualizado' : 'nuevo'}) + foto de stock` })
    fetchCierres()
  }

  async function eliminarCierre(id) {
    if (!confirm('¿Anular este cierre semanal?\n\nDespués podés volver a cerrar esa semana (Cierre Auto → "Semana anterior", o el botón 🔄 Re-cerrar) y se va a recalcular con los datos actualizados (ej. sueldos ya liquidados).\n\nNota: en vez de anular, también podés usar 🔄 Re-cerrar directamente — actualiza el cierre sin borrarlo.')) return
    await supabase.from('cierres_semanales').delete().eq('id', id)
    showAlert({ type: 'success', msg: '🗑️ Cierre anulado — ya podés volver a cerrar esa semana' })
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
    // Usar el MES OPERATIVO que contiene hoy (inicio/cierre manual), no el del
    // calendario: así no mezcla los días de fin de mes (29/30) que ya pasan al
    // mes siguiente. Fallback al calendario si no hay mes operativo definido.
    const op = mesesOp.find(m => m.fecha_inicio && m.fecha_cierre && m.fecha_inicio <= hoy && hoy <= m.fecha_cierre)
    if (op) { setDesde(op.fecha_inicio); setHasta(op.fecha_cierre) }
    else { setDesde(hoy.substring(0, 7) + '-01'); setHasta(hoy) }
  }

  // ====== Datos para el tab Por Mes ======
  const meses = [...new Set(cierres.map(c => c.mes))].sort().reverse()
  const semanasMes = cierres.filter(c => c.mes === mesSelector)

  // ── CIERRES QUE SE PISAN ENTRE SÍ ────────────────────────────
  // Dos cierres guardados que comparten aunque sea un día suman las MISMAS
  // ventas dos veces en el total del mes. Pasó el 01/09/2026 en Monte Cristo:
  // se cerró 25→31/08 y después, por errarle al día de arranque, 24→31/08 —
  // el mes mostró $17,4M de minorista en vez de $9,6M.
  // No se bloquea nada: el sistema avisa y el dueño decide cuál anular.
  // `cierres` ya viene filtrado por RLS a la boca del usuario, así que el
  // cierre de otra sucursal nunca cuenta como solape.
  const seSolapan = (a, b) =>
    !!(a.semana_inicio && a.semana_fin && b.semana_inicio && b.semana_fin) &&
    a.semana_inicio <= b.semana_fin && b.semana_inicio <= a.semana_fin

  // Cierres guardados que pisan el período [ini, fin] con OTRAS fechas.
  // El de fechas idénticas no cuenta: guardar ahí actualiza esa misma fila.
  function cierresQueSePisan(ini, fin) {
    if (!ini || !fin || ini > fin) return []
    return cierres.filter(c =>
      !(c.semana_inicio === ini && c.semana_fin === fin) &&
      seSolapan({ semana_inicio: ini, semana_fin: fin }, c))
  }
  // Dentro del mes que se está mirando: qué otras filas pisan a ésta.
  const pisadosEnMes = c => semanasMes.filter(o => o.id !== c.id && seSolapan(c, o))
  const hayPisadosEnMes = semanasMes.some(c => pisadosEnMes(c).length > 0)

  // Impacto en la ganancia de datos cargados DESPUÉS de cerrar la semana (snapshot
  // desactualizado): + ventas nuevas (remitos) − gastos nuevos − compras nuevas.
  // Si hubo cambios, la ganancia guardada quedó vieja → conviene recalcular y reguardar.
  function impactoPost(c) {
    if (!c.created_at) return { hay: false, delta: 0 }
    const ini = c.semana_inicio, fin = c.semana_fin, ts = c.created_at
    const enRango = (f) => f >= ini && f <= fin
    const ventasN = remitosHist
      .filter(r => !r.eliminado && r.cobro !== 'interno' && !r.es_cobranza_terceros && String(r.cliente_nombre || '').trim().toUpperCase() !== 'MITRE' && enRango(r.fecha) && r.created_at > ts)
      .reduce((s, r) => s + (Number(r.total) || 0), 0)
    const gastosN = gastosHist
      .filter(g => !g.solo_balance && ['fijo', 'variable', 'socio'].includes(g.tipo) && enRango(g.fecha) && g.created_at > ts)
      .reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const comprasN = entradasHist
      .filter(e => !e.eliminado && e.destino !== 'desposte' && e.destino !== 'elaboracion' && enRango(e.fecha) && e.created_at > ts)
      .reduce((s, e) => s + (Number(e.importe) > 0 ? Number(e.importe) : (Number(e.kg_real || e.kg) || 0) * (Number(e.precio_kg) || 0)), 0)
    const movido = ventasN + gastosN + comprasN
    return { hay: movido > 1, delta: ventasN - gastosN - comprasN }
  }
  const totMes = { ventas: 0, ventasMin: 0, ventasMay: 0, compras: 0, gastos: 0, sueldos: 0, ganancia: 0, kgCarne: 0, kgPollo: 0, kgCerdo: 0, ventasCtacte: 0 }
  semanasMes.forEach(c => {
    totMes.ventas += c.ventas || 0
    totMes.ventasMin += Number(c.ingresos?.ventas_caja) || 0
    totMes.ventasMay += Number(c.ingresos?.ventas_mayorista) || 0
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

  // Histórico mensual (Ventas vs Compras por mes) — para el gráfico de tendencia.
  // Usa ventas/compras porque están cargadas en TODOS los cierres (la ganancia
  // sólo se computa en los recientes). Mes seleccionado resaltado más fuerte.
  const trendMeses = [...new Set(cierres.map(c => c.mes).filter(Boolean))].sort().map(m => {
    const ws = cierres.filter(c => c.mes === m)
    return {
      label: new Date(m + '-15').toLocaleDateString('es-AR', { month: 'short' }).replace('.', ''),
      valores: [ws.reduce((s, c) => s + (c.ventas || 0), 0), ws.reduce((s, c) => s + (c.compras || 0), 0)],
    }
  })

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
            {/* Este período pisa un cierre ya guardado con OTRAS fechas: si se
                guarda, el mes cuenta dos veces los días repetidos. */}
            {cierresQueSePisan(desde, hasta).map(c => (
              <div key={c.id} style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,90,90,0.10)', border: '1px solid var(--red-light)',
                fontSize: 12, color: 'var(--red-light)', display: 'flex',
                alignItems: 'center', gap: 10, flexWrap: 'wrap'
              }}>
                <span style={{ flex: 1, minWidth: 240 }}>
                  ⚠️ <b>Este período pisa un cierre ya guardado</b> ({fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}).
                  Si guardás igual, el mes va a contar dos veces los días repetidos.
                  Poné exactamente esas fechas para actualizarlo, o anulá el viejo.
                </span>
                <button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}
                  title="Usar el período del cierre ya guardado, para actualizarlo en vez de crear uno nuevo"
                  onClick={() => { setDesde(c.semana_inicio); setHasta(c.semana_fin) }}>
                  📅 Usar {fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-light)', whiteSpace: 'nowrap' }}
                  title="Anular el cierre ya guardado" onClick={() => eliminarCierre(c.id)}>
                  🗑️ Anular el viejo
                </button>
              </div>
            ))}
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
                  sub={`${view.ventas.cantRemitos || 0} remitos · caja minorista`} />
                <MetricCard label="💰 Cobrado en el período" value={fmt(view.cobrado.total)} color="var(--teal)" big />
                <MetricCard label="📤 Por cobrar al cierre" value={fmt(view.porCobrar.total)} color="var(--amber)"
                  editable={editableNow} rawValue={view.porCobrar.total} onCommit={v => commitLeaf('porCobrar.total', v)}
                  sub={`${view.porCobrar.clientes.length} clientes con deuda`} />
                <MetricCard label="🛒 Compras" value={fmt(view.compras.total)} color="var(--red-light)" big
                  editable={editableNow} rawValue={view.compras.total} onCommit={v => commitLeaf('compras.total', v)} />
                <MetricCard label="📆 Comprado en el mes" value={fmt(view.compras.mes || 0)} color="#f0883e"
                  sub="acumulado del mes en curso" />
                <MetricCard label="💳 Pagado a proveedores" value={fmt(view.pagadoProv.mes || 0)} color="#c084fc"
                  sub="acumulado del mes (sin 1ª semana)" />
                <MetricCard label="📥 Por pagar al cierre" value={fmt(view.porPagarProv.total)} color="var(--amber)"
                  sub="saldo real cta. cte. al cierre" />
                {view.saldoAdeudado && (
                  <MetricCard label="🔴 Saldo adeudado (arrastre)" value={fmt(view.saldoAdeudado.total || 0)} color="var(--red-light)"
                    sub="deuda de semanas anteriores sin pagar" />
                )}
              </div>

              {/* SALDO ADEUDADO (ARRASTRE) — deuda vieja impaga, con nombre
                  propio para que no se escape al pagar la semana. Informativo:
                  NO se resta de la ganancia (esas compras ya se descontaron
                  completas la semana en que se compraron; restarlas de nuevo
                  sería doble descuento — decisión Fabricio 04/08/2026). */}
              {(view.saldoAdeudado?.total || 0) > 0.01 && (
                <div className="card" style={{ border: '1px solid var(--red-light)', background: 'rgba(192,57,43,0.06)', marginBottom: 14 }}>
                  <div className="card-title" style={{ color: 'var(--red-light)' }}>🔴 Saldo adeudado a proveedores — arrastre de semanas anteriores</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                    Deuda vieja que sigue impaga (compras de semanas anteriores menos todos los pagos hechos hasta hoy).
                    Esta semana correspondería pagar: <strong style={{ color: 'var(--text)' }}>compras del período {fmt(view.compras.total)} + arrastre {fmt(view.saldoAdeudado.total)} = {fmt((Number(view.compras.total) || 0) + (Number(view.saldoAdeudado.total) || 0))}</strong>.
                    No se resta de la ganancia: ya se descontó en la semana en que se compró.
                  </div>
                  {(view.saldoAdeudado.proveedores || []).map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)', fontSize: 13 }}>
                      <span>{p.nombre}</span>
                      <span style={{ fontWeight: 700, color: 'var(--red-light)' }}>{fmt(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}

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
                  <FilaDesglose label="Remitos mayoristas" value={view.ventas.mayorista} color="var(--green)" editable={editableNow} onCommit={v => commitLeaf('ventas.mayorista', v)} />
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
                  <FilaDesglose label="Aguinaldos" value={view.sueldos.aguinaldos || 0} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('sueldos.aguinaldos', v)} />
                  <FilaDesglose label="Vacaciones" value={view.sueldos.vacaciones || 0} color="var(--red-light)" editable={editableNow} onCommit={v => commitLeaf('sueldos.vacaciones', v)} />
                  <FilaDesglose label="TOTAL GASTOS + SUELDOS" value={view.gastos.total + view.sueldos.total + (view.sueldos.aguinaldos || 0) + (view.sueldos.vacaciones || 0)} color="var(--amber)" />
                </div>

                {/* KG MOVIDOS */}
                <div className="card">
                  <div className="card-title">⚖️ Kg comprados (entradas)</div>
                  <FilaDesglose label="🥩 Carne" value={view.kg.carne} esKg editable={editableNow} onCommit={v => commitLeaf('kg.carne', v)} />
                  <FilaDesglose label="🍗 Pollo" value={view.kg.pollo} esKg editable={editableNow} onCommit={v => commitLeaf('kg.pollo', v)} />
                  <FilaDesglose label="🐷 Cerdo" value={view.kg.cerdo} esKg editable={editableNow} onCommit={v => commitLeaf('kg.cerdo', v)} />
                  <FilaDesglose label="🌭 Embutidos" value={view.kg.embutidos} esKg editable={editableNow} onCommit={v => commitLeaf('kg.embutidos', v)} />
                </div>

                {/* CLIENTES — VENDIDO EN EL PERÍODO */}
                {(view.ventasPorCliente?.length > 0) && (
                  <div className="card">
                    <div className="card-title">📤 Clientes — vendido en el período</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>
                      Lo despachado a cada cliente entre {fmtFecha(view.periodo.desde)} y {fmtFecha(view.periodo.hasta)}.
                    </div>
                    <div style={{ fontSize: 12, maxHeight: 320, overflowY: 'auto' }}>
                      {view.ventasPorCliente.map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
                          <span>{c.nombre}</span>
                          <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(c.total)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', fontWeight: 700 }}>
                        <span>TOTAL ({view.ventasPorCliente.length})</span>
                        <span style={{ color: 'var(--gold)' }}>{fmt(view.ventasPorCliente.reduce((s, c) => s + c.total, 0))}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* PROVEEDORES — COMPRADO EN EL PERÍODO */}
                {(view.comprasPorProveedor?.length > 0) && (
                  <div className="card">
                    <div className="card-title">📥 Proveedores — comprado en el período</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>
                      Lo comprado a cada proveedor entre {fmtFecha(view.periodo.desde)} y {fmtFecha(view.periodo.hasta)}.
                    </div>
                    <div style={{ fontSize: 12, maxHeight: 320, overflowY: 'auto' }}>
                      {view.comprasPorProveedor.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
                          <span>{p.nombre || '—'}</span>
                          <span style={{ color: 'var(--red-light)', fontWeight: 600 }}>{fmt(p.total)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', fontWeight: 700 }}>
                        <span>TOTAL ({view.comprasPorProveedor.length})</span>
                        <span style={{ color: 'var(--gold)' }}>{fmt(view.comprasPorProveedor.reduce((s, p) => s + p.total, 0))}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CONTROL SEMANAL (lun → dom): comprado / vendido / elaborado / stock */}
              {control && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="card-title">📋 Control semanal (lun → dom) · {fmtFecha(view.periodo.desde)} al {fmtFecha(view.periodo.hasta)}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>

                    {/* COMPRADO */}
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>🛒 Comprado (bruto)</div>
                      {control.comprado.map((x, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
                          <span>{nombreTipo(x.tipo)}</span><span style={{ fontWeight: 600 }}>{fmtKg(x.kg)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontWeight: 700 }}>
                        <span>TOTAL</span><span style={{ color: 'var(--gold)' }}>{fmtKg(control.comprado.reduce((s, x) => s + x.kg, 0))}</span>
                      </div>
                    </div>

                    {/* VENDIDO */}
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 6 }}>🥩 Vendido (mayor. + minor.)</div>
                      {control.vendido.map((x, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12, gap: 6 }}>
                          <span>{nombreTipo(x.categoria)}</span>
                          <span style={{ fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {fmtKg(x.total)}<br /><span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 400 }}>{fmtKg(x.may)} may · {fmtKg(x.min)} min</span>
                          </span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontWeight: 700 }}>
                        <span>TOTAL</span><span style={{ color: 'var(--green)' }}>{fmtKg(control.vendido.reduce((s, x) => s + x.total, 0))}</span>
                      </div>
                    </div>

                    {/* ELABORADO / CONVERSIÓN (interno) */}
                    <div>
                      <div style={{ fontWeight: 700, color: '#dd9b6c', marginBottom: 6 }}>🌭 Elaborado / interno</div>
                      {control.elaborado.map((x, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
                          <span>Elaborado: {nombreTipo(x.tipo)}</span><span style={{ fontWeight: 600 }}>{fmtKg(x.kg)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12, color: 'var(--muted)' }}>
                        <span>🔪 Conversión a cortes</span><span style={{ fontWeight: 600 }}>{fmtKg(control.conversionInterna)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Movimientos internos — no son ventas.</div>
                    </div>

                    {/* STOCK que debería quedar */}
                    <div>
                      <div style={{ fontWeight: 700, color: '#7ec8ff', marginBottom: 6 }}>📦 Stock que debería quedar</div>
                      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                        {control.stock.map((x, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12, color: x.kg < 0 ? '#ff8b8b' : 'inherit' }}>
                            <span>{nombreTipo(x.tipo)}</span><span style={{ fontWeight: 600 }}>{fmtKg(x.kg)}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                        {control.stockEnVivo ? '⚡ Stock en vivo (se congela al guardar el cierre).' : '🔒 Foto guardada al cierre de esa semana.'}
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* GUARDAR */}
              <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
                {/* Mes operativo — clave en semanas de borde para cerrar por semanas enteras */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', marginRight: 8 }}>📅 Esta semana cuenta para el mes:</label>
                  <select value={mesOperativo} onChange={e => setMesOperativo(e.target.value)}
                    style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
                    {opcionesMes.map(m => <option key={m} value={m}>{mesLabelDe(m)}</option>)}
                  </select>
                  {opcionesMes.length > 1 && (
                    <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 6 }}>
                      ⚠️ Semana de borde (cae entre {mesLabelDe(opcionesMes[0])} y {mesLabelDe(opcionesMes[1])}). Elegí en qué mes contarla — siempre entera.
                    </div>
                  )}
                </div>
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
          <ConfigMesesOperativos />
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
                  <button className="btn btn-ghost btn-sm" onClick={() => imprimirCierreMensual(semanasMes, totMes, mesLabel, trendMeses)} disabled={!semanasMes.length}>
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
                <MetricCard label="Vtas. Minorista (caja)" value={fmt(totMes.ventasMin)} color="var(--green)" />
                <MetricCard label="Vtas. Mayorista" value={fmt(totMes.ventasMay)} color="var(--green)" />
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
                        <th>Vtas. Minorista</th>
                        <th>Vtas. Mayorista</th>
                        <th>Compras</th>
                        <th>Gastos</th>
                        <th>Sueldos</th>
                        <th>Ganancia</th>
                        <th>Kg Carne</th>
                        <th>Kg Pollo</th>
                        <th>Kg Cerdo</th>
                        <th>Mes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semanasMes.map(c => {
                        const desact = impactoPost(c)
                        const pisados = pisadosEnMes(c)
                        return (
                        <tr key={c.id}>
                          <td>{fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}
                            {desact.hay && (
                              <div title="Se cargaron ventas, gastos o compras con fecha de esta semana DESPUÉS de cerrarla. Recalculá y reguardá el cierre para actualizar la ganancia." style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginTop: 3 }}>
                                ⚠️ desactualizado · ganancia real {desact.delta >= 0 ? '+' : '−'}{fmt(desact.delta)} · recalculá
                              </div>
                            )}
                            {pisados.length > 0 && (
                              <div title="Estos cierres comparten días. El TOTAL del mes suma las mismas ventas dos veces: anulá el que sobra." style={{ fontSize: 10, color: 'var(--red-light)', fontWeight: 700, marginTop: 3 }}>
                                ⛔ pisa {pisados.map(o => `${fmtFecha(o.semana_inicio)} → ${fmtFecha(o.semana_fin)}`).join(', ')} · el TOTAL cuenta doble
                              </div>
                            )}
                          </td>
                          <td style={{ color: 'var(--green)' }}>{fmt(c.ingresos?.ventas_caja || 0)}</td>
                          <td style={{ color: 'var(--green)' }}>{fmt(c.ingresos?.ventas_mayorista || 0)}</td>
                          <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                          <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                          <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                          <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                          <td>{fmtKg(c.kg_carne)}</td>
                          <td>{fmtKg(c.kg_pollo)}</td>
                          <td>{fmtKg(c.kg_cerdo)}</td>
                          <td>
                            {(() => {
                              const otro = [...new Set([mesDe(c.semana_inicio), mesDe(c.semana_fin)])].find(m => m !== c.mes)
                              return otro ? (
                                <button className="btn btn-ghost btn-sm" onClick={() => moverSemanaDeMes(c)}
                                  title={`Mover a ${mesLabelDe(otro)}`} style={{ fontSize: 11, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                                  ↔ {mesLabelDe(otro).split(' ')[0]}
                                </button>
                              ) : <span style={{ color: 'var(--muted)' }}>—</span>
                            })()}
                            {/* Anular acá mismo: antes había que ir hasta el tab
                                Historial para sacar un cierre mal cerrado. */}
                            <button className="btn btn-ghost btn-sm" title="Anular este cierre semanal"
                              onClick={() => eliminarCierre(c.id)}
                              style={{ color: 'var(--red-light)', fontSize: 11, marginLeft: 4 }}>
                              🗑️
                            </button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td>TOTAL
                          {hayPisadosEnMes && (
                            <div style={{ fontSize: 10, color: 'var(--red-light)', fontWeight: 700, marginTop: 3 }}>
                              ⛔ hay cierres que se pisan · este total está inflado
                            </div>
                          )}
                        </td>
                        <td style={{ color: 'var(--green)' }}>{fmt(totMes.ventasMin)}</td>
                        <td style={{ color: 'var(--green)' }}>{fmt(totMes.ventasMay)}</td>
                        <td style={{ color: 'var(--red-light)' }}>{fmt(totMes.compras)}</td>
                        <td style={{ color: 'var(--amber)' }}>{fmt(totMes.gastos)}</td>
                        <td style={{ color: 'var(--blue)' }}>{fmt(totMes.sueldos)}</td>
                        <td style={{ color: totMes.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)' }}>{fmt(totMes.ganancia)}</td>
                        <td>{fmtKg(totMes.kgCarne)}</td>
                        <td>{fmtKg(totMes.kgPollo)}</td>
                        <td>{fmtKg(totMes.kgCerdo)}</td>
                        <td></td>
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
                  {(pagCierres?.items || []).filter(Boolean).map(c => (
                    <tr key={c.id}>
                      <td>{fmtFecha(c.semana_inicio)} → {fmtFecha(c.semana_fin)}</td>
                      <td style={{ color: 'var(--green)' }}>{fmt(c.ventas)}</td>
                      <td style={{ color: 'var(--red-light)' }}>{fmt(c.compras)}</td>
                      <td style={{ color: 'var(--amber)' }}>{fmt(c.gastos)}</td>
                      <td style={{ color: 'var(--blue)' }}>{fmt(c.sueldos)}</td>
                      <td style={{ color: c.ganancia >= 0 ? 'var(--gold)' : 'var(--red-light)', fontWeight: 700 }}>{fmt(c.ganancia)}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm"
                          title="Recalcular esta semana con los datos actuales (ej. sueldos ya liquidados) y volver a guardarla — actualiza el cierre existente"
                          onClick={() => { setDesde(c.semana_inicio); setHasta(c.semana_fin); setTab('semanal') }}>
                          🔄 Re-cerrar
                        </button>
                        <button className="btn btn-ghost btn-sm" title="Anular este cierre semanal" onClick={() => eliminarCierre(c.id)} style={{ color: 'var(--red-light)' }}>
                          🗑️ Anular
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador {...pagCierres.controles} label="cierres" />
          </div>
        </div>
      )}
    </div>
  )
}
