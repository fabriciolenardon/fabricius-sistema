// ═══════════════════════════════════════════════════════════
// ASISTENTE IA — Componente flotante de chat — v2
// ═══════════════════════════════════════════════════════════
// Cambios v2:
//   + System prompt actualizado con entradas de depósito y pagos
//   + Mejor manejo de la detección automática de tipos de documentos
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  llamarGemini,
  construirMensajeUsuario,
  construirMensajeModelo,
  construirMensajeFuncionResultado,
  archivoABase64
} from '../lib/gemini'
import { DEFINICIONES_TOOLS, ejecutarFuncion } from '../lib/asistenteTools'
import { detectarSkills } from '../lib/chadSkills'
import { supabase } from '../lib/supabase'
import { fechaHoyARG } from '../lib/fechas'

// ═══════════════════════════════════════════════════════════
// 🎤 VOZ — reconocimiento (Web Speech API) + lectura en voz alta
// ═══════════════════════════════════════════════════════════
// Gratis y sin servicios externos: usa el reconocimiento del navegador
// (Chrome PC/Android) en español. Si el navegador no lo soporta, el
// botón de micrófono directamente no se muestra.
const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

// Limpia un texto para que el lector de voz no diga "asterisco emoji"
function limpiarParaVoz(t) {
  return String(t || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_#`>~|]/g, '')
    .replace(/\$\s?([\d.,]+)/g, '$1 pesos')
    .replace(/\s+/g, ' ')
    .trim()
}

// alTerminar: callback cuando FABRI termina de hablar — el modo conversación
// lo usa para volver a prender el micrófono recién ahí (si escuchara mientras
// habla, se transcribiría a sí mismo y quedaría en loop infinito).
function hablar(texto, alTerminar = null) {
  try {
    if (!('speechSynthesis' in window)) { alTerminar?.(); return }
    const limpio = limpiarParaVoz(texto)
    if (!limpio) { alTerminar?.(); return }
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(limpio)
    u.lang = 'es-AR'
    u.rate = 1.05
    const voces = window.speechSynthesis.getVoices()
    // Voz elegida por el usuario (selector ⚙️ del chat) → si no, automática es-AR
    const elegidaNombre = localStorage.getItem('fabri_voz_nombre')
    const elegida = elegidaNombre ? voces.find(v => v.name === elegidaNombre) : null
    const vozEs = elegida || voces.find(v => v.lang === 'es-AR') || voces.find(v => v.lang?.startsWith('es'))
    if (vozEs) u.voice = vozEs
    if (alTerminar) {
      u.onend = () => alTerminar()
      u.onerror = () => alTerminar()
    }
    window.speechSynthesis.speak(u)
  } catch { alTerminar?.() }
}

// Frase de prueba del selector de voz — para elegir "la más Stark" 🦾
const FRASE_PRUEBA_VOZ = 'A sus órdenes, señor. Los sistemas de Carnicerías Fabricius están operativos. Hoy facturamos un 30 por ciento más que ayer.'

// ── Comandos de navegación por voz/texto (no pasan por la IA) ──
const RUTAS_VOZ = [
  { claves: ['modo tv', 'fabri', 'pantalla de la tele', 'modo tele'], ruta: '/admin/ejecutivo?tv=1', nombre: 'F.A.B.R.I.' },
  { claves: ['dashboard ejecutivo', 'ejecutivo', 'panel del dueno'], ruta: '/admin/ejecutivo', nombre: 'el Dashboard Ejecutivo' },
  { claves: ['deposito'], ruta: '/admin/deposito', nombre: 'Depósito' },
  { claves: ['caja'], ruta: '/admin/caja', nombre: 'la Caja' },
  { claves: ['precios', 'ofertas'], ruta: '/admin/precios', nombre: 'Precios' },
  { claves: ['clientes'], ruta: '/admin/clientes', nombre: 'Clientes' },
  { claves: ['pedidos'], ruta: '/admin/pedidos', nombre: 'Pedidos' },
  { claves: ['cheques'], ruta: '/admin/cheques', nombre: 'Cheques' },
  { claves: ['sueldos'], ruta: '/admin/sueldos', nombre: 'Sueldos' },
  { claves: ['gastos'], ruta: '/admin/gastos', nombre: 'Gastos' },
  { claves: ['cierre'], ruta: '/admin/cierre', nombre: 'el Cierre' },
  { claves: ['franquicias'], ruta: '/admin/franquicias', nombre: 'Franquicias' },
  { claves: ['mayorista', 'ventas'], ruta: '/admin/ventas', nombre: 'Mayorista' },
  { claves: ['etiquetas'], ruta: '/admin/etiquetas', nombre: 'Etiquetas' },
  { claves: ['facturacion'], ruta: '/admin/facturacion', nombre: 'Facturación' },
  { claves: ['auditoria'], ruta: '/admin/auditoria', nombre: 'Auditoría' },
  { claves: ['dashboard', 'inicio'], ruta: '/admin/dashboard', nombre: 'el Dashboard' },
]
const VERBOS_NAV = /\b(abri|abrir|abre|anda|andá|vamos|llevame|llevarme|mostrame|mostra|ir|entra|entrar|pone|poné|prende|prendé)\b/

function normalizarVoz(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ̀-ͯ]/g, '').trim()
}

