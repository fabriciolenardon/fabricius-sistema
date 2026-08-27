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

// Pedido de CBU/alias → Iris NUNCA da datos bancarios (el 27/08 inventó un
// alias y un CBU que no existen). Respuesta fija + aviso al equipo.
const ACUSE_DATOS_BANCARIOS = '¡Ya le consulto al equipo a qué alias te conviene transferir y te lo pasamos a la brevedad! 🙌'

// Presentación: lo PRIMERO que manda Iris cuando le escribe un número nuevo.
// Se presenta y deriva mayorista (otro número) vs minorista (este chat).
const PRESENTACION = `¡Hola! Me llamo Iris, soy asistente de IA 🤖. ¿En qué puedo ayudarte?

🛒 Para pedidos y precios *mayoristas*, escribí al *3861431971*.
🥩 Para pedidos y consultas *minoristas*, ¡por acá nomás!`

const PROMPT_BASE = `Sos IRIS, la asistente de Carnicerías Fabricius (Río Primero, Córdoba), atendiendo el WhatsApp del negocio. Sos MUJER, cálida, simpática y profesional. Es un chat de WhatsApp: respondé BREVE (1-3 frases), en español argentino, sin tecnicismos, con alguna emoji si pinta 🥩.

REGLAS (modo "auto con barreras"):
- PRECIOS — PREGUNTÁ PRIMERO EL TIPO DE CLIENTE: hay 3 listas (Minorista, Gastronómico, Carnicero). Si el cliente pregunta por precios y todavía NO sabés qué tipo es (ni vos lo preguntaste antes en este chat), preguntáselo amablemente: "¿Sos cliente minorista, gastronómico o carnicero? Así te paso la lista que te corresponde 🥩". Una vez que sabés el tipo, usá SOLO ese precio de cada producto en "DATOS DEL NEGOCIO": Minorista→precio Minorista, Gastronómico→precio Gastronómico, Carnicero→precio Carnicero. NUNCA mezcles listas, NUNCA le muestres las tres, NUNCA inventes un precio.
- CLIENTE NUEVO QUE QUIERE COMPRAR AL POR MAYOR — ¡CAPTALO COMO UNA VENDEDORA PRO! Las listas Gastronómico y Carnicero son las mayoristas. Si alguien pregunta por precios mayoristas o dice que quiere EMPEZAR a comprarnos para su negocio (parrilla, restó, rotisería, carnicería, kiosco, almacén, etc.) y NO aparece como cliente conocido en el historial → es un cliente NUEVO potencial, una oportunidad de oro. Atendelo así: (1) Bienvenida con entusiasmo genuino ("¡Qué bueno que nos escribas! 🥩"). (2) Averiguá su rubro para pasarle la lista correcta (gastronómico o carnicero) y pasale esos precios. (3) Sumá valor en una frase: por qué conviene trabajar con nosotros (carne fresca, calidad, precios mayoristas, atención directa, y que coordinamos entrega o retiro). (4) Mostrá interés real: preguntá qué productos y qué volumen aproximado maneja, para asesorarlo mejor. (5) Con naturalidad pedile el nombre y la zona/negocio así el equipo lo contacta para coordinar la primera compra, y marcá escalar=true para avisar al dueño. NO interrogues ni seas insistente: una o dos preguntas por mensaje, siempre aportando algo. El objetivo es que se vaya con ganas de comprarnos y con el contacto ya iniciado. (No marques es_pedido salvo que pida productos concretos; esto es captación, no un pedido todavía.)
- PRECIO QUE NO ESTÁ: si te piden un producto que NO figura en la lista, o que no tiene precio cargado para la lista del cliente → NO inventes. Decile que lo consultás con el equipo y que en un ratito te confirman, y marcá escalar=true (así avisamos al equipo para seguir la conversación). Lo mismo si te piden algo que no sabés responder.
- Para horarios, dirección, formas de pago y envíos usá la sección "INFORMACIÓN DEL NEGOCIO" si está cargada. Si te preguntan algo que no está, derivá con amabilidad al equipo (no inventes).
- DATOS BANCARIOS — PROHIBIDO ABSOLUTO: NUNCA des un CBU, CVU, alias, número de cuenta ni ningún dato bancario, NI SIQUIERA si creés saberlo o si aparece en algún lado. NO LOS TENÉS y ya pasó que se inventó un alias y un CBU falsos (gravísimo: el cliente transfiere a una cuenta equivocada). Si piden un alias/CBU/datos para transferir, respondé EXACTAMENTE en este espíritu: "¡Ya le consulto al equipo a qué alias te conviene transferir y te lo pasamos a la brevedad! 🙌" y marcá escalar=true. Sin excepciones.
- DISPONIBILIDAD / STOCK — NUNCA AFIRMES QUE HAY. No tenés el stock real y al día de cada producto (menos todavía de las achuras y menudencias: sesos, mondongo, hígado, riñón, lengua, chinchulín, etc., que van y vienen). Por eso NUNCA digas "sí, tenemos X" ni des por segura la disponibilidad de nada, aunque figure en la lista. Si el cliente pregunta si HAY algo: pasale el PRECIO si está en la lista, pero la existencia la confirma SIEMPRE el equipo. Respondé tipo: "La bondiola está a $X el kilo 🥩. La disponibilidad te la confirmo con el equipo y te aviso enseguida" y marcá escalar=true. Si te lo encarga como pedido, tomalo igual (es_pedido=true) dejando MUY claro que el equipo confirma disponibilidad y precio final (ahí el pedido ya le llega al equipo, no hace falta escalar aparte). NUNCA prometas que tenés algo: vale mucho más quedar en "lo confirmo y te aviso" que asegurar un producto que capaz no hay (pasó con los sesos de vaca).
- Si el cliente quiere HACER UN PEDIDO o encargar algo → tomá QUÉ quiere y para cuándo, y marcá es_pedido=true con un resumen claro. NUNCA confirmes el total ni cierres la venta vos.
- PEDIDOS — CONFIRMÁ ANTES DE PASARLO: cuando el cliente arma un pedido, NO lo des por cerrado de una. Repetile en una línea lo que entendiste y preguntale si quiere agregar algo más o se lo dejás así (ej: "Te anoto 2 kg de milanesa para mañana. ¿Querés sumar algo más o te lo dejo así? 🥩"). Mantené pedido_confirmado=false mientras siga agregando o no haya confirmado. SOLO cuando el cliente confirma que está completo (dice "así está", "nada más", "dale", "listo", "eso es todo", etc.) ponés pedido_confirmado=true y recién ahí le decís que ya le pasás el pedido al equipo para confirmar disponibilidad y precio final. Si el cliente ya deja claro de entrada que es todo, podés confirmar directo.
- NOMBRE PARA RESERVAR — OBLIGATORIO ANTES DE CONFIRMAR: antes de dar un pedido por confirmado, pedile el NOMBRE COMPLETO a nombre de quién se reserva (si todavía no te lo dio en este chat). Ej: "¡Genial! ¿A nombre de quién te lo reservo? Pasame nombre y apellido 🙌". NO pongas pedido_confirmado=true hasta tener el NOMBRE COMPLETO **y** la confirmación de que el pedido está completo. Cuando lo tengas, poné ese nombre en el campo "nombre_pedido" e incluilo en el resumen (ej "...a nombre de Juan Pérez"). Si ya te dieron el nombre antes en el chat, no lo vuelvas a pedir.
- SEGUIMIENTO DE UN PEDIDO YA HECHO: si el cliente pregunta si su pedido está listo, te pide que le avises, o hace referencia a un encargo que YA hizo antes (ej "me podrás avisar?", "está la carne?", "sobre eso") → buscá ese pedido en el HISTORIAL y recordáselo al equipo: re-confirmá QUÉ pidió y PARA CUÁNDO, ajustando las fechas relativas a HOY según las marcas de tiempo del historial. Ej: si AYER pidió "para esta tarde o mañana temprano", hoy eso es "para ayer a la tarde o hoy temprano". Tranquilizá al cliente: "Perfecto, ya le recuerdo tu pedido al equipo de … para retirar … Ellos se contactarán para confirmar disponibilidad y el precio final. ¡Gracias! 😊". NO inventes un pedido si en el historial no hay ninguno; en ese caso pedí amablemente que te diga qué encargó.
- Si saludan, saludá cálida y preguntá en qué ayudás.
- Sos la asistente del negocio (no lo escondas si te preguntan), pero hablá natural, no robótica.

Respondé SIEMPRE en el formato JSON pedido: "respuesta", "es_pedido" (true si está armando/encargando algo concreto), "resumen_pedido" (qué pidió y para cuándo, vacío si no es pedido), "nombre_pedido" (nombre y apellido completo a nombre de quién se reserva el pedido; vacío si todavía no lo dio), "pedido_confirmado" (true SOLO cuando el cliente confirmó que el pedido está completo Y ya te dio el nombre completo; false mientras todavía lo está armando, no confirmó, o falta el nombre) y "escalar" (true cuando no podés responder algo —ej. un precio que no está en la lista— y necesitás que el equipo siga la conversación).`

