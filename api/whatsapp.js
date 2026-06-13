// ═══════════════════════════════════════════════════════════
// WHATSAPP — Iris atiende el WhatsApp del negocio (Cloud API Meta)
// ═══════════════════════════════════════════════════════════
// FASE 2 (este archivo): Iris responde con PRECIOS y STOCK reales del
// sistema (consulta Supabase) y, ante un PEDIDO, lo registra en la bandeja
// `pedidos_whatsapp` y le avisa al dueño por WhatsApp. Modo "auto con
// barreras": NUNCA cierra la venta — toma la solicitud y la escala al equipo.
//
// Config (Vercel → Settings → Environment Variables):
//   WHATSAPP_TOKEN              (secreta — token de la Cloud API de Meta)
//   WHATSAPP_VERIFY_TOKEN       (opcional — verificación del webhook;
//                                default 'fabricius-iris-2026')
//   VITE_GEMINI_API_KEY         (ya existe — el cerebro de Iris)
//   VITE_SUPABASE_URL           (ya existe — URL del proyecto Supabase)
//   SUPABASE_SERVICE_ROLE_KEY   (NUEVA, secreta — lee precios/stock y
//                                registra pedidos saltando RLS; server-only)
//   WHATSAPP_AVISOS_TO          (NUEVA, opcional — número del dueño en formato
//                                internacional sin '+' p/ recibir avisos de
//                                pedidos, ej 543575400406; si falta, solo se
//                                guarda en la bandeja sin avisar)
//
// Meta exige responder 200 al webhook; si algo falla, igual devolvemos 200
// (para que Meta no reintente en loop) y logueamos el error. Toda la parte
// de precios/stock/pedidos degrada con gracia: si falta una env var o falla
// una consulta, Iris sigue respondiendo (como en Fase 1).
// ═══════════════════════════════════════════════════════════

export const config = { maxDuration: 30 }

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026'
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AVISOS_TO = process.env.WHATSAPP_AVISOS_TO
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// Categorías que SÍ se le muestran al público por WhatsApp. Se excluyen las
// mayoristas/internas (insumos, medias reses, cajas y cajones).
const CATEGORIAS_PUBLICAS = [
  'bovino_corte', 'bovino_brosa', 'bovino_pieza',
  'cerdo_corte', 'cerdo_pieza', 'embutido',
  'pollo', 'rebozado', 'almacen', 'bebidas',
]

const PROMPT_BASE = `Sos IRIS, la asistente de Carnicerías Fabricius (Río Primero, Córdoba), atendiendo el WhatsApp del negocio. Sos MUJER, cálida, simpática y profesional. Es un chat de WhatsApp: respondé BREVE (1-3 frases), en español argentino, sin tecnicismos, con alguna emoji si pinta 🥩.

REGLAS (modo "auto con barreras"):
- Para PRECIOS y STOCK usá SOLO los datos de la sección "DATOS DEL NEGOCIO" de abajo. Son precios al público (minorista). NUNCA inventes un precio ni un stock que no esté en esa lista.
- Si te preguntan por algo que NO está en la lista, decí con amabilidad que enseguida te lo confirma alguien del equipo (no inventes).
- El stock es orientativo; si preguntan por una cantidad grande o puntual, aclará que el equipo confirma disponibilidad.
- Dudas generales (horarios, envíos, formas de pago, dónde están) → respondé con buena onda.
- Si el cliente quiere HACER UN PEDIDO o encargar algo (ej. "quiero 5 kg de asado para mañana") → tomá con amabilidad QUÉ quiere y para cuándo, decile que ya le pasás el pedido al equipo para confirmar disponibilidad y precio final, y marcá es_pedido=true con un resumen claro. NUNCA confirmes el total ni cierres la venta vos.
- Si saludan, saludá cálida y preguntá en qué ayudás.
- Sos la asistente del negocio (no lo escondas si te preguntan), pero hablá natural, no robótica.

Respondé SIEMPRE en el formato JSON pedido: "respuesta" (lo que le mandás al cliente), "es_pedido" (true solo si está encargando algo concreto) y "resumen_pedido" (qué pidió y para cuándo, vacío si no es pedido).`

