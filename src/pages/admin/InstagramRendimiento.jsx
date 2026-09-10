// Rendimiento de Instagram — qué de lo publicado funcionó y qué no.
// Lee las últimas 50 publicaciones con sus likes/comentarios (y el alcance, si
// el token tiene el permiso de estadísticas) y las ordena. La idea es decidir
// qué hacer la semana que viene mirando datos propios y no la intuición.
//
// OJO: no se promedia entre tipos distintos para sacar un número global —
// un reel y una foto no compiten en la misma cancha. Cada tipo se mide contra
// los de su clase.
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useEsMovil } from '../../lib/useEsMovil'

const TZ = 'America/Argentina/Buenos_Aires'
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const ICONO = { foto: '🖼️', carrusel: '🎠', reel: '🎬', video: '📹' }
const PLURAL = { foto: 'fotos', carrusel: 'carruseles', reel: 'reels', video: 'videos' }

function fechaARG(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit',
    })
  } catch { return '' }
}

function diaARG(iso) {
  try {
    // El día de la semana según Argentina, no según el navegador.
    const enARG = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
    return enARG.getDay()
  } catch { return null }
}

const num = (n) => (typeof n === 'number' ? n.toLocaleString('es-AR') : '—')

export default function InstagramRendimiento() {
  const esMovil = useEsMovil()
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')
  const [posts, setPosts] = useState([])
  const [conAlcance, setConAlcance] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true); setErr('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErr('No hay sesión activa.'); return }

      const r = await fetch('/api/instagram?posts=1', { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) { setErr(j?.error || `Error ${r.status}`); return }

      setPosts(j.posts || [])
      setConAlcance(!!j.conAlcance)
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setCargando(false)
    }
  }

  const caja = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: esMovil ? 16 : 22, marginBottom: 16,
  }

  if (cargando) {
    return <div style={{ ...caja, color: 'var(--muted)' }}>Leyendo tus publicaciones…</div>
  }

  if (err) {
    return (
      <div style={{ ...caja, borderColor: '#c0392b', background: 'rgba(192,57,43,0.08)' }}>
        <div style={{ fontWeight: 700, color: '#e74c3c', marginBottom: 6 }}>
          No se pudo leer el rendimiento
        </div>
        <div style={{ color: 'var(--text)', fontSize: 14.5 }}>{err}</div>
      </div>
    )
  }

  if (!posts.length) {
    return <div style={{ ...caja, color: 'var(--muted)' }}>Todavía no hay publicaciones para analizar.</div>
  }

  // ── Por tipo: cada uno contra los de su clase ──
  const porTipo = {}
  for (const p of posts) {
    if (!porTipo[p.tipo]) porTipo[p.tipo] = { tipo: p.tipo, n: 0, total: 0, alcance: 0, conAlc: 0 }
    const t = porTipo[p.tipo]
    t.n++; t.total += p.total
    if (typeof p.alcance === 'number') { t.alcance += p.alcance; t.conAlc++ }
  }
  const tipos = Object.values(porTipo)
    .map((t) => ({
      ...t,
      promedio: t.total / t.n,
      promAlcance: t.conAlc ? t.alcance / t.conAlc : null,
    }))
    .sort((a, b) => b.promedio - a.promedio)

  // ── Por día de la semana (solo con 2+ publicaciones, si no es anécdota) ──
  const porDia = {}
  for (const p of posts) {
    const d = diaARG(p.fecha)
    if (d === null) continue
    if (!porDia[d]) porDia[d] = { dia: d, n: 0, total: 0 }
    porDia[d].n++; porDia[d].total += p.total
  }
  const dias = Object.values(porDia)
    .filter((d) => d.n >= 2)
    .map((d) => ({ ...d, promedio: d.total / d.n }))
    .sort((a, b) => b.promedio - a.promedio)

  const ordenados = [...posts].sort((a, b) => b.total - a.total)
  const mejores = ordenados.slice(0, 5)
  const peores = ordenados.slice(-3).reverse()
  const promedioGeneral = posts.reduce((s, p) => s + p.total, 0) / posts.length

  return (
    <>
      {/* ── Qué formato rinde ── */}
      <div style={caja}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>Qué formato rinde</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '0 0 16px' }}>
          Promedio de likes + comentarios de cada tipo. Últimas {posts.length} publicaciones.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: esMovil ? '1fr' : `repeat(${Math.min(tipos.length, 4)}, 1fr)`,
          gap: 12,
        }}>
          {tipos.map((t, i) => (
            <div key={t.tipo} style={{
              background: 'var(--surface2)', borderRadius: 8, padding: 15,
              border: i === 0 ? '1px solid var(--amber)' : '1px solid transparent',
            }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                {ICONO[t.tipo] || '📄'} {t.n} {PLURAL[t.tipo] || t.tipo}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: i === 0 ? 'var(--amber)' : 'var(--text)' }}>
                {t.promedio.toFixed(0)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                interacciones promedio
              </div>
              {t.promAlcance !== null && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  {t.promAlcance.toFixed(0)} de alcance
                </div>
              )}
            </div>
          ))}
        </div>

        {tipos.length > 1 && tipos[0].n >= 2 && (
          <p style={{
            margin: '16px 0 0', padding: '12px 14px', background: 'var(--surface2)',
            borderRadius: 8, fontSize: 14.5, color: 'var(--text)', lineHeight: 1.6,
          }}>
            👉 Lo que mejor te funciona son <b>{PLURAL[tipos[0].tipo] || tipos[0].tipo}</b>
            {' '}({tipos[0].promedio.toFixed(0)} de promedio)
            {tipos[tipos.length - 1].promedio > 0 && (
              <> — {(tipos[0].promedio / tipos[tipos.length - 1].promedio).toFixed(1)}× más
              que {PLURAL[tipos[tipos.length - 1].tipo] || tipos[tipos.length - 1].tipo}</>
            )}.
          </p>
        )}

        {!conAlcance && (
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
            No se pudo leer el alcance (cuánta gente lo vio). Para tenerlo hay que agregarle
            el permiso <code>instagram_manage_insights</code> al token. Mientras tanto se
            comparan likes y comentarios, que sirve igual porque los seguidores son los mismos.
          </p>
        )}
      </div>

      {/* ── Mejores días ── */}
      {dias.length >= 2 && (
        <div style={caja}>
          <h2 style={{ fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>Qué días rinden</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '0 0 14px' }}>
            Solo los días con 2 o más publicaciones — con una sola es casualidad, no un dato.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dias.map((d) => {
              const pct = Math.max(4, (d.promedio / dias[0].promedio) * 100)
              return (
                <div key={d.dia} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 88, fontSize: 14, color: 'var(--text)', flexShrink: 0 }}>
                    {DIAS[d.dia]}
                  </div>
                  <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: 4, height: 22 }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: 'var(--amber)', borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ width: 78, fontSize: 13, color: 'var(--muted)', textAlign: 'right', flexShrink: 0 }}>
                    {d.promedio.toFixed(0)} · {d.n} pub.
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Top ── */}
      <div style={caja}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>Lo que más funcionó</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '0 0 16px' }}>
          El promedio de tu cuenta es {promedioGeneral.toFixed(0)} interacciones.
        </p>
        <Lista posts={mejores} esMovil={esMovil} promedio={promedioGeneral} />
      </div>

      {/* ── Peores ── */}
      <div style={caja}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>Lo que no enganchó</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '0 0 16px' }}>
          Sirve tanto como lo de arriba: esto es lo que conviene no repetir.
        </p>
        <Lista posts={peores} esMovil={esMovil} promedio={promedioGeneral} />
      </div>
    </>
  )
}

