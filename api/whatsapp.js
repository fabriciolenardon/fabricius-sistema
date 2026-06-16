// ═══════════════════════════════════════════════════════════
// WHATSAPP — Iris atiende el WhatsApp del negocio (Cloud API Meta)
// ═══════════════════════════════════════════════════════════
// FASE 3: además de responder con precios/stock reales y registrar pedidos,
// GUARDA toda la conversación (wa_mensajes/wa_contactos) para verla en vivo
// en el panel "Conversaciones", respeta la PAUSA por contacto (cuando un
// humano atiende, Iris se calla), da un acuse y deriva ante avisos de PAGO,
// usa la CONFIG editable del negocio (wa_config) e ignora los comprobantes
// (imágenes/PDF) sin responder.
//
// Config (Vercel → Settings → Environment Variables):
//   WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN (opc), VITE_GEMINI_API_KEY,
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_AVISOS_TO (opc)
//
// Siempre responde 200 (para que Meta no reintente). Todo degrada con gracia.
// ═══════════════════════════════════════════════════════════

export const config = { maxDuration: 30 }

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026'
const GEMINI_KEY = process.env.VITE_GEMINI_API_KEY
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AVISOS_TO = process.env.WHATSAPP_AVISOS_TO
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

const CATEGORIAS_PUBLICAS = [
  'bovino_corte', 'bovino_brosa', 'bovino_pieza',
  'cerdo_corte', 'cerdo_pieza', 'embutido',
  'pollo', 'rebozado', 'almacen', 'bebidas',
]

const ACUSE_PAGO = '¡Gracias! 🙌 Ya le aviso al equipo para que verifique tu pago. En un ratito te confirman. 🥩'

const PROMPT_BASE = `Sos IRIS, la asistente de Carnicerías Fabricius (Río Primero, Córdoba), atendiendo el WhatsApp del negocio. Sos MUJER, cálida, simpática y profesional. Es un chat de WhatsApp: respondé BREVE (1-3 frases), en español argentino, sin tecnicismos, con alguna emoji si pinta 🥩.

REGLAS (modo "auto con barreras"):
- Para PRECIOS y STOCK usá SOLO los datos de la sección "DATOS DEL NEGOCIO". Son precios al público (minorista). NUNCA inventes un precio ni un stock que no esté en esa lista.
- Para horarios, dirección, formas de pago y envíos usá la sección "INFORMACIÓN DEL NEGOCIO" si está cargada. Si te preguntan algo que no está, derivá con amabilidad al equipo (no inventes).
- El stock es orientativo; si preguntan por una cantidad grande o puntual, aclará que el equipo confirma disponibilidad.
- Si el cliente quiere HACER UN PEDIDO o encargar algo → tomá QUÉ quiere y para cuándo, y marcá es_pedido=true con un resumen claro. NUNCA confirmes el total ni cierres la venta vos.
- PEDIDOS — CONFIRMÁ ANTES DE PASARLO: cuando el cliente arma un pedido, NO lo des por cerrado de una. Repetile en una línea lo que entendiste y preguntale si quiere agregar algo más o se lo dejás así (ej: "Te anoto 2 kg de milanesa para mañana. ¿Querés sumar algo más o te lo dejo así? 🥩"). Mantené pedido_confirmado=false mientras siga agregando o no haya confirmado. SOLO cuando el cliente confirma que está completo (dice "así está", "nada más", "dale", "listo", "eso es todo", etc.) ponés pedido_confirmado=true y recién ahí le decís que ya le pasás el pedido al equipo para confirmar disponibilidad y precio final. Si el cliente ya deja claro de entrada que es todo, podés confirmar directo.
- SEGUIMIENTO DE UN PEDIDO YA HECHO: si el cliente pregunta si su pedido está listo, te pide que le avises, o hace referencia a un encargo que YA hizo antes (ej "me podrás avisar?", "está la carne?", "sobre eso") → buscá ese pedido en el HISTORIAL y recordáselo al equipo: re-confirmá QUÉ pidió y PARA CUÁNDO, ajustando las fechas relativas a HOY según las marcas de tiempo del historial. Ej: si AYER pidió "para esta tarde o mañana temprano", hoy eso es "para ayer a la tarde o hoy temprano". Tranquilizá al cliente: "Perfecto, ya le recuerdo tu pedido al equipo de … para retirar … Ellos se contactarán para confirmar disponibilidad y el precio final. ¡Gracias! 😊". NO inventes un pedido si en el historial no hay ninguno; en ese caso pedí amablemente que te diga qué encargó.
- Si saludan, saludá cálida y preguntá en qué ayudás.
- Sos la asistente del negocio (no lo escondas si te preguntan), pero hablá natural, no robótica.

Respondé SIEMPRE en el formato JSON pedido: "respuesta", "es_pedido" (true si está armando/encargando algo concreto), "resumen_pedido" (qué pidió y para cuándo, vacío si no es pedido) y "pedido_confirmado" (true SOLO cuando el cliente confirmó que el pedido está completo; false mientras todavía lo está armando o no confirmó).`

const SCHEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    es_pedido: { type: 'boolean' },
    resumen_pedido: { type: 'string' },
    pedido_confirmado: { type: 'boolean' },
  },
  required: ['respuesta', 'es_pedido'],
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge)
    return res.status(403).send('forbidden')
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  try {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

    const value = body?.entry?.[0]?.changes?.[0]?.value
    const msg = value?.messages?.[0]
    const phoneId = value?.metadata?.phone_number_id
    if (!msg || !phoneId) return res.status(200).end()

    const from = msg.from
    const nombreContacto = value?.contacts?.[0]?.profile?.name || null
    if (!from) return res.status(200).end()

    if (!WA_TOKEN) { console.error('Falta WHATSAPP_TOKEN'); return res.status(200).end() }

    // Guardamos el phone_id del negocio para que el envío manual del panel lo use.
    setConfig('phone_id', phoneId)

    // Texto a mostrar / procesar según el tipo de mensaje.
    const tipo = msg.type === 'text' ? 'text'
      : (msg.type === 'image' ? 'image' : (msg.type === 'document' ? 'document' : (msg.type === 'audio' || msg.type === 'voice' ? 'audio' : 'other')))
    const texto = (msg.text?.body || '').trim()
    const textoMostrable = tipo === 'text' ? texto
      : (msg[msg.type]?.caption ? `${etiquetaTipo(tipo)} ${msg[msg.type].caption}` : etiquetaTipo(tipo))

    // Estado previo del contacto (para saber si Iris está pausada y el conteo).
    const contacto = await getContacto(from)
    const pausada = contacto?.iris_pausada === true

    // Persistimos el mensaje entrante y actualizamos el contacto (siempre,
    // aunque Iris no responda — así el panel ve TODO lo que entra).
    await guardarMensaje(from, 'in', 'cliente', tipo, textoMostrable)
    await upsertContacto(from, nombreContacto, textoMostrable, contacto)

    // Comprobantes (imágenes/PDF/audio) → NO se responden. Quedan en el panel.
    if (tipo !== 'text' || !texto) return res.status(200).end()

    // Si un humano tomó el control de este chat, Iris no responde.
    if (pausada) return res.status(200).end()

    // Sorteo vigente (wa_config.sorteo_contacto). Cuando está cargado: (1) las
    // consultas EXPLÍCITAS del sorteo/rifa/comprar número se derivan acá directo al
    // encargado; (2) además le pasamos a Iris que hay un sorteo, para que entienda
    // frases ambiguas ("el número 89", "guardame") y derive sola. Cuando el sorteo
    // termina se borra esa clave y todo vuelve a la normalidad, sin tocar código.
    const sorteo = await getConfigValor('sorteo_contacto')
    if (sorteo && esMensajeSorteo(texto)) {  // va ANTES del pago: aunque mencionen pagar, es tema del encargado
      const msg = `¡Hola! 🎉 Para el sorteo de la media res escribile directamente a ${sorteo}, que es quien lo maneja y te pasa todos los datos para participar. ¡Mucha suerte! 🥩`
      await enviarWhatsApp(phoneId, from, msg)
      await guardarMensaje(from, 'out', 'iris', 'text', msg)
      return res.status(200).end()
    }

    // Aviso de pago/transferencia por texto → acuse y derivar (no flujo normal).
    if (esMensajePago(texto)) {
      await enviarWhatsApp(phoneId, from, ACUSE_PAGO)
      await guardarMensaje(from, 'out', 'iris', 'text', ACUSE_PAGO)
      return res.status(200).end()
    }

    // Flujo normal: precios/stock + info editable → respuesta de Iris.
    // Traemos también el HISTORIAL del chat para que Iris tenga contexto (no
    // re-salude en cada mensaje y siga el hilo del pedido). El mensaje entrante
    // ya quedó guardado arriba, así que es el último turno del cliente.
    const [datosNegocio, infoNegocio, historial] = await Promise.all([
      traerDatosNegocio(), traerConfigNegocio(), traerHistorial(from),
    ])
    const ia = await responderConIris(historial, texto, datosNegocio, infoNegocio, sorteo)
    await enviarWhatsApp(phoneId, from, ia.respuesta)
    await guardarMensaje(from, 'out', 'iris', 'text', ia.respuesta)

    // Registramos el pedido SOLO cuando el cliente lo confirmó (pidió que se lo
    // deje así). Mientras lo está armando, Iris pregunta "¿algo más?" y no se pasa
    // nada al equipo todavía → no llegan pedidos a medias.
    if (ia.pedido_confirmado) {
      try {
        // registrarPedido consolida los turnos del mismo encargo en UNA fila.
        // Solo avisamos al dueño cuando es un pedido NUEVO (no en cada refinada),
        // así no le llega una notificación por cada mensaje del cliente.
        const esNuevoPedido = await registrarPedido({ telefono: from, nombreContacto, mensaje: texto, resumen: ia.resumen_pedido })
        if (esNuevoPedido) {
          await avisarAlDueno(phoneId, { nombreContacto, telefono: from, resumen: ia.resumen_pedido, mensaje: texto })
          // Notificación push a los dispositivos suscritos (además del WhatsApp).
          try {
            await fetch(`https://${req.headers.host}/api/enviar-push?secret=${VERIFY_TOKEN}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ titulo: '🛎️ Nuevo pedido por WhatsApp', body: `${nombreContacto || from}: ${ia.resumen_pedido || texto}`, url: '/admin/whatsapp' }),
            })
          } catch {}
        }
      } catch (e) { console.error('Registro/aviso pedido WA error', e) }
    }

    return res.status(200).end()
  } catch (err) {
    console.error('WhatsApp handler error:', err)
    return res.status(200).end()
  }
}

function etiquetaTipo(tipo) {
  if (tipo === 'image') return '📷 [imagen / comprobante]'
  if (tipo === 'document') return '📄 [documento / comprobante]'
  if (tipo === 'audio') return '🎤 [audio]'
  return '📎 [adjunto]'
}

// Detecta avisos de pago/transferencia en texto (sin acentos, minúsculas).
function esMensajePago(texto) {
  const t = String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /(transfer|deposit|comprobante|ya pague|ya abone|ya pagu|\bsena\b|te pase|le pase|abone el|pague el|hice el deposito|mando el comp|paso el comp)/.test(t)
}

// Detecta consultas sobre el sorteo/rifa (para derivar al encargado). 'sorteo'
// y 'rifa' son inequívocos; "comprar/sacar/participar/anotar + número" es la
// otra forma típica. Evitamos el 'numero' suelto (muy ambiguo).
function esMensajeSorteo(texto) {
  const t = String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /(\bsorte\w*|\brif[ao]\w*)/.test(t)
    || /(comprar|sacar|saco|saca|participa|anota|anoto|reserva|guarda)\w*.{0,15}(numero|numeros|nro|numerito|numeritos)/.test(t)
    || /(numero|numeros|nro).{0,15}(sorteo|rifa|media res)/.test(t)
    || /\b(numero|nro)\s+\d{1,4}\b/.test(t)
}

// ── Supabase REST (service_role → saltea RLS) ────────────────────────────
function sbHeaders(extra = {}) {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...extra }
}
async function sbGet(path, headers) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers })
  if (!r.ok) throw new Error(`Supabase GET ${r.status} ${path}`)
  return r.json()
}

// Lee una sola clave de wa_config (string vacío si no existe o falla).
async function getConfigValor(clave) {
  if (!SB_URL || !SB_KEY) return ''
  try {
    const rows = await sbGet(`wa_config?clave=eq.${encodeURIComponent(clave)}&select=valor`, sbHeaders())
    return (rows?.[0]?.valor || '').trim()
  } catch (e) { console.error('getConfigValor', e); return '' }
}

async function getContacto(telefono) {
  if (!SB_URL || !SB_KEY) return null
  try {
    const rows = await sbGet(`wa_contactos?telefono=eq.${encodeURIComponent(telefono)}&select=*`, sbHeaders())
    return rows?.[0] || null
  } catch (e) { console.error('getContacto', e); return null }
}

async function guardarMensaje(telefono, direccion, autor, tipo, texto) {
  if (!SB_URL || !SB_KEY) return
  try {
    await fetch(`${SB_URL}/rest/v1/wa_mensajes`, {
      method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ telefono, direccion, autor, tipo, texto }),
    })
  } catch (e) { console.error('guardarMensaje', e) }
}

async function upsertContacto(telefono, nombre, ultimoMensaje, contactoPrevio) {
  if (!SB_URL || !SB_KEY) return
  try {
    if (contactoPrevio) {
      await fetch(`${SB_URL}/rest/v1/wa_contactos?telefono=eq.${encodeURIComponent(telefono)}`, {
        method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          nombre: nombre || contactoPrevio.nombre,
          ultimo_mensaje: ultimoMensaje,
          ultimo_at: new Date().toISOString(),
          no_leidos: (contactoPrevio.no_leidos || 0) + 1,
        }),
      })
    } else {
      await fetch(`${SB_URL}/rest/v1/wa_contactos`, {
        method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ telefono, nombre, ultimo_mensaje: ultimoMensaje, ultimo_at: new Date().toISOString(), no_leidos: 1 }),
      })
    }
  } catch (e) { console.error('upsertContacto', e) }
}

// Upsert de una clave de wa_config (sin await crítico).
function setConfig(clave, valor) {
  if (!SB_URL || !SB_KEY) return
  fetch(`${SB_URL}/rest/v1/wa_config?on_conflict=clave`, {
    method: 'POST', headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ clave, valor, updated_at: new Date().toISOString() }),
  }).catch(() => {})
}

// Info editable del negocio (la carga el admin en el panel).
async function traerConfigNegocio() {
  if (!SB_URL || !SB_KEY) return ''
  try {
    const rows = await sbGet('wa_config?select=clave,valor', sbHeaders())
    const c = {}; (rows || []).forEach(r => { if (r.valor) c[r.clave] = r.valor })
    const L = []
    if (c.horarios) L.push(`Horarios: ${c.horarios}`)
    if (c.direccion) L.push(`Dirección: ${c.direccion}`)
    if (c.formas_pago) L.push(`Formas de pago: ${c.formas_pago}`)
    if (c.envios) L.push(`Envíos: ${c.envios}`)
    if (c.instrucciones_extra) L.push(c.instrucciones_extra)
    return L.join('\n')
  } catch (e) { console.error('traerConfigNegocio', e); return '' }
}

// ── Datos del negocio (precios + stock) ──────────────────────────────────
async function traerDatosNegocio() {
  if (!SB_URL || !SB_KEY) return ''
  try {
    const inCats = `(${CATEGORIAS_PUBLICAS.join(',')})`
    const [precios, stock] = await Promise.all([
      sbGet(`precios?select=nombre,categoria,precio_minorista&precio_minorista=not.is.null&categoria=in.${inCats}&order=categoria,nombre`, sbHeaders()),
      sbGet('stock_actual?select=tipo,kg_disponible', sbHeaders()),
    ])
    const listaPrecios = (precios || [])
      .filter(p => p.nombre && Number(p.precio_minorista) > 0)
      .map(p => `- ${p.nombre.trim()}: ${formatearPesos(p.precio_minorista)}`).join('\n')
    const lineasStock = (stock || [])
      .filter(s => Number(s.kg_disponible) > 0)
      .map(s => `- ${s.tipo}: ${Math.round(Number(s.kg_disponible))} kg`).join('\n')
    let out = ''
    if (listaPrecios) out += `PRECIOS AL PÚBLICO (por kg salvo que el nombre diga lo contrario):\n${listaPrecios}\n`
    if (lineasStock) out += `\nSTOCK ORIENTATIVO disponible hoy:\n${lineasStock}\n`
    return out
  } catch (e) { console.error('traerDatosNegocio error', e); return '' }
}

// Historial del chat como `contents` de Gemini, para que Iris tenga contexto
// (no re-salude ni pierda el hilo). Trae los últimos mensajes de texto, los
// ordena cronológicamente, mapea cliente→'user' / Iris+humano→'model' y mergea
// turnos consecutivos del mismo lado (Gemini espera roles alternados y arrancar
// en 'user'). El mensaje entrante actual ya está guardado → queda de último.
// Fecha/hora actual en Argentina, legible (ej "lunes, 16 de junio de 2026, 10:21").
function fechaHoraARG() {
  try {
    return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  } catch { return '' }
}

// Marca de tiempo relativa de un mensaje: "hoy 13:52" / "ayer 09:46" / "14/06 10:00".
// Sirve para que Iris ubique cuándo pasó cada cosa y re-ancle las fechas relativas.
function etiquetaTiempo(iso) {
  if (!iso) return ''
  try {
    const tz = 'America/Argentina/Buenos_Aires'
    const tieneTZ = /(Z|[+\-]\d{2}:?\d{2})$/.test(String(iso).trim())
    const d = new Date(tieneTZ ? iso : String(iso).replace(' ', 'T') + 'Z')
    const dia = x => new Intl.DateTimeFormat('es-AR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(x)
    const hora = new Intl.DateTimeFormat('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    const hoy = dia(new Date())
    const ayer = dia(new Date(Date.now() - 86400000))
    const dDia = dia(d)
    if (dDia === hoy) return `hoy ${hora}`
    if (dDia === ayer) return `ayer ${hora}`
    return `${dDia.slice(0, 5)} ${hora}`
  } catch { return '' }
}

async function traerHistorial(telefono) {
  if (!SB_URL || !SB_KEY) return null
  try {
    const rows = await sbGet(
      `wa_mensajes?telefono=eq.${encodeURIComponent(telefono)}&tipo=eq.text&order=created_at.desc&limit=14&select=direccion,texto,created_at`,
      sbHeaders()
    )
    const ordenados = (rows || []).reverse()
    const contents = []
    for (const m of ordenados) {
      const t = (m.texto || '').trim()
      if (!t) continue
      const role = m.direccion === 'in' ? 'user' : 'model'
      // Prefijo con la marca de tiempo (hoy/ayer/fecha) para que Iris ubique
      // cuándo se dijo cada cosa y re-ancle "hoy/mañana" al día actual.
      const linea = `[${etiquetaTiempo(m.created_at)}] ${t}`
      const last = contents[contents.length - 1]
      if (last && last.role === role) last.parts[0].text += '\n' + linea
      else contents.push({ role, parts: [{ text: linea }] })
    }
    while (contents.length && contents[0].role !== 'user') contents.shift()
    return contents.length ? contents : null
  } catch (e) { console.error('traerHistorial', e); return null }
}

// ── Cerebro de Iris (Gemini, salida estructurada) ────────────────────────
async function responderConIris(historial, textoActual, datosNegocio, infoNegocio, sorteo) {
  const fallback = { respuesta: '¡Hola! 🥩 Gracias por tu mensaje. En un ratito te responde alguien del equipo de Carnicerías Fabricius.', es_pedido: false, resumen_pedido: '', pedido_confirmado: false }
  if (!GEMINI_KEY) return fallback
  // Si no hay historial (o falló), usamos solo el mensaje actual.
  const contents = (Array.isArray(historial) && historial.length)
    ? historial
    : [{ role: 'user', parts: [{ text: textoActual }] }]

  let systemText = PROMPT_BASE
  systemText += `\n\n=== FECHA Y HORA AHORA ===\nAhora es ${fechaHoraARG()} (hora de Argentina). Usá esto para interpretar "hoy", "ayer", "mañana", "esta tarde", "temprano", etc. En el HISTORIAL cada mensaje arranca con su marca de tiempo entre corchetes (ej "[ayer 13:52]", "[hoy 09:46]") — usala para saber CUÁNDO se dijo cada cosa y re-anclar las fechas al día de hoy, pero NUNCA copies esa marca en tu respuesta.`
  if (sorteo) systemText += `\n\n=== SORTEO VIGENTE ===\nHay un SORTEO/RIFA de una media res que maneja ${sorteo} (NO el equipo de la carnicería). Si el cliente menciona el sorteo, la rifa, o quiere comprar/guardar/reservar un NÚMERO (ej. "el número 89", "guardame uno", "cuánto sale el número"), NO lo tomes vos como pedido ni preguntes qué quiere encargar: derivalo con amabilidad a ${sorteo}, que es quien maneja el sorteo y le pasa los datos para participar. En ese caso es_pedido=false.`
  if (infoNegocio) systemText += `\n\n=== INFORMACIÓN DEL NEGOCIO (horarios/dirección/pagos/envíos) ===\n${infoNegocio}`
  systemText += datosNegocio
    ? `\n\n=== DATOS DEL NEGOCIO (usar SOLO esto para precios/stock) ===\n${datosNegocio}`
    : `\n\n(No tengo la lista de precios cargada ahora: para precios/stock puntuales, derivá al equipo con amabilidad.)`

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 22000)
    let r
    try {
      r = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemText }] },
          // thinkingBudget:0 desactiva el "pensamiento" de gemini-2.5-flash. Sin
          // esto, los tokens de thinking se comían el presupuesto de salida y en
          // mensajes que requieren razonar (tomar un pedido) Gemini devolvía
          // contenido VACÍO → caíamos al fallback "en un ratito te responde
          // alguien" (bug 15/06: Iris no tomó el pedido y re-saludaba).
          generationConfig: { temperature: 0.4, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', responseSchema: SCHEMA_RESPUESTA },
        }),
        signal: ctrl.signal,
      })
    } finally { clearTimeout(timer) }
    if (!r.ok) { console.error('Gemini WA', r.status, (await r.text().catch(() => '')).slice(0, 300)); return fallback }
    const data = await r.json()
    const cand = data.candidates?.[0]
    const raw = (cand?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!raw) { console.error('Gemini WA vacío — finishReason:', cand?.finishReason, 'block:', data.promptFeedback?.blockReason); return fallback }
    let parsed
    try { parsed = JSON.parse(raw) } catch { return { ...fallback, respuesta: raw } }
    return {
      respuesta: (parsed.respuesta || '').trim() || fallback.respuesta,
      es_pedido: parsed.es_pedido === true,
      resumen_pedido: (parsed.resumen_pedido || '').trim(),
      pedido_confirmado: parsed.pedido_confirmado === true,
    }
  } catch (e) { console.error('Gemini WA error', e); return fallback }
}

// ── Registro del pedido + aviso al dueño ─────────────────────────────────
// Devuelve true si creó un pedido NUEVO, false si actualizó uno existente (o falló).
// Consolidación: Iris marca es_pedido=true en cada mensaje del encargo (más ahora
// que tiene historial), y Meta puede reintentar el webhook → antes eso creaba
// VARIAS filas del mismo pedido. Ahora, si ya hay un pedido 'nuevo' de este
// teléfono de hace menos de 6h, lo ACTUALIZAMOS (el último resumen manda) en vez
// de duplicar. El estado 'nuevo' es la ventana: una vez atendido/descartado, un
// mensaje posterior abre un pedido fresco (es otro encargo).
async function registrarPedido({ telefono, nombreContacto, mensaje, resumen }) {
  if (!SB_URL || !SB_KEY) return false
  const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
  let existente = null
  try {
    const rows = await sbGet(
      `pedidos_whatsapp?telefono=eq.${encodeURIComponent(telefono)}&estado=eq.nuevo&created_at=gt.${encodeURIComponent(desde)}&order=created_at.desc&limit=1&select=id`,
      sbHeaders()
    )
    existente = rows?.[0] || null
  } catch (e) { console.error('buscar pedido WA existente', e) }

  if (existente?.id) {
    const upd = { mensaje_cliente: mensaje, resumen_pedido: resumen || null }
    if (nombreContacto) upd.nombre_contacto = nombreContacto
    const r = await fetch(`${SB_URL}/rest/v1/pedidos_whatsapp?id=eq.${existente.id}`, {
      method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(upd),
    })
    if (!r.ok) console.error('Actualizar pedido WA', r.status, await r.text().catch(() => ''))
    return false
  }

  const r = await fetch(`${SB_URL}/rest/v1/pedidos_whatsapp`, {
    method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ telefono, nombre_contacto: nombreContacto, mensaje_cliente: mensaje, resumen_pedido: resumen || null }),
  })
  if (!r.ok) { console.error('Registrar pedido WA', r.status, await r.text().catch(() => '')); return false }
  return true
}

async function avisarAlDueno(phoneId, { nombreContacto, telefono, resumen, mensaje }) {
  if (!AVISOS_TO) return
  const quien = nombreContacto ? `${nombreContacto} (${telefono})` : telefono
  const aviso = `🛎️ *Nuevo pedido por WhatsApp*\n\n👤 ${quien}\n📝 ${resumen || mensaje}\n\n💬 Dijo: "${mensaje}"\n\nRevisalo en el sistema para confirmarlo.`
  await enviarWhatsApp(phoneId, AVISOS_TO, aviso)
}

// ── Envío por la Cloud API ───────────────────────────────────────────────
// Argentina: WhatsApp ENTREGA el número con un 9 tras el código de país
// (549...), pero la API solo ENVÍA si se le quita (54...). Sin esto rebota
// con (#131030). Solo afecta a números argentinos.
function normalizarDestinoAR(numero) {
  return String(numero || '').replace(/^549(\d+)$/, '54$1')
}
async function enviarWhatsApp(phoneId, to, texto) {
  const destino = normalizarDestinoAR(to)
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: String(texto).slice(0, 4000) } }),
  })
  if (!r.ok) console.error('Envío WhatsApp', r.status, await r.text().catch(() => ''))
}

function formatearPesos(n) {
  const v = Math.round(Number(n) || 0)
  return '$ ' + v.toLocaleString('es-AR')
}