// Esquema de salida estructurada: una sola llamada a Gemini nos da el texto
// para el cliente + si es un pedido + el resumen, sin round-trips extra.
const SCHEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    es_pedido: { type: 'boolean' },
    resumen_pedido: { type: 'string' },
  },
  required: ['respuesta', 'es_pedido'],
}

export default async function handler(req, res) {
  // ── Verificación del webhook (Meta hace un GET al configurarlo) ──
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).send('forbidden')
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  try {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

    const value = body?.entry?.[0]?.changes?.[0]?.value
    const msg = value?.messages?.[0]
    const phoneId = value?.metadata?.phone_number_id

    // Solo procesamos mensajes de texto entrantes; lo demás (estados de
    // entrega, etc.) se ignora respondiendo 200.
    if (!msg || msg.type !== 'text' || !phoneId) return res.status(200).end()

    const texto = (msg.text?.body || '').trim()
    const from = msg.from
    const nombreContacto = value?.contacts?.[0]?.profile?.name || null
    if (!texto || !from) return res.status(200).end()

    if (!WA_TOKEN) { console.error('Falta WHATSAPP_TOKEN'); return res.status(200).end() }

    // Datos reales del negocio (precios + stock). Si falla, queda vacío y
    // Iris responde igual derivando al equipo.
    const datosNegocio = await traerDatosNegocio()

    const ia = await responderConIris(texto, datosNegocio)
    await enviarWhatsApp(phoneId, from, ia.respuesta)

    // Si el cliente está encargando algo, lo registramos y avisamos al dueño.
    // Va aparte para que un fallo acá nunca corte la respuesta al cliente.
    if (ia.es_pedido) {
      try {
        await registrarPedido({ telefono: from, nombreContacto, mensaje: texto, resumen: ia.resumen_pedido })
        await avisarAlDueno(phoneId, { nombreContacto, telefono: from, resumen: ia.resumen_pedido, mensaje: texto })
      } catch (e) { console.error('Registro/aviso pedido WA error', e) }
    }

    return res.status(200).end()
  } catch (err) {
    console.error('WhatsApp handler error:', err)
    return res.status(200).end() // 200 igual para que Meta no reintente en loop
  }
}

// ── Datos del negocio (Supabase, service_role → saltea RLS) ──────────────
// Devuelve un texto listo para inyectar al prompt. Ante cualquier falla
// devuelve '' (Iris responde sin precios, como en Fase 1).
async function traerDatosNegocio() {
  if (!SB_URL || !SB_KEY) return ''
  try {
    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    const inCats = `(${CATEGORIAS_PUBLICAS.join(',')})`
    const [precios, stock] = await Promise.all([
      sbGet(`precios?select=nombre,categoria,precio_minorista&precio_minorista=not.is.null&categoria=in.${inCats}&order=categoria,nombre`, headers),
      sbGet('stock_actual?select=tipo,kg_disponible', headers),
    ])

    const listaPrecios = (precios || [])
      .filter(p => p.nombre && Number(p.precio_minorista) > 0)
      .map(p => `- ${p.nombre.trim()}: ${formatearPesos(p.precio_minorista)}`)
      .join('\n')

    const lineasStock = (stock || [])
      .filter(s => Number(s.kg_disponible) > 0)
      .map(s => `- ${s.tipo}: ${Math.round(Number(s.kg_disponible))} kg`)
      .join('\n')

    let out = ''
    if (listaPrecios) out += `PRECIOS AL PÚBLICO (por kg salvo que el nombre diga lo contrario):\n${listaPrecios}\n`
    if (lineasStock) out += `\nSTOCK ORIENTATIVO disponible hoy:\n${lineasStock}\n`
    return out
  } catch (e) {
    console.error('traerDatosNegocio error', e)
    return ''
  }
}

