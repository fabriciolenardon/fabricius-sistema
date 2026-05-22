// ============================================================
// LIMPIEZA DE DUPLICADOS — pantalla auxiliar dentro de Precios
// ============================================================
// Lista todos los productos sin codigo_balanza (sin PLU) y para cada uno
// sugiere candidatos similares (productos con PLU 1-106) en base a tokens
// compartidos del nombre (similitud Jaccard sobre palabras de 3+ letras).
//
// Acciones por fila:
//   - Fusionar         → copia precios faltantes del sin-PLU al con-PLU
//                        y borra el sin-PLU. Usar cuando el nombre del PDF
//                        es el correcto.
//   - Migrar PLU       → libera el PLU del con-PLU y se lo asigna al sin-PLU,
//                        después borra el con-PLU. Usar cuando el nombre del
//                        sin-PLU es más completo (ej. "ASADO VENTANA (LINEA
//                        DORADA)" vs "ASADO VENTANA" del PDF).
//   - Borrar           → elimina el sin-PLU sin migrar nada (cuando es
//                        producto obsoleto o efectivamente duplicado puro).
//   - Ignorar          → marca el producto como ya revisado (se guarda en
//                        localStorage, no toca la BD). Usar cuando NO es
//                        duplicado y debe quedar como está.
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const fmt = n => n != null && n > 0 ? '$' + Math.round(n).toLocaleString('es-AR') : '—'

// Categorías que típicamente NO se gestionan vía balanza
// (no las propongo para fusión con productos del PDF de PLUs)
const CATS_NO_BALANZA = new Set(['bovino_mr', 'bovino_caja_cb', 'bovino_caja_pt', 'bebidas', 'almacen'])

const IGNORADOS_KEY = 'limpieza_duplicados_ignorados_v1'

function tokenizar(nombre) {
  return (nombre || '')
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3)
}

function similitudJaccard(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = new Set([...tokensA, ...tokensB]).size
  return union > 0 ? inter / union : 0
}

