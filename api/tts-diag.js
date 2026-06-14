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
    let userStatus = null, userBody = null, voicesStatus = null
    if (key) {
      const ru = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } })
      userStatus = ru.status
      userBody = await ru.text().then(t => { try { return JSON.parse(t) } catch { return String(t).slice(0, 300) } })
      const rv = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
      voicesStatus = rv.status
    }
    return res.status(200).json({ meta, userStatus, userBody, voicesStatus })
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