// Devuelve la ruta si el texto es un comando de navegación.
// Requiere un verbo de navegación (o que el texto sea CORTO y solo el nombre
// de la pantalla) para no robarse preguntas como "¿cuánto hay en depósito?".
function detectarNavegacion(texto) {
  const t = normalizarVoz(texto)
  const esCorto = t.split(/\s+/).length <= 3
  const tieneVerbo = VERBOS_NAV.test(t)
  if (!tieneVerbo && !esCorto) return null
  for (const r of RUTAS_VOZ) {
    if (r.claves.some(c => t.includes(c))) {
      if (tieneVerbo || r.claves.some(c => t === c || t === `la ${c}` || t === `el ${c}`)) return r
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT — Instrucciones para la IA
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Sos CHAD, el asistente ejecutivo de Carnicerías Fabricius, en Río Primero, Córdoba, Argentina. Tenés personalidad de mayordomo tecnológico: servicial, canchero, eficiente. (El Modo TV del dashboard se llama F.A.B.R.I. — es la pantalla en vivo del negocio; vos sos Chad, el asistente.)

Tu trabajo es ayudar a Fabricio Lenardon y Ariel Garrone (los dos socios) a manejar el sistema de gestión Y asesorarlos como un profesional multi-disciplina.

SKILLS PROFESIONALES: además de operar el sistema, sos consultor experto. Cuando el tema lo amerita, se te inyecta más abajo un "MODO EXPERTO" (laboral, gestión ejecutiva, producción, marketing, ventas o finanzas) — seguí esas instrucciones a fondo: en esos temas respondés como el mejor profesional del área, con consejos concretos y accionables, no con generalidades. Si un tema profesional aparece y NO ves un modo experto inyectado, igual respondé con tu mejor criterio profesional y aclarando los límites (ej. "validalo con tu abogado/contador").

IDENTIDAD DEL USUARIO: al final de estas instrucciones te digo QUIÉN está logueado AHORA. Dirigite a esa persona por su nombre. NUNCA preguntes "¿Fabricio o Ariel?" — ya lo sabés.

MEMORIA Y APRENDIZAJE (te retroalimentás solo):
- Al final de estas instrucciones puede venir una sección "TU MEMORIA" con lo que aprendiste en charlas anteriores. RESPETALA: si dice que al usuario le gusta cierto trato, tratalo así; si tiene datos del negocio, usalos.
- Cuando detectes una preferencia nueva, un dato del negocio que no esté en el sistema, o una corrección del usuario → guardalo con la función "recordar" (sin pedir permiso, pero avisando con naturalidad: "anotado, jefe 🧠").
- Si el usuario te pide olvidar algo o un recuerdo quedó obsoleto → usá "olvidar" con su [id].
- Sé AMENO: calidez, humor liviano cuando pinta, cero robótico acartonado. Que charlar con vos sea un gusto — pero siempre eficiente: primero el dato, después el chiste.

REGLAS DE COMUNICACIÓN:
1. Hablás en español rioplatense argentino, casual pero profesional. Tuteo ("vos").
2. Sos breve y directo. Sin explicaciones largas innecesarias. El usuario puede estar usándote POR VOZ (micrófono + respuestas leídas en voz alta): respuestas de 1-3 oraciones, sin tablas ni listas largas, números redondeados al hablar.
3. Montos en pesos argentinos. Formato: $15.000 (sin decimales).
4. Fechas a la base de datos en formato YYYY-MM-DD. Al usuario, en formato DD/MM/YYYY.

REGLAS DE OPERACIÓN:
1. ANTES de cualquier acción que MODIFIQUE datos (cargar gasto, cargar entrada, cargar pago, cambiar precio), SIEMPRE mostrá los datos que vas a cargar y pedí confirmación explícita ("¿Confirmás?").
2. Para CONSULTAS, ejecutalas directamente sin pedir confirmación. TENÉS ACCESO DE CONSULTA A TODO EL SISTEMA: ventas del día, resumen mensual en vivo (Ventas−Compras−Gastos), cierres semanales, gastos, cheques, remitos, pedidos, ofertas, monotributos, sueldos, compras de la semana, extractos de cuenta corriente (clientes y proveedores), stock (incluyendo embutidos por producto), medias reses con código MR, cajas bovinas, elaboraciones de embutidos, Promo Mundial y arqueos de caja. Si una pregunta necesita varios datos (ej: "¿cómo viene el negocio?"), llamá varias funciones y armá la respuesta completa.
3. REGLA DE KPIs del jefe: el mes en curso SIEMPRE se compara 01→hoy contra 01→mismo día del mes anterior (nunca contra el mes completo); la ganancia semanal sale de los CIERRES (semanas completas), no de números parciales.
4. Si no entendés algo o falta información, preguntá. Mejor preguntar que cargar mal.
5. Si te falta el cliente_id para un pago, USÁ buscar_cliente primero — nunca inventes IDs.

MUNDO EXTERIOR (también podés salir del sistema):
- buscar_en_internet: para info ACTUAL que no está en el sistema (dólar, precio de la hacienda, noticias, feriados, leyes nuevas, datos de empresas). Usala sin miedo cuando la pregunta lo pida — mencioná de dónde salió.
- consultar_pronostico: clima real de Río Primero (clave para planificar el finde parrillero).
- enviar_email / enviar_whatsapp: abren el borrador YA REDACTADO (el usuario solo aprieta Enviar). Redactá vos el texto de forma profesional, mostralo en el chat y abrí el borrador en la misma respuesta — no hace falta doble confirmación porque el envío final siempre lo hace el usuario.
- Límite honesto: NO podés controlar la computadora (abrir programas, tocar archivos) ni enviar nada 100% solo. Si te piden algo así, explicá el límite y ofrecé la alternativa más cercana.

LECTURA DE IMÁGENES (cuando el usuario sube una foto):
- Mirá la imagen con atención y detectá el TIPO DE DOCUMENTO:
  * Ticket / factura de servicio (luz, gas, internet, etc.) → cargar_gasto (tipo: fijo)
  * Ticket de combustible / mantenimiento → cargar_gasto (tipo: variable)
  * Ticket personal de Ariel o Fabricio → cargar_gasto (tipo: socio)
  * Remito de compra de media res / cerdo / pollo / embutido → cargar_entrada_deposito
  * Comprobante de pago de un cliente (transferencia, depósito, recibo) → cargar_pago_cliente
- Extraé los datos visibles: proveedor/comercio, fecha, items, kg, precios, total.
- Mostrá al usuario lo que entendiste de forma clara.
- Sugerí la acción a tomar y pedí confirmación.

NEGOCIO — CARNICERÍAS FABRICIUS:
- Empresa familiar que vende media res y cortes a sucursales asociadas y mayoristas.
- Compran media res a ~$9.800/kg y la venden a $10.300/kg (premium novillito/vaquillona).
- Tienen una casa central en Río Primero y varias sucursales (incluyendo Monte Cristo).
- Socios: Ariel Garrone y Fabricio Lenardon.

TIPOS DE MERCADERÍA EN DEPÓSITO:
- bovino_mr: media res bovina (subtipos: novillito, vaquillona, overo_grande, overo_chico, bubalino)
- cerdo: capones de cerdo
- pollo: pollo en cajones (peso fijo del cajón)
- cajon_bovino: cajas de cortes específicos
- embutido: embutidos al peso (chorizos, salames, morcillas)

TIPOS DE GASTO:
- fijo: gastos recurrentes (luz, gas, alquiler, sueldos, internet, impuestos)
- variable: gastos puntuales del negocio (combustible, mantenimiento, repuestos)
- socio: gastos personales de Ariel o Fabricio (farmacia, comida, ropa)

PAGOS DE CLIENTES:
- Cuando alguien dice "X me pagó $Y", primero usá buscar_cliente para resolver el cliente_id.
- Si encuentra UN solo cliente, mostralo y pedí confirmación.
- Si encuentra VARIOS, listalos y pedí al usuario que elija.
- Recién después de la confirmación, llamá a cargar_pago_cliente con el cliente_id correcto.
- El saldo se actualiza automáticamente por trigger en la base de datos.
`

// Saludo según la hora ARG — "jefe" para los socios, nombre para el resto
function armarSaludo(usuario) {
  const nombre = (usuario?.nombre || '').trim()
  const primerNombre = nombre.split(/\s+/)[0] || ''
  const esJefe = /fabricio|ariel/i.test(nombre)
  const trato = esJefe ? `jefe${primerNombre ? ' ' + primerNombre : ''}` : (primerNombre || 'crack')
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }))
  if (hora < 13) return `¡Buen día, ${trato}! ☀️ Acá Chad, a tu servicio. ¿Con qué arrancamos?`
  if (hora < 19) return `¡Hola ${trato}! 🦾 ¿Cómo viene tu día? Pedime lo que necesites.`
  return `¡Hola ${trato}! 🌙 ¿Cómo estuvo tu día? Acá estoy para lo que haga falta.`
}

export default function AsistenteIA() {
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState([
    { rol: 'asistente', texto: '¡Hola! Soy Chad, tu asistente. Manejo todo el sistema (gastos, depósito, pagos, deudas, stock) y también te asesoro como profesional: temas laborales, decisiones de negocio, producción, marketing, ventas y finanzas. 🎤 También podés hablarme con el micrófono.' }
  ])

  // 👤 Quién está logueado — para que FABRI te reconozca sin preguntar
  const [usuario, setUsuario] = useState(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: perfil } = await supabase.from('profiles').select('nombre, rol').eq('id', user.id).maybeSingle()
        if (vivo) setUsuario({ nombre: perfil?.nombre || user.email, rol: perfil?.rol || '' })
      } catch { /* sin identidad, FABRI sigue funcionando genérico */ }
    })()
    return () => { vivo = false }
  }, [])

  // 🌅 Primera charla del día: saludo personalizado (una vez por día por usuario)
  useEffect(() => {
    if (!abierto || !usuario) return
    const clave = `fabri_saludo_${fechaHoyARG()}_${usuario.nombre}`
    if (localStorage.getItem(clave)) return
    localStorage.setItem(clave, '1')
    const saludo = armarSaludo(usuario)
    setMensajes([{ rol: 'asistente', texto: saludo }])
    if (vozActiva) hablar(saludo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, usuario])
  const [input, setInput] = useState('')
  const [imagenSeleccionada, setImagenSeleccionada] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [historialGemini, setHistorialGemini] = useState([])
  const fileInputRef = useRef(null)
  const mensajesRef = useRef(null)

  // 🎤 Estado de voz
  const [escuchando, setEscuchando] = useState(false)
  const [vozActiva, setVozActiva] = useState(() => localStorage.getItem('fabri_voz') === '1') // 🔊 leer respuestas siempre
  const recognitionRef = useRef(null)
  const turnoDeVozRef = useRef(false) // el último mensaje entró por micrófono → responder hablando

  // ⚙️ Selector de voz: las voces las pone el navegador/Windows (getVoices
  // carga async → escuchamos voiceschanged). La elegida persiste en localStorage.
  const [mostrarConfigVoz, setMostrarConfigVoz] = useState(false)
  const [vocesES, setVocesES] = useState([])
  const [vozElegida, setVozElegida] = useState(() => localStorage.getItem('fabri_voz_nombre') || '')
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const cargarVoces = () => {
      const todas = window.speechSynthesis.getVoices()
      setVocesES(todas.filter(v => v.lang?.toLowerCase().startsWith('es')))
    }
    cargarVoces()
    window.speechSynthesis.addEventListener?.('voiceschanged', cargarVoces)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', cargarVoces)
  }, [])
  function elegirVoz(nombre) {
    setVozElegida(nombre)
    if (nombre) localStorage.setItem('fabri_voz_nombre', nombre)
    else localStorage.removeItem('fabri_voz_nombre')
  }

  function toggleVoz() {
    setVozActiva(v => {
      const nuevo = !v
      localStorage.setItem('fabri_voz', nuevo ? '1' : '0')
      if (!nuevo) window.speechSynthesis?.cancel()
      return nuevo
    })
  }

  // 🎙️ MODO CONVERSACIÓN: escucha continua. Ciclo: escuchar → enviar →
  // FABRI responde HABLANDO (mic apagado, para no escucharse a sí mismo) →
  // al terminar de hablar, el mic se vuelve a prender solo.
  const [modoConversacion, setModoConversacion] = useState(false)
  const modoConvRef = useRef(false)        // para los callbacks del recognizer/synth
  const reanudarTimerRef = useRef(null)
  const iniciarEscuchaRef = useRef(() => {})

  // ⏱️ Pausa de envío: lo dicho se ACUMULA y recién se envía después de
  // este silencio. Permite hablar tranquilo, frenar a pensar, y seguir —
  // sin que se dispare en la primera pausita. (Pedido de Fabricio.)
  const PAUSA_ENVIO_MS = 2200
  const finalAcumRef = useRef('')     // texto final acumulado entre pausas
  const silencioTimerRef = useRef(null)

  // Re-arma el micrófono si el modo conversación sigue activo y FABRI ya
  // terminó de hablar. El delay evita que el mic agarre la cola del audio.
  function reanudarSiConversacion() {
    if (!modoConvRef.current) return
    clearTimeout(reanudarTimerRef.current)
    reanudarTimerRef.current = setTimeout(() => {
      if (!modoConvRef.current) return
      if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) return // sigue hablando: su onend reintenta
      iniciarEscuchaRef.current?.()
    }, 450)
  }

  // Responder en voz alta si corresponde (toggle global, turno por mic, o conversación)
  function hablarSiCorresponde(texto) {
    if (vozActiva || turnoDeVozRef.current || modoConvRef.current) {
      hablar(texto, () => reanudarSiConversacion())
    } else {
      reanudarSiConversacion()
    }
  }

  // Envía lo acumulado (lo dispara el timer de silencio o el cierre del recognizer)
  function enviarAcumulado(rec) {
    clearTimeout(silencioTimerRef.current)
    const txt = finalAcumRef.current.trim()
    finalAcumRef.current = ''
    setEscuchando(false)
    try { rec?.stop() } catch { /* ya detenido */ }
    if (txt) enviar(txt, { vozEntrada: true })
    else reanudarSiConversacion()
  }

  function iniciarEscucha() {
    if (!SpeechRecognitionAPI || escuchando || cargando) return
    try {
      const rec = new SpeechRecognitionAPI()
      recognitionRef.current = rec
      finalAcumRef.current = ''
      rec.lang = 'es-AR'
      rec.interimResults = true
      // continuous: el recognizer NO corta en la primera pausa — seguimos
      // acumulando y el envío lo decide NUESTRO timer de silencio.
      rec.continuous = true
      rec.onresult = (e) => {
        let parcial = ''
        let final = ''
        for (const res of e.results) {
          if (res.isFinal) final += res[0].transcript + ' '
          else parcial += res[0].transcript
        }
        finalAcumRef.current = final.trim()
        setInput((final + parcial).trim())
        clearTimeout(silencioTimerRef.current)
        if (parcial) return // sigue hablando: no arrancar el contador
        if (final.trim()) {
          // Hubo una pausa: arrancar el contador. Si retoma, se resetea solo.
          silencioTimerRef.current = setTimeout(() => enviarAcumulado(rec), PAUSA_ENVIO_MS)
        }
      }
      rec.onerror = (e) => {
        setEscuchando(false)
        clearTimeout(silencioTimerRef.current)
        // Sin permiso de micrófono → apagar el modo conversación (si no, loop de errores)
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          modoConvRef.current = false
          setModoConversacion(false)
        }
      }
      rec.onend = () => {
        // El navegador cortó solo (silencio largo): si quedó texto, se envía;
        // si no, en modo conversación se re-arma.
        if (finalAcumRef.current.trim()) enviarAcumulado(null)
        else { setEscuchando(false); reanudarSiConversacion() }
      }
      setEscuchando(true)
      window.speechSynthesis?.cancel() // si estaba hablando, que se calle para escuchar
      rec.start()
    } catch {
      setEscuchando(false)
    }
  }
  iniciarEscuchaRef.current = iniciarEscucha

  function detenerEscucha() {
    // Cancelación manual: NO se envía lo acumulado
    clearTimeout(silencioTimerRef.current)
    finalAcumRef.current = ''
    try { recognitionRef.current?.stop() } catch { /* ya detenido */ }
    setEscuchando(false)
  }

  function toggleConversacion() {
    if (modoConvRef.current) {
      modoConvRef.current = false
      setModoConversacion(false)
      clearTimeout(reanudarTimerRef.current)
      window.speechSynthesis?.cancel()
      detenerEscucha()
    } else {
      modoConvRef.current = true
      setModoConversacion(true)
      window.speechSynthesis?.cancel()
      iniciarEscucha()
    }
  }

  useEffect(() => {
    if (mensajesRef.current) mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight
  }, [mensajes, cargando])

  async function enviar(textoVoz = null, { vozEntrada = false } = {}) {
    // textoVoz solo es string cuando viene del micrófono (el onClick del
    // botón pasa el evento — se ignora)
    const textoDirecto = typeof textoVoz === 'string' ? textoVoz : null
    if (!textoDirecto && !input.trim() && !imagenSeleccionada) return
    if (cargando) return

    const textoUsuario = (textoDirecto ?? input).trim()
    const imagen = textoDirecto ? null : imagenSeleccionada
    turnoDeVozRef.current = vozEntrada
    setInput('')
    if (!textoDirecto) setImagenSeleccionada(null)

    // 🧭 Comandos de navegación: no gastan IA, responden al instante
    const nav = !imagen && detectarNavegacion(textoUsuario)
    if (nav) {
      setMensajes(prev => [...prev,
        { rol: 'usuario', texto: textoUsuario },
        { rol: 'asistente', texto: `🧭 Te llevo a ${nav.nombre}` },
      ])
      hablarSiCorresponde(`Te llevo a ${nav.nombre}`)
      navigate(nav.ruta)
      return
    }

    setCargando(true)

    setMensajes(prev => [...prev, {
      rol: 'usuario',
      texto: textoUsuario || '(foto)',
      tieneImagen: !!imagen,
      imagenPreview: imagen?.preview
    }])

    try {
      const imagenData = imagen ? { data: imagen.data, mimeType: imagen.mimeType } : null
      const mensajeNuevo = construirMensajeUsuario(
        textoUsuario || 'Analizá esta imagen y decime qué es y qué datos puedo extraer.',
        imagenData
      )

      let historialActualizado = [...historialGemini, mensajeNuevo]

      // 🎓 SKILLS DE CHAD: si el mensaje toca un tema profesional (laboral,
      // ejecutivo, producción, marketing, ventas, finanzas), se inyecta el
      // modo experto correspondiente al prompt — solo para esta llamada.
      const skillsTxt = detectarSkills(textoUsuario || '')

      // 🧠 MEMORIA DE CHAD: lo aprendido en charlas anteriores entra al
      // prompt de cada llamada (fresco de la base, por si recordó/olvidó algo
      // en este mismo turno). Si falla, FABRI sigue sin memoria, no se rompe.
      let memoriaTxt = ''
      try {
        const { data: mems } = await supabase.from('fabri_memoria')
          .select('id, usuario, tipo, contenido')
          .eq('activa', true)
          .order('created_at', { ascending: false })
          .limit(60)
        if (mems && mems.length > 0) {
          memoriaTxt = '\n\nTU MEMORIA (lo que aprendiste en charlas anteriores — usala para tratar a cada uno como le gusta y recordar el negocio; podés olvidar recuerdos por su [id]):\n' +
            mems.map(m => `[${m.id}]${m.usuario ? ` (sobre ${m.usuario})` : ''} ${m.contenido}`).join('\n')
        }
      } catch { /* sin memoria, FABRI funciona igual */ }

      let intentos = 0
      while (intentos < 8) {
        intentos++
        const respuesta = await llamarGemini({
          historial: historialActualizado,
          // Contexto vivo: quién está hablando, qué día es y la memoria
          // acumulada — así FABRI reconoce, recuerda y se adapta.
          systemPrompt: `${SYSTEM_PROMPT}${skillsTxt}\n\nUSUARIO LOGUEADO AHORA: ${usuario?.nombre || 'desconocido'}${usuario?.rol ? ` (rol: ${usuario.rol})` : ''}. FECHA DE HOY: ${fechaHoyARG()}.${memoriaTxt}`,
          tools: DEFINICIONES_TOOLS
        })

        historialActualizado.push(construirMensajeModelo(respuesta.texto, respuesta.llamadaFuncion))

        if (respuesta.texto) {
          setMensajes(prev => [...prev, { rol: 'asistente', texto: respuesta.texto }])
          hablarSiCorresponde(respuesta.texto)
        }

        if (respuesta.llamadaFuncion) {
          const { nombre, argumentos } = respuesta.llamadaFuncion
          const resultado = await ejecutarFuncion(nombre, argumentos)
          historialActualizado.push(construirMensajeFuncionResultado(nombre, resultado))
          continue
        }

        break
      }

      setHistorialGemini(historialActualizado)
    } catch (err) {
      console.error('Error:', err)
      setMensajes(prev => [...prev, {
        rol: 'asistente',
        texto: `❌ Error: ${err.message}`,
        esError: true
      }])
    } finally {
      setCargando(false)
      // Modo conversación: si FABRI no quedó hablando (respuesta sin texto o
      // error), re-armar el micrófono igual para no cortar la charla.
      reanudarSiConversacion()
    }
  }

  async function manejarImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { alert('Solo se aceptan imágenes.'); return }
    const { data, mimeType } = await archivoABase64(file)
    const preview = URL.createObjectURL(file)
    setImagenSeleccionada({ data, mimeType, preview, nombre: file.name })
    e.target.value = ''
  }

  function manejarEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
  }

  function nuevaConversacion() {
    setMensajes([{ rol: 'asistente', texto: '¡Listo, empezamos de nuevo! ¿En qué te ayudo?' }])
    setHistorialGemini([])
    setImagenSeleccionada(null)
  }

  return (
    <>
      {!abierto && (
        <button onClick={() => setAbierto(true)} style={estilos.botonFlotante} aria-label="Abrir asistente">
          🤖
        </button>
      )}

      {abierto && (
        <div style={estilos.panel}>
          <div style={estilos.header}>
            <div>
              <div style={estilos.headerTitulo}>🦾 CHAD</div>
              <div style={estilos.headerSubtitulo}>{usuario ? `Al servicio de ${usuario.nombre.trim().split(/\s+/)[0]}` : 'Asistente'} · IA{SpeechRecognitionAPI ? ' · 🎤 voz' : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={toggleVoz} style={{ ...estilos.botonHeader, ...(vozActiva ? estilos.botonVozActiva : {}) }}
                title={vozActiva ? 'Respuestas habladas: SÍ (click para silenciar)' : 'Respuestas habladas: NO (click para activar)'}>
                {vozActiva ? '🔊' : '🔇'}
              </button>
              <button onClick={() => setMostrarConfigVoz(v => !v)}
                style={{ ...estilos.botonHeader, ...(mostrarConfigVoz ? estilos.botonVozActiva : {}) }}
                title="Elegir la voz del asistente">⚙️</button>
              <button onClick={nuevaConversacion} style={estilos.botonHeader} title="Nueva conversación">🗑️</button>
              <button onClick={() => { if (modoConvRef.current) toggleConversacion(); setAbierto(false) }} style={estilos.botonHeader} title="Cerrar">✕</button>
            </div>
          </div>

          {mostrarConfigVoz && (
            <div style={estilos.configVoz}>
              <div style={{ fontSize: 11, color: '#c9a84c', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
                🗣️ VOZ DEL ASISTENTE
              </div>
              {vocesES.length === 0 ? (
                <div style={{ fontSize: 11, color: '#6a6a50' }}>
                  Este navegador no tiene voces en español instaladas.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={vozElegida} onChange={e => elegirVoz(e.target.value)} style={estilos.selectVoz}>
                    <option value="">Automática (es-AR)</option>
                    {vocesES.map(v => (
                      <option key={v.name} value={v.name}>{v.name.replace(/^Microsoft |^Google /, '')} · {v.lang}</option>
                    ))}
                  </select>
                  <button onClick={() => hablar(FRASE_PRUEBA_VOZ)} style={estilos.botonProbarVoz} title="Escuchar esta voz">
                    ▶ Probar
                  </button>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#6a6a50', marginTop: 6, lineHeight: 1.4 }}>
                💡 Para más voces (graves estilo mayordomo 🦾): Windows → Configuración → Hora e idioma → Voz → Agregar voces → Español. Las nuevas aparecen acá tras reiniciar Chrome.
              </div>
            </div>
          )}

          <div style={estilos.mensajes} ref={mensajesRef}>
            {mensajes.map((m, i) => (
              <div key={i} style={{
                ...estilos.mensaje,
                ...(m.rol === 'usuario' ? estilos.mensajeUsuario : estilos.mensajeAsistente),
                ...(m.esError ? estilos.mensajeError : {})
              }}>
                {m.imagenPreview && <img src={m.imagenPreview} alt="" style={estilos.imagenPreview} />}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</div>
              </div>
            ))}
            {cargando && (
              <div style={{ ...estilos.mensaje, ...estilos.mensajeAsistente }}>
                <div style={estilos.cargando}>
                  <span style={estilos.punto}>·</span>
                  <span style={{ ...estilos.punto, animationDelay: '0.2s' }}>·</span>
                  <span style={{ ...estilos.punto, animationDelay: '0.4s' }}>·</span>
                </div>
              </div>
            )}
          </div>

          {imagenSeleccionada && (
            <div style={estilos.previewBox}>
              <img src={imagenSeleccionada.preview} alt="" style={estilos.previewImagen} />
              <span style={{ fontSize: 11, color: '#c8c0b0', flex: 1 }}>{imagenSeleccionada.nombre}</span>
              <button onClick={() => setImagenSeleccionada(null)} style={estilos.botonHeader}>✕</button>
            </div>
          )}

          <div style={estilos.inputBox}>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={manejarImagen} style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()} style={estilos.botonAdjuntar} title="Subir foto">📎</button>
            {SpeechRecognitionAPI && (
              <button onClick={escuchando && !modoConversacion ? detenerEscucha : iniciarEscucha}
                style={{ ...estilos.botonAdjuntar, ...(escuchando ? estilos.botonMicEscuchando : {}) }}
                title={escuchando ? 'Escuchando… (click para cortar)' : 'Hablarle una vez'}>
                🎤
              </button>
            )}
            {SpeechRecognitionAPI && (
              <button onClick={toggleConversacion}
                style={{ ...estilos.botonAdjuntar, ...(modoConversacion ? estilos.botonConvActiva : {}) }}
                title={modoConversacion
                  ? 'Modo conversación ACTIVO: Chad escucha de corrido (click para cortar)'
                  : 'Modo conversación: hablá de corrido sin apretar nada — Chad responde y vuelve a escuchar solo'}>
                🎙️
              </button>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={manejarEnter}
              placeholder={
                escuchando ? '🎤 Escuchando… (2 seg de silencio = enviar)'
                : modoConversacion ? (cargando ? '🤔 Chad pensando…' : '🎙️ Conversación activa — hablá tranquilo')
                : 'Pedime algo...'
              }
              rows={1}
              style={{ ...estilos.textarea, ...(escuchando ? { borderColor: '#e74c3c' } : modoConversacion ? { borderColor: '#2ecc71' } : {}) }}
              disabled={cargando}
            />
            <button onClick={() => enviar()} disabled={cargando || (!input.trim() && !imagenSeleccionada)} style={estilos.botonEnviar}>
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }
        @keyframes micPulso {
          0%, 100% { box-shadow: 0 0 0 0 rgba(231,76,60,0.5); }
          50% { box-shadow: 0 0 0 8px rgba(231,76,60,0); }
        }
        @keyframes convPulso {
          0%, 100% { box-shadow: 0 0 0 0 rgba(46,204,113,0.5); }
          50% { box-shadow: 0 0 0 8px rgba(46,204,113,0); }
        }
      `}</style>
    </>
  )
}

