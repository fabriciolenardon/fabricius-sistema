// Instagram — panel de conexión con la cuenta del negocio.
// Le pega a /api/instagram?check=1 con la sesión de admin (el endpoint pide
// Authorization, así que no se puede abrir la URL a mano en el navegador) y
// muestra el resultado en criollo: si el token anda, a qué cuenta llega, y qué
// falta cargar. Todo el trabajo pesado está en api/instagram.js.
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useEsMovil } from '../../lib/useEsMovil'
import InstagramRendimiento from './InstagramRendimiento'

export default function Instagram() {
  const esMovil = useEsMovil()
  const [cargando, setCargando] = useState(false)
  const [res, setRes] = useState(null)     // respuesta parseada
  const [err, setErr] = useState('')       // error de red o del endpoint
  const [copiado, setCopiado] = useState('')

  // Consulta el estado al entrar: si no, recargar la página deja la pantalla
  // como si estuviera desconectada y asusta.
  useEffect(() => { probar() }, [])

  async function probar() {
    setCargando(true); setErr(''); setRes(null); setCopiado('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErr('No hay sesión activa. Volvé a entrar al sistema.'); return }

      const r = await fetch('/api/instagram?check=1', { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json().catch(() => null)

      if (!j) { setErr(`El servidor respondió ${r.status} sin datos.`); return }
      setRes(j)
      if (!r.ok) setErr(j.error || `Error ${r.status}`)
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setCargando(false)
    }
  }

  async function copiar(txt, cual) {
    try {
      await navigator.clipboard.writeText(txt)
      setCopiado(cual)
      setTimeout(() => setCopiado(''), 2500)
    } catch {
      setErr('No se pudo copiar. Seleccionalo y copialo a mano.')
    }
  }

  const caja = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: esMovil ? 16 : 22,
    marginBottom: 16,
  }

  const cuentas = Array.isArray(res?.cuentas) ? res.cuentas : []
  const yaConfigurada = res?.ok && res?.cuenta

  return (
    <div style={{ padding: esMovil ? 12 : 20, maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontSize: esMovil ? 22 : 28, margin: '0 0 6px', color: 'var(--text)' }}>
        📸 Instagram
      </h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 22px', fontSize: 15, lineHeight: 1.5 }}>
        Conexión con la cuenta del negocio para publicar desde el sistema.
      </p>

      <div style={caja}>
        <button
          onClick={probar}
          disabled={cargando}
          style={{
            background: cargando ? 'var(--surface2)' : 'var(--amber)',
            color: cargando ? 'var(--muted)' : '#1a1a1a',
            border: 'none', borderRadius: 8,
            padding: '13px 26px', fontSize: 16, fontWeight: 700,
            cursor: cargando ? 'default' : 'pointer',
            width: esMovil ? '100%' : 'auto',
          }}
        >
          {cargando ? 'Probando…' : '🔌 Probar de nuevo'}
        </button>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '12px 0 0', lineHeight: 1.5 }}>
          Verifica el token contra Meta y busca la cuenta de Instagram. No publica nada.
        </p>
      </div>

      {/* ── Error ── */}
      {err && (
        <div style={{ ...caja, borderColor: '#c0392b', background: 'rgba(192,57,43,0.08)' }}>
          <div style={{ fontWeight: 700, color: '#e74c3c', marginBottom: 8, fontSize: 16 }}>
            No se pudo conectar
          </div>
          <div style={{ color: 'var(--text)', fontSize: 15, lineHeight: 1.55 }}>{err}</div>

          {Array.isArray(res?.revisar) && res.revisar.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: '16px 0 8px', color: 'var(--text)', fontSize: 14 }}>
                Qué revisar:
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text)', fontSize: 14.5, lineHeight: 1.7 }}>
                {res.revisar.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </>
          )}

          {Array.isArray(res?.paginasVistas) && res.paginasVistas.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 13.5, color: 'var(--muted)' }}>
              Páginas que sí vio el token: {res.paginasVistas.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* ── Falta cargar el ID: mostramos el que encontró ── */}
      {cuentas.length > 0 && (
        <div style={{ ...caja, borderColor: 'var(--amber)' }}>
          <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 4, fontSize: 17 }}>
            ✅ El token funciona
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 18px', lineHeight: 1.5 }}>
            Falta un paso: cargar este número en Vercel como <b>INSTAGRAM_USER_ID</b> y redeployar.
          </p>

          {cuentas.map((c) => (
            <div
              key={c.instagramUserId}
              style={{
                background: 'var(--surface2)', borderRadius: 8,
                padding: 16, marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                @{c.usuario}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--muted)', margin: '3px 0 14px' }}>
                Página: {c.pagina}
                {typeof c.seguidores === 'number' && ` · ${c.seguidores.toLocaleString('es-AR')} seguidores`}
              </div>

              <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                INSTAGRAM_USER_ID
              </div>
              <div style={{
                display: 'flex', gap: 10, alignItems: 'center',
                flexDirection: esMovil ? 'column' : 'row',
              }}>
                <code style={{
                  flex: 1, width: esMovil ? '100%' : 'auto',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '11px 13px',
                  fontSize: 16, color: 'var(--text)', wordBreak: 'break-all',
                }}>
                  {c.instagramUserId}
                </code>
                <button
                  onClick={() => copiar(c.instagramUserId, c.instagramUserId)}
                  style={{
                    background: 'var(--amber)', color: '#1a1a1a', border: 'none',
                    borderRadius: 6, padding: '11px 20px', fontWeight: 700,
                    cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
                    width: esMovil ? '100%' : 'auto',
                  }}
                >
                  {copiado === c.instagramUserId ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          ))}

          <div style={{
            background: 'var(--surface2)', borderRadius: 8, padding: 16,
            fontSize: 14.5, color: 'var(--text)', lineHeight: 1.7,
          }}>
            <b>Cómo cargarlo</b>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Vercel → el proyecto → Settings → Environment Variables</li>
              <li>Llave: <code>INSTAGRAM_USER_ID</code> · Valor: el número de arriba</li>
              <li>Guardar y <b>Redeploy</b></li>
              <li>Volvé acá y tocá «Probar conexión» de nuevo</li>
            </ol>
          </div>
        </div>
      )}

      {/* ── Ya está todo configurado ── */}
      {yaConfigurada && (
        <div style={{ ...caja, borderColor: '#27ae60' }}>
          <div style={{ fontWeight: 700, color: '#2ecc71', marginBottom: 14, fontSize: 17 }}>
            ✅ Conectado
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: esMovil ? '1fr 1fr' : 'repeat(3, 1fr)',
            gap: 14,
          }}>
            <Dato titulo="Cuenta" valor={res.cuenta.username ? `@${res.cuenta.username}` : '—'} />
            <Dato
              titulo="Seguidores"
              valor={typeof res.cuenta.followers_count === 'number'
                ? res.cuenta.followers_count.toLocaleString('es-AR') : '—'}
            />
            <Dato
              titulo="Publicaciones"
              valor={typeof res.cuenta.media_count === 'number'
                ? res.cuenta.media_count.toLocaleString('es-AR') : '—'}
            />
          </div>

          {res.cupo && typeof res.cupo.quota_usage === 'number' && (
            <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '16px 0 0' }}>
              Publicaciones usadas en las últimas 24 h: <b>{res.cupo.quota_usage}</b> de 50.
            </p>
          )}

          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '16px 0 0', lineHeight: 1.55 }}>
            Ya se puede publicar desde el sistema.
          </p>
        </div>
      )}

      {yaConfigurada && <InstagramRendimiento />}
    </div>
  )
}

function Dato({ titulo, valor }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '13px 15px' }}>
      <div style={{
        fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase',
        color: 'var(--muted)', marginBottom: 5,
      }}>
        {titulo}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>{valor}</div>
    </div>
  )
}
