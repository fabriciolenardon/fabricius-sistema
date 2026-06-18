// ============================================================
// BALANCE — Exportación a PDF (estilo contador)
// ============================================================
// Genera un PDF A4 con el Estado de Resultados y el Estado de
// Situación Patrimonial del ejercicio. Usa pdf-lib desde CDN
// (mismo patrón que Gastos.jsx / Etiquetas.jsx).
// ============================================================
import { SECCIONES_ER, SECCIONES_ESP } from './balance'

function cargarPdfLib() {
  return new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib)
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
    s.onload = () => resolve(window.PDFLib)
    s.onerror = () => reject(new Error('No se pudo cargar pdf-lib (revisá tu conexión)'))
    document.head.appendChild(s)
  })
}

// Monto en pesos para PDF (Helvetica no tiene glyph de "$" con problemas, pero
// usamos formato AR con separador de miles y coma decimal).
function money(v) {
  const num = Number(v) || 0
  return '$ ' + num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fechaAR(d) {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

// Agrupa las líneas manuales por sección preservando orden.
function lineasDe(lineas, estado, seccion) {
  return (lineas || [])
    .filter(l => l.estado === estado && l.seccion === seccion)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
}

export async function exportarBalancePdf({ cuenta, ejercicio, calc, lineas }) {
  const PDFLib = await cargarPdfLib()
  const { PDFDocument, StandardFonts, rgb } = PDFLib
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const W = 595.28, H = 841.89
  const ML = 50, MR = 50
  const COLR = W - MR              // x del borde derecho (montos alineados a la derecha)
  const dark = rgb(0.1, 0.1, 0.12)
  const grey = rgb(0.45, 0.45, 0.5)
  const line = rgb(0.8, 0.8, 0.83)
  const gold = rgb(0.72, 0.55, 0.12)

  let page = doc.addPage([W, H])
  let y = H - 55

  const nl = (dy = 16) => { y -= dy; if (y < 70) { page = doc.addPage([W, H]); y = H - 55 } }
  const txt = (s, x, opts = {}) =>
    page.drawText(String(s ?? ''), { x, y, size: opts.size || 10, font: opts.bold ? bold : font, color: opts.color || dark })
  // texto alineado a la derecha terminando en COLR
  const txtR = (s, opts = {}) => {
    const f = opts.bold ? bold : font, size = opts.size || 10
    const w = f.widthOfTextAtSize(String(s ?? ''), size)
    page.drawText(String(s ?? ''), { x: COLR - w, y, size, font: f, color: opts.color || dark })
  }
  const hr = (color = line) => { page.drawLine({ start: { x: ML, y: y + 4 }, end: { x: COLR, y: y + 4 }, thickness: 0.7, color }) }

  // ---- Encabezado ----
  txt(cuenta?.razon_social?.trim() || cuenta?.nombre?.trim() || 'FABRICIUS SAS', ML, { bold: true, size: 16 })
  nl(18)
  txt(`CUIT ${cuenta?.cuit || ''}  ·  Responsable Inscripto`, ML, { color: grey, size: 9 })
  nl(20)
  txt(ejercicio?.denominacion || `Ejercicio Económico N° ${ejercicio?.numero || ''}`, ML, { bold: true, size: 12, color: gold })
  nl(14)
  txt(`Período: ${fechaAR(ejercicio?.fecha_inicio)}  al  ${fechaAR(ejercicio?.fecha_cierre)}`, ML, { color: grey, size: 9 })
  if (ejercicio?.estado === 'cerrado') {
    nl(12)
    txt(`Ejercicio CERRADO el ${fechaAR(ejercicio?.cerrado_at)}`, ML, { color: grey, size: 8 })
  }
  nl(26)

  // ================= ESTADO DE RESULTADOS =================
  txt('ESTADO DE RESULTADOS', ML, { bold: true, size: 12 }); nl(6); hr(gold); nl(18)

  const row = (label, val, opts = {}) => {
    txt(label, opts.indent ? ML + 14 : ML, { bold: opts.bold, color: opts.color, size: opts.size })
    if (val != null) txtR(money(val), { bold: opts.bold, color: opts.color, size: opts.size })
    nl(opts.gap || 15)
  }

  row('Ventas netas (sin IVA)', calc.ventasNetas, { bold: true })
  row('Costo de mercadería vendida', null, { bold: true })
  row('Existencia inicial', calc.existIni, { indent: true, color: grey })
  row('(+) Compras netas', calc.comprasNetas, { indent: true, color: grey })
  row('(−) Existencia final', -calc.existFin, { indent: true, color: grey })
  row('= Costo de mercadería vendida', -calc.cmv, { indent: true })
  nl(2); hr(); nl(14)
  row('Resultado bruto', calc.resultadoBruto, { bold: true })
  nl(6)
  // Gastos detallados
  row('Gastos de comercialización y administración', null, { bold: true })
  lineasDe(lineas, 'resultados', 'gastos').forEach(l => row(l.rubro, -Number(l.monto || 0), { indent: true, color: grey }))
  row('Total gastos', -calc.gastos, { indent: true })
  // Otros
  const otrosIng = lineasDe(lineas, 'resultados', 'otros_ingresos')
  const otrosEgr = lineasDe(lineas, 'resultados', 'otros_egresos')
  if (otrosIng.length) { row('Otros ingresos', calc.otrosIngresos, { bold: true }); otrosIng.forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey })) }
  if (otrosEgr.length) { row('Otros egresos', -calc.otrosEgresos, { bold: true }); otrosEgr.forEach(l => row(l.rubro, -Number(l.monto || 0), { indent: true, color: grey })) }
  nl(2); hr(); nl(14)
  row('Resultado antes de impuesto a las ganancias', calc.resultadoAntesImp, { bold: true })
  row('(−) Impuesto a las ganancias', -calc.impGan, { indent: true, color: grey })
  nl(2); hr(gold); nl(16)
  row('RESULTADO DEL EJERCICIO', calc.resultadoEjercicio, { bold: true, size: 12, color: calc.resultadoEjercicio >= 0 ? rgb(0.1, 0.45, 0.2) : rgb(0.7, 0.15, 0.15) })

  // ================= ESTADO DE SITUACIÓN PATRIMONIAL =================
  nl(20)
  txt('ESTADO DE SITUACIÓN PATRIMONIAL', ML, { bold: true, size: 12 }); nl(6); hr(gold); nl(18)

  // ACTIVO
  txt('ACTIVO', ML, { bold: true, size: 11, color: gold }); nl(16)
  txt(SECCIONES_ESP.activo_corriente, ML, { bold: true }); nl(15)
  lineasDe(lineas, 'patrimonial', 'activo_corriente').forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey }))
  row('Bienes de cambio (existencia final)', calc.bienesCambio, { indent: true, color: grey })
  row('Subtotal Activo Corriente', calc.activoCorriente, { indent: true })
  nl(4)
  txt(SECCIONES_ESP.activo_no_corriente, ML, { bold: true }); nl(15)
  lineasDe(lineas, 'patrimonial', 'activo_no_corriente').forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey }))
  row('Subtotal Activo No Corriente', calc.activoNoCorriente, { indent: true })
  nl(2); hr(); nl(14)
  row('TOTAL ACTIVO', calc.totalActivo, { bold: true, size: 11 })
  nl(10)

  // PASIVO
  txt('PASIVO', ML, { bold: true, size: 11, color: gold }); nl(16)
  txt(SECCIONES_ESP.pasivo_corriente, ML, { bold: true }); nl(15)
  lineasDe(lineas, 'patrimonial', 'pasivo_corriente').forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey }))
  row('Subtotal Pasivo Corriente', calc.pasivoCorriente, { indent: true })
  nl(4)
  txt(SECCIONES_ESP.pasivo_no_corriente, ML, { bold: true }); nl(15)
  lineasDe(lineas, 'patrimonial', 'pasivo_no_corriente').forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey }))
  row('Subtotal Pasivo No Corriente', calc.pasivoNoCorriente, { indent: true })
  nl(2); hr(); nl(14)
  row('TOTAL PASIVO', calc.totalPasivo, { bold: true, size: 11 })
  nl(10)

  // PATRIMONIO NETO
  txt('PATRIMONIO NETO', ML, { bold: true, size: 11, color: gold }); nl(16)
  lineasDe(lineas, 'patrimonial', 'patrimonio_neto').forEach(l => row(l.rubro, Number(l.monto || 0), { indent: true, color: grey }))
  row('Resultado del ejercicio', calc.resultadoEjercicio, { indent: true, color: grey })
  nl(2); hr(); nl(14)
  row('TOTAL PATRIMONIO NETO', calc.totalPN, { bold: true, size: 11 })
  nl(8); hr(gold); nl(16)
  row('TOTAL PASIVO + PATRIMONIO NETO', calc.totalPasivo + calc.totalPN, { bold: true, size: 11 })
  nl(16)
  const cuadraTxt = calc.cuadra ? 'El balance cuadra (Activo = Pasivo + Patrimonio Neto)' : `DIFERENCIA SIN CUADRAR: ${money(calc.diferencia)}`
  txt(cuadraTxt, ML, { size: 9, color: calc.cuadra ? rgb(0.1, 0.45, 0.2) : rgb(0.7, 0.15, 0.15), bold: !calc.cuadra })
  nl(30)
  txt('Documento generado por el sistema Fabricius — borrador de gestión, sujeto a revisión del contador.', ML, { size: 7, color: grey })

  const bytes = await doc.save()
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Balance_${(cuenta?.nombre || 'SAS').trim().replace(/\s+/g, '_')}_Ej${ejercicio?.numero || ''}.pdf`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
