// =============================================================================
// WSAA — autenticación directa contra ARCA (sin AfipSDK)
// =============================================================================
// Firma un "Login Ticket Request" (TRA) con el certificado usando CMS/PKCS#7
// (node-forge) y lo envía a WSAA loginCms. Devuelve Token + Sign (el "TA"),
// válido ~12 hs. El TA se cachea en `arca_ta` porque ARCA no permite pedir
// dos seguidos para el mismo (certificado, servicio).
// =============================================================================
import forge from 'https://esm.sh/node-forge@1.3.1'

const WSAA_URL = {
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
}

function unescapeXml(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// TRA: pedido de ticket de acceso para el servicio wsfe.
function buildTRA(): string {
  const now = Date.now()
  const uid = Math.floor(now / 1000)
  const gen = new Date(now - 10 * 60 * 1000).toISOString()
  const exp = new Date(now + 10 * 60 * 1000).toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0">\n<header>\n<uniqueId>${uid}</uniqueId>\n<generationTime>${gen}</generationTime>\n<expirationTime>${exp}</expirationTime>\n</header>\n<service>wsfe</service>\n</loginTicketRequest>`
}

// Genera una clave privada RSA 2048 + un CSR para subir a ARCA
// ("Administración de Certificados Digitales"). El DN cumple lo que pide ARCA:
// C=AR, O=<razón social>, CN=<alias>, serialNumber="CUIT <cuit>".
export function generarCSR(opts: { cuit: string; razonSocial: string; alias: string }): { csr: string; key: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  const org = (opts.razonSocial || 'EMPRESA').replace(/[^\w .,&-]/g, '').slice(0, 100) || 'EMPRESA'
  const alias = (opts.alias || 'fabricius').replace(/[^a-zA-Z0-9]/g, '') || 'fabricius'
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: org },
    { name: 'commonName', value: alias },
    { name: 'serialNumber', value: 'CUIT ' + String(opts.cuit).replace(/\D/g, '') },
  ])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return {
    csr: forge.pki.certificationRequestToPem(csr),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

// Firma el TRA en CMS (PKCS#7) y lo devuelve en base64 (DER).
export function signTRA(tra: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(certPem)
  p7.addSigner({
    key: keyPem,
    certificate: certPem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign()
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}

async function wsaaLogin(ambiente: string, cms: string): Promise<{ ok: boolean; token?: string; sign?: string; expiration?: string; error?: string }> {
  const url = ambiente === 'produccion' ? WSAA_URL.produccion : WSAA_URL.homologacion
  const soap = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' }, body: soap })
  const text = await resp.text()
  const ret = text.match(/<loginCmsReturn[^>]*>([\s\S]*?)<\/loginCmsReturn>/i)
  if (!ret) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)
    return { ok: false, error: (fault ? unescapeXml(fault[1]) : `HTTP ${resp.status}: ${text.slice(0, 400)}`) }
  }
  const ta = unescapeXml(ret[1])
  const token = (ta.match(/<token>([\s\S]*?)<\/token>/i) || [])[1]
  const sign = (ta.match(/<sign>([\s\S]*?)<\/sign>/i) || [])[1]
  const expiration = (ta.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/i) || [])[1]
  if (!token || !sign) return { ok: false, error: 'WSAA devolvió un TA sin token/sign' }
  return { ok: true, token, sign, expiration }
}

// Obtiene un TA válido: del cache si está vigente, o pidiendo uno nuevo a WSAA.
export async function getTA(
  admin: any,
  opts: { certCuit: string; ambiente: string; cert: string; key: string; forzar?: boolean },
): Promise<{ ok: boolean; token?: string; sign?: string; expiration?: string; error?: string }> {
  const { certCuit, ambiente, cert, key } = opts
  const { data: cached } = await admin.from('arca_ta').select('*')
    .eq('cert_cuit', certCuit).eq('ambiente', ambiente).eq('service', 'wsfe').maybeSingle()
  const vigente = cached && new Date(cached.expiration).getTime() > Date.now() + 10 * 60 * 1000
  if (vigente) return { ok: true, token: cached.token, sign: cached.sign, expiration: cached.expiration }

  let r: { ok: boolean; token?: string; sign?: string; expiration?: string; error?: string }
  try {
    const cms = signTRA(buildTRA(), cert, key)
    r = await wsaaLogin(ambiente, cms)
  } catch (e) {
    r = { ok: false, error: 'Error firmando/llamando a WSAA: ' + (e instanceof Error ? e.message : String(e)) }
  }
  if (!r.ok) {
    // ARCA no deja pedir otro TA mientras hay uno vigente; si tenemos uno cacheado, lo reusamos
    if (cached && /ya posee|TA v[aá]lido|already.*valid/i.test(r.error || '')) {
      return { ok: true, token: cached.token, sign: cached.sign, expiration: cached.expiration }
    }
    return { ok: false, error: r.error }
  }
  await admin.from('arca_ta').upsert({
    cert_cuit: certCuit, ambiente, service: 'wsfe',
    token: r.token, sign: r.sign, expiration: r.expiration, updated_at: new Date().toISOString(),
  }, { onConflict: 'cert_cuit,ambiente,service' })
  return r
}
