// =============================================================================
// EDGE FUNCTION: arca-config
// =============================================================================
// Gestiona credenciales ARCA por cuenta y prueba la conexión.
//
// AUTH: ahora es AUTÓNOMA (sin AfipSDK). Firma el Login Ticket (WSAA) con el
// certificado usando node-forge (CMS/PKCS#7) y obtiene Token+Sign, que se
// cachean en `arca_ta` (~12 hs, ARCA no deja pedir dos seguidos).
//
// La generación de certificado (`crear_cert_dev`) SIGUE usando las automations
// de AfipSDK (es un flujo de UI de ARCA, no un web service). Es opcional: para
// producción se puede crear el cert en ARCA a mano y pegarlo.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getTA, generarCSR } from './wsaa.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Falta autenticación', 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return jsonError('No autenticado', 401)
    const { data: profile } = await supabaseUser.from('profiles').select('rol').eq('id', user.id).single()
    if (profile?.rol !== 'admin') return jsonError('Solo el administrador puede configurar ARCA', 403)

    const body = await req.json().catch(() => ({}))
    const accion = String(body.accion || '').trim()
    const cuenta_id = Number(body.cuenta_id)
    if (!cuenta_id) return jsonError('cuenta_id es obligatorio')

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: cuenta, error: cuentaErr } = await supabaseAdmin
      .from('cuentas_fiscales').select('id, nombre, razon_social, cuit').eq('id', cuenta_id).single()
    if (cuentaErr || !cuenta) return jsonError('Cuenta no encontrada')

    if (accion === 'guardar') {
      const ambiente = body.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const punto_venta = Number(body.punto_venta) || 1
      const cert = typeof body.cert === 'string' ? body.cert.trim() : ''
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      const { data: prev } = await supabaseAdmin.from('arca_config').select('cert, key').eq('cuenta_id', cuenta_id).single()
      const fila: Record<string, unknown> = {
        cuenta_id, ambiente, punto_venta,
        cert: cert || prev?.cert || null, key: key || prev?.key || null,
        afipsdk_access_token: typeof body.afipsdk_access_token === 'string' && body.afipsdk_access_token.trim() ? body.afipsdk_access_token.trim() : null,
        updated_at: new Date().toISOString(),
      }
      const { error: upErr } = await supabaseAdmin.from('arca_config').upsert(fila, { onConflict: 'cuenta_id' })
      if (upErr) return jsonError('No se pudo guardar la config: ' + upErr.message)
      const tieneCreds = Boolean(fila.cert && fila.key)
      await supabaseAdmin.from('cuentas_fiscales').update({ arca_habilitado: tieneCreds, arca_ambiente: ambiente, arca_punto_venta: punto_venta }).eq('id', cuenta_id)
      // Si cambiaron cert/key, invalidar el TA cacheado de esta cuenta (titular o emisor)
      if (cert || key) {
        const cc = String((await supabaseAdmin.from('arca_config').select('cert_cuit').eq('cuenta_id', cuenta_id).single()).data?.cert_cuit || cuenta.cuit).replace(/[-\s.]/g, '')
        await supabaseAdmin.from('arca_ta').delete().eq('cert_cuit', cc).eq('ambiente', ambiente)
      }
      return jsonOk({ guardado: true, tiene_credenciales: tieneCreds, ambiente, punto_venta })
    }

    if (accion === 'probar') {
      const { data: cfg } = await supabaseAdmin.from('arca_config').select('*').eq('cuenta_id', cuenta_id).single()
      if (!cfg?.cert || !cfg?.key) return jsonError('Faltan el certificado y/o la clave. Cargalos primero.')
      const ambiente = cfg.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const certCuit = String(cfg.cert_cuit || cuenta.cuit).replace(/[-\s.]/g, '')

      const r = await getTA(supabaseAdmin, { certCuit, ambiente, cert: cfg.cert, key: cfg.key })
      const ok = !!(r.ok && r.token && r.sign)
      const msg = ok
        ? `Conexión OK con ARCA (${ambiente}, directo). Token válido hasta ${r.expiration || 's/d'}.`
        : `Falló: ${r.error || 'no se obtuvo token'}`
      await supabaseAdmin.from('arca_config').update({ ultimo_test_ok: ok, ultimo_test_at: new Date().toISOString(), ultimo_test_msg: msg }).eq('cuenta_id', cuenta_id)
      return ok ? jsonOk({ probado: true, mensaje: msg }) : jsonError(msg)
    }

    if (accion === 'crear_cert_dev') {
      // Generación de cert vía AfipSDK (flujo de UI, no web service). Opcional.
      const ambiente = body.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const sufijo = ambiente === 'produccion' ? 'prod' : 'dev'
      const password = String(body.arca_password || '')
      const aliasDefault = 'fab' + cuenta_id + (ambiente === 'produccion' ? 'p' : '')
      const alias = (String(body.alias || aliasDefault).trim() || aliasDefault).replace(/[^a-zA-Z0-9]/g, '')
      if (!password) return jsonError('Ingresá la clave fiscal de ARCA')
      const emisorCuit = String(cuenta.cuit).replace(/[-\s.]/g, '')
      const certCuit = String(body.arca_username || '').replace(/[-\s.]/g, '') || emisorCuit
      const esApoderado = certCuit !== emisorCuit
      const accessToken = body.afipsdk_access_token || Deno.env.get('AFIPSDK_ACCESS_TOKEN') || null

      const { data: existente } = await supabaseAdmin.from('arca_config').select('cert, key').eq('cuenta_id', cuenta_id).single()
      const certRes = await runAutomation(`create-cert-${sufijo}`, { cuit: certCuit, username: certCuit, password, alias }, accessToken)
      let cert = certRes.data?.cert ?? certRes.data?.data?.cert
      let key = certRes.data?.key ?? certRes.data?.data?.key
      if (!(cert && key)) {
        if (existente?.cert && existente?.key) { cert = existente.cert; key = existente.key }
        else return jsonError('No se pudo crear el certificado: ' + (certRes.error || 'sin cert/key'))
      }
      const authRes = await runAutomation(`auth-web-service-${sufijo}`, { cuit: emisorCuit, username: certCuit, password, alias, service: 'wsfe' }, accessToken)
      if (!authRes.ok) return jsonError('Certificado OK, pero no se pudo autorizar el web service wsfe: ' + authRes.error)

      const punto_venta = Number(body.punto_venta) || 1
      await supabaseAdmin.from('arca_config').upsert({
        cuenta_id, ambiente, punto_venta, cert, key, cert_cuit: esApoderado ? certCuit : null,
        afipsdk_access_token: body.afipsdk_access_token ? String(body.afipsdk_access_token).trim() : null, updated_at: new Date().toISOString(),
      }, { onConflict: 'cuenta_id' })
      await supabaseAdmin.from('cuentas_fiscales').update({ arca_habilitado: true, arca_ambiente: ambiente, arca_punto_venta: punto_venta }).eq('id', cuenta_id)
      await supabaseAdmin.from('arca_ta').delete().eq('cert_cuit', certCuit).eq('ambiente', ambiente)
      const ambLabel = ambiente === 'produccion' ? 'PRODUCCIÓN' : 'homologación'
      return jsonOk({ creado: true, mensaje: esApoderado
        ? `Certificado de ${ambLabel} del apoderado (${certCuit}) generado y wsfe del emisor (${emisorCuit}) autorizado. Probá la conexión.`
        : `Certificado de ${ambLabel} generado y web service wsfe autorizado. Probá la conexión.` })
    }

    if (accion === 'generar_csr') {
      // Genera clave privada + CSR (autónomo, sin AfipSDK). Guarda la clave;
      // el usuario sube el CSR a ARCA y luego pega el certificado (.crt).
      const ambiente = body.ambiente === 'produccion' ? 'produccion' : 'homologacion'
      const punto_venta = Number(body.punto_venta) || 1
      const emisorCuit = String(cuenta.cuit).replace(/[-\s.]/g, '')
      const certCuit = String(body.arca_username || '').replace(/[-\s.]/g, '') || emisorCuit
      const esApoderado = certCuit !== emisorCuit
      const alias = 'fabricius' + cuenta_id + (ambiente === 'produccion' ? 'p' : '')

      const { csr, key } = generarCSR({ cuit: certCuit, razonSocial: cuenta.razon_social || cuenta.nombre || '', alias })

      // Guardar la clave privada (el cert se pega después). Mantener cert previo si lo había.
      const { data: prev } = await supabaseAdmin.from('arca_config').select('cert').eq('cuenta_id', cuenta_id).single()
      await supabaseAdmin.from('arca_config').upsert({
        cuenta_id, ambiente, punto_venta, key, cert: prev?.cert || null,
        cert_cuit: esApoderado ? certCuit : null, updated_at: new Date().toISOString(),
      }, { onConflict: 'cuenta_id' })
      await supabaseAdmin.from('cuentas_fiscales').update({ arca_ambiente: ambiente, arca_punto_venta: punto_venta }).eq('id', cuenta_id)
      await supabaseAdmin.from('arca_ta').delete().eq('cert_cuit', certCuit).eq('ambiente', ambiente)

      return jsonOk({ csr, alias, cert_cuit: certCuit, mensaje: 'CSR generado. Subilo a ARCA y pegá el certificado que te devuelve.' })
    }

    if (accion === 'estado') {
      const { data: cfg } = await supabaseAdmin.from('arca_config')
        .select('ambiente, punto_venta, cert, cert_cuit, ultimo_test_ok, ultimo_test_at, ultimo_test_msg').eq('cuenta_id', cuenta_id).single()
      return jsonOk({ configurada: !!cfg?.cert, ambiente: cfg?.ambiente || null, punto_venta: cfg?.punto_venta || null,
        cert_cuit: cfg?.cert_cuit || null, ultimo_test_ok: cfg?.ultimo_test_ok ?? null, ultimo_test_at: cfg?.ultimo_test_at || null, ultimo_test_msg: cfg?.ultimo_test_msg || null })
    }

    return jsonError('Acción no reconocida: usá guardar | probar | crear_cert_dev | estado')
  } catch (err) {
    return jsonError('Error inesperado: ' + (err instanceof Error ? err.message : String(err)), 500)
  }
})

// --- AfipSDK automations (solo para generar certificados) ---
async function runAutomation(automation: string, params: Record<string, unknown>, accessToken?: string | null): Promise<{ ok: boolean; data?: any; error?: string }> {
  const base = 'https://app.afipsdk.com/api/v1/automations'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const terminada = (d: any) => {
    if (!d) return false
    if (d?.data?.cert && d?.data?.key) return true
    const st = String(d?.status || d?.data?.status || '').toLowerCase()
    return st === 'complete' || st === 'completed' || st === 'success' || st === 'created'
  }
  try {
    const resp = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ automation, params }) })
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
      if (status === 'error' || status === 'failed') return { ok: false, error: sdata?.error || sdata?.message || 'la automatización falló en ARCA (¿clave fiscal incorrecta?)' }
    }
    return { ok: false, error: 'tardó demasiado (timeout). Reintentá en un momento.' }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

function jsonOk(payload: Record<string, unknown>) { return new Response(JSON.stringify({ ok: true, ...payload }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function jsonError(msg: string, status = 400) { return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
