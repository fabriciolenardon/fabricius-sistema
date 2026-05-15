// ═══════════════════════════════════════════════════════════
// CONEXIÓN CON GEMINI API
// ═══════════════════════════════════════════════════════════
// Este archivo se encarga de hablar con la IA de Google (Gemini).
// Soporta: chat conversacional, lectura de imágenes y function calling.
// ═══════════════════════════════════════════════════════════

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const MODEL = 'gemini-2.5-flash' // El modelo gratuito y rápido
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

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
  if (!GEMINI_API_KEY) {
    throw new Error('Falta la API key de Gemini. Configurá VITE_GEMINI_API_KEY en Vercel.')
  }

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

  const response = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Error Gemini:', errorText)
    throw new Error(`Error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  return parsearRespuesta(data)
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
