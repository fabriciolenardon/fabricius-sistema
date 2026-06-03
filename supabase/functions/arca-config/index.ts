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
      const taxId = String(cuenta.cuit).replace(/[-\s.]/g, '')

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
      // Genera el certificado de homologación vía la automation de AfipSDK
      // (se loguea a ARCA con la clave fiscal del CUIT). La clave fiscal NO se guarda.
      const username = String(body.arca_username || '').trim() || String(cuenta.cuit).replace(/[-\s.]/g, '')
      const password = String(body.arca_password || '')
      const alias = (String(body.alias || 'fabricius').trim() || 'fabricius').replace(/[^a-zA-Z0-9]/g, '')
      if (!password) return jsonError('Ingresá la clave fiscal de ARCA del CUIT')
      const taxId = String(cuenta.cuit).replace(/[-\s.]/g, '')
      const accessToken = body.afipsdk_access_token || Deno.env.get('AFIPSDK_ACCESS_TOKEN') || null

      const cert = await crearCertDev({ cuit: taxId, username, password, alias, accessToken })
      if (!cert.ok) return jsonError('No se pudo crear el certificado: ' + cert.error)

      // Guardar cert+key en homologación y habilitar
      const punto_venta = Number(body.punto_venta) || 1
      await supabaseAdmin.from('arca_config').upsert({
        cuenta_id, ambiente: 'homologacion', punto_venta,
        cert: cert.cert, key: cert.key,
        afipsdk_access_token: body.afipsdk_access_token ? String(body.afipsdk_access_token).trim() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cuenta_id' })
      await supabaseAdmin.from('cuentas_fiscales').update({
        arca_habilitado: true, arca_ambiente: 'homologacion', arca_punto_venta: punto_venta,
      }).eq('id', cuenta_id)

      return jsonOk({ creado: true, mensaje: 'Certificado de testing generado y guardado. Probá la conexión.' })
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

// AfipSDK automation 'create-cert-dev' → crea cert + key de homologación.
// Es asíncrona: si no vuelve 'complete', se reintenta el mismo POST hasta que termina.
async function crearCertDev(opts: {
  cuit: string; username: string; password: string; alias: string; accessToken?: string | null
}): Promise<{ ok: boolean; cert?: string; key?: string; error?: string }> {
  const url = 'https://app.afipsdk.com/api/v1/automations'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.accessToken) headers['Authorization'] = `Bearer ${opts.accessToken}`
  const payload: Record<string, unknown> = {
    automation: 'create-cert-dev',
    params: { cuit: opts.cuit, username: opts.username, password: opts.password, alias: opts.alias },
  }
  try {
    let longJobId: string | null = null
    for (let intento = 0; intento < 25; intento++) {
      const body = longJobId ? { ...payload, long_job_id: longJobId } : payload
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
      const text = await resp.text()
      let data: any = null; try { data = JSON.parse(text) } catch { /* */ }
      if (!resp.ok) return { ok: false, error: (data?.message || data?.error || text || `HTTP ${resp.status}`).slice(0, 600) }

      const status = String(data?.status || '').toLowerCase()
      const cert = data?.data?.cert
      const key = data?.data?.key
      if ((status === 'complete' || status === 'completed' || status === 'success') && cert && key) {
        return { ok: true, cert, key }
      }
      if (cert && key) return { ok: true, cert, key }
      if (status === 'error' || status === 'failed') {
        return { ok: false, error: data?.error || data?.message || 'la automatización falló en ARCA' }
      }
      longJobId = data?.long_job_id || data?.id || longJobId
      // Esperar antes de reintentar (la automation tarda unos segundos)
      await new Promise(r => setTimeout(r, 3000))
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
