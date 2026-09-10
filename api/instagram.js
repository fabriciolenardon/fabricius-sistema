// ───────────────────────────────────────────────────────────
// INSTAGRAM — publicar en la cuenta del negocio (Graph API de Meta)
// ───────────────────────────────────────────────────────────
// Misma app de Meta que WhatsApp. Publica foto, carrusel o reel en
// @carniceriafabricius. Igual que wa-send: valida que quien llama sea
// admin (JWT de Supabase → profiles.rol) y el token nunca sale al navegador.
//
// La imagen/video tiene que estar en una URL PÚBLICA: Meta la va a buscar
// a ella, no se suben bytes. Usamos el bucket público `placas` de Supabase
// Storage.
//
// Publicar es en dos pasos:
//   1) POST /{ig_user_id}/media          → devuelve un creation_id
//   2) POST /{ig_user_id}/media_publish  → lo publica
// Los reels tardan en procesarse, así que entre paso 1 y 2 hay que esperar
// a que el contenedor quede en FINISHED.
//
// Diagnóstico: GET /api/instagram?check=1 dice si el token sirve y a qué
// cuenta está pegado, sin publicar nada.
// ───────────────────────────────────────────────────────────
export const config = { maxDuration: 60 }

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.VITE_SUPABASE_ANON_KEY

// Token propio de Instagram. Si no está, cae al de WhatsApp por si le
// agregaste los permisos de IG al mismo usuario de sistema.
const IG_TOKEN = process.env.INSTAGRAM_TOKEN || process.env.WHATSAPP_TOKEN
const IG_USER_ID = process.env.INSTAGRAM_USER_ID

const GRAPH = 'https://graph.facebook.com/v21.0'

// ── helpers ──

