// ============================================================
// COMPROBANTE PDF — factura imprimible formato AFIP/ARCA
// ============================================================
// Genera el HTML de un comprobante electrónico (Factura A/B/C)
// con el layout típico: recuadro de letra, datos del emisor y
// receptor, detalle de ítems, totales, CAE + QR. Se abre en una
// ventana imprimible (Ctrl+P → Guardar como PDF).
//
// Importante: el CAE y los datos fiscales salen de lo que ARCA
// autorizó; el detalle de ítems es informativo (ARCA recibe solo
// los totales).
// ============================================================
import { abrirVentanaImprimible } from './pdfPrintable'
import { buildQrUrl, qrImgUrl, COMPROBANTES } from './arca'

const fmt$ = n => '$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum = (n, d = 2) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function fechaAR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const COD_AFIP = { 1: '01', 6: '06', 11: '11' }
const CONDICION_EMISOR = {
  monotributo: 'Responsable Monotributo',
  responsable_inscripto: 'IVA Responsable Inscripto',
  exento: 'IVA Sujeto Exento',
  consumidor_final: 'Consumidor Final',
}
const CONDICION_RECEPTOR = {
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
  13: 'Monotributo Social',
  16: 'Monotributo Trab. Independiente Promovido',
}
const DOC_LABEL = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: '' }

function formatearCuit(c) {
  const s = String(c || '').replace(/\D/g, '')
  return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : (c || '')
}

