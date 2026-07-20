// ============================================================
// LISTAS DE PRECIOS — Exportación a PDF para WhatsApp
// ============================================================
// Genera un PDF A4 real (archivo) con la lista de precios vigente,
// listo para compartir por WhatsApp:
//   - 'mayorista'  → columnas MINORISTA | MAYORISTA (estilo "PLANILLA
//                    PRECIOS": cortes por mayor y menor).
//   - 'carniceria' → una sola columna con precio_carniceria (estilo
//                    "LISTA PARA CARNICERIAS": precios de reventa).
// En el celular usa el share nativo (navigator.share) que abre el menú
// con WhatsApp; en la compu descarga el .pdf para arrastrarlo al chat.
// Usa pdf-lib desde CDN (mismo patrón que balancePdf.js / Gastos.jsx).
// ============================================================

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

// Títulos "lindos" para las categorías históricas. Sin emojis: Helvetica
// (WinAnsi) no puede codificarlos y pdf-lib tira error al dibujar el texto.
const TITULOS_PDF = {
  bovino_mr:      'BOVINO — MEDIAS RESES',
  bovino_pieza:   'BOVINO — PIEZAS',
  bovino_corte:   'BOVINO — CORTES',
  bovino_brosa:   'BROSAS / ACHURAS',
  bovino_caja_pt: 'CAJAS BOVINAS — ENVASADOS PT',
  cerdo_corte:    'CERDO — CORTES',
  cerdo_pieza:    'CERDO — PIEZAS',
  embutido:       'EMBUTIDOS',
  pollo:          'POLLO',
  pollo_cajon:    'POLLO — CAJONES',
  rebozado:       'REBOZADOS Y CONGELADOS',
  rebozado_cajon: 'REBOZADOS — CAJAS',
}
// Categorías que nunca van a la lista compartible (no son carne)
const EXCLUIDAS_PDF = new Set(['almacen', 'bebidas', 'insumos'])
// Orden default si no llega el catálogo dinámico (compat)
const ORDEN_DEFAULT = ['bovino_mr', 'bovino_pieza', 'bovino_corte', 'bovino_brosa', 'bovino_caja_pt', 'cerdo_corte', 'cerdo_pieza', 'embutido', 'pollo', 'pollo_cajon', 'rebozado', 'rebozado_cajon']

// Arma las secciones a partir del catálogo de categorías (Precios → 🗂️
// Categorías): respeta su orden y suma las personalizadas. El título sale
// del override histórico o del label (sin emojis, en mayúsculas).
function seccionesDe(categorias) {
  const base = (categorias && categorias.length)
    ? categorias.filter(c => c.activa !== false && !EXCLUIDAS_PDF.has(c.clave)).map(c => ({ cat: c.clave, label: c.label }))
    : ORDEN_DEFAULT.map(clave => ({ cat: clave, label: clave }))
  return base.map(s => ({
    cat: s.cat,
    titulo: TITULOS_PDF[s.cat] || safe(s.label).toUpperCase() || s.cat.replace(/^cat_/, '').replace(/_/g, ' ').toUpperCase(),
  }))
}