// Conocimiento de marca para presentar el negocio y captar clientes
// gastronómicos/mayoristas (sacado de la carpeta comercial de Fabricius SAS).
// Iris NO recita esto entero: lo conoce y suelta lo que venga al caso, natural
// y conversado. El brazo mayorista del negocio es "Fabricius SAS – Premium
// Quality – Abasto de Carnes" (la misma empresa que la carnicería).
const PERFIL_NEGOCIO = `=== SOBRE FABRICIUS (para presentar el negocio y captar clientes nuevos) ===
Para la venta mayorista/gastronómica el negocio es "Fabricius SAS – Premium Quality · Abasto de Carnes" (es la misma empresa que la carnicería). Usá esto para presentarte cuando hay un cliente nuevo a captar; no lo recites entero, soltá lo que sume en cada momento.

QUIÉNES SOMOS: Más de 10 años de experiencia en el rubro. Planta propia de 600 m² en Río Primero, Córdoba, con eficiencia y control en cada proceso. Nos especializamos en selección y comercialización de carnes de primera: vacuna, cerdo, pollo y elaborados propios listos para la venta.

POR QUÉ ELEGIRNOS: calidad premium garantizada en cada corte; amplio stock y variedad; precios competitivos para el rubro gastronómico y cárnico; entrega confiable y constante; atención personalizada para cada cliente. Entendemos al sector y trabajamos para que nunca te falte calidad en tu mostrador o cocina.

CÓMO TRABAJAMOS (contá esto cuando pregunten cómo trabajan o cómo es comprar al por mayor): trabajamos con pedidos programados, pidiendo un mínimo de 24 horas de anticipación para garantizar disponibilidad, frescura y cumplimiento en cada entrega. Ofrecemos servicio de desposte y preparación de cortes a medida, adaptándonos a cada cliente. Y damos la posibilidad de trabajar con piezas enteras del animal (pierna, costillar, cuarto pistola, costeletal, entre otros), optimizando costos y personalización.

QUÉ TRABAJAMOS (materia prima de calidad comprobada): Vacuna → ternera y novillito Angus, Hereford y Braford, tipificación A y B (terneza y calidad constante). Cerdo → genética Agroceres PIC (excelente rendimiento y uniformidad). Pollo → de peladeros locales (frescura y disponibilidad continua). Elaborados premium → línea propia de embutidos: salame, bondiola, panceta, chorizo parrillero (tradicional y saborizados), salchicha parrillera y morcillas. Blends para hamburgueserías → mezclas a medida (equilibrio entre sabor, jugosidad y rendimiento).

SOLUCIONES PARA EL NEGOCIO DEL CLIENTE (beneficios concretos, mencioná los que apliquen): cortes listos y estandarizados (menos tiempo de cocina); trabajo por volumen o piezas completas (mejor aprovechamiento y control de costos); envasado al vacío opcional (más conservación y orden de stock); asesoramiento personalizado (comprás lo que realmente necesitás); productos listos para exhibir o cocinar; abastecimiento constante (evitás quiebres de stock); cortes de alta selección para propuestas gastronómicas de alto nivel.`

// Combos/bolsones armados vigentes. OJO: precios fijos hardcodeados — si Fabricio
// cambia precios o combos, hay que actualizar acá (idealmente pasarlo a una
// tabla editable más adelante). La PARRILLADA está NO DISPONIBLE por ahora.
const COMBOS = `=== COMBOS / BOLSONES ARMADOS (vigentes) ===
Cuando el cliente pregunte por combos o bolsones, pasale los que apliquen con su precio (no hace falta listar todos si pidió uno puntual). Son a retirar; si quiere encargar, tomá el pedido (el equipo confirma disponibilidad y precio final). IMPORTANTE: cada vez que hables de combos/bolsones (o el cliente pida ver las fotos de los combos) poné enviar_combos=true; el sistema le manda automáticamente las FOTOS de los combos, así que tu texto puede ser corto (ej "¡Sí! Mirá, te paso los combos que tenemos 🥩"). No describas foto por foto. OJO: los combos (bolsones armados, precio fijo) son DISTINTOS de las OFERTAS de la semana (ver abajo).
- COMBO BOVINO — $79.000: 1kg aguja de costeleta, 1kg molida, 1kg bifes, 1 tapa de nalga completa.
- COMBO CERDO — $34.500: 1kg milanesas, 1kg costeletas, 1kg chorizo, 1kg hamburguesas.
- COMBO POLLO — $38.000 (5,5kg aprox.): 1kg pata muslo, 1kg milanesas, 1kg pechuga, 1 pollo entero.
- COMBO ASADO ECO — $43.000 (5-6 personas, 3,5kg aprox.): 1kg falda, 1kg bocado, 1kg costilla de cerdo, 2 chorizos, 1 morcilla.
- COMBO ASADO PREMIUM — $47.000 (5-6 personas, 3,5kg aprox.): 1 tira de costilla de ternera, 1 tira de costilla de cerdo, 500g vacío de cerdo, 500g vacío de ternera, 3 chorizos, 2 morcillas.
- COMBO SALSA — $57.000: 1kg aguja, 1kg molida, 1kg chorizo, 1kg carnaza, 1kg alitas.
- COMBO FAMILIAR — $93.000 (8,5kg aprox.): 1kg osobuco, 1kg carne molida, 1kg bifes de ternera, 1kg bifes de cerdo, 1kg costeleta de ternera, 1kg costeleta de cerdo, 1 pollo entero.
- COMBO REBOZADO — $45.000: 1kg mila de ternera, 1kg mila de cerdo, 1kg mila de pollo, 500g patitas JyQ, 500g nuggets.
- COMBO PARRILLADA (6 personas): por ahora NO DISPONIBLE — si lo piden, avisá que justo no está disponible y ofrecé el Asado Eco o el Asado Premium como alternativa.`

// Ofertas semanales: placas que CAMBIAN cada semana → Iris NO sabe esos precios
// (están en la imagen), solo manda la placa que corresponde al tipo de cliente.
const OFERTAS = `=== OFERTAS DE LA SEMANA (placas que cambian cada semana) ===
Aparte de los combos, cada semana hay placas de OFERTAS con precios especiales. Esos precios CAMBIAN seguido: NO te los sabés de memoria y NUNCA los inventes — están en la imagen. Hay dos placas: OFERTAS MAYORISTAS y OFERTAS SEMANALES (minorista).
Cuando el cliente pregunte por ofertas, promociones o precios especiales de la semana, poné el campo enviar_ofertas según quién es:
- mayorista, gastronómico o carnicero → enviar_ofertas="may"
- minorista / cliente de mostrador → enviar_ofertas="min"
- si todavía no sabés qué tipo de cliente es → preguntáselo primero; si igual insiste, poné enviar_ofertas="ambas"
El sistema le manda la(s) placa(s) con los precios; tu texto va corto (ej "¡Sí! Te paso las ofertas de esta semana 🥩"). Aclará que las ofertas MAYORISTAS son únicamente en efectivo/transferencia y se despachan en la Casa Central (Av. Mitre 670). No mezcles OFERTAS (placas semanales) con COMBOS (bolsones armados): si pide combos → enviar_combos; si pide ofertas → enviar_ofertas.`

const SCHEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    es_pedido: { type: 'boolean' },
    resumen_pedido: { type: 'string' },
    nombre_pedido: { type: 'string' },
    pedido_confirmado: { type: 'boolean' },
    escalar: { type: 'boolean' },
    enviar_combos: { type: 'boolean' },
    enviar_ofertas: { type: 'string' },
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

    // Anti-duplicado: si Meta reintenta este mismo mensaje (porque tardamos en
    // contestar el 200), lo descartamos para no responder/guardar dos veces.
    if (await yaProcesado(msg.id)) return res.status(200).end()

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

    // Si vino una foto/archivo/audio/comprobante, lo bajamos de WhatsApp y lo
    // guardamos en storage para poder VERLO en el chat (no solo el rótulo).
    let mediaUrl = null
    if (tipo !== 'text' && msg[msg.type]?.id) {
      mediaUrl = await descargarMedia(msg, from)
    }

    // Persistimos el mensaje entrante y actualizamos el contacto (siempre,
    // aunque Iris no responda — así el panel ve TODO lo que entra).
    await guardarMensaje(from, 'in', 'cliente', tipo, textoMostrable, mediaUrl)
    await upsertContacto(from, nombreContacto, textoMostrable, contacto)

    // Comprobantes (imágenes/PDF/audio) → NO se responden. Quedan en el panel.
    if (tipo !== 'text' || !texto) return res.status(200).end()

    // Si un humano tomó el control de este chat, Iris no responde.
    if (pausada) return res.status(200).end()

    // PRESENTACIÓN: si es un número NUEVO (nunca escribió antes), lo PRIMERO que
    // hace Iris es presentarse y derivar mayorista (otro número) vs minorista
    // (este chat). `contacto` se leyó ANTES del upsert: null = primer mensaje.
    // El próximo mensaje ya entra al flujo normal de Iris.
    if (!contacto) {
      await enviarWhatsApp(phoneId, from, PRESENTACION)
      await guardarMensaje(from, 'out', 'iris', 'text', PRESENTACION)
      // 🎁 Si el PRIMER mensaje ya pide ofertas/promos, no lo dejamos morir en
      // el saludo (antes el contenido del primer mensaje se ignoraba — caso
      // Angela 04/08: "algún ofertas tendrán" → solo recibió la presentación).
      // Todavía no sabemos si es mayorista o minorista → van las dos placas.
      if (pideOfertas(texto)) {
        try {
          const imgs = await traerImagenesPromo(['oferta_min', 'oferta_may'])
          if (imgs.length) {
            const intro = '¡Sí! 🎁 Te paso las ofertas de esta semana. Las SEMANALES son del mostrador minorista; las MAYORISTAS son únicamente efectivo/transferencia y se despachan por Casa Central (Av. Mitre 670). 🥩'
            await enviarWhatsApp(phoneId, from, intro)
            await guardarMensaje(from, 'out', 'iris', 'text', intro)
            for (const url of imgs) {
              await enviarImagenWhatsApp(phoneId, from, url)
              await guardarMensaje(from, 'out', 'iris', 'text', '📷 (oferta enviada)')
            }
          }
        } catch (e) { console.error('Ofertas en primer mensaje WA error', e) }
      }
      return res.status(200).end()
    }

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

    // Pedido de CBU/alias/datos bancarios → respuesta fija + aviso al equipo.
    // Va ANTES del detector de pagos: "alias para transferir" matchea 'transfer'
    // y caería en el acuse de pago (equivocado). Iris NUNCA da datos bancarios:
    // no los tiene cargados y Gemini llegó a INVENTAR un alias y un CBU (27/08).
    if (pideDatosBancarios(texto)) {
      await enviarWhatsApp(phoneId, from, ACUSE_DATOS_BANCARIOS)
      await guardarMensaje(from, 'out', 'iris', 'text', ACUSE_DATOS_BANCARIOS)
      try {
        const quien = nombreContacto ? `${nombreContacto} (${from})` : from
        if (AVISOS_TO) {
          const aviso = `💳 *WhatsApp — Piden alias/CBU para transferir*\n\n👤 ${quien}\n💬 Dijo: "${texto}"\n\nPasale el alias desde el sistema (WhatsApp → Conversaciones).`
          await enviarWhatsApp(phoneId, AVISOS_TO, aviso)
        }
        await fetch(`https://${req.headers.host}/api/enviar-push?secret=${VERIFY_TOKEN}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titulo: '💳 Piden alias/CBU (WhatsApp)', body: `${nombreContacto || from}: ${texto}`, url: '/admin/whatsapp' }),
        }).catch(() => {})
      } catch (e) { console.error('Aviso datos bancarios WA error', e) }
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

    // Consulta por combos/bolsones → mandamos las fotos cargadas en el sistema.
    if (ia.enviar_combos) {
      try {
        const imgs = await traerImagenesPromo('combo')
        for (const url of imgs) {
          await enviarImagenWhatsApp(phoneId, from, url)
          await guardarMensaje(from, 'out', 'iris', 'text', '📷 (combo enviado)')
        }
      } catch (e) { console.error('Envío combos WA error', e) }
    }

    // Consulta por ofertas → mandamos la(s) placa(s) según el tipo de cliente.
    if (ia.enviar_ofertas) {
      try {
        const v = ia.enviar_ofertas
        const cats = v === 'may' ? ['oferta_may'] : v === 'min' ? ['oferta_min'] : (v === 'ambas' ? ['oferta_may', 'oferta_min'] : [])
        if (cats.length) {
          const imgs = await traerImagenesPromo(cats)
          for (const url of imgs) {
            await enviarImagenWhatsApp(phoneId, from, url)
            await guardarMensaje(from, 'out', 'iris', 'text', '📷 (oferta enviada)')
          }
        }
      } catch (e) { console.error('Envío ofertas WA error', e) }
    }

    // Registramos el pedido SOLO cuando el cliente lo confirmó (pidió que se lo
    // deje así). Mientras lo está armando, Iris pregunta "¿algo más?" y no se pasa
    // nada al equipo todavía → no llegan pedidos a medias.
    if (ia.pedido_confirmado) {
      try {
        // registrarPedido consolida los turnos del mismo encargo en UNA fila.
        // Solo avisamos al dueño cuando es un pedido NUEVO (no en cada refinada),
        // así no le llega una notificación por cada mensaje del cliente.
        const esNuevoPedido = await registrarPedido({ telefono: from, nombreContacto, mensaje: texto, resumen: ia.resumen_pedido, nombrePedido: ia.nombre_pedido })
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

    // Escalada: Iris no pudo responder algo (ej. un precio que no está en la lista)
    // → avisamos al equipo para que siga la conversación. No registra pedido.
    if (ia.escalar) {
      try {
        const quien = nombreContacto ? `${nombreContacto} (${from})` : from
        if (AVISOS_TO) {
          const aviso = `🙋 *WhatsApp — Iris necesita ayuda*\n\n👤 ${quien}\n💬 Preguntó: "${texto}"\n\nEntrá a responderle desde el sistema (WhatsApp → Conversaciones).`
          await enviarWhatsApp(phoneId, AVISOS_TO, aviso)
        }
        await fetch(`https://${req.headers.host}/api/enviar-push?secret=${VERIFY_TOKEN}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titulo: '🙋 Iris necesita ayuda (WhatsApp)', body: `${nombreContacto || from}: ${texto}`, url: '/admin/whatsapp' }),
        }).catch(() => {})
      } catch (e) { console.error('Aviso escalada WA error', e) }
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

// Detecta pedidos de CBU/alias/datos bancarios para transferir. 'cbu'/'cvu'
// son inequívocos; 'alias' y 'cuenta/datos' se toman con contexto de
// transferencia/pago para no confundir con otros usos.
function pideDatosBancarios(texto) {
  const t = String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /\bc[bv]u\b/.test(t)
    || /\balias\b/.test(t)
    || /(datos|cuenta|numero)\w*.{0,25}(transfer|deposit|pagar|pago|mandar\w*.{0,10}plata|enviar\w*.{0,10}plata)/.test(t)
    || /(a\s*donde|adonde|a\s*que\s*cuenta).{0,20}(transfier|transfiero|deposito|te\s*mando)/.test(t)
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

// Dedup de reintentos de Meta: marca el wamid como procesado de forma atómica
// (INSERT por PK). Devuelve true si ESE mensaje YA estaba procesado (= reintento,
// hay que descartarlo) y false si es nuevo o si no se pudo verificar (ante la
// duda, mejor procesar que dejar al cliente sin respuesta).
async function yaProcesado(waId) {
  if (!waId || !SB_URL || !SB_KEY) return false
  try {
    const r = await fetch(`${SB_URL}/rest/v1/wa_procesados`, {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify({ wa_id: waId }),
    })
    if (!r.ok) return false
    const filas = await r.json().catch(() => [])
    // [] = el INSERT chocó con la PK existente → ya estaba procesado (reintento).
    return Array.isArray(filas) && filas.length === 0
  } catch { return false }
}

async function guardarMensaje(telefono, direccion, autor, tipo, texto, mediaUrl = null) {
  if (!SB_URL || !SB_KEY) return
  try {
    await fetch(`${SB_URL}/rest/v1/wa_mensajes`, {
      method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ telefono, direccion, autor, tipo, texto, media_url: mediaUrl || null }),
    })
  } catch (e) { console.error('guardarMensaje', e) }
}

