// CombosWhatsapp.jsx — Gestión de las fotos de combos que Iris manda por
// WhatsApp. Subís las imágenes (van al bucket público 'combos') y quedan
// registradas en combos_imagenes; cuando un cliente pregunta por combos,
// el webhook (Iris) las envía por su URL pública.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function CombosWhatsapp() {
  const [imgs, setImgs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setCargando(true)
    const { data } = await supabase.from('combos_imagenes').select('*').order('orden', { ascending: true }).order('creado_at', { ascending: true })
    setImgs(data || []); setCargando(false)
  }

  async function subir(files) {
    const lista = Array.from(files || [])
    if (lista.length === 0) return
    setSubiendo(true)
    for (const file of lista) {
      if (!file.type.startsWith('image/')) { alert(`${file.name} no es una imagen.`); continue }
      if (file.size > 5 * 1024 * 1024) { alert(`${file.name} pesa más de 5MB (WhatsApp no la aceptaría).`); continue }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `combo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('combos').upload(path, file, { contentType: file.type })
      if (error) { alert('No se pudo subir: ' + error.message); continue }
      const { data: pub } = supabase.storage.from('combos').getPublicUrl(path)
      const orden = (imgs.length ? Math.max(...imgs.map(i => i.orden || 0)) : 0) + 1
      const { error: insErr } = await supabase.from('combos_imagenes').insert({ url: pub.publicUrl, path, orden })
      if (insErr) { alert('No se pudo registrar: ' + insErr.message) }
    }
    setSubiendo(false)
    if (fileRef.current) fileRef.current.value = ''
    cargar()
  }

  async function borrar(c) {
    if (!confirm('¿Borrar esta foto de combo? Iris dejará de enviarla.')) return
    await supabase.storage.from('combos').remove([c.path]).catch(() => {})
    await supabase.from('combos_imagenes').delete().eq('id', c.id)
    cargar()
  }

  return (
    <div>
      <div style={aviso}>
        📦 Subí acá las fotos de los <strong>combos/bolsones</strong>. Cuando un cliente pregunte por combos por WhatsApp, <strong>Iris se las manda solas</strong>. Para cambiar un combo, borrá la foto vieja y subí la nueva. (Máx 5MB por imagen.)
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0' }}>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo}
          style={{ ...btn, opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ? 'Subiendo…' : '⬆️ Subir fotos de combos'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {cargando ? 'Cargando…' : `${imgs.length} foto(s) cargada(s)`}
        </span>
      </div>

      {!cargando && imgs.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 12 }}>
          Todavía no subiste fotos de combos. Subí las imágenes y Iris ya las podrá enviar. 🥩
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {imgs.map(c => (
          <div key={c.id} style={card}>
            <img src={c.url} alt="combo" style={{ width: '100%', borderRadius: 8, display: 'block', aspectRatio: '3/4', objectFit: 'cover' }} />
            <button onClick={() => borrar(c)} style={btnBorrar} title="Borrar">🗑️ Borrar</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const aviso = { background: 'rgba(0,170,255,0.06)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }
const btn = { padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, fontFamily: "'DM Sans',sans-serif", background: 'var(--gold)', color: '#000' }
const btnBorrar = { padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }
