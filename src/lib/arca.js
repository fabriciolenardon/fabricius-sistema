// ============================================================
// ARCA — Facturación electrónica (constantes + helpers de front)
// ============================================================
// Códigos oficiales AFIP/ARCA usados por WSFEv1 y helpers para
// llamar a las edge functions `arca-config` / `arca-emitir` y
// armar la URL del QR del comprobante.
//
// Acá NO hay secretos: el certificado y la clave privada viven
// solo en la edge function (service_role). Esto es solo UI.
// ============================================================
import { supabase } from './supabase'

// --- Tipos de comprobante (código AFIP → etiqueta + letra) ---
export const COMPROBANTES = {
  1:  { letra: 'A', label: 'Factura A' },
  6:  { letra: 'B', label: 'Factura B' },
  11: { letra: 'C', label: 'Factura C' },
  // (NC/ND y otros quedan para una iteración posterior)
}

// --- Tipo de documento del receptor ---
export const DOC_TIPOS = [
  { v: 99, l: 'Consumidor Final (sin identificar)' },
  { v: 80, l: 'CUIT' },
  { v: 86, l: 'CUIL' },
  { v: 96, l: 'DNI' },
]

// --- Condición frente al IVA del receptor (RG 5616, obligatorio) ---
export const COND_IVA_RECEPTOR = [
  { v: 5,  l: 'Consumidor Final' },
  { v: 1,  l: 'Responsable Inscripto' },
  { v: 6,  l: 'Responsable Monotributo' },
  { v: 4,  l: 'Exento' },
  { v: 13, l: 'Monotributo Social' },
  { v: 16, l: 'Monotributo Trabajador Independiente Promovido' },
]

// --- Concepto ---
export const CONCEPTOS = [
  { v: 1, l: 'Productos' },
  { v: 2, l: 'Servicios' },
  { v: 3, l: 'Productos y Servicios' },
]

// Alícuotas de IVA (código AFIP). Carne = 10,5%.
export const IVA_ALICUOTAS = [
  { id: 4, label: '10,5% (carne)', pct: 10.5 },
  { id: 5, label: '21%', pct: 21 },
  { id: 3, label: '0% / Exento', pct: 0 },
  { id: 6, label: '27%', pct: 27 },
]

// Comprobantes que la edge function `arca-emitir` ya soporta.
export const COMPROBANTES_SOPORTADOS = [11, 6, 1]

// Sugiere qué comprobantes puede emitir una cuenta según su condición IVA.
// Monotributo → Factura C. Responsable Inscripto / SAS → A (a RI) o B (a CF).
export function comprobantesDeCuenta(cuenta) {
  const cond = cuenta?.condicion_iva || cuenta?.tipo
  if (cond === 'monotributo') return [11]
  if (cond === 'responsable_inscripto' || cuenta?.tipo === 'sas') return [6, 1]
  return [11]
}

// ============================================================
// Llamadas a las edge functions (normaliza el error del body)
// ============================================================
async function invokeFn(nombre, body) {
  const { data, error } = await supabase.functions.invoke(nombre, { body })
  if (error) {
    // supabase-js mete el body de un 4xx/5xx en error.context
    let msg = error.message
    try {
      const j = await error.context?.json?.()
      if (j?.error) msg = j.error
    } catch { /* sin body json */ }
    return { ok: false, error: msg, data: null }
  }
  if (data && data.ok === false) return { ok: false, error: data.error || 'Error', data }
  return { ok: true, error: null, data }
}

export function guardarConfigArca(payload) {
  return invokeFn('arca-config', { accion: 'guardar', ...payload })
}
export function probarConexionArca(cuenta_id) {
  return invokeFn('arca-config', { accion: 'probar', cuenta_id })
}
// Genera el certificado de homologación vía AfipSDK (logueándose a ARCA con la clave fiscal).
export function crearCertTestingArca(payload) {
  return invokeFn('arca-config', { accion: 'crear_cert_dev', ...payload })
}
// Genera clave + CSR (autónomo) para subir a ARCA y obtener el certificado.
export function generarCsrArca(payload) {
  return invokeFn('arca-config', { accion: 'generar_csr', ...payload })
}
export function emitirComprobante(payload) {
  return invokeFn('arca-emitir', payload)
}

// ============================================================
// QR de ARCA — https://www.afip.gob.ar/fe/qr/?p=<base64(json)>
// ============================================================
// Spec oficial v1. `datos` debe traer: cuit (emisor, número),
// ptoVta, tipoCmp (código AFIP), nroCmp, importe, fecha YYYY-MM-DD,
// tipoDocRec, nroDocRec, codAut (CAE).
export function buildQrUrl(datos) {
  const payload = {
    ver: 1,
    fecha: datos.fecha,
    cuit: Number(String(datos.cuit).replace(/[-\s.]/g, '')),
    ptoVta: Number(datos.ptoVta),
    tipoCmp: Number(datos.tipoCmp),
    nroCmp: Number(datos.nroCmp),
    importe: Number(datos.importe),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: Number(datos.tipoDocRec) || 99,
    nroDocRec: Number(datos.nroDocRec) || 0,
    tipoCodAut: 'E',
    codAut: Number(String(datos.codAut)),
  }
  const b64 = base64Json(payload)
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}

// Imagen QR lista para <img src>. Usamos un generador público liviano
// (no requiere dependencias). El contenido es la URL oficial de ARCA.
export function qrImgUrl(qrUrl, size = 160) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(qrUrl)}`
}

// base64 de un JSON respetando UTF-8 (btoa no soporta multibyte directo)
function base64Json(obj) {
  const json = JSON.stringify(obj)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}