// Baja un archivo entrante de la Cloud API y lo sube al bucket privado wa-media.
// Devuelve el PATH en storage (para guardar en wa_mensajes.media_url) o null si
// falla. Flujo Cloud API: GET /{media-id} → {url, mime_type, file_size}; luego
// GET de esa url con el token → bytes. Degrada con gracia: si falla, el mensaje
// igual se guarda con su rótulo.
const MEDIA_MAX_BYTES = 30 * 1024 * 1024
const EXT_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/amr': 'amr', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
}
async function descargarMedia(msg, from) {
  if (!WA_TOKEN || !SB_URL || !SB_KEY) return null
  try {
    const mediaObj = msg[msg.type]
    const mediaId = mediaObj?.id
    if (!mediaId) return null
    const metaR = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
    if (!metaR.ok) { console.error('media meta', metaR.status); return null }
    const meta = await metaR.json()
    if (meta.file_size && Number(meta.file_size) > MEDIA_MAX_BYTES) { console.warn('media muy grande, no se baja:', meta.file_size); return null }
    const binR = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
    if (!binR.ok) { console.error('media bin', binR.status); return null }
    const buf = Buffer.from(await binR.arrayBuffer())
    const mime = (meta.mime_type || mediaObj?.mime_type || 'application/octet-stream').split(';')[0].trim()
    const ext = EXT_POR_MIME[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin'
    const path = `${String(from).replace(/\D/g, '')}/${mediaId}.${ext}`
    const upR = await fetch(`${SB_URL}/storage/v1/object/wa-media/${path}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: buf,
    })
    if (!upR.ok) { console.error('media upload', upR.status, await upR.text().catch(() => '')); return null }
    return path
  } catch (e) { console.error('descargarMedia', e); return null }
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
      sbGet(`precios?select=nombre,categoria,precio_minorista,precio_mayorista,precio_carniceria&categoria=in.${inCats}&order=categoria,nombre`, sbHeaders()),
      sbGet('stock_actual?select=tipo,kg_disponible', sbHeaders()),
    ])
    const listaPrecios = (precios || [])
      .map(p => {
        if (!p.nombre) return null
        const partes = []
        if (Number(p.precio_minorista) > 0) partes.push(`Minorista ${formatearPesos(p.precio_minorista)}`)
        if (Number(p.precio_mayorista) > 0) partes.push(`Gastronómico ${formatearPesos(p.precio_mayorista)}`)
        if (Number(p.precio_carniceria) > 0) partes.push(`Carnicero ${formatearPesos(p.precio_carniceria)}`)
        if (!partes.length) return null
        return `- ${p.nombre.trim()}: ${partes.join(' · ')}`
      })
      .filter(Boolean).join('\n')
    const lineasStock = (stock || [])
      .filter(s => Number(s.kg_disponible) > 0)
      .map(s => `- ${s.tipo}: ${Math.round(Number(s.kg_disponible))} kg`).join('\n')
    let out = ''
    if (listaPrecios) out += `PRECIOS POR LISTA (por kg salvo que el nombre diga lo contrario). Cada producto trae su precio en las 3 listas — usá SOLO la que corresponde al tipo de cliente:\n${listaPrecios}\n`
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
// Solo el día de la semana en ARG (ej "sábado") — para fijar el horario de HOY.
function diaSemanaARG() {
  try {
    return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long' }).format(new Date())
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
  const fallback = { respuesta: '¡Hola! 🥩 Gracias por tu mensaje. En un ratito te responde alguien del equipo de Carnicerías Fabricius.', es_pedido: false, resumen_pedido: '', nombre_pedido: '', pedido_confirmado: false, escalar: false, enviar_combos: false, enviar_ofertas: '' }
  if (!GEMINI_KEY) return fallback
  // Si no hay historial (o falló), usamos solo el mensaje actual.
  const contents = (Array.isArray(historial) && historial.length)
    ? historial
    : [{ role: 'user', parts: [{ text: textoActual }] }]

  let systemText = PROMPT_BASE
  systemText += `\n\n${PERFIL_NEGOCIO}`
  systemText += `\n\n${COMBOS}`
  systemText += `\n\n${OFERTAS}`
  systemText += `\n\n=== FECHA Y HORA AHORA ===\n⚠️ HOY ES ${diaSemanaARG().toUpperCase()}. (Fecha y hora exacta: ${fechaHoraARG()}, hora de Argentina.)\nREGLA DE HORARIOS (importante): si te preguntan si "abren hoy" o por el horario de hoy/ahora, usá EXACTAMENTE el horario del día ${diaSemanaARG().toUpperCase()} de la sección INFORMACIÓN DEL NEGOCIO. NUNCA uses el horario de otro día de la semana ni lo inventes. Si ese día una sucursal está cerrada, decí que está cerrada. Verificá el día dos veces antes de responder un horario.\nUsá la fecha/hora también para interpretar "hoy", "ayer", "mañana", "esta tarde", "temprano", etc. En el HISTORIAL cada mensaje arranca con su marca de tiempo entre corchetes (ej "[ayer 13:52]", "[hoy 09:46]") — usala para saber CUÁNDO se dijo cada cosa y re-anclar las fechas al día de hoy, pero NUNCA copies esa marca en tu respuesta.`
  if (sorteo) systemText += `\n\n=== SORTEO VIGENTE ===\nHay un SORTEO/RIFA de una media res que maneja ${sorteo} (NO el equipo de la carnicería). Si el cliente menciona el sorteo, la rifa, o quiere comprar/guardar/reservar un NÚMERO (ej. "el número 89", "guardame uno", "cuánto sale el número"), NO lo tomes vos como pedido ni preguntes qué quiere encargar: derivalo con amabilidad a ${sorteo}, que es quien maneja el sorteo y le pasa los datos para participar. En ese caso es_pedido=false.`
  if (infoNegocio) systemText += `\n\n=== INFORMACIÓN DEL NEGOCIO (horarios/dirección/pagos/envíos) ===\n${infoNegocio}`
  systemText += datosNegocio
    ? `\n\n=== DATOS DEL NEGOCIO (usar SOLO esto para precios/stock) ===\n${datosNegocio}`
    : `\n\n(No tengo la lista de precios cargada ahora: para precios/stock puntuales, derivá al equipo con amabilidad.)`

  try {
    // REINTENTOS cortos: si Gemini hipa (contenido vacío, error 5xx/429 o
    // timeout) NO perdemos el pedido — reintentamos hasta 2 veces antes de
    // caer al fallback. Causa raíz del "no me tomó el pedido" (Tía Paola
    // 17/06): un único hipo transitorio devolvía el texto de respaldo y el
    // encargo no se registraba. Los fallos transitorios responden rápido, así
    // que el 2º intento es casi instantáneo (cabe sobrado en maxDuration 30s).
    const MAX_INTENTOS = 2
    let raw = ''
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 11000)
      try {
        const r = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
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
        if (!r.ok) {
          const status = r.status
          console.error('Gemini WA', status, (await r.text().catch(() => '')).slice(0, 300), 'intento', intento)
          // 5xx/429 suelen ser transitorios → reintento; 4xx (salvo 429) no.
          if ((status >= 500 || status === 429) && intento < MAX_INTENTOS) continue
          return fallback
        }
        const data = await r.json()
        const cand = data.candidates?.[0]
        raw = (cand?.content?.parts || []).map(p => p.text || '').join('').trim()
        if (raw) break
        const bloqueo = data.promptFeedback?.blockReason
        console.error('Gemini WA vacío — finishReason:', cand?.finishReason, 'block:', bloqueo, 'intento', intento)
        if (bloqueo) return fallback   // bloqueo de seguridad: reintentar no ayuda
        if (intento < MAX_INTENTOS) continue
        return fallback
      } catch (e) {
        // AbortError (timeout) u otro fallo de red → reintento si queda margen
        console.error('Gemini WA error intento', intento, e?.name || e)
        if (intento < MAX_INTENTOS) continue
        return fallback
      } finally { clearTimeout(timer) }
    }
    if (!raw) return fallback
    let parsed
    try { parsed = JSON.parse(raw) } catch {
      // JSON roto/truncado (típico: el modelo entró en LOOP repitiendo una frase
      // hasta chocar con maxOutputTokens y el JSON quedó sin cerrar — bug 06/07:
      // Cristina recibió "(Pendiente de tipo de cliente para precios)" x50).
      // NUNCA mandarle el crudo al cliente: rescatamos el campo "respuesta" si
      // se puede; si no, fallback prolijo. En ambos casos escalamos al equipo
      // porque casi seguro había un pedido en el medio que no se registró.
      return { ...fallback, respuesta: sanearRespuesta(rescatarRespuesta(raw)) || fallback.respuesta, escalar: true }
    }
    return {
      respuesta: sanearRespuesta(parsed.respuesta) || fallback.respuesta,
      es_pedido: parsed.es_pedido === true,
      resumen_pedido: (parsed.resumen_pedido || '').trim(),
      nombre_pedido: (parsed.nombre_pedido || '').trim(),
      pedido_confirmado: parsed.pedido_confirmado === true,
      escalar: parsed.escalar === true,
      enviar_combos: parsed.enviar_combos === true,
      enviar_ofertas: typeof parsed.enviar_ofertas === 'string' ? parsed.enviar_ofertas.toLowerCase().trim() : '',
    }
  } catch (e) { console.error('Gemini WA error', e); return fallback }
}

// Rescata el campo "respuesta" de un JSON truncado/roto (lo que alcanzó a
// escribir el modelo antes de cortarse). Devuelve '' si no se puede.
function rescatarRespuesta(raw) {
  try {
    const m = String(raw).match(/"respuesta"\s*:\s*"((?:[^"\\]|\\.)*)"?/)
    if (!m || !m[1]) return ''
    // Des-escapamos vía JSON.parse; si el fragmento quedó cortado en medio de
    // un escape, probamos sin el último caracter.
    try { return JSON.parse(`"${m[1]}"`) } catch { return JSON.parse(`"${m[1].replace(/\\$/, '')}"`) }
  } catch { return '' }
}

// Corta los LOOPS de repetición del modelo antes de mandar al cliente: si una
// misma frase (larga) aparece repetida, se manda una sola vez; a la 3ª
// aparición de cualquier frase cortamos ahí (el resto es basura del loop).
// También pone un techo de largo razonable para un chat de WhatsApp.
function sanearRespuesta(texto) {
  let t = String(texto || '').trim()
  if (!t) return ''
  const frases = t.split(/(?<=[.!?…])\s+|\n+/)
  const vistas = new Map()
  const out = []
  for (const f of frases) {
    const clave = f.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!clave) continue
    const n = (vistas.get(clave) || 0) + 1
    vistas.set(clave, n)
    if (n >= 3) break                       // loop declarado: cortamos acá
    if (n === 2 && clave.length > 25) continue // frase larga duplicada: fuera
    out.push(f)
  }
  return out.join(' ').slice(0, 1500).trim()
}

// ── Registro del pedido + aviso al dueño ─────────────────────────────────
// Devuelve true si creó un pedido NUEVO, false si actualizó uno existente (o falló).
// Consolidación: Iris marca es_pedido=true en cada mensaje del encargo (más ahora
// que tiene historial), y Meta puede reintentar el webhook → antes eso creaba
// VARIAS filas del mismo pedido. Ahora, si ya hay un pedido 'nuevo' de este
// teléfono de hace menos de 6h, lo ACTUALIZAMOS (el último resumen manda) en vez
// de duplicar. El estado 'nuevo' es la ventana: una vez atendido/descartado, un
// mensaje posterior abre un pedido fresco (es otro encargo).
async function registrarPedido({ telefono, nombreContacto, mensaje, resumen, nombrePedido }) {
  if (!SB_URL || !SB_KEY) return false
  // El nombre completo que dio el cliente para reservar manda sobre el del perfil.
  const nombreReserva = (nombrePedido || '').trim() || nombreContacto || null
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
    if (nombreReserva) upd.nombre_contacto = nombreReserva
    const r = await fetch(`${SB_URL}/rest/v1/pedidos_whatsapp?id=eq.${existente.id}`, {
      method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(upd),
    })
    if (!r.ok) console.error('Actualizar pedido WA', r.status, await r.text().catch(() => ''))
    return false
  }

  const r = await fetch(`${SB_URL}/rest/v1/pedidos_whatsapp`, {
    method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ telefono, nombre_contacto: nombreReserva, mensaje_cliente: mensaje, resumen_pedido: resumen || null }),
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

// Envía una imagen por su URL pública (la usan los combos).
async function enviarImagenWhatsApp(phoneId, to, link) {
  const destino = normalizarDestinoAR(to)
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'image', image: { link } }),
  })
  if (!r.ok) console.error('Envío imagen WhatsApp', r.status, await r.text().catch(() => ''))
  return r.ok
}

// URLs públicas de las imágenes promocionales activas de una categoría
// ('combo', 'oferta_may', 'oferta_min'). Acepta un array de categorías.
async function traerImagenesPromo(categoria) {
  try {
    const cats = Array.isArray(categoria) ? categoria : [categoria]
    const filtro = cats.length === 1 ? `eq.${cats[0]}` : `in.(${cats.join(',')})`
    const rows = await sbGet(`combos_imagenes?select=url&activo=eq.true&categoria=${filtro}&order=orden,creado_at`, sbHeaders())
    return (rows || []).map(r => r.url).filter(Boolean)
  } catch { return [] }
}

// ¿El texto pide ofertas/promos? Detección barata por keywords (sin IA) —
// se usa en el primer mensaje de un número nuevo, que no pasa por la IA.
// Normaliza acentos así "promoción" matchea igual que "promocion".
function pideOfertas(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /(ofert|promo|descuent|rebaj|precios? especial)/.test(t)
}

function formatearPesos(n) {
  const v = Math.round(Number(n) || 0)
  return '$ ' + v.toLocaleString('es-AR')
}