async function sbGet(path, headers) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers })
  if (!r.ok) throw new Error(`Supabase GET ${r.status} ${path}`)
  return r.json()
}

// ── Cerebro de Iris (Gemini con salida estructurada) ─────────────────────
// Ante cualquier falla devuelve una respuesta segura para que el cliente
// nunca quede sin contestación.
async function responderConIris(texto, datosNegocio) {
  const fallback = {
    respuesta: '¡Hola! 🥩 Gracias por tu mensaje. En un ratito te responde alguien del equipo de Carnicerías Fabricius.',
    es_pedido: false,
    resumen_pedido: '',
  }
  if (!GEMINI_KEY) return fallback

  const systemText = datosNegocio
    ? `${PROMPT_BASE}\n\n=== DATOS DEL NEGOCIO (usar SOLO esto para precios/stock) ===\n${datosNegocio}`
    : `${PROMPT_BASE}\n\n(No tengo la lista de precios cargada en este momento: para precios/stock puntuales, derivá al equipo con amabilidad.)`

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 22000)
    let r
    try {
      r = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: texto }] }],
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 600,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA_RESPUESTA,
          },
        }),
        signal: ctrl.signal,
      })
    } finally { clearTimeout(timer) }
    if (!r.ok) { console.error('Gemini WA', r.status); return fallback }
    const data = await r.json()
    const raw = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!raw) return fallback
    let parsed
    try { parsed = JSON.parse(raw) } catch { return { ...fallback, respuesta: raw } }
    return {
      respuesta: (parsed.respuesta || '').trim() || fallback.respuesta,
      es_pedido: parsed.es_pedido === true,
      resumen_pedido: (parsed.resumen_pedido || '').trim(),
    }
  } catch (e) {
    console.error('Gemini WA error', e)
    return fallback
  }
}

// ── Registro del pedido en la bandeja (Supabase) ─────────────────────────
async function registrarPedido({ telefono, nombreContacto, mensaje, resumen }) {
  if (!SB_URL || !SB_KEY) return
  const r = await fetch(`${SB_URL}/rest/v1/pedidos_whatsapp`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      telefono,
      nombre_contacto: nombreContacto,
      mensaje_cliente: mensaje,
      resumen_pedido: resumen || null,
    }),
  })
  if (!r.ok) console.error('Registrar pedido WA', r.status, await r.text().catch(() => ''))
}

// ── Aviso al dueño por WhatsApp ──────────────────────────────────────────
async function avisarAlDueno(phoneId, { nombreContacto, telefono, resumen, mensaje }) {
  if (!AVISOS_TO) return
  const quien = nombreContacto ? `${nombreContacto} (${telefono})` : telefono
  const aviso = `🛎️ *Nuevo pedido por WhatsApp*\n\n👤 ${quien}\n📝 ${resumen || mensaje}\n\n💬 Dijo: "${mensaje}"\n\nRevisalo en el sistema para confirmarlo.`
  await enviarWhatsApp(phoneId, AVISOS_TO, aviso)
}

// ── Envío por la Cloud API de Meta ───────────────────────────────────────
// Argentina: WhatsApp ENTREGA el número entrante con un 9 tras el código de
// país (549XXXXXXXXXX), pero la Cloud API solo ENVÍA si se le quita ese 9
// (54XXXXXXXXXX). Sin esto el envío rebota con (#131030) "destinatario no
// permitido / inválido". Solo afecta a números argentinos (código 54).
function normalizarDestinoAR(numero) {
  return String(numero || '').replace(/^549(\d+)$/, '54$1')
}

async function enviarWhatsApp(phoneId, to, texto) {
  const destino = normalizarDestinoAR(to)
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'text',
      text: { body: String(texto).slice(0, 4000) },
    }),
  })
  if (!r.ok) console.error('Envío WhatsApp', r.status, await r.text().catch(() => ''))
}

// Formatea un número como pesos argentinos ($ 12.345).
function formatearPesos(n) {
  const v = Math.round(Number(n) || 0)
  return '$ ' + v.toLocaleString('es-AR')
}