const money = v => '$ ' + (Number(v) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Helvetica solo soporta WinAnsi (latin-1): cualquier char fuera (emoji,
// comillas raras) rompe drawText. Se filtra defensivamente.
const safe = s => String(s ?? '').replace(/[^\x20-\xFF]/g, '').trim()

export async function generarListaPreciosPdf({ tipo, precios, categorias }) {
  const PDFLib = await cargarPdfLib()
  const { PDFDocument, StandardFonts, rgb } = PDFLib
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const esMayMin = tipo === 'mayorista'
  const W = 595.28, H = 841.89
  const ML = 46, MR = 46
  const COLR = W - MR
  // Columnas de precios alineadas a la derecha
  const COL_MAY = COLR            // última col: mayorista (o carniceria)
  const COL_MIN = COLR - 110      // penúltima col (solo lista may/min)

  const dark = rgb(0.1, 0.1, 0.12)
  const grey = rgb(0.45, 0.45, 0.5)
  const gold = rgb(0.72, 0.55, 0.12)
  const lineC = rgb(0.85, 0.85, 0.88)
  const zebra = rgb(0.965, 0.96, 0.945)

  let page, y
  const headerPagina = () => {
    page = doc.addPage([W, H])
    y = H - 52
    page.drawText('CARNICERIAS FABRICIUS', { x: ML, y, size: 20, font: bold, color: gold })
    y -= 15
    const fechaTxt = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const titulo = esMayMin ? 'LISTA DE PRECIOS — MAYORISTA Y MINORISTA' : 'LISTA DE PRECIOS — CARNICERIAS'
    page.drawText(titulo, { x: ML, y, size: 10, font: bold, color: dark })
    const fTxt = `Vigente al ${fechaTxt}`
    const fw = font.widthOfTextAtSize(fTxt, 9)
    page.drawText(fTxt, { x: COLR - fw, y, size: 9, font, color: grey })
    y -= 10
    page.drawLine({ start: { x: ML, y }, end: { x: COLR, y }, thickness: 1.2, color: gold })
    y -= 20
  }
  const saltoSiHaceFalta = (alto = 14) => { if (y - alto < 56) headerPagina() }
  const txtR = (s, xRight, opts = {}) => {
    const f = opts.bold ? bold : font, size = opts.size || 9.5
    const w = f.widthOfTextAtSize(String(s), size)
    page.drawText(String(s), { x: xRight - w, y, size, font: f, color: opts.color || dark })
  }

  headerPagina()

  const porCat = {}
  precios.forEach(p => { (porCat[p.categoria] = porCat[p.categoria] || []).push(p) })

  seccionesDe(categorias).forEach(sec => {
    const items = (porCat[sec.cat] || [])
      .filter(p => esMayMin
        ? (Number(p.precio_minorista) > 0 || Number(p.precio_mayorista) > 0)
        : Number(p.precio_carniceria) > 0)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    if (!items.length) return

    // Título de sección + encabezado de columnas (no cortar entre página)
    saltoSiHaceFalta(46)
    page.drawText(sec.titulo, { x: ML, y, size: 11, font: bold, color: gold })
    y -= 13
    if (esMayMin) {
      txtR('MINORISTA', COL_MIN, { bold: true, size: 8, color: grey })
      txtR('MAYORISTA', COL_MAY, { bold: true, size: 8, color: grey })
    } else {
      txtR('PRECIO', COL_MAY, { bold: true, size: 8, color: grey })
    }
    y -= 4
    page.drawLine({ start: { x: ML, y }, end: { x: COLR, y }, thickness: 0.6, color: lineC })
    y -= 13

    items.forEach((p, i) => {
      saltoSiHaceFalta(13)
      if (i % 2 === 1) page.drawRectangle({ x: ML - 3, y: y - 3.5, width: COLR - ML + 6, height: 13, color: zebra })
      // El nombre no debe pisar la columna de precios: se recorta si hace falta
      const maxW = (esMayMin ? COL_MIN - 78 : COL_MAY - 90) - ML
      let nombre = safe(p.nombre).toUpperCase()
      while (nombre.length > 4 && font.widthOfTextAtSize(nombre, 9.5) > maxW) nombre = nombre.slice(0, -1)
      page.drawText(nombre, { x: ML, y, size: 9.5, font, color: dark })
      if (esMayMin) {
        txtR(Number(p.precio_minorista) > 0 ? money(p.precio_minorista) : '—', COL_MIN)
        txtR(Number(p.precio_mayorista) > 0 ? money(p.precio_mayorista) : '—', COL_MAY, { bold: true })
      } else {
        txtR(money(p.precio_carniceria), COL_MAY, { bold: true })
      }
      y -= 13
    })
    y -= 12
  })

  // Pie en cada página
  doc.getPages().forEach((pg, i) => {
    pg.drawText(`Carnicerias Fabricius — Rio Primero, Cordoba · Precios sujetos a modificacion sin previo aviso · Pag. ${i + 1}/${doc.getPageCount()}`,
      { x: ML, y: 34, size: 7.5, font, color: grey })
  })

  return doc.save()
}

// Comparte el PDF por el share nativo (celular → WhatsApp directo) o lo
// descarga (compu → arrastrarlo al chat de WhatsApp Web).
export async function compartirListaPrecios({ tipo, precios, categorias }) {
  const bytes = await generarListaPreciosPdf({ tipo, precios, categorias })
  const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g, '-')
  const nombre = tipo === 'mayorista'
    ? `Lista Fabricius Mayorista-Minorista ${fecha}.pdf`
    : `Lista Fabricius Carnicerias ${fecha}.pdf`
  const file = new File([bytes], nombre, { type: 'application/pdf' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nombre })
      return 'compartido'
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado'
      // share falló (p.ej. permisos) → cae a descarga
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return 'descargado'
}
