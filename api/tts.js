// ═══════════════════════════════════════════════════════════
// TTS — Texto a voz con ElevenLabs (voz humana de Chad)
// ═══════════════════════════════════════════════════════════
// Corre EN EL SERVIDOR (función Vercel): la API key de ElevenLabs
// nunca llega al navegador. Recibe { text, voiceId? } y devuelve el
// audio MP3. Si falta la key o ElevenLabs falla, responde con un
// status de error y el front cae a la voz del navegador.
//
// Config por variables de entorno (Vercel → Settings → Env Vars):
//   ELEVENLABS_API_KEY   (obligatoria, secreta)
//   ELEVENLABS_VOICE_ID  (opcional — la voz elegida; default abajo)
//   ELEVENLABS_MODEL     (opcional — default eleven_flash_v2_5, el
//                         más barato y rápido, multilingüe/español)
// ═══════════════════════════════════════════════════════════

// Voz por defecto (premade multilingüe de ElevenLabs). Se puede pisar
// con ELEVENLABS_VOICE_ID sin tocar código.
// Voz elegida por Fabricio en la Voice Library de ElevenLabs.
const VOZ_DEFAULT = 'nTkjq09AuYgsNR8E4sDe'
const MODELO_DEFAULT = 'eleven_flash_v2_5'
// Velocidad de habla (ElevenLabs: 0.7 lenta … 1.0 normal … 1.2 rápida).
// 1.12 = un toque más ágil que lo normal. Pisable con ELEVENLABS_SPEED.
const VELOCIDAD_DEFAULT = 1.12

// Extiende el límite de ejecución de la función (default Hobby = 10s, que
// cortaba el llamado a ElevenLabs y devolvía 502 sin cuerpo). 60s es el
// techo de Hobby; alcanza de sobra para TTS de una frase.
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  // TODO en try/catch: ningún error queda en 502 vacío, siempre hay cuerpo.
  try {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(503).json({ error: 'ElevenLabs no configurado (falta API key)' })

    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const { text, voiceId } = body || {}
    const limpio = String(text || '').trim().slice(0, 800)
    if (!limpio) return res.status(400).json({ error: 'Falta el texto' })

    const voz = voiceId || process.env.ELEVENLABS_VOICE_ID || VOZ_DEFAULT
    const modelo = process.env.ELEVENLABS_MODEL || MODELO_DEFAULT
    let velocidad = Number(process.env.ELEVENLABS_SPEED) || VELOCIDAD_DEFAULT
    velocidad = Math.min(1.2, Math.max(0.7, velocidad))

    // Timeout interno por debajo del techo de la función (45s < 60s): si
    // ElevenLabs cuelga, abortamos y respondemos con cuerpo (no 502 vacío).
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 45000)
    const t0 = Date.now()
    let r
    try {
      r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: limpio,
          model_id: modelo,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true, speed: velocidad },
        }),
        signal: ctrl.signal,
      })
    } finally { clearTimeout(timer) }

    if (!r.ok) {
      const detalle = await r.text().catch(() => '')
      console.error('ElevenLabs error', r.status, detalle.slice(0, 300))
      return res.status(r.status === 429 ? 429 : 502).json({
        error: 'ElevenLabs no disponible', elStatus: r.status, elDetalle: detalle.slice(0, 300),
      })
    }

    const audio = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-TTS-Ms', String(Date.now() - t0)) // cuánto tardó ElevenLabs (diagnóstico)
    return res.status(200).send(audio)
  } catch (err) {
    console.error('TTS handler error:', err)
    return res.status(500).json({ error: 'Error en TTS', detalle: `${err?.name || 'Error'}: ${err?.message || err}` })
  }
}
