// =============================================================================
// EDGE FUNCTION: arca-config
// =============================================================================
// Gestiona las credenciales ARCA (certificado + clave privada) de cada cuenta
// fiscal y permite probar la conexión contra ARCA vía AfipSDK.
//
// Acciones (body.accion):
//   - 'guardar' : upsert de { cuenta_id, ambiente, punto_venta, cert, key,
//                 afipsdk_access_token? } en `arca_config`. Refleja flags NO
//                 secretos en `cuentas_fiscales`. Nunca devuelve cert/key.
//   - 'probar'  : autentica contra AfipSDK (WSAA) con las credenciales guardadas
//                 y registra el resultado del test. Devuelve ok/mensaje.
//   - 'estado'  : metadatos no sensibles (habilitado, ambiente, punto_venta,
//                 último test). No devuelve cert/key.
//
// Seguridad:
//   - Solo admin (profiles.rol = 'admin'), validado por el JWT del caller.
//   - El cert/key se leen/escriben con service_role; jamás vuelven al frontend.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const AFIPSDK_BASE = 'https://app.afipsdk.com/api/v1/afip'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Falta autenticación', 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Validar rol admin con el JWT del caller
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return jsonError('No autenticado', 401)
    const { data: profile } = await supabaseUser
      .from('profiles').select('rol').eq('id', user.id).single()
    if (profile?.rol !== 'admin') return jsonError('Solo el administrador puede configurar ARCA', 403)

    const body = await req.json().catch(() => ({}))
    const accion = String(body.accion || '').trim()
    const cuenta_id = Number(body.cuenta_id)
    if (!cuenta_id) return jsonError('cuenta_id es obligatorio')

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // La cuenta debe existir; necesitamos el CUIT para autenticar
    const { data: cuenta, error: cuentaErr } = await supabaseAdmin
      .from('cuentas_fiscales').select('id, nombre, cuit').eq('id', cuenta_id).single()
    if (cuentaErr || !cuenta) return jsonError('Cuenta no encontrada')

    if (accion === 'guardar') {
      const ambiente = body.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const punto_venta = Number(body.punto_venta) || 1
      const cert = typeof body.cert === 'string' ? body.cert.trim() : ''
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      const afipsdk_access_token = typeof body.afipsdk_access_token === 'string'
        ? body.afipsdk_access_token.trim() : ''

      // Leer config existente para no pisar cert/key si no los reenvían
      const { data: prev } = await supabaseAdmin
        .from('arca_config').select('cert, key').eq('cuenta_id', cuenta_id).single()

      const fila: Record<string, unknown> = {
        cuenta_id, ambiente, punto_venta,
        cert: cert || prev?.cert || null,
        key: key || prev?.key || null,
        afipsdk_access_token: afipsdk_access_token || null,
        updated_at: new Date().toISOString(),
      }
      const { error: upErr } = await supabaseAdmin
        .from('arca_config').upsert(fila, { onConflict: 'cuenta_id' })
      if (upErr) return jsonError('No se pudo guardar la config: ' + upErr.message)

      const tieneCreds = Boolean(fila.cert && fila.key)
      await supabaseAdmin.from('cuentas_fiscales').update({
        arca_habilitado: tieneCreds,
        arca_ambiente: ambiente,
        arca_punto_venta: punto_venta,
      }).eq('id', cuenta_id)

      return jsonOk({ guardado: true, tiene_credenciales: tieneCreds, ambiente, punto_venta })
    }

    if (accion === 'probar') {
      const { data: cfg } = await supabaseAdmin
        .from('arca_config').select('*').eq('cuenta_id', cuenta_id).single()
      if (!cfg?.cert || !cfg?.key) {
        return jsonError('Faltan el certificado y/o la clave. Cargalos primero.')
      }
      const environment = cfg.ambiente === 'produccion' ? 'prod' : 'dev'
      // Autenticar con el CUIT del titular del certificado (apoderado si difiere)
      const taxId = String(cfg.cert_cuit || cuenta.cuit).replace(/[-\s.]/g, '')

      const r = await afipAuth({
        environment, wsid: 'wsfe', tax_id: taxId,
        cert: cfg.cert, key: cfg.key, force_create: true,
        accessToken: cfg.afipsdk_access_token || Deno.env.get('AFIPSDK_ACCESS_TOKEN') || null,
      })

      const ok = !!(r.ok && r.data?.token && r.data?.sign)
      const msg = ok
        ? `Conexión OK con ARCA (${cfg.ambiente}). Token válido hasta ${r.data.expiration || 's/d'}.`
        : `Falló: ${r.error || 'respuesta inesperada de AfipSDK'}`

      await supabaseAdmin.from('arca_config').update({
        ultimo_test_ok: ok, ultimo_test_at: new Date().toISOString(), ultimo_test_msg: msg,
      }).eq('cuenta_id', cuenta_id)

      return ok ? jsonOk({ probado: true, mensaje: msg }) : jsonError(msg)
    }

    if (accion === 'crear_cert_dev') {
      // Genera el certificado (homologación o PRODUCCIÓN) y autoriza el web service
      // wsfe. Soporta APODERADO: el TITULAR del cert (arca_username) puede ser un
      // CUIT distinto del EMISOR (cuenta.cuit). La clave fiscal NO se guarda.
      const ambiente = body.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const sufijo = ambiente === 'produccion' ? 'prod' : 'dev' // create-cert-prod / auth-web-service-prod
      const password = String(body.arca_password || '')
      // Alias ÚNICO por cuenta+ambiente: evita chocar con un alias ya existente en ARCA.
      const aliasDefault = 'fab' + cuenta_id + (ambiente === 'produccion' ? 'p' : '')
      const alias = (String(body.alias || aliasDefault).trim() || aliasDefault).replace(/[^a-zA-Z0-9]/g, '')
      if (!password) return jsonError('Ingresá la clave fiscal de ARCA')
      const emisorCuit = String(cuenta.cuit).replace(/[-\s.]/g, '')
      const certCuit = String(body.arca_username || '').replace(/[-\s.]/g, '') || emisorCuit
      const esApoderado = certCuit !== emisorCuit
      const accessToken = body.afipsdk_access_token || Deno.env.get('AFIPSDK_ACCESS_TOKEN') || null

      // 1) Crear certificado del TITULAR (si ya hay uno guardado y la automation falla, se reusa)
      const { data: existente } = await supabaseAdmin
        .from('arca_config').select('cert, key').eq('cuenta_id', cuenta_id).single()
      const certRes = await runAutomation(`create-cert-${sufijo}`,
        { cuit: certCuit, username: certCuit, password, alias }, accessToken)
      let cert = certRes.data?.cert ?? certRes.data?.data?.cert
      let key = certRes.data?.key ?? certRes.data?.data?.key
      if (!(cert && key)) {
        if (existente?.cert && existente?.key) { cert = existente.cert; key = existente.key }
        else return jsonError('No se pudo crear el certificado: ' + (certRes.error || 'sin cert/key'))
      }

      // 2) Autorizar el web service wsfe del EMISOR, logueado como el TITULAR
      const authRes = await runAutomation(`auth-web-service-${sufijo}`,
        { cuit: emisorCuit, username: certCuit, password, alias, service: 'wsfe' }, accessToken)
      if (!authRes.ok) {
        return jsonError('Certificado OK, pero no se pudo autorizar el web service wsfe: ' + authRes.error)
      }

      // 3) Guardar y habilitar (cert_cuit solo si el titular difiere del emisor)
      const punto_venta = Number(body.punto_venta) || 1
      await supabaseAdmin.from('arca_config').upsert({
        cuenta_id, ambiente, punto_venta, cert, key,
        cert_cuit: esApoderado ? certCuit : null,
        afipsdk_access_token: body.afipsdk_access_token ? String(body.afipsdk_access_token).trim() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cuenta_id' })
      await supabaseAdmin.from('cuentas_fiscales').update({
        arca_habilitado: true, arca_ambiente: ambiente, arca_punto_venta: punto_venta,
      }).eq('id', cuenta_id)

      const ambLabel = ambiente === 'produccion' ? 'PRODUCCIÓN' : 'homologación'
      return jsonOk({
        creado: true,
        mensaje: esApoderado
          ? `Certificado de ${ambLabel} del apoderado (${certCuit}) generado y wsfe del emisor (${emisorCuit}) autorizado. Probá la conexión.`
          : `Certificado de ${ambLabel} generado y web service wsfe autorizado. Probá la conexión.`,
      })
    }

    if (accion === 'estado') {
      const { data: cfg } = await supabaseAdmin
        .from('arca_config')
        .select('ambiente, punto_venta, cert, ultimo_test_ok, ultimo_test_at, ultimo_test_msg')
        .eq('cuenta_id', cuenta_id).single()
      return jsonOk({
        configurada: !!cfg?.cert,
        ambiente: cfg?.ambiente || null,
        punto_venta: cfg?.punto_venta || null,
        ultimo_test_ok: cfg?.ultimo_test_ok ?? null,
        ultimo_test_at: cfg?.ultimo_test_at || null,
        ultimo_test_msg: cfg?.ultimo_test_msg || null,
      })
    }

    return jsonError('Acción no reconocida: usá guardar | probar | crear_cert_dev | estado')
  } catch (err) {
    return jsonError('Error inesperado: ' + (err instanceof Error ? err.message : String(err)), 500)
  }
})

