// ═══════════════════════════════════════════════════════════
// WHATSAPP — Iris atiende el WhatsApp del negocio (Cloud API Meta)
// ═══════════════════════════════════════════════════════════
// FASE 1 (este archivo): recibe mensajes de clientes y responde con
// Iris (Gemini). Modo "auto con barreras": responde dudas generales
// con calidez; ante un PEDIDO/compra NO cierra la venta — toma lo que
// el cliente quiere y avisa que el equipo confirma. (El acceso a
// precios/stock reales y la notificación de pedidos llega en FASE 2.)
//
// Config (Vercel → Settings → Environment Variables):
//   WHATSAPP_TOKEN         (secreta — token de la app de WhatsApp/Meta)
//   WHATSAPP_VERIFY_TOKEN  (opcional — para verificar el webhook;
//                           default 'fabricius-iris-2026')
//   VITE_GEMINI_API_KEY    (ya existe — el cerebro de Iris)
//
// Meta exige responder 200 al webhook; si algo falla, igual devolvemos
// 200 (para que Meta no reintente en loop) y logueamos el error.
// ═══════════════════════════════════════════════════════════

export const config = { maxDuration: 30 }

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026'
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

const PROMPT_IRIS_WA = `Sos IRIS, la asistente de Carnicerías Fabricius (Río Primero, Córdoba), atendiendo el WhatsApp del negocio. Sos MUJER, cálida, simpática y profesional. Es un chat de WhatsApp: respondé BREVE (1-3 frases), en español argentino, sin tecnicismos, con alguna emoji si pinta 🥩.

REGLAS (modo "auto con barreras"):
- Dudas generales (horarios, si hacen envíos, formas de pago, dónde están, qué venden) → respondé con buena onda.
- Si preguntan un PRECIO o si hay STOCK de algo puntual y no estás 100% segura → NO inventes. Decí que enseguida te lo confirma alguien del equipo.
- Si el cliente quiere HACER UN PEDIDO o comprar (ej. "quiero 5 kg de asado para mañana") → tomá con amabilidad QUÉ quiere y para cuándo, y avisale que ya le pasás el pedido al equipo para confirmar disponibilidad y precio. NUNCA confirmes el total ni cierres la venta vos.
- Si saludan, saludá cálida y preguntá en qué ayudás.
- Sos la asistente del negocio (no escondas que sos una asistente si te preguntan), pero hablá natural, no robótica.`

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
    if (!texto || !from) return res.status(200).end()

    if (!WA_TOKEN) { console.error('Falta WHATSAPP_TOKEN'); return res.status(200).end() }

    const respuesta = await responderConIris(texto)
    await enviarWhatsApp(phoneId, from, respuesta)
    return res.status(200).end()
  } catch (err) {
    console.error('WhatsApp handler error:', err)
    return res.status(200).end() // 200 igual para que Meta no reintente en loop
  }
}

// Genera la respuesta de Iris con Gemini. Ante cualquier falla, devuelve
// un mensaje seguro para que el cliente nunca quede sin respuesta.
async function responderConIris(texto) {
  const fallback = '¡Hola! 🥩 Gracias por tu mensaje. En un ratito te responde alguien del equipo de Carnicerías Fabricius.'
  if (!GEMINI_KEY) return fallback
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    let r
    try {
      r = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: texto }] }],
          systemInstruction: { parts: [{ text: PROMPT_IRIS_WA }] },
          generationConfig: { temperature: 0.5, maxOutputTokens: 400 },
        }),
        signal: ctrl.signal,
      })
    } finally { clearTimeout(timer) }
    if (!r.ok) { console.error('Gemini WA', r.status); return fallback }
    const data = await r.json()
    const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    return out || fallback
  } catch (e) {
    console.error('Gemini WA error', e)
    return fallback
  }
}

// Argentina: WhatsApp ENTREGA el número entrante con un 9 tras el código de
// país (549XXXXXXXXXX), pero la Cloud API solo ENVÍA si se le quita ese 9
// (54XXXXXXXXXX). Sin esto el envío rebota con (#131030) "destinatario no
// permitido / inválido". Solo afecta a números argentinos (código 54).
function normalizarDestinoAR(numero) {
  return String(numero || '').replace(/^549(\d+)$/, '54$1')
}

// Envía un mensaje de texto al cliente por la Cloud API de Meta.
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
