// ============================================================
// TICKET DE VENTA — comprobante NO fiscal para imprimir/reimprimir
// ============================================================
// Genera el HTML de un ticket angosto (estilo impresora térmica, ~72mm)
// a partir de una fila de ventas_minoristas y lo manda a imprimir con
// el helper de iframe oculto. NO es un comprobante fiscal (eso lo hace
// el módulo Facturación / ARCA); es la copia para el cliente.
// ============================================================
import { imprimirHTML } from './imprimir'
import { fmtPrecio, fmtKg } from './formatos'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Cantidad del ítem: entera → unidades; con decimales → kilos.
function cantTxt(it) {
  const n = Number(it?.kg) || 0
  return Number.isInteger(n) ? `${n} u` : fmtKg(n)
}

export function imprimirTicketVenta(venta) {
  const items = Array.isArray(venta?.items) ? venta.items : []
  const hora = venta?.hora ? String(venta.hora).slice(0, 8) : ''
  const fecha = venta?.fecha || ''

  const filas = items.map(it => `
    <tr>
      <td class="d">${esc(it.descripcion)}</td>
      <td class="r">${esc(cantTxt(it))}</td>
      <td class="r">${fmt$(it.importe)}</td>
    </tr>`).join('')

  const pagos = []
  if (Number(venta?.efectivo) > 0)      pagos.push(`<div class="row"><span>Efectivo</span><span>${fmt$(venta.efectivo)}</span></div>`)
  if (Number(venta?.debito) > 0)        pagos.push(`<div class="row"><span>Débito</span><span>${fmt$(venta.debito)}</span></div>`)
  if (Number(venta?.transferencia) > 0) pagos.push(`<div class="row"><span>Transferencia</span><span>${fmt$(venta.transferencia)}</span></div>`)
  const descuento = Number(venta?.descuento_monto) > 0
    ? `<div class="row" style="color:#000"><span>Descuento${venta.descuento_pct ? ` ${venta.descuento_pct}%` : ''}</span><span>-${fmt$(venta.descuento_monto)}</span></div>`
    : ''

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { width: 72mm; margin: 0 auto; padding: 6px 8px; color: #000;
           font-family: 'Courier New', monospace; font-size: 12px; }
    .center { text-align: center; }
    .title { font-size: 16px; font-weight: 700; letter-spacing: 1px; }
    .muted { color: #333; font-size: 11px; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; vertical-align: top; }
    td.d { width: 56%; }
    td.r { text-align: right; white-space: nowrap; }
    .row { display: flex; justify-content: space-between; font-size: 12px; }
    .total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; margin-top: 4px; }
    .foot { margin-top: 8px; text-align: center; font-size: 10px; color: #333; }
  </style></head><body>
    <div class="center title">CARNICERÍAS FABRICIUS</div>
    <div class="center muted">FABRICIUS SAS</div>
    <hr>
    <div class="muted">Fecha: ${esc(fecha)} ${esc(hora)}</div>
    <div class="muted">Comprobante: ${esc(String(venta?.id || '').slice(0, 8))}</div>
    <hr>
    <table>
      <thead><tr><td class="d"><b>Producto</b></td><td class="r"><b>Cant</b></td><td class="r"><b>Importe</b></td></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <hr>
    ${descuento}
    <div class="total"><span>TOTAL</span><span>${fmt$(venta?.total)}</span></div>
    ${pagos.length ? '<hr>' + pagos.join('') : ''}
    <div class="foot">COMPROBANTE NO FISCAL · ¡Gracias por su compra!</div>
  </body></html>`

  imprimirHTML(html)
}
