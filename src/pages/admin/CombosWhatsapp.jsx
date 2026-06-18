// CombosWhatsapp.jsx — Gestión de las imágenes que Iris manda por WhatsApp:
// combos/bolsones armados y las placas de ofertas de la semana (mayoristas y
// minoristas). Cada sección sube a su categoría en combos_imagenes (bucket
// público 'combos'); el webhook (Iris) las envía por su URL pública.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const SECCIONES = [
  { categoria: 'combo',      titulo: '📦 Combos / Bolsones',        desc: 'Fotos de los combos armados. Iris las manda cuando preguntan por combos o bolsones.' },
  { categoria: 'oferta_may', titulo: '🚚 Ofertas Mayoristas',       desc: 'Placa de ofertas mayoristas de la semana. Iris la manda a clientes mayoristas/gastronómicos/carniceros. Subila nueva cada semana.' },
  { categoria: 'oferta_min', titulo: '🏪 Ofertas Semanales (minorista)', desc: 'Placa de ofertas para clientes de mostrador. Iris la manda a minoristas. Subila nueva cada semana.' },
]

export default function CombosWhatsapp() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={aviso}>
        🖼️ Subí acá las imágenes que <strong>Iris manda por WhatsApp</strong>. Los <strong>combos</strong> son fijos; las <strong>ofertas</strong> cambian cada semana: cuando tengas las placas nuevas, borrá las viejas y subí las nuevas. (Máx 5MB por imagen.)
      </div>
      {SECCIONES.map(s => <SeccionImagenes key={s.categoria} {...s} />)}
    </div>
  )
}

function SeccionImagenes({ categoria, titulo, desc }) {
  const [imgs, setImgs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setCargando(true)
    const { data } = await supabase.from('combos_imagenes').select('*').eq('categoria', categoria)
      .order('orden', { ascending: true }).order('creado_at', { ascending: true })
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
      const path = `${categoria}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('combos').upload(path, file, { contentType: file.type })
      if (error) { alert('No se pudo subir: ' + error.message); continue }
      const { data: pub } = supabase.storage.from('combos').getPublicUrl(path)
      const orden = (imgs.length ? Math.max(...imgs.map(i => i.orden || 0)) : 0) + 1
      const { error: insErr } = await supabase.from('combos_imagenes').insert({ url: pub.publicUrl, path, orden, categoria })
      if (insErr) { alert('No se pudo registrar: ' + insErr.message) }
    }
    setSubiendo(false)
    if (fileRef.current) fileRef.current.value = ''
    cargar()
  }

  async function borrar(c) {
    if (!confirm('¿Borrar esta imagen? Iris dejará de enviarla.')) return
    await supabase.storage.from('combos').remove([c.path]).catch(() => {})
    await supabase.from('combos_imagenes').delete().eq('id', c.id)
    cargar()
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{titulo}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px', lineHeight: 1.45 }}>{desc}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => subir(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={subiendo} style={{ ...btn, opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ? 'Subiendo…' : '⬆️ Subir imagen'}
        </button>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{cargando ? 'Cargando…' : `${imgs.length} cargada(s)`}</span>
      </div>
      {!cargando && imgs.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 14, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
          Sin imágenes todavía.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {imgs.map(c => (
          <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <img src={c.url} alt="" style={{ width: '100%', borderRadius: 6, display: 'block', aspectRatio: '3/4', objectFit: 'cover' }} />
            <button onClick={() => borrar(c)} style={btnBorrar} title="Borrar">🗑️ Borrar</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const aviso = { background: 'rgba(0,170,255,0.06)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }
const btn = { padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, fontFamily: "'DM Sans',sans-serif", background: 'var(--gold)', color: '#000' }
const btnBorrar = { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, fontWeight: 700 }
