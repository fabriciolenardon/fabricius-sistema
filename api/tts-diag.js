// TEMPORAL — diagnostica la ELEVENLABS_API_KEY (BORRAR luego).
// Protegido por ?secret=WHATSAPP_VERIFY_TOKEN. No expone la key completa.
export const config = { maxDuration: 20 }

export default async function handler(req, res) {
  try {
    const secret = req.query.secret
    if (secret !== (process.env.WHATSAPP_VERIFY_TOKEN || 'fabricius-iris-2026')) return res.status(403).json({ error: 'forbidden' })
    const raw = process.env.ELEVENLABS_API_KEY || ''
    const key = raw.trim()
    const meta = {
      tiene_key: !!raw,
      largo: raw.length,
      prefijo: raw.slice(0, 4),
      sufijo: raw.slice(-3),
      tiene_espacios_o_saltos: raw !== key,
    }
    let voicesStatus = null, ttsStatus = null, ttsBody = null
    if (key) {
      const rv = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
      voicesStatus = rv.status
      // Prueba REAL de text-to-speech con la voz Jessica.
      const rt = await fetch('https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: 'Hola, prueba.', model_id: 'eleven_multilingual_v2' }),
      })
      ttsStatus = rt.status
      ttsBody = rt.ok ? `[AUDIO OK ${rt.headers.get('content-type')}]` : await rt.text().then(t => { try { return JSON.parse(t) } catch { return String(t).slice(0, 400) } })
    }
    return res.status(200).json({ meta, voicesStatus, ttsStatus, ttsBody })
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