const estilos = {
  botonFlotante: {
    position: 'fixed', bottom: 24, right: 24, width: 60, height: 60,
    borderRadius: '50%', border: '2px solid #c9a84c',
    background: 'linear-gradient(135deg, #1c1c18, #131310)',
    color: '#c9a84c', fontSize: 28, cursor: 'pointer',
    boxShadow: '0 6px 24px rgba(0,0,0,0.4), 0 0 0 4px rgba(201,168,76,0.1)',
    zIndex: 9999, transition: 'transform 0.2s',
  },
  panel: {
    position: 'fixed', bottom: 24, right: 24, width: 400, height: 600,
    maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
    background: '#131310', border: '1px solid #28281e', borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', zIndex: 9999,
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    padding: '14px 16px', borderBottom: '1px solid #28281e',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(135deg, #1c1c18, #131310)',
    borderRadius: '16px 16px 0 0',
  },
  headerTitulo: { fontFamily: "'Bebas Neue', cursive", fontSize: 20, letterSpacing: 2, color: '#c9a84c' },
  headerSubtitulo: { fontSize: 10, color: '#6a6a50', letterSpacing: 1 },
  botonHeader: {
    background: 'transparent', border: '1px solid #333328', borderRadius: 8,
    color: '#c8c0b0', width: 30, height: 30, cursor: 'pointer', fontSize: 14,
  },
  mensajes: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  mensaje: { padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, maxWidth: '85%', wordWrap: 'break-word' },
  mensajeUsuario: { background: '#8a6e2a', color: '#f0ece0', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  mensajeAsistente: { background: '#1c1c18', color: '#f0ece0', alignSelf: 'flex-start', border: '1px solid #28281e', borderBottomLeftRadius: 4 },
  mensajeError: { background: '#3a1a1a', borderColor: '#c0392b', color: '#e74c3c' },
  imagenPreview: { maxWidth: '100%', borderRadius: 8, marginBottom: 6, display: 'block' },
  cargando: { display: 'flex', gap: 4, padding: '4px 0' },
  punto: { fontSize: 24, lineHeight: 0.5, color: '#c9a84c', animation: 'blink 1.4s infinite' },
  previewBox: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    background: '#1c1c18', borderTop: '1px solid #28281e',
  },
  previewImagen: { width: 40, height: 40, borderRadius: 6, objectFit: 'cover' },
  inputBox: {
    display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #28281e',
    background: '#131310', borderRadius: '0 0 16px 16px', alignItems: 'flex-end',
  },
  botonAdjuntar: {
    background: '#1c1c18', border: '1px solid #28281e', borderRadius: 10,
    color: '#c9a84c', width: 38, height: 38, cursor: 'pointer', fontSize: 16,
    flexShrink: 0,
  },
  botonMicEscuchando: {
    background: '#3a1a1a', border: '1px solid #e74c3c',
    animation: 'micPulso 1.2s ease-in-out infinite',
  },
  botonConvActiva: {
    background: '#0e2a1a', border: '1px solid #2ecc71', color: '#2ecc71',
    animation: 'convPulso 1.6s ease-in-out infinite',
  },
  configVoz: {
    padding: '10px 14px', background: '#181814', borderBottom: '1px solid #28281e',
  },
  selectVoz: {
    flex: 1, background: '#1c1c18', border: '1px solid #28281e', borderRadius: 8,
    color: '#f0ece0', fontSize: 12, padding: '7px 8px', fontFamily: "'DM Sans', sans-serif",
  },
  botonProbarVoz: {
    background: '#c9a84c', border: 'none', borderRadius: 8, color: '#0a0a08',
    padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0,
  },
  botonVozActiva: {
    border: '1px solid #c9a84c', color: '#c9a84c', background: 'rgba(201,168,76,0.12)',
  },
  textarea: {
    flex: 1, background: '#1c1c18', border: '1px solid #28281e', borderRadius: 10,
    padding: '10px 12px', color: '#f0ece0', fontSize: 14, resize: 'none',
    fontFamily: "'DM Sans', sans-serif", outline: 'none', maxHeight: 100,
  },
  botonEnviar: {
    background: '#c9a84c', border: 'none', borderRadius: 10,
    color: '#0a0a08', width: 38, height: 38, cursor: 'pointer', fontSize: 16,
    fontWeight: 700, flexShrink: 0,
  },
}
