// ═══════════════════════════════════════════════════════════
// CONEXIÓN CON GEMINI API
// ═══════════════════════════════════════════════════════════
// Este archivo se encarga de hablar con la IA de Google (Gemini).
// Soporta: chat conversacional, lectura de imágenes y function calling.
// ═══════════════════════════════════════════════════════════

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

// ── Cadena de modelos con FALLBACK por cuota ──────────────────
// El plan gratuito de Gemini tiene cupo DIARIO POR MODELO. Cuando un
// modelo devuelve 429 (cuota agotada), pasamos al siguiente — cada uno
// tiene su propio cupo, así Chad sigue respondiendo. El modelo agotado
// queda marcado 10 minutos para no insistirle en cada mensaje.
const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
const agotadoHasta = {} // modelo → timestamp hasta el que no se intenta

function urlModelo(modelo) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`
}

const MSG_SIN_CUPO = 'Chad se quedó sin cupo gratuito de IA por hoy en todos los modelos 😞. El cupo se renueva solo cada día. Si esto pasa seguido, conviene activar la facturación del proyecto en Google AI Studio (el modelo flash cuesta centavos) — avisale a Claude y lo configuran juntos.'

// POST a un modelo concreto. Devuelve { ok, status, data?, errorText? }
async function postGemini(modelo, body) {
  const response = await fetch(`${urlModelo(modelo)}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (response.ok) return { ok: true, status: response.status, data: await response.json() }
  return { ok: false, status: response.status, errorText: await response.text() }
}

// Ejecuta el body contra la cadena de modelos, saltando los agotados.
// 429 / 503 → marca el modelo y prueba el siguiente. Otros errores cortan.
async function conFallback(body, etiqueta) {
  if (!GEMINI_API_KEY) throw new Error('Falta la API key de Gemini. Configurá VITE_GEMINI_API_KEY en Vercel.')
  let ultimoError = null
  for (const modelo of MODELOS) {
    if ((agotadoHasta[modelo] || 0) > Date.now()) continue
    const r = await postGemini(modelo, body)
    if (r.ok) return r.data
    console.error(`Error Gemini (${etiqueta}, ${modelo}):`, r.errorText)
    if (r.status === 429 || r.status === 503) {
      agotadoHasta[modelo] = Date.now() + 10 * 60 * 1000
      ultimoError = new Error(MSG_SIN_CUPO)
      continue
    }
    throw new Error(`Error ${r.status}: ${String(r.errorText).slice(0, 300)}`)
  }
  throw (ultimoError || new Error(MSG_SIN_CUPO))
}

// Convierte un archivo (foto) a base64 para mandarlo a Gemini
export async function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve({ data: base64, mimeType: file.type })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Llamada principal a Gemini
// historial: array de mensajes [{ role: 'user'|'model', parts: [...] }]
// systemPrompt: instrucciones del sistema
// tools: array de funciones que la IA puede llamar
export async function llamarGemini({ historial, systemPrompt, tools }) {
  const body = {
    contents: historial,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.3, // Más bajo = más preciso, menos creativo
      maxOutputTokens: 2048,
    }
  }

  if (tools && tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }]
  }

  const data = await conFallback(body, 'chat')
  return parsearRespuesta(data)
}

// ─────────────────────────────────────────────────────────────
// 🌐 BÚSQUEDA EN INTERNET — Gemini con grounding de Google Search
// ─────────────────────────────────────────────────────────────
// Gemini NO permite mezclar google_search con functionDeclarations en
// la misma llamada, así que la búsqueda es una llamada SEPARADA: la
// tool buscar_en_internet de Chad delega acá y devuelve el resultado
// al loop principal como cualquier otra función.
export async function buscarConGoogle(consulta) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: consulta }] }],
    systemInstruction: { parts: [{ text: 'Respondé en español argentino, breve y concreto, usando la información MÁS ACTUAL de la búsqueda. Incluí números, fechas y datos puntuales. Sin preámbulos.' }] },
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  }
  const data = await conFallback(body, 'búsqueda')
  const cand = data.candidates?.[0]
  const texto = (cand?.content?.parts || []).map(p => p.text || '').join('').trim()
  const fuentes = (cand?.groundingMetadata?.groundingChunks || [])
    .map(c => c.web?.title).filter(Boolean)
  return { texto: texto || 'La búsqueda no devolvió resultados.', fuentes: [...new Set(fuentes)].slice(0, 3) }
}

// Parsea la respuesta de Gemini y devuelve { texto, llamadaFuncion }
function parsearRespuesta(data) {
  const candidato = data.candidates?.[0]
  if (!candidato) return { texto: 'Sin respuesta de la IA.', llamadaFuncion: null }

  const partes = candidato.content?.parts || []
  let texto = ''
  let llamadaFuncion = null

  for (const parte of partes) {
    if (parte.text) texto += parte.text
    if (parte.functionCall) {
      llamadaFuncion = {
        nombre: parte.functionCall.name,
        argumentos: parte.functionCall.args || {}
      }
    }
  }

  return { texto: texto.trim(), llamadaFuncion }
}

// Construye un mensaje del usuario con texto + opcional imagen
export function construirMensajeUsuario(texto, imagen) {
  const parts = []
  if (texto) parts.push({ text: texto })
  if (imagen) parts.push({ inlineData: { mimeType: imagen.mimeType, data: imagen.data } })
  return { role: 'user', parts }
}

// Construye un mensaje del modelo (respuesta de la IA)
export function construirMensajeModelo(texto, llamadaFuncion) {
  const parts = []
  if (texto) parts.push({ text: texto })
  if (llamadaFuncion) {
    parts.push({ functionCall: { name: llamadaFuncion.nombre, args: llamadaFuncion.argumentos } })
  }
  return { role: 'model', parts }
}

// Construye un mensaje con el resultado de una función ejecutada
export function construirMensajeFuncionResultado(nombreFuncion, resultado) {
  return {
    role: 'user',
    parts: [{
      functionResponse: {
        name: nombreFuncion,
        response: { result: resultado }
      }
    }]
  }
}
