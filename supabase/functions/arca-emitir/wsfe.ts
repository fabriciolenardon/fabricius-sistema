// =============================================================================
// WSFEv1 — Factura Electrónica directa contra ARCA (sin AfipSDK)
// =============================================================================
// Llama a los métodos SOAP del WSFEv1: FECompUltimoAutorizado (siguiente número)
// y FECAESolicitar (pide el CAE). Recibe el Auth {Token, Sign, Cuit} del WSAA.
// =============================================================================
import { XMLParser } from 'https://esm.sh/fast-xml-parser@4.4.1'

const WSFE_URL = {
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
}
const NS = 'http://ar.gov.afip.dif.FEV1/'

type Auth = { Token: string; Sign: string; Cuit: number }

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true })

function authXml(a: Auth): string {
  return `<ar:Auth><ar:Token>${a.Token}</ar:Token><ar:Sign>${a.Sign}</ar:Sign><ar:Cuit>${a.Cuit}</ar:Cuit></ar:Auth>`
}

async function soapCall(ambiente: string, action: string, inner: string): Promise<{ ok: boolean; body?: any; error?: string }> {
  const url = ambiente === 'produccion' ? WSFE_URL.produccion : WSFE_URL.homologacion
  const soap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soap:Body>${inner}</soap:Body></soap:Envelope>`
  let resp: Response
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `${NS}${action}` }, body: soap })
  } catch (e) {
    return { ok: false, error: 'Error de red llamando a WSFE: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const text = await resp.text()
  let obj: any
  try { obj = parser.parse(text) } catch { return { ok: false, error: 'No se pudo parsear la respuesta de ARCA: ' + text.slice(0, 300) } }
  const bodyNode = obj?.Envelope?.Body
  if (!bodyNode) return { ok: false, error: 'Respuesta SOAP sin Body: ' + text.slice(0, 300) }
  if (bodyNode.Fault) return { ok: false, error: bodyNode.Fault.faultstring || JSON.stringify(bodyNode.Fault) }
  return { ok: true, body: bodyNode }
}

function asArray(x: any): any[] { return x == null ? [] : (Array.isArray(x) ? x : [x]) }

// Solo ERRORES reales (Errors.Err). Los Events son avisos informativos de ARCA
// (ej. el [39] de la RG 5616) y NO deben bloquear la emisión.
export function extraerErrores(res: any): string {
  const out: string[] = []
  for (const e of asArray(res?.Errors?.Err)) {
    const msg = e?.Msg ?? e?.Mensaje
    if (msg) out.push(e?.Code ? `[${e.Code}] ${msg}` : String(msg))
  }
  return out.join(' · ')
}

export function extraerObservaciones(det: any): string {
  const out: string[] = []
  for (const o of asArray(det?.Observaciones?.Obs)) {
    const msg = o?.Msg
    if (msg) out.push(o?.Code ? `[${o.Code}] ${msg}` : String(msg))
  }
  return out.join(' · ')
}

// Devuelve el último número autorizado para (ptoVta, cbteTipo).
export async function ultimoAutorizado(ambiente: string, auth: Auth, ptoVta: number, cbteTipo: number): Promise<{ ok: boolean; nro?: number; error?: string }> {
  const inner = `<ar:FECompUltimoAutorizado>${authXml(auth)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`
  const r = await soapCall(ambiente, 'FECompUltimoAutorizado', inner)
  if (!r.ok) return { ok: false, error: r.error }
  const res = r.body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult
  // Si vino un número (incluye 0 para PV nuevo), lo usamos aunque haya avisos.
  if (res && res.CbteNro != null && res.CbteNro !== '') return { ok: true, nro: Number(res.CbteNro) }
  const err = extraerErrores(res)
  return { ok: false, error: err || 'no se obtuvo el número del último comprobante' }
}

// Pide el CAE. `det` es el FECAEDetRequest (objeto plano) y `ivaArray` las alícuotas.
export async function solicitarCAE(
  ambiente: string, auth: Auth,
  opts: { ptoVta: number; cbteTipo: number; det: Record<string, any>; ivaArray: Array<{ Id: number; BaseImp: number; Importe: number }> },
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const { ptoVta, cbteTipo, det, ivaArray } = opts
  const ivaXml = ivaArray && ivaArray.length
    ? `<ar:Iva>${ivaArray.map(a => `<ar:AlicIva><ar:Id>${a.Id}</ar:Id><ar:BaseImp>${a.BaseImp}</ar:BaseImp><ar:Importe>${a.Importe}</ar:Importe></ar:AlicIva>`).join('')}</ar:Iva>`
    : ''
  const servXml = det.FchServDesde
    ? `<ar:FchServDesde>${det.FchServDesde}</ar:FchServDesde><ar:FchServHasta>${det.FchServHasta}</ar:FchServHasta><ar:FchVtoPago>${det.FchVtoPago}</ar:FchVtoPago>`
    : ''
  // Comprobantes asociados (obligatorio en Notas de Crédito/Débito: referencian
  // la factura original). Va DESPUÉS de CondicionIVAReceptorId y ANTES de Iva (XSD).
  const cbtesAsocXml = Array.isArray(det.CbtesAsoc) && det.CbtesAsoc.length
    ? `<ar:CbtesAsoc>${det.CbtesAsoc.map((c: any) =>
        `<ar:CbteAsoc>` +
        `<ar:Tipo>${c.Tipo}</ar:Tipo>` +
        `<ar:PtoVta>${c.PtoVta}</ar:PtoVta>` +
        `<ar:Nro>${c.Nro}</ar:Nro>` +
        (c.Cuit ? `<ar:Cuit>${c.Cuit}</ar:Cuit>` : '') +
        (c.CbteFch ? `<ar:CbteFch>${c.CbteFch}</ar:CbteFch>` : '') +
        `</ar:CbteAsoc>`).join('')}</ar:CbtesAsoc>`
    : ''
  // Orden de elementos según el XSD de WSFEv1 (es estricto).
  const detXml =
    `<ar:Concepto>${det.Concepto}</ar:Concepto>` +
    `<ar:DocTipo>${det.DocTipo}</ar:DocTipo>` +
    `<ar:DocNro>${det.DocNro}</ar:DocNro>` +
    `<ar:CbteDesde>${det.CbteDesde}</ar:CbteDesde>` +
    `<ar:CbteHasta>${det.CbteHasta}</ar:CbteHasta>` +
    `<ar:CbteFch>${det.CbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${det.ImpTotal}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${det.ImpTotConc}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${det.ImpNeto}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${det.ImpOpEx}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${det.ImpTrib}</ar:ImpTrib>` +
    `<ar:ImpIVA>${det.ImpIVA}</ar:ImpIVA>` +
    servXml +
    `<ar:MonId>${det.MonId}</ar:MonId>` +
    `<ar:MonCotiz>${det.MonCotiz}</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${det.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>` +
    cbtesAsocXml +
    ivaXml
  const inner =
    `<ar:FECAESolicitar>${authXml(auth)}<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>${detXml}</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq></ar:FECAESolicitar>`
  const r = await soapCall(ambiente, 'FECAESolicitar', inner)
  if (!r.ok) return { ok: false, error: r.error }
  const res = r.body?.FECAESolicitarResponse?.FECAESolicitarResult
  if (!res) return { ok: false, error: 'Respuesta sin FECAESolicitarResult' }
  return { ok: true, result: res }
}

// Extrae el detalle de respuesta (puede venir como objeto o array).
export function detResponse(res: any): any {
  const d = res?.FeDetResp?.FECAEDetResponse
  return Array.isArray(d) ? d[0] : d
}
