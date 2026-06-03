// =============================================================================
// EDGE FUNCTION: arca-emitir
// =============================================================================
// Emite un comprobante electrónico contra ARCA (vía AfipSDK) y devuelve el CAE.
//
// Flujo:
//   1) Auth WSAA (AfipSDK cachea token+sign 12 hs).
//   2) FECompUltimoAutorizado → siguiente número de comprobante.
//   3) FECAESolicitar → CAE + vencimiento (o Errores/Observaciones).
//   4) Guarda la fila en `facturas` (tipo 'emitida', emitida_por_arca = true)
//      → sigue alimentando topes de monotributo y Libro IVA.
//
// Soporta: Factura C (monotributo, sin IVA), Factura B (RI → consumidor final)
// y Factura A (RI → RI), ambas con IVA discriminado por alícuota (carne = 10,5%).
// Soporta apoderado (cert de un CUIT distinto del emisor). NC/ND quedan pendientes.
//
// Seguridad: solo admin; cert/key se leen con service_role y nunca vuelven al
// frontend. Si ARCA rechaza, se guarda el motivo y se devuelve error claro;
// NUNCA se inventa un CAE.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const AFIPSDK_BASE = 'https://app.afipsdk.com/api/v1/afip'

// URLs de los WSFEv1 (las resuelve AfipSDK con estos hints).
const WSFE = {
  prod: { url: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx', wsdl: 'wsfe-production.wsdl' },
  dev:  { url: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',     wsdl: 'wsfe.wsdl' },
}

// Comprobantes soportados ahora
const COMPROBANTES_OK = new Set([1, 6, 11]) // 1=Factura A, 6=Factura B, 11=Factura C
// Alícuotas de IVA válidas (código AFIP → solo para validar)
const IVA_IDS_OK = new Set([3, 4, 5, 6, 8, 9]) // 3=0% 4=10.5% 5=21% 6=27% 8=5% 9=2.5%

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Falta autenticación', 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return jsonError('No autenticado', 401)
    const { data: profile } = await supabaseUser
      .from('profiles').select('rol').eq('id', user.id).single()
    if (profile?.rol !== 'admin') return jsonError('Solo el administrador puede emitir', 403)

    const body = await req.json().catch(() => ({}))
    const cuenta_id = Number(body.cuenta_id)
    if (!cuenta_id) return jsonError('cuenta_id es obligatorio')

    const comprobante_codigo = Number(body.comprobante_codigo)
    if (!COMPROBANTES_OK.has(comprobante_codigo)) {
      return jsonError('Comprobante no soportado todavía (por ahora: Factura A=1, B=6, C=11)')
    }
    // Alícuota de IVA (solo aplica a A/B). Default 4 = 10,5% (carne).
    const iva_id = IVA_IDS_OK.has(Number(body.iva_id)) ? Number(body.iva_id) : 4

    // Importes
    const impTotal = round2(Number(body.importe_total))
    if (!(impTotal > 0)) return jsonError('El total debe ser mayor a 0')
    const impIva = round2(Number(body.importe_iva) || 0)
    let impNeto = round2(Number(body.importe_neto) || 0)
    // Factura C: sin IVA discriminado → neto = total
    if (comprobante_codigo === 11) impNeto = impTotal
    // Factura B: si no mandan neto, derivarlo de total - iva
    else if (!(impNeto > 0)) impNeto = round2(impTotal - impIva)

    // Receptor
    const doc_tipo = Number(body.doc_tipo) || 99 // 99 = consumidor final sin identificar
    const doc_nro = String(body.doc_nro || '0').replace(/[-\s.]/g, '') || '0'
    const cond_iva_receptor = Number(body.cond_iva_receptor) || 5 // 5 = consumidor final
    const concepto = Number(body.concepto) || 1 // 1 = productos
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || ''))
      ? String(body.fecha) : fechaHoyARG()

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: cuenta, error: cuentaErr } = await supabaseAdmin
      .from('cuentas_fiscales').select('id, nombre, cuit').eq('id', cuenta_id).single()
    if (cuentaErr || !cuenta) return jsonError('Cuenta no encontrada')

    const { data: cfg } = await supabaseAdmin
      .from('arca_config').select('*').eq('cuenta_id', cuenta_id).single()
    if (!cfg?.cert || !cfg?.key) return jsonError('La cuenta no tiene credenciales ARCA cargadas')

    const environment = cfg.ambiente === 'produccion' ? 'prod' : 'dev'
    const ws = environment === 'prod' ? WSFE.prod : WSFE.dev
    const punto_venta = Number(cfg.punto_venta) || 1
    // Emisor del comprobante = CUIT de la cuenta. Titular del certificado puede
    // ser un apoderado (cfg.cert_cuit) que entra a ARCA en nombre del emisor.
    const cuitNum = Number(String(cuenta.cuit).replace(/[-\s.]/g, ''))
    const certCuitNum = Number(String(cfg.cert_cuit || cuenta.cuit).replace(/[-\s.]/g, ''))
    const accessToken = cfg.afipsdk_access_token || Deno.env.get('AFIPSDK_ACCESS_TOKEN') || null

    // 1) Auth — se autentica con el titular del certificado (apoderado si difiere)
    const auth = await afipAuth({
      environment, wsid: 'wsfe', tax_id: String(certCuitNum),
      cert: cfg.cert, key: cfg.key, accessToken,
    })
    if (!auth.ok || !auth.data?.token || !auth.data?.sign) {
      return jsonError('No se pudo autenticar con ARCA: ' + (auth.error || 'sin token'))
    }
    // El comprobante se emite a nombre del emisor (la cuenta), no del apoderado
    const Auth = { Token: auth.data.token, Sign: auth.data.sign, Cuit: cuitNum }

    // 2) Último autorizado → siguiente número
    const ultimo = await afipRequest({
      environment, ws, accessToken,
      method: 'FECompUltimoAutorizado',
      params: { Auth, PtoVta: punto_venta, CbteTipo: comprobante_codigo },
    })
    if (!ultimo.ok) return jsonError('No se pudo consultar el último comprobante: ' + ultimo.error)
    const ultimoNro = Number(
      ultimo.data?.FECompUltimoAutorizadoResult?.CbteNro ??
      ultimo.data?.CbteNro ?? 0
    )
    const numero = ultimoNro + 1
    const letraComp = comprobante_codigo === 11 ? 'C' : comprobante_codigo === 1 ? 'A' : 'B'

    // 3) FECAESolicitar
    const det: Record<string, unknown> = {
      Concepto: concepto,
      DocTipo: doc_tipo,
      DocNro: Number(doc_nro) || 0,
      CbteDesde: numero,
      CbteHasta: numero,
      CbteFch: fecha.replace(/-/g, ''),
      ImpTotal: impTotal,
      ImpTotConc: 0,
      ImpNeto: impNeto,
      ImpOpEx: 0,
      ImpIVA: comprobante_codigo === 11 ? 0 : impIva,
      ImpTrib: 0,
      MonId: 'PES',
      MonCotiz: 1,
      CondicionIVAReceptorId: cond_iva_receptor,
    }
    // Si hay servicios, ARCA exige fechas de servicio + vto de pago
    if (concepto !== 1) {
      det.FchServDesde = fecha.replace(/-/g, '')
      det.FchServHasta = fecha.replace(/-/g, '')
      det.FchVtoPago = fecha.replace(/-/g, '')
    }
    // Factura A y B: IVA discriminado con la alícuota elegida (carne = 10,5% = id 4).
    if ((comprobante_codigo === 1 || comprobante_codigo === 6) && impIva > 0) {
      det.Iva = { AlicIva: [{ Id: iva_id, BaseImp: impNeto, Importe: impIva }] }
    }

    const solicitud = await afipRequest({
      environment, ws, accessToken,
      method: 'FECAESolicitar',
      params: {
        Auth,
        FeCAEReq: {
          FeCabReq: { CantReg: 1, PtoVta: punto_venta, CbteTipo: comprobante_codigo },
          FeDetReq: { FECAEDetRequest: det },
        },
      },
    })
    if (!solicitud.ok) return jsonError('Error llamando a ARCA: ' + solicitud.error)

    const res = solicitud.data?.FECAESolicitarResult ?? solicitud.data ?? {}
    const detResp = pickDetResponse(res)
    const resultado = String(res?.FeCabResp?.Resultado || detResp?.Resultado || '')
    const errores = extraerMensajes(res, detResp)

    if (resultado !== 'A' || !detResp?.CAE) {
      // Rechazado: guardar borrador con el motivo, NO inventar CAE
      const { data: filaRech } = await supabaseAdmin.from('facturas').insert({
        cuenta_id, tipo: 'emitida', fecha,
        punto_venta: String(punto_venta).padStart(5, '0'),
        numero: String(numero).padStart(8, '0'),
        tipo_comprobante: letraComp,
        comprobante_codigo, doc_tipo, doc_nro,
        cond_iva_receptor,
        monto_neto: impNeto, monto_iva: comprobante_codigo === 11 ? 0 : impIva,
        monto_otros: 0, monto_total: impTotal,
        contraparte_nombre: body.contraparte_nombre || null,
        contraparte_cuit: body.contraparte_cuit || null,
        concepto: body.descripcion || null,
        emitida_por_arca: true,
        arca_estado: resultado === 'R' ? 'rechazada' : 'error',
        arca_resultado: { resultado, errores, raw: res },
      }).select('id').single()

      return jsonError(
        `ARCA rechazó el comprobante: ${errores || 'sin detalle'}`,
        422,
        { factura_id: filaRech?.id, estado: resultado === 'R' ? 'rechazada' : 'error', errores }
      )
    }

    const cae = String(detResp.CAE)
    const caeVtoRaw = String(detResp.CAEFchVto || '')
    const cae_vto = caeVtoRaw.length === 8
      ? `${caeVtoRaw.slice(0, 4)}-${caeVtoRaw.slice(4, 6)}-${caeVtoRaw.slice(6, 8)}`
      : null

    // 4) Guardar comprobante autorizado
    const { data: fila, error: insErr } = await supabaseAdmin.from('facturas').insert({
      cuenta_id, tipo: 'emitida', fecha,
      punto_venta: String(punto_venta).padStart(5, '0'),
      numero: String(numero).padStart(8, '0'),
      tipo_comprobante: letraComp,
      comprobante_codigo, doc_tipo, doc_nro,
      cond_iva_receptor,
      monto_neto: impNeto, monto_iva: comprobante_codigo === 11 ? 0 : impIva,
      monto_otros: 0, monto_total: impTotal,
      contraparte_id: body.contraparte_id || null,
      contraparte_nombre: body.contraparte_nombre || null,
      contraparte_cuit: body.contraparte_cuit || null,
      contraparte_iva: body.contraparte_iva || null,
      concepto: body.descripcion || null,
      condicion_pago: body.condicion_pago || 'contado',
      cae, cae_vto,
      emitida_por_arca: true,
      arca_estado: 'autorizada',
      arca_resultado: { resultado, observaciones: errores || null },
    }).select('*').single()
    if (insErr) {
      // El CAE ya existe en ARCA; avisamos para no perderlo
      return jsonError(
        `Se obtuvo CAE ${cae} pero falló el guardado local: ${insErr.message}. ` +
        `Anotá el número ${punto_venta}-${numero} y el CAE.`,
        500, { cae, cae_vto, numero, punto_venta }
      )
    }

    return jsonOk({
      factura_id: fila.id,
      estado: 'autorizada',
      cae, cae_vto,
      punto_venta, numero,
      comprobante_codigo,
      cuit_emisor: cuitNum,
      importe_total: impTotal,
      observaciones: errores || null,
    })
  } catch (err) {
    return jsonError('Error inesperado: ' + (err instanceof Error ? err.message : String(err)), 500)
  }
})

