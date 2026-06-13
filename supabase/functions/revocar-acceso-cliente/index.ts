// =============================================================================
// EDGE FUNCTION: revocar-acceso-cliente
// =============================================================================
// Revoca el portal de un cliente: borra el user de auth, el profile, y
// desmarca el flag tiene_portal en la tabla clientes.
//
// Recibe:  { cliente_id: number }
// Devuelve: { ok: true }
//
// Seguridad: solo invocable por usuarios autenticados con rol = 'admin'.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Validar admin
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
      return jsonError('Solo el administrador puede revocar accesos', 403)
    }

    // Parsear payload — cliente_id es UUID (string)
    const body = await req.json().catch(() => ({}))
    const cliente_id = String(body.cliente_id || '').trim()
    if (!cliente_id) return jsonError('cliente_id es obligatorio')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cliente_id)) {
      return jsonError('cliente_id no es un UUID válido')
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Buscar el profile asociado al cliente
    const { data: profileCliente } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('cliente_id', cliente_id)
      .eq('rol', 'cliente_mayorista')
      .maybeSingle()

    // Borrar el user de auth si existe (cascada se ocupa del profile)
    if (profileCliente?.id) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(profileCliente.id)
      if (delErr) {
        // Si falla, intentamos borrar profile manualmente
        await supabaseAdmin.from('profiles').delete().eq('id', profileCliente.id)
      }
    }

    // Desmarcar flags en clientes
    await supabaseAdmin
      .from('clientes')
      .update({ tiene_portal: false, email_portal: null })
      .eq('id', cliente_id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
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