function Lista({ posts, esMovil, promedio }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {posts.map((p) => {
        const vs = promedio > 0 ? p.total / promedio : 1
        return (
          <a
            key={p.id}
            href={p.permalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', gap: 14, alignItems: 'center',
              background: 'var(--surface2)', borderRadius: 8, padding: 12,
              textDecoration: 'none', color: 'inherit',
            }}
          >
            {p.miniatura && (
              <img
                src={p.miniatura}
                alt=""
                style={{
                  width: esMovil ? 54 : 66, height: esMovil ? 54 : 66,
                  objectFit: 'cover', borderRadius: 6, flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 3 }}>
                {ICONO[p.tipo] || '📄'} {p.tipo} · {fechaARG(p.fecha)}
              </div>
              <div style={{
                fontSize: 14, color: 'var(--text)', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {p.texto ? p.texto.split('\n')[0] : '(sin texto)'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                {num(p.total)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {num(p.likes)} ♥ · {num(p.comentarios)} 💬
              </div>
              {promedio > 0 && (
                <div style={{
                  fontSize: 11.5, marginTop: 2,
                  color: vs >= 1 ? '#2ecc71' : 'var(--muted)',
                }}>
                  {vs >= 1 ? '+' : ''}{((vs - 1) * 100).toFixed(0)}% vs promedio
                </div>
              )}
            </div>
          </a>
        )
      })}
    </div>
  )
}
