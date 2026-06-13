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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    // Sin key configurada: el front usa la voz del navegador.
    return res.status(503).json({ error: 'ElevenLabs no configurado' })
  }

  try {
    const { text, voiceId } = req.body || {}
    const limpio = String(text || '').trim().slice(0, 800) // tope de seguridad de caracteres
    if (!limpio) return res.status(400).json({ error: 'Falta el texto' })

    const voz = voiceId || process.env.ELEVENLABS_VOICE_ID || VOZ_DEFAULT
    const modelo = process.env.ELEVENLABS_MODEL || MODELO_DEFAULT

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: limpio,
        model_id: modelo,
        // Ajustes equilibrados: natural pero estable para uso diario
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
      }),
    })

    if (!r.ok) {
      const detalle = await r.text().catch(() => '')
      console.error('ElevenLabs error', r.status, detalle.slice(0, 300))
      // 401/403 = key mala; 429 = sin créditos. El front cae a voz navegador.
      return res.status(r.status === 429 ? 429 : 502).json({ error: 'ElevenLabs no disponible' })
    }

    const audio = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(audio)
  } catch (err) {
    console.error('TTS handler error:', err)
    return res.status(500).json({ error: 'Error generando la voz' })
  }
}