export default function LimpiezaDuplicados() {
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [accionEnCurso, setAccionEnCurso] = useState(null) // id en proceso
  const [ignorados, setIgnorados] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(IGNORADOS_KEY) || '[]')) }
    catch { return new Set() }
  })
  const [mostrarIgnorados, setMostrarIgnorados] = useState(false)
  const [umbralSimilitud, setUmbralSimilitud] = useState(0.3)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase.from('precios').select('*').order('nombre')
    if (error) { showMsg('❌ Error cargando: ' + error.message, 'error'); setLoading(false); return }
    setProductos(data || [])
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 3500)
  }

  function persistirIgnorados(nuevo) {
    setIgnorados(nuevo)
    localStorage.setItem(IGNORADOS_KEY, JSON.stringify([...nuevo]))
  }

  // Particionar productos: sin PLU vs con PLU 1-106
  const sinPLU = useMemo(() =>
    productos.filter(p =>
      !p.codigo_balanza
      && !(p.nombre || '').startsWith('ZZ_')
      && (mostrarIgnorados || !ignorados.has(p.id))
    ),
    [productos, ignorados, mostrarIgnorados]
  )

  const conPLU = useMemo(() =>
    productos
      .filter(p => p.codigo_balanza >= 1 && p.codigo_balanza <= 106)
      .map(p => ({ ...p, _tokens: tokenizar(p.nombre) })),
    [productos]
  )

  // Para cada producto sin PLU, calcular sus mejores candidatos
  const filas = useMemo(() => {
    return sinPLU.map(p => {
      const tokensP = tokenizar(p.nombre)
      const cands = conPLU
        .map(c => ({ ...c, _sim: similitudJaccard(tokensP, c._tokens) }))
        .filter(c => c._sim >= umbralSimilitud)
        .sort((a, b) => b._sim - a._sim)
        .slice(0, 3)
      return { ...p, _candidatos: cands }
    })
  }, [sinPLU, conPLU, umbralSimilitud])

  // ----- Acciones -----
  async function fusionar(sinPlu, conPlu) {
    if (!confirm(`Fusionar:\n\n• Borrar "${sinPlu.nombre}"\n• Conservar "${conPlu.nombre}" (PLU ${conPlu.codigo_balanza})\n• Copiar precios faltantes del viejo al nuevo si los hay\n\n¿Confirmar?`)) return
    setAccionEnCurso(sinPlu.id)
    try {
      const updates = {}
      for (const c of ['precio_minorista', 'precio_mayorista', 'precio_carniceria']) {
        const valNuevo = Number(conPlu[c]) || 0
        const valViejo = Number(sinPlu[c]) || 0
        if (valNuevo === 0 && valViejo > 0) updates[c] = valViejo
      }
      if (Object.keys(updates).length > 0) {
        const { error: e1 } = await supabase.from('precios').update(updates).eq('id', conPlu.id)
        if (e1) throw e1
      }
      const { error: e2 } = await supabase.from('precios').delete().eq('id', sinPlu.id)
      if (e2) throw e2
      showMsg(`✅ Fusionado: borrado "${sinPlu.nombre}", conservado PLU ${conPlu.codigo_balanza}`)
      await cargar()
    } catch (e) {
      showMsg('❌ Error: ' + (e.message || e), 'error')
    }
    setAccionEnCurso(null)
  }

  async function migrarPLU(sinPlu, conPlu) {
    const plu = conPlu.codigo_balanza
    if (!confirm(`Migrar PLU ${plu}:\n\n• Asignar PLU ${plu} a "${sinPlu.nombre}"\n• Borrar "${conPlu.nombre}"\n\nLos precios actuales del primer producto se conservan.\n¿Confirmar?`)) return
    setAccionEnCurso(sinPlu.id)
    try {
      // 1. Liberar PLU del con-PLU
      const { error: e1 } = await supabase.from('precios').update({ codigo_balanza: null }).eq('id', conPlu.id)
      if (e1) throw e1
      // 2. Asignar PLU al sin-PLU
      const { error: e2 } = await supabase.from('precios').update({ codigo_balanza: plu }).eq('id', sinPlu.id)
      if (e2) throw e2
      // 3. Borrar el que era con-PLU
      const { error: e3 } = await supabase.from('precios').delete().eq('id', conPlu.id)
      if (e3) throw e3
      showMsg(`✅ PLU ${plu} migrado a "${sinPlu.nombre}"`)
      await cargar()
    } catch (e) {
      showMsg('❌ Error: ' + (e.message || e), 'error')
    }
    setAccionEnCurso(null)
  }

  async function borrarSolo(sinPlu) {
    if (!confirm(`Borrar "${sinPlu.nombre}" definitivamente.\n¿Confirmar?`)) return
    setAccionEnCurso(sinPlu.id)
    try {
      const { error } = await supabase.from('precios').delete().eq('id', sinPlu.id)
      if (error) throw error
      showMsg(`✅ Borrado "${sinPlu.nombre}"`)
      await cargar()
    } catch (e) {
      showMsg('❌ Error: ' + (e.message || e), 'error')
    }
    setAccionEnCurso(null)
  }

  function ignorar(sinPlu) {
    const nuevo = new Set(ignorados)
    nuevo.add(sinPlu.id)
    persistirIgnorados(nuevo)
    showMsg(`✓ "${sinPlu.nombre}" marcado como no-duplicado`)
  }

  function desIgnorar(sinPlu) {
    const nuevo = new Set(ignorados)
    nuevo.delete(sinPlu.id)
    persistirIgnorados(nuevo)
  }

  // ----- Estilos -----
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12 }
  const btn = (color = 'var(--gold)', bg) => ({
    padding: '6px 12px', borderRadius: 6, border: 'none',
    background: bg || color, color: bg ? '#fff' : '#000',
    cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: "'DM Sans',sans-serif",
    marginRight: 6, marginTop: 4,
  })
  const chip = (bg, color = '#000') => ({
    background: bg, color, padding: '2px 8px', borderRadius: 4,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, marginRight: 6,
  })

  return (
    <div>
      {msg && (
        <div style={{
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{msg.texto}</div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🧹 Limpieza de duplicados</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
          Acá ves los productos <strong>sin PLU asignado</strong>. Para cada uno te sugiero candidatos similares (con PLU 1-106) y podés decidir qué hacer.
        </p>
        <ul style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 18, marginTop: 0 }}>
          <li><strong style={{ color: '#7dff7d' }}>Fusionar</strong>: el nombre del PDF es el correcto. Borra el viejo, conserva precios faltantes.</li>
          <li><strong style={{ color: '#ffd17a' }}>Migrar PLU</strong>: el nombre viejo es el correcto (ej. con anotación "LÍNEA DORADA"). Le pasa el PLU.</li>
          <li><strong style={{ color: '#ff8b8b' }}>Borrar</strong>: el producto viejo no sirve y no tiene equivalente.</li>
          <li><strong style={{ color: '#aaa' }}>Ignorar</strong>: no es duplicado de nada, debe quedar como está. Se oculta en futuras sesiones.</li>
        </ul>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            <strong>{sinPLU.length}</strong> productos sin PLU{mostrarIgnorados ? '' : ' (excluyendo ignorados)'} · {ignorados.size} ignorados
          </div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={mostrarIgnorados} onChange={e => setMostrarIgnorados(e.target.checked)} />
            mostrar ignorados
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Umbral similitud:
            <input type="range" min="0.1" max="0.9" step="0.05" value={umbralSimilitud}
              onChange={e => setUmbralSimilitud(parseFloat(e.target.value))} style={{ width: 100 }} />
            <span style={{ fontFamily: 'monospace' }}>{(umbralSimilitud * 100).toFixed(0)}%</span>
          </label>
          <button onClick={cargar} style={btn('var(--surface)', '#444')}>🔄 Recargar</button>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando productos...</p>}

      {!loading && filas.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Nada para limpiar</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            No quedan productos sin PLU por revisar.
          </div>
        </div>
      )}

      {!loading && filas.map(p => {
        const esIgnorado = ignorados.has(p.id)
        const esCatNoBalanza = CATS_NO_BALANZA.has(p.categoria)
        return (
          <div key={p.id} style={{ ...card, opacity: esIgnorado ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {p.nombre}
                  {esIgnorado && <span style={chip('#444', '#aaa')}>IGNORADO</span>}
                  {esCatNoBalanza && <span style={chip('#2a3a4a', '#7af')}>{p.categoria}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  ID: {p.id} · Cat: {p.categoria} · Min: {fmt(p.precio_minorista)} · May: {fmt(p.precio_mayorista)} · Carn: {fmt(p.precio_carniceria)}
                </div>
              </div>
              <div>
                {esIgnorado
                  ? <button onClick={() => desIgnorar(p)} style={btn('var(--surface)', '#666')}>↺ Des-ignorar</button>
                  : <button onClick={() => ignorar(p)} style={btn('var(--surface)', '#444')} disabled={accionEnCurso === p.id}>✕ Ignorar (no es duplicado)</button>
                }
                <button onClick={() => borrarSolo(p)} style={btn('var(--surface)', '#5a2a2a')} disabled={accionEnCurso === p.id}>🗑️ Borrar este</button>
              </div>
            </div>

            {!esIgnorado && p._candidatos.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Candidatos similares (con PLU)
                </div>
                {p._candidatos.map(c => (
                  <div key={c.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <span style={chip('var(--gold)')}>PLU {c.codigo_balanza}</span>
                        <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                          ({(c._sim * 100).toFixed(0)}% match · Min: {fmt(c.precio_minorista)})
                        </span>
                      </div>
                      <div>
                        <button onClick={() => fusionar(p, c)} style={btn('#7dff7d')} disabled={accionEnCurso === p.id}>
                          🟢 Fusionar (conservar PLU)
                        </button>
                        <button onClick={() => migrarPLU(p, c)} style={btn('#ffd17a')} disabled={accionEnCurso === p.id}>
                          🟡 Migrar PLU al viejo
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!esIgnorado && p._candidatos.length === 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                Sin candidatos similares con umbral {(umbralSimilitud * 100).toFixed(0)}%. Probá bajar el umbral o ignoralo si no es duplicado.
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
