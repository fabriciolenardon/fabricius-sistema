// ============================================================
// LIBRO IVA — Generador de CSV para el contador
// ============================================================
// Genera un CSV con el formato estándar de Libro IVA Ventas
// y Libro IVA Compras (separado por mes, una cuenta o todas).
// Usa separador ";" y BOM UTF-8 para que Excel argentino lo
// abra directo con columnas y acentos correctos.
// ============================================================

const fmtFecha = d => {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const fmtNum = n => {
  const v = Number(n) || 0
  return v.toFixed(2).replace('.', ',')
}

const escapar = s => {
  if (s == null) return ''
  const str = String(s)
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

// Genera el CSV del Libro IVA Ventas (facturas emitidas)
export function generarLibroVentas(facturas, cuentas) {
  const filas = facturas.filter(f => f.tipo === 'emitida')
  const headers = [
    'Fecha', 'Cuenta', 'Tipo Cbte', 'Punto Vta', 'Número',
    'CUIT Cliente', 'Cliente', 'Cond. IVA',
    'Neto Gravado', 'IVA', 'Otros Trib.', 'Total',
    'Concepto', 'Notas',
  ]
  const lineas = [headers.map(escapar).join(';')]
  let totNeto = 0, totIva = 0, totOtros = 0, totTotal = 0
  filas.forEach(f => {
    const c = cuentas.find(x => x.id === f.cuenta_id)
    const row = [
      fmtFecha(f.fecha),
      c?.nombre || `Cuenta #${f.cuenta_id}`,
      f.tipo_comprobante || '',
      f.punto_venta || '',
      f.numero || '',
      f.contraparte_cuit || '',
      f.contraparte_nombre || '',
      f.contraparte_iva || '',
      fmtNum(f.monto_neto),
      fmtNum(f.monto_iva),
      fmtNum(f.monto_otros),
      fmtNum(f.monto_total),
      f.concepto || '',
      f.notas || '',
    ]
    lineas.push(row.map(escapar).join(';'))
    totNeto  += Number(f.monto_neto)  || 0
    totIva   += Number(f.monto_iva)   || 0
    totOtros += Number(f.monto_otros) || 0
    totTotal += Number(f.monto_total) || 0
  })
  // Fila de totales
  lineas.push(['', '', '', '', '', '', '', 'TOTAL',
    fmtNum(totNeto), fmtNum(totIva), fmtNum(totOtros), fmtNum(totTotal), '', ''].map(escapar).join(';'))
  return lineas.join('\n')
}

// Igual pero para compras (recibidas)
export function generarLibroCompras(facturas, cuentas) {
  const filas = facturas.filter(f => f.tipo === 'recibida')
  const headers = [
    'Fecha', 'Cuenta', 'Tipo Cbte', 'Punto Vta', 'Número',
    'CUIT Proveedor', 'Proveedor', 'Cond. IVA',
    'Neto Gravado', 'IVA Crédito', 'Otros', 'Total',
    'Concepto', 'Notas',
  ]
  const lineas = [headers.map(escapar).join(';')]
  let totNeto = 0, totIva = 0, totOtros = 0, totTotal = 0
  filas.forEach(f => {
    const c = cuentas.find(x => x.id === f.cuenta_id)
    const row = [
      fmtFecha(f.fecha),
      c?.nombre || `Cuenta #${f.cuenta_id}`,
      f.tipo_comprobante || '',
      f.punto_venta || '',
      f.numero || '',
      f.contraparte_cuit || '',
      f.contraparte_nombre || '',
      f.contraparte_iva || '',
      fmtNum(f.monto_neto),
      fmtNum(f.monto_iva),
      fmtNum(f.monto_otros),
      fmtNum(f.monto_total),
      f.concepto || '',
      f.notas || '',
    ]
    lineas.push(row.map(escapar).join(';'))
    totNeto  += Number(f.monto_neto)  || 0
    totIva   += Number(f.monto_iva)   || 0
    totOtros += Number(f.monto_otros) || 0
    totTotal += Number(f.monto_total) || 0
  })
  lineas.push(['', '', '', '', '', '', '', 'TOTAL',
    fmtNum(totNeto), fmtNum(totIva), fmtNum(totOtros), fmtNum(totTotal), '', ''].map(escapar).join(';'))
  return lineas.join('\n')
}

// Descarga el contenido como archivo .csv en el navegador
export function descargarCSV(contenido, nombreArchivo) {
  // BOM UTF-8 para que Excel argentino respete acentos
  const BOM = '﻿'
  const blob = new Blob([BOM + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombreArchivo
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
