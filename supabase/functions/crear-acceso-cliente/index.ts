// =============================================================================
// EDGE FUNCTION: crear-acceso-cliente
// =============================================================================
// Habilita el portal mayorista para un cliente.
//
// Recibe:  { cliente_id: number, email: string }
// Devuelve: { email: string, password: string }  -> el admin se las pasa al cliente
//
// Seguridad:
//   - Solo puede ser invocada por usuarios autenticados con rol = 'admin'.
//   - Usa la service_role_key (inyectada por Supabase) para crear users en auth.
//   - La service_role_key NUNCA viaja al frontend, queda solo en el servidor.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Genera un password aleatorio amigable (sin caracteres confusos como 0/O, 1/l)
function generarPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pwd = ''
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < length; i++) pwd += chars[bytes[i] % chars.length]
  return pwd
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 1) Validar que el caller esté autenticado y sea admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Falta autenticación', 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Cliente con el JWT del usuario que invoca (para validar su rol)
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return jsonError('No autenticado', 401)

    const { data: profile, error: profileErr } = await supabaseUser
      .from('profiles')
      .select('rol')
      .eq('id', user.id)
      .single()
    if (profileErr || profile?.rol !== 'admin') {
      return jsonError('Solo el administrador puede habilitar accesos', 403)
    }

    // 2) Parsear payload
    const body = await req.json().catch(() => ({}))
    const cliente_id = Number(body.cliente_id)
    const email = String(body.email || '').trim().toLowerCase()
    if (!cliente_id || !email) return jsonError('cliente_id y email son obligatorios')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Email inválido')

    // 3) Cliente admin (service_role) — saltea RLS y permite crear usuarios
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) Verificar que el cliente exista y no tenga ya portal habilitado
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from('clientes')
      .select('id, nombre, tiene_portal, email_portal')
      .eq('id', cliente_id)
      .single()
    if (clienteErr || !cliente) return jsonError('Cliente no encontrado')
    if (cliente.tiene_portal) {
      return jsonError('Este cliente ya tiene portal habilitado. Revocá el acceso anterior antes de crear uno nuevo.')
    }

    // 5) Crear el usuario en Supabase Auth
    const password = generarPassword(12)
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // ya viene confirmado, no requiere verificación por email
      user_metadata: { cliente_id, cliente_nombre: cliente.nombre, alta_via: 'admin_portal' },
    })
    if (createErr || !newUser?.user) {
      return jsonError('No se pudo crear el usuario: ' + (createErr?.message || 'error desconocido'))
    }

    // 6) Crear el profile vinculado al cliente
    const { error: profileInsertErr } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: newUser.user.id,
        nombre: cliente.nombre,
        rol: 'cliente_mayorista',
        cliente_id: cliente.id,
      })
    if (profileInsertErr) {
      // Rollback: borrar el user creado para no dejar huérfanos
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      return jsonError('No se pudo crear el perfil: ' + profileInsertErr.message)
    }

    // 7) Marcar el cliente como con portal habilitado
    await supabaseAdmin
      .from('clientes')
      .update({ tiene_portal: true, email_portal: email })
      .eq('id', cliente.id)

    // 8) Devolver credenciales al admin (única vez que ve el password)
    return new Response(
      JSON.stringify({
        ok: true,
        email,
        password,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return jsonError('Error inesperado: ' + (err instanceof Error ? err.message : String(err)), 500)
  }
})

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