async function graph(path, { method = 'GET', params = {} } = {}) {
  const qs = new URLSearchParams({ ...params, access_token: IG_TOKEN })
  const url = method === 'GET' ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`
  const opts = method === 'GET'
    ? {}
    : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs }
  const r = await fetch(url, opts)
  const txt = await r.text()
  let json
  try { json = JSON.parse(txt) } catch { json = { raw: txt } }
  if (!r.ok) {
    const e = new Error(json?.error?.message || `Graph ${r.status}`)
    e.status = r.status
    e.detalle = json?.error || json
    throw e
  }
  return json
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// Espera a que el contenedor esté listo. Las fotos suelen salir en el
// primer intento; un reel puede tardar bastante.
async function esperarContenedor(creationId, intentos = 20) {
  for (let i = 0; i < intentos; i++) {
    const { status_code, status } = await graph(creationId, { params: { fields: 'status_code,status' } })
    if (status_code === 'FINISHED') return true
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      const e = new Error(`Meta rechazó el contenido (${status_code})`)
      e.detalle = status || status_code
      throw e
    }
    await dormir(i < 3 ? 1500 : 3000)
  }
  throw new Error('El contenido tardó demasiado en procesarse. Probá de nuevo en un rato.')
}

async function exigirAdmin(req) {
  const authz = req.headers.authorization || ''
  const userToken = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  if (!userToken) return { error: 'sin sesión', code: 401 }

  const ures = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${userToken}` },
  })
  if (!ures.ok) return { error: 'sesión inválida', code: 401 }
  const user = await ures.json()
  const uid = user?.id
  if (!uid) return { error: 'sin usuario', code: 401 }

  const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
  const prof = await (await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=rol`, { headers: svc })).json()
  if (prof?.[0]?.rol !== 'admin') return { error: 'solo admin', code: 403 }

  return { uid, svc }
}

// ── handler ──

export default async function handler(req, res) {
  try {
    if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'config de Supabase faltante' })
    if (!IG_TOKEN) return res.status(500).json({ error: 'falta INSTAGRAM_TOKEN' })

    const guard = await exigirAdmin(req)
    if (guard.error) return res.status(guard.code).json({ error: guard.error })

    // ── Diagnóstico: ¿el token sirve? ¿a qué cuenta apunta? ──
    if (req.method === 'GET') {
      // Sin INSTAGRAM_USER_ID cargado, lo busca solo: recorre las páginas de
      // Facebook del token y devuelve la cuenta de Instagram vinculada a cada
      // una. Así alcanza con cargar el token para saber qué ID poner.
      if (!IG_USER_ID) {
        const paginas = await graph('me/accounts', {
          params: { fields: 'id,name,instagram_business_account{id,username,followers_count}' },
        })
        const encontradas = (paginas?.data || [])
          .filter((p) => p.instagram_business_account)
          .map((p) => ({
            pagina: p.name,
            paginaId: p.id,
            instagramUserId: p.instagram_business_account.id,
            usuario: p.instagram_business_account.username,
            seguidores: p.instagram_business_account.followers_count,
          }))

        if (!encontradas.length) {
          return res.status(200).json({
            ok: false,
            error: 'El token anda, pero ninguna de tus páginas tiene una cuenta de Instagram de empresa vinculada.',
            revisar: [
              'Que @carniceriafabricius sea Cuenta de empresa (no personal ni de creador)',
              'Que esté vinculada a una página de Facebook',
              'Que el token tenga los permisos instagram_basic y pages_show_list',
            ],
            paginasVistas: (paginas?.data || []).map((p) => p.name),
          })
        }

        return res.status(200).json({
          ok: true,
          mensaje: 'Cargá este instagramUserId como INSTAGRAM_USER_ID en Vercel y redeployá.',
          cuentas: encontradas,
        })
      }

      const cuenta = await graph(IG_USER_ID, {
        params: { fields: 'username,name,followers_count,media_count' },
      })
      let cupo = null
      try {
        cupo = await graph(`${IG_USER_ID}/content_publishing_limit`, {
          params: { fields: 'config,quota_usage' },
        })
      } catch { /* el cupo es informativo, si falla no importa */ }
      return res.status(200).json({ ok: true, cuenta, cupo: cupo?.data?.[0] || null })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
    if (!IG_USER_ID) return res.status(500).json({ error: 'falta INSTAGRAM_USER_ID' })

    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

    const caption = String(body?.caption || '').slice(0, 2200)
    const imagenes = Array.isArray(body?.imageUrls)
      ? body.imageUrls.filter(Boolean).slice(0, 10)
      : (body?.imageUrl ? [String(body.imageUrl)] : [])
    const videoUrl = body?.videoUrl ? String(body.videoUrl) : ''

    if (!imagenes.length && !videoUrl) {
      return res.status(400).json({ error: 'falta imageUrl, imageUrls o videoUrl' })
    }
    for (const u of imagenes.concat(videoUrl ? [videoUrl] : [])) {
      if (!/^https:\/\//i.test(u)) {
        return res.status(400).json({ error: 'las URLs tienen que ser https públicas — Meta va a buscar el archivo' })
      }
    }

    let creationId

    if (videoUrl) {
      // ── Reel ──
      const cont = await graph(`${IG_USER_ID}/media`, {
        method: 'POST',
        params: { media_type: 'REELS', video_url: videoUrl, caption },
      })
      creationId = cont.id
      await esperarContenedor(creationId)

    } else if (imagenes.length === 1) {
      // ── Foto sola ──
      const cont = await graph(`${IG_USER_ID}/media`, {
        method: 'POST',
        params: { image_url: imagenes[0], caption },
      })
      creationId = cont.id
      await esperarContenedor(creationId, 8)

    } else {
      // ── Carrusel ──
      const hijos = []
      for (const url of imagenes) {
        const h = await graph(`${IG_USER_ID}/media`, {
          method: 'POST',
          params: { image_url: url, is_carousel_item: 'true' },
        })
        hijos.push(h.id)
      }
      for (const h of hijos) await esperarContenedor(h, 8)

      const cont = await graph(`${IG_USER_ID}/media`, {
        method: 'POST',
        params: { media_type: 'CAROUSEL', children: hijos.join(','), caption },
      })
      creationId = cont.id
      await esperarContenedor(creationId, 8)
    }

    // ── Publicar ──
    const pub = await graph(`${IG_USER_ID}/media_publish`, {
      method: 'POST',
      params: { creation_id: creationId },
    })

    let permalink = null
    try {
      const info = await graph(pub.id, { params: { fields: 'permalink' } })
      permalink = info?.permalink || null
    } catch { /* si no viene el link no es motivo para fallar */ }

    // Dejar rastro de lo publicado (si la tabla existe)
    try {
      await fetch(`${SB_URL}/rest/v1/ig_publicaciones`, {
        method: 'POST',
        headers: { ...guard.svc, Prefer: 'return=minimal' },
        body: JSON.stringify({
          media_id: pub.id,
          permalink,
          tipo: videoUrl ? 'reel' : (imagenes.length > 1 ? 'carrusel' : 'foto'),
          caption,
          publicado_por: guard.uid,
        }),
      })
    } catch { /* el registro es opcional */ }

    return res.status(200).json({ ok: true, mediaId: pub.id, permalink })

  } catch (err) {
    console.error('instagram error', err?.message, err?.detalle || '')
    const status = err?.status && err.status >= 400 && err.status < 500 ? 400 : 502
    return res.status(status).json({
      error: String(err?.message || err),
      detalle: err?.detalle || null,
    })
  }
}