// Construye el HTML del comprobante a partir de la fila `factura` y su `cuenta` (emisor).
export function comprobanteHtml(factura, cuenta) {
  const codigo = Number(factura.comprobante_codigo) || 11
  const letra = COMPROBANTES[codigo]?.letra || 'C'
  const pv = String(factura.punto_venta || '1').padStart(5, '0')
  const nro = String(factura.numero || '').padStart(8, '0')
  const esC = codigo === 11
  const items = Array.isArray(factura.items) ? factura.items : []

  // QR oficial de ARCA
  let qrImg = ''
  if (factura.cae) {
    const qrUrl = buildQrUrl({
      fecha: factura.fecha, cuit: cuenta.cuit, ptoVta: factura.punto_venta || 1,
      tipoCmp: codigo, nroCmp: factura.numero, importe: factura.monto_total,
      tipoDocRec: factura.doc_tipo || 99, nroDocRec: factura.doc_nro || 0, codAut: factura.cae,
    })
    qrImg = `<img src="${qrImgUrl(qrUrl, 150)}" width="150" height="150" alt="QR ARCA" />`
  }

  const condEmisor = CONDICION_EMISOR[cuenta.condicion_iva] || CONDICION_EMISOR[cuenta.tipo] || ''
  const docRecLabel = DOC_LABEL[factura.doc_tipo] || ''
  const condRec = CONDICION_RECEPTOR[factura.cond_iva_receptor] || 'Consumidor Final'
  // Título del documento: FACTURA / NOTA DE CRÉDITO / NOTA DE DÉBITO (según el código).
  const tituloDoc = (COMPROBANTES[codigo]?.label || 'Factura').replace(/\s+[ABC]$/, '').toUpperCase()
  // Comprobante asociado (en NC/ND): se guarda en arca_resultado.cbte_asoc.
  const asoc = factura.arca_resultado?.cbte_asoc || null
  const asocTxt = asoc
    ? `${COMPROBANTES[Number(asoc.tipo)]?.label || 'Comprobante'} ${String(asoc.pto_vta || '').padStart(5, '0')}-${String(asoc.nro || '').padStart(8, '0')}`
    : ''

  // Filas de ítems
  const filas = items.length ? items.map(it => {
    const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0)
    return `<tr>
      <td>${esc(it.descripcion || '')}</td>
      <td class="r">${fmtNum(it.cantidad, 2)}</td>
      <td class="r">${fmt$(it.precio_unit)}</td>
      ${esC ? '' : `<td class="r">${it.iva_id === 5 ? '21%' : it.iva_id === 4 ? '10,5%' : it.iva_id === 6 ? '27%' : '0%'}</td>`}
      <td class="r">${fmt$(sub)}</td>
    </tr>`
  }).join('') : `<tr><td colspan="${esC ? 4 : 5}" style="color:#888">${esc(factura.concepto || 'Venta')}</td></tr>`

  return `
  <style>
    .cbte { font-family: 'Helvetica','Arial',sans-serif; color:#111; font-size:12px; }
    .cbte * { box-sizing: border-box; }
    .cbte .row { display:flex; }
    .cbte .box { border:1px solid #333; }
    .cbte table { width:100%; border-collapse:collapse; margin:0; }
    .cbte th { background:#f0f0f0; color:#000; border:1px solid #999; padding:6px 6px; font-size:10px; text-transform:uppercase; text-align:left; }
    .cbte td { border:1px solid #ddd; padding:6px 6px; font-size:11px; background:#fff; }
    .cbte .r { text-align:right; }
    .cbte .c { text-align:center; }
    .cbte .muted { color:#555; font-size:10px; }
    .cbte .big { font-size:15px; font-weight:800; }
  </style>
  <div class="cbte">
    <!-- Cabecera: emisor | letra | comprobante -->
    <div class="row" style="border:1px solid #333;">
      <div style="width:46%; padding:12px; border-right:0;">
        <div class="big">${esc(cuenta.razon_social || cuenta.nombre || '')}</div>
        <div class="muted" style="margin-top:6px;">
          <strong>Razón social:</strong> ${esc(cuenta.razon_social || cuenta.nombre || '')}<br/>
          ${cuenta.domicilio_fiscal ? `<strong>Domicilio:</strong> ${esc(cuenta.domicilio_fiscal)}<br/>` : ''}
          <strong>Condición frente al IVA:</strong> ${esc(condEmisor)}
        </div>
      </div>
      <!-- Letra -->
      <div style="width:8%; border-left:1px solid #333; border-right:1px solid #333; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div style="font-size:40px; font-weight:800; line-height:1;">${letra}</div>
        <div style="font-size:9px; margin-top:2px;">COD. ${COD_AFIP[codigo] || codigo}</div>
      </div>
      <div style="width:46%; padding:12px;">
        <div class="big">${tituloDoc}</div>
        <div class="muted" style="margin-top:6px;">
          <strong>Punto de Venta:</strong> ${pv} &nbsp; <strong>Comp. Nro:</strong> ${nro}<br/>
          <strong>Fecha de Emisión:</strong> ${fechaAR(factura.fecha)}<br/>
          <strong>CUIT:</strong> ${formatearCuit(cuenta.cuit)}<br/>
          ${cuenta.iibb_numero ? `<strong>Ingresos Brutos:</strong> ${esc(cuenta.iibb_numero)}<br/>` : ''}
          ${cuenta.fecha_inicio_actividad ? `<strong>Inicio de Actividades:</strong> ${fechaAR(cuenta.fecha_inicio_actividad)}` : ''}
        </div>
      </div>
    </div>

    <!-- Receptor -->
    <div class="box" style="border-top:0; padding:10px;">
      <div class="muted">
        <strong>${docRecLabel ? docRecLabel + ':' : 'Documento:'}</strong> ${esc(factura.doc_nro && Number(factura.doc_nro) ? formatearCuit(factura.doc_nro) : '—')}
        &nbsp;·&nbsp; <strong>Condición frente al IVA:</strong> ${esc(condRec)}
        ${factura.contraparte_nombre ? `<br/><strong>Apellido y Nombre / Razón social:</strong> ${esc(factura.contraparte_nombre)}` : ''}
        ${asocTxt ? `<br/><strong>Comprobante asociado:</strong> ${esc(asocTxt)}` : ''}
      </div>
    </div>

    <!-- Ítems -->
    <table style="margin-top:8px;">
      <thead>
        <tr>
          <th>Descripción</th>
          <th style="width:80px; text-align:right;">Cantidad</th>
          <th style="width:110px; text-align:right;">P. Unitario</th>
          ${esC ? '' : '<th style="width:60px; text-align:right;">IVA</th>'}
          <th style="width:120px; text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>

    <!-- Totales -->
    <div class="row" style="margin-top:8px; justify-content:flex-end;">
      <div style="width:300px;">
        <table>
          ${esC ? '' : `
          <tr><td>Subtotal Neto</td><td class="r">${fmt$(factura.monto_neto)}</td></tr>
          <tr><td>IVA</td><td class="r">${fmt$(factura.monto_iva)}</td></tr>`}
          <tr><td class="big">TOTAL</td><td class="r big">${fmt$(factura.monto_total)}</td></tr>
        </table>
      </div>
    </div>

    <!-- CAE + QR -->
    <div class="row" style="margin-top:16px; align-items:flex-end; gap:16px;">
      <div style="width:160px;">${qrImg}</div>
      <div style="flex:1;">
        <div class="muted">Comprobante Autorizado</div>
        <div style="font-size:14px; margin-top:4px;"><strong>CAE N°:</strong> ${esc(factura.cae || '—')}</div>
        <div style="font-size:14px;"><strong>Fecha de Vto. de CAE:</strong> ${fechaAR(factura.cae_vto)}</div>
        ${cuenta.arca_ambiente === 'homologacion' || factura.arca_ambiente === 'homologacion' ? '<div style="margin-top:6px; color:#b00; font-size:11px;">⚠ COMPROBANTE EMITIDO EN AMBIENTE DE HOMOLOGACIÓN (SIN VALIDEZ FISCAL)</div>' : ''}
      </div>
    </div>
  </div>`
}

// Abre la ventana imprimible del comprobante.
export function imprimirComprobante(factura, cuenta) {
  const codigo = Number(factura.comprobante_codigo) || 11
  const letra = COMPROBANTES[codigo]?.letra || 'C'
  const pv = String(factura.punto_venta || '1').padStart(5, '0')
  const nro = String(factura.numero || '').padStart(8, '0')
  abrirVentanaImprimible({
    titulo: `Factura ${letra} ${pv}-${nro}`,
    contenidoHtml: comprobanteHtml(factura, cuenta),
  })
}