// ---------------------------------------------------------------------------
// Helpers AfipSDK
// ---------------------------------------------------------------------------
async function afipAuth(opts: {
  environment: string; wsid: string; tax_id: string
  cert: string; key: string; accessToken?: string | null
}): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`
    const resp = await fetch(`${AFIPSDK_BASE}/auth`, {
      method: 'POST', headers,
      body: JSON.stringify({
        environment: opts.environment, wsid: opts.wsid, tax_id: opts.tax_id,
        force_create: false, cert: opts.cert, key: opts.key,
      }),
    })
    const text = await resp.text()
    let data: any = null; try { data = JSON.parse(text) } catch { /* ignore */ }
    if (!resp.ok) return { ok: false, error: (data?.message || data?.error || text || `HTTP ${resp.status}`).slice(0, 500) }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function afipRequest(opts: {
  environment: string
  ws: { url: string; wsdl: string }
  method: string
  params: Record<string, unknown>
  accessToken?: string | null
}): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`
    const resp = await fetch(`${AFIPSDK_BASE}/requests`, {
      method: 'POST', headers,
      body: JSON.stringify({
        environment: opts.environment,
        method: opts.method,
        wsid: 'wsfe',
        url: opts.ws.url,
        wsdl: opts.ws.wsdl,
        soap_v_1_2: false,
        params: opts.params,
      }),
    })
    const text = await resp.text()
    let data: any = null; try { data = JSON.parse(text) } catch { /* ignore */ }
    if (!resp.ok) return { ok: false, error: (data?.message || data?.error || text || `HTTP ${resp.status}`).slice(0, 800) }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// El detalle viene como objeto o array según el SOAP→JSON
function pickDetResponse(res: any): any {
  const d = res?.FeDetResp?.FECAEDetResponse
  if (!d) return null
  return Array.isArray(d) ? d[0] : d
}

// Junta Errors (cabecera) + Observaciones (detalle) en un string legible
function extraerMensajes(res: any, detResp: any): string {
  const out: string[] = []
  const push = (arr: any, campo = 'Msg') => {
    if (!arr) return
    const list = Array.isArray(arr) ? arr : [arr]
    for (const x of list) {
      const code = x?.Code ?? x?.Codigo
      const msg = x?.[campo] ?? x?.Msg ?? x?.Mensaje
      if (msg) out.push(code ? `[${code}] ${msg}` : String(msg))
    }
  }
  push(res?.Errors?.Err)
  push(res?.Events?.Evt)
  push(detResp?.Observaciones?.Obs)
  return out.join(' · ')
}

function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100 }

// Fecha de hoy en hora Argentina (YYYY-MM-DD)
function fechaHoyARG(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ---------------------------------------------------------------------------
function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(msg: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error: msg, ...extra }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