// --- AfipSDK: autenticación WSAA (devuelve token+sign, los cachea AfipSDK) ---
async function afipAuth(opts: {
  environment: string; wsid: string; tax_id: string
  cert: string; key: string; force_create?: boolean; accessToken?: string | null
}): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`
    const resp = await fetch(`${AFIPSDK_BASE}/auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        environment: opts.environment,
        wsid: opts.wsid,
        tax_id: opts.tax_id,
        force_create: opts.force_create ?? false,
        cert: opts.cert,
        key: opts.key,
      }),
    })
    const text = await resp.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { /* texto plano de error */ }
    if (!resp.ok) {
      return { ok: false, error: (data?.message || data?.error || text || `HTTP ${resp.status}`).slice(0, 500) }
    }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Ejecuta una automation de AfipSDK: 1 POST para crear el job, luego GET a
// /automations/{id} para consultar el estado (re-POSTear dispara el anti-duplicado
// de 10s). Devuelve el objeto `data` final de la automation.
async function runAutomation(
  automation: string,
  params: Record<string, unknown>,
  accessToken?: string | null,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const base = 'https://app.afipsdk.com/api/v1/automations'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  // ¿La automation ya terminó? (create-cert devuelve cert/key; auth-ws devuelve status)
  const terminada = (d: any) => {
    if (!d) return false
    if (d?.data?.cert && d?.data?.key) return true
    const st = String(d?.status || d?.data?.status || '').toLowerCase()
    return st === 'complete' || st === 'completed' || st === 'success' || st === 'created'
  }

  try {
    const resp = await fetch(base, {
      method: 'POST', headers,
      body: JSON.stringify({ automation, params }),
    })
    const text = await resp.text()
    let data: any = null; try { data = JSON.parse(text) } catch { /* */ }
    if (!resp.ok) return { ok: false, error: (data?.message || data?.error || text || `HTTP ${resp.status}`).slice(0, 600) }
    if (terminada(data)) return { ok: true, data: data?.data ?? data }

    const id = data?.id || data?.automation_id || data?.long_job_id
    if (!id) return { ok: false, error: 'AfipSDK no devolvió un id de automatización para consultar.' }

    for (let intento = 0; intento < 22; intento++) {
      await new Promise(res => setTimeout(res, 5000))
      const sresp = await fetch(`${base}/${id}`, { method: 'GET', headers })
      const stext = await sresp.text()
      let sdata: any = null; try { sdata = JSON.parse(stext) } catch { /* */ }
      if (!sresp.ok) continue
      const status = String(sdata?.status || '').toLowerCase()
      if (terminada(sdata)) return { ok: true, data: sdata?.data ?? sdata }
      if (status === 'error' || status === 'failed') {
        return { ok: false, error: sdata?.error || sdata?.message || 'la automatización falló en ARCA (¿clave fiscal incorrecta?)' }
      }
    }
    return { ok: false, error: 'tardó demasiado (timeout). Reintentá en un momento.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function jsonOk(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
