// ============================================================
// RECETAS — las fórmulas de los elaborados
// ============================================================
// Lo que hasta ahora era un papel pegado en la pared del depósito.
// Se monta en tres lugares con el mismo componente:
//   · Depósito → 📖 Recetas (central y sucursal)
//   · Portal Desposte → 📖 Recetas
//
// QUIÉN EDITA: sólo los admin de la central. La fórmula es lo que hace que
// el chorizo de Monte Cristo sepa igual que el de Río Primero, así que la
// sucursal y el desposte la LEEN. No es una decisión de esta pantalla: la
// mig 104 lo aplica en la base (`is_admin() AND es_central()`), así que
// esconder el botón es sólo para no ofrecer algo que va a rebotar.
//
// LA ESCALA es lo que más se usa: la receta está escrita para 10 kg y hoy
// se hacen 35. Multiplica las cantidades numéricas; las que son una nota
// ("1 cabeza de ajo cada 10 kg") se muestran tal cual, porque no hay forma
// honesta de escalar un texto.
//
// LA BASE NO ES EL TOTAL. En el salame la base son 30 kg de cerdo y de ahí
// salen 50 kg de pasta (56 con el queso). La base es el ancla del
// multiplicador; el TOTAL lo calcula la pantalla sumando base + todo lo que
// esté en kg o g. Por eso la carne de la base NO va también en la lista de
// ingredientes: se contaría dos veces.
//
// "CADA KILO LLEVA" es la lectura que pidió Fabricio: en vez de leer la
// tabla de 30 kg y hacer la cuenta, cada renglón dice cuánto entra en UN
// kilo de producto terminado (cantidad ÷ total). Como es una proporción, no
// cambia al escalar.
//
// LOS CONDIMENTOS NO SON UNA RECETA SUELTA (`rol = 'condimentos'`): son los
// de la pasta de salame. Su tarjeta tiene un selector para elegir a qué
// salame acompañan, y toma los kilos del TOTAL de ese salame — así mover el
// salame a 60 kg mueve los condimentos solos.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNumero } from '../lib/formatos'
import { useEsMovil } from '../lib/useEsMovil'

const CATEGORIAS = [
  { id: 'hamburguesa', label: '🍔 Hamburguesas' },
  { id: 'milanesa', label: '🍗 Milanesas' },
  { id: 'embutido', label: '🌭 Embutidos' },
  { id: 'salame', label: '🥓 Salames' },
  { id: 'otro', label: '📖 Otras' },
]
const labelCategoria = c => CATEGORIAS.find(x => x.id === c)?.label || '📖 Otras'

// Unidades sugeridas en el desplegable. Es una lista abierta: si mañana
// aparece "cucharada" se escribe y listo.
const UNIDADES = ['g', 'kg', 'ml', 'l', 'u', 'cda', 'cdta', 'cabeza', 'diente']

const nuevaFila = () => ({ nombre: '', cantidad: '', unidad: 'g', nota: '' })

// Kilos que aporta un ingrediente. Sólo kg y g pesan: los huevos, el vino y
// las cabezas de ajo no entran al total (son unidades y líquidos).
function kgDeIngrediente(i) {
  const c = Number(i?.cantidad)
  if (!isFinite(c)) return 0
  const u = String(i?.unidad || '').toLowerCase()
  if (u === 'kg') return c
  if (u === 'g') return c / 1000
  return 0
}

// Lo que RINDE la receta: la base más todo lo que se le suma en peso.
// La carne de la base no va en `ingredientes` justamente para no contarla dos
// veces (ver la cabecera).
function totalDeReceta(r) {
  return (Number(r.base_kg) || 0) + (r.ingredientes || []).reduce((s, i) => s + kgDeIngrediente(i), 0)
}

// Cantidad con los decimales que el número necesita: 0,24 g no puede
// redondearse a 0, y 30 kg no necesita decimales.
function fmtCant(v) {
  const n = Number(v)
  if (!isFinite(n)) return ''
  const dec = Math.abs(n) < 1 ? 3 : Math.abs(n) < 10 ? 2 : n % 1 === 0 ? 0 : 2
  return fmtNumero(n, dec)
}

// Cuánto de este ingrediente entra en UN kilo de producto terminado.
// Se pasa a gramos cuando queda por debajo del kilo, que es como se lee.
function porKilo(cantidad, unidad, totalKg) {
  const c = Number(cantidad)
  if (!isFinite(c) || !(totalKg > 0)) return null
  const u = String(unidad || '').toLowerCase()
  const v = c / totalKg
  if (u === 'kg') return v < 1 ? `${fmtCant(v * 1000)} g` : `${fmtCant(v)} kg`
  return `${fmtCant(v)} ${unidad || ''}`.trim()
}

const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, boxSizing: 'border-box' }

export default function Recetas({ puedeEditar = false }) {
  const esMovil = useEsMovil()
  const [recetas, setRecetas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)  // receta en edición (borrador)
  const [msg, setMsg] = useState(null)
  // Los kilos elegidos en cada tarjeta viven ACÁ y no adentro de la tarjeta:
  // la de condimentos necesita leer el total de OTRA receta.
  const [kgPorReceta, setKgPorReceta] = useState({})   // recetaId → kg (string)
  const [vinculo, setVinculo] = useState({})           // condimentoId → recetaId | ''

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true); setError('')
    const { data, error } = await supabase.from('recetas').select('*')
      .eq('activa', true).order('orden').order('nombre')
    if (error) setError(error.message)
    setRecetas(data || [])
    setCargando(false)
  }

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 3500)
  }

  const porCategoria = useMemo(() => {
    const m = new Map()
    for (const r of recetas) {
      if (!m.has(r.categoria)) m.set(r.categoria, [])
      m.get(r.categoria).push(r)
    }
    return [...m.entries()].sort((a, b) =>
      CATEGORIAS.findIndex(c => c.id === a[0]) - CATEGORIAS.findIndex(c => c.id === b[0]))
  }, [recetas])

  // Las fórmulas a las que se puede enganchar una tarjeta de condimentos:
  // las de su misma familia (los condimentos del salame no sirven para la
  // hamburguesa). Se calcula una vez para todas.
  const formulasPorCategoria = useMemo(() => {
    const m = {}
    for (const r of recetas) {
      if (r.rol === 'condimentos') continue
      ;(m[r.categoria] = m[r.categoria] || []).push(r)
    }
    return m
  }, [recetas])

  // Estado calculado de cada tarjeta: kilos elegidos, factor y total que rinde.
  // Una receta de condimentos vinculada NO tiene kilos propios: toma el total
  // del salame elegido, así mover el salame a 60 kg mueve los condimentos.
  const estado = useMemo(() => {
    const propio = {}
    for (const r of recetas) {
      const base = Number(r.base_kg) || 1
      const kg = Number(String(kgPorReceta[r.id] ?? r.base_kg).replace(',', '.'))
      const usados = isFinite(kg) && kg > 0 ? kg : base
      propio[r.id] = { kg: usados, factor: usados / base, total: totalDeReceta(r) * (usados / base) }
    }
    const final = {}
    for (const r of recetas) {
      const destino = r.rol === 'condimentos' ? vinculo[r.id] : ''
      const fuente = destino && propio[destino]
      if (fuente) {
        const base = Number(r.base_kg) || 1
        final[r.id] = { ...propio[r.id], kg: fuente.total, factor: fuente.total / base, vinculadoA: destino }
      } else {
        final[r.id] = propio[r.id]
      }
    }
    return final
  }, [recetas, kgPorReceta, vinculo])

  function abrirNueva() {
    setEditando({
      nombre: '', categoria: 'embutido', rol: 'formula', base_kg: 10, base_label: 'Masa',
      notas: '', ingredientes: [nuevaFila()],
    })
  }

  function abrirEdicion(r) {
    // Copia profunda: se edita un borrador, así cancelar no deja la
    // pantalla con los cambios a medio hacer.
    setEditando({
      ...r,
      ingredientes: (r.ingredientes || []).map(i => ({
        nombre: i.nombre || '', cantidad: i.cantidad ?? '', unidad: i.unidad || '', nota: i.nota || '',
      })),
    })
  }

  async function guardar() {
    const b = editando
    if (!b.nombre.trim()) { aviso('❌ Poné el nombre de la receta', 'error'); return }
    const ingredientes = b.ingredientes
      .filter(i => i.nombre.trim())
      .map(i => ({
        nombre: i.nombre.trim(),
        // Vacío ≠ 0: un ingrediente que sólo tiene nota ("1 cabeza cada
        // 10 kg") guarda cantidad null y se muestra sin número.
        cantidad: String(i.cantidad).trim() === '' ? null : Number(String(i.cantidad).replace(',', '.')),
        unidad: i.unidad?.trim() || null,
        nota: i.nota?.trim() || null,
      }))
    if (ingredientes.length === 0) { aviso('❌ La receta necesita al menos un ingrediente', 'error'); return }
    if (ingredientes.some(i => i.cantidad != null && !isFinite(i.cantidad))) {
      aviso('❌ Hay una cantidad que no es un número', 'error'); return
    }

    const fila = {
      nombre: b.nombre.trim(),
      categoria: b.categoria,
      rol: b.rol === 'condimentos' ? 'condimentos' : 'formula',
      base_kg: Number(String(b.base_kg).replace(',', '.')) || 1,
      base_label: b.base_label?.trim() || 'Masa',
      notas: b.notas?.trim() || null,
      ingredientes,
    }
    const q = b.id
      ? supabase.from('recetas').update(fila).eq('id', b.id)
      : supabase.from('recetas').insert({ ...fila, orden: (recetas.at(-1)?.orden || 0) + 10 })
    const { error } = await q
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    setEditando(null)
    await cargar()
    aviso(b.id ? '✅ Receta actualizada' : '✅ Receta creada')
  }

  async function borrar(r) {
    // Baja lógica: una receta vieja sirve para entender una elaboración
    // de hace tres meses. No se borra la fila.
    const { error } = await supabase.from('recetas').update({ activa: false }).eq('id', r.id)
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    await cargar()
    aviso('✅ Receta archivada')
  }

  if (cargando) return <div className="empty">Cargando recetas…</div>

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
      {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#ff6b6b' }}>❌ {error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="card-title">📖 Recetas de elaborados</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              Las fórmulas del depósito. Poné cuántos kilos vas a hacer y las cantidades se
              recalculan solas.
              {!puedeEditar && <> Las define la central: acá se consultan.</>}
            </div>
          </div>
          {puedeEditar && (
            <button onClick={abrirNueva}
              style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: '#000', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 800, fontSize: 13 }}>
              + Nueva receta
            </button>
          )}
        </div>
      </div>

      {recetas.length === 0 && <div className="empty">Todavía no hay recetas cargadas.</div>}

      {porCategoria.map(([cat, lista]) => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>
            {labelCategoria(cat).toUpperCase()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            {lista.map(r => (
              <TarjetaReceta key={r.id} receta={r} puedeEditar={puedeEditar}
                est={estado[r.id]}
                setKg={v => setKgPorReceta(m => ({ ...m, [r.id]: v }))}
                formulas={(formulasPorCategoria[r.categoria] || [])}
                recetas={recetas}
                vinculadoA={vinculo[r.id] || ''}
                setVinculo={v => setVinculo(m => ({ ...m, [r.id]: v }))}
                onEditar={() => abrirEdicion(r)} onBorrar={() => borrar(r)} />
            ))}
          </div>
        </div>
      ))}

      {editando && (
        <EditorReceta borrador={editando} setBorrador={setEditando}
          onGuardar={guardar} onCancelar={() => setEditando(null)} esMovil={esMovil} />
      )}
    </div>
  )
}

// ── Una receta, con su escalador ────────────────────────────
function TarjetaReceta({ receta, puedeEditar, est, setKg, formulas, recetas, vinculadoA, setVinculo, onEditar, onBorrar }) {
  const [confirmar, setConfirmar] = useState(false)

  const base = Number(receta.base_kg) || 1
  const factor = est?.factor ?? 1
  const escalada = Math.abs(factor - 1) > 0.0001
  const esCondimentos = receta.rol === 'condimentos'
  // El total lo calcula la tarjeta: base + todo lo que pese. Es lo que
  // "sale" (50 kg de pasta) y lo que engancha a los condimentos.
  const totalBase = totalDeReceta(receta)
  const total = totalBase * factor
  // Si la receta YA está escrita por kilo (base 1), el "cada kilo lleva"
  // sobra y encima confunde: daría un número apenas distinto, porque se
  // calcula sobre el producto terminado y los condimentos también pesan.
  const escritaPorKilo = base === 1
  // Otras fórmulas de la misma familia a las que se puede enganchar.
  const opciones = formulas.filter(f => f.id !== receta.id)
  const fuente = vinculadoA ? recetas.find(r => r.id === vinculadoA) : null

  return (
    <div className="card" style={{ borderColor: escalada || fuente ? 'var(--gold)' : 'var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 1, lineHeight: 1.1 }}>
          {receta.nombre}
        </div>
        {puedeEditar && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onEditar} title="Editar"
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
            <button onClick={() => setConfirmar(true)} title="Archivar"
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>🗑️</button>
          </div>
        )}
      </div>

      {/* Confirmación inline: en iPhone/PWA un window.confirm se suprime sin
          error y la acción se pierde (ver PR #220). */}
      {confirmar && (
        <div style={{ background: '#3a2a1a', border: '1px solid #ffb86b', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 12, color: '#ffb86b' }}>
          ¿Archivar «{receta.nombre}»? Deja de mostrarse, pero no se borra.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => { setConfirmar(false); onBorrar() }}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#a53a3a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Sí, archivar</button>
            <button onClick={() => setConfirmar(false)}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Cabecera: o el escalador propio, o el enganche a un salame */}
      {esCondimentos && opciones.length > 0 ? (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 6 }}>CONDIMENTOS PARA</div>
          <select value={vinculadoA} onChange={e => setVinculo(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value="">— elegir a mano —</option>
            {opciones.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          {fuente ? (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>
              {fmtCant(est?.kg || 0)} kg de pasta · sale del kilaje de «{fuente.nombre}»
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <input type="number" step="any" value={String(est?.kg ?? base)}
                onChange={e => setKg(e.target.value)}
                style={{ ...inp, width: 100, textAlign: 'right', fontWeight: 800 }} />
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>kg de pasta</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 0.5 }}>{(receta.base_label || 'BASE').toUpperCase()}</div>
            <input type="number" step="any" value={String(est?.kg ?? base)} onChange={e => setKg(e.target.value)}
              style={{ ...inp, width: 90, textAlign: 'right', fontWeight: 800 }} />
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>kg</div>
            {escalada && (
              <button onClick={() => setKg(String(base))}
                style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, border: '1px solid var(--gold)', background: 'transparent', color: 'var(--gold)', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                ×{fmtNumero(factor, 2)} · volver a {fmtNumero(base, 0)} kg
              </button>
            )}
          </div>
          {/* Lo que SALE. En el salame la base son 30 kg de cerdo pero salen
              50 de pasta, y es el número con el que se trabaja después. */}
          {total > base + 0.001 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
              Salen <strong style={{ color: 'var(--green)', fontSize: 15 }}>{fmtCant(total)} kg</strong> de producto
            </div>
          )}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {/* La base va como primer renglón: es un ingrediente más para el que
              lee, y así entra en la columna "cada kilo lleva". */}
          {!esCondimentos && (
            <FilaIngrediente
              nombre={receta.base_label} destacado mostrarPorKilo={escritaPorKilo ? false : true}
              cantidad={base} unidad="kg" factor={factor} totalBase={totalBase} escalada={escalada} />
          )}
          {(receta.ingredientes || []).map((i, k) => (
            <FilaIngrediente key={k} nombre={i.nombre} nota={i.nota}
              cantidad={i.cantidad} unidad={i.unidad} factor={factor}
              mostrarPorKilo={!escritaPorKilo}
              totalBase={esCondimentos ? base : totalBase} escalada={escalada} />
          ))}
        </tbody>
      </table>

      {receta.notas && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{receta.notas}</div>
      )}
    </div>
  )
}

// Un renglón de la receta: la cantidad escalada y, abajo, cuánto de eso
// entra en UN kilo de producto terminado — que es la lectura que evita
// tener que hacer la cuenta contra la tabla de 30 kg.
function FilaIngrediente({ nombre, nota, cantidad, unidad, factor, totalBase, escalada, destacado, mostrarPorKilo = true }) {
  const unitario = mostrarPorKilo && cantidad != null ? porKilo(cantidad, unidad, totalBase) : null
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <td style={{ padding: '6px 4px', fontSize: 13, fontWeight: destacado ? 700 : 400 }}>
        {nombre}
        {/* La nota es la parte que no se puede escalar: se muestra igual
            siempre y se avisa cuando la receta está escalada. */}
        {nota && (
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {nota}{escalada && cantidad == null ? ' · no escala' : ''}
          </div>
        )}
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {cantidad != null ? (
          <>
            <div>
              <strong style={{ fontSize: 15, color: escalada ? 'var(--gold)' : 'var(--text)' }}>
                {fmtCant(Number(cantidad) * factor)}
              </strong>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}> {unidad || ''}</span>
            </div>
            {unitario && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{unitario} por kg</div>}
          </>
        ) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>}
      </td>
    </tr>
  )
}

// ── Editor (modal) ──────────────────────────────────────────
function EditorReceta({ borrador, setBorrador, onGuardar, onCancelar, esMovil }) {
  const set = (campo, valor) => setBorrador(b => ({ ...b, [campo]: valor }))
  const setIng = (idx, campo, valor) => setBorrador(b => ({
    ...b, ingredientes: b.ingredientes.map((i, k) => k === idx ? { ...i, [campo]: valor } : i),
  }))
  const agregar = () => setBorrador(b => ({ ...b, ingredientes: [...b.ingredientes, nuevaFila()] }))
  const quitar = idx => setBorrador(b => ({ ...b, ingredientes: b.ingredientes.filter((_, k) => k !== idx) }))
  const mover = (idx, delta) => setBorrador(b => {
    const arr = [...b.ingredientes]
    const j = idx + delta
    if (j < 0 || j >= arr.length) return b
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    return { ...b, ingredientes: arr }
  })

  return (
    <div onClick={onCancelar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 20, maxWidth: 640, width: '100%', marginTop: 20 }}>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 14 }}>
          {borrador.id ? '✏️ Editar receta' : '📖 Nueva receta'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nombre</label>
            <input value={borrador.nombre} onChange={e => set('nombre', e.target.value)}
              placeholder="Chorizo Parrillero" style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Grupo</label>
            <select value={borrador.categoria} onChange={e => set('categoria', e.target.value)}
              style={{ ...inp, width: '100%' }}>
              {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1fr 2fr', gap: 10, marginBottom: 6 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Base (kg)</label>
            <input type="number" step="any" value={borrador.base_kg} onChange={e => set('base_kg', e.target.value)}
              style={{ ...inp, width: '100%', textAlign: 'right' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Qué es esa base</label>
            <input value={borrador.base_label} onChange={e => set('base_label', e.target.value)}
              placeholder="Carne vacuna / Masa" style={{ ...inp, width: '100%' }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          A cuántos kilos corresponden las cantidades de abajo. Si la receta está escrita
          <strong> por kilo</strong>, poné 1. <strong>La base no va también en la lista</strong>:
          se contaría dos veces al calcular lo que sale.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, marginBottom: 14, color: borrador.rol === 'condimentos' ? 'var(--gold)' : 'var(--muted)' }}>
          <input type="checkbox" checked={borrador.rol === 'condimentos'}
            onChange={e => set('rol', e.target.checked ? 'condimentos' : 'formula')}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          Son <strong>condimentos de otra receta</strong> — la tarjeta va a tener un selector para
          elegir a cuál acompaña y toma los kilos de ella.
        </label>

        <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>INGREDIENTES</div>
        {borrador.ingredientes.map((i, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : '1.6fr 80px 90px 1.4fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <input value={i.nombre} onChange={e => setIng(idx, 'nombre', e.target.value)}
              placeholder="Sal" style={inp} />
            <input type="number" step="any" value={i.cantidad} onChange={e => setIng(idx, 'cantidad', e.target.value)}
              placeholder="—" style={{ ...inp, textAlign: 'right' }} />
            <input list="recetas-unidades" value={i.unidad} onChange={e => setIng(idx, 'unidad', e.target.value)}
              placeholder="g" style={inp} />
            <input value={i.nota} onChange={e => setIng(idx, 'nota', e.target.value)}
              placeholder="Nota (ej: 1 cabeza cada 10 kg)" style={inp} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => mover(idx, -1)} title="Subir"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11 }}>▲</button>
              <button onClick={() => mover(idx, 1)} title="Bajar"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 11 }}>▼</button>
              <button onClick={() => quitar(idx)} title="Quitar"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #5a2a2a', background: 'transparent', color: '#ff6b6b', cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          </div>
        ))}
        <datalist id="recetas-unidades">{UNIDADES.map(u => <option key={u} value={u} />)}</datalist>

        <button onClick={agregar}
          style={{ marginTop: 4, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          + Agregar ingrediente
        </button>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
          Dejá la cantidad vacía cuando el ingrediente no es un número fijo y se explica solo
          con la nota (ej. «1 cabeza de ajo cada 10 kg»). Esos no se escalan.
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notas de la receta (opcional)</label>
          <textarea value={borrador.notas || ''} onChange={e => set('notas', e.target.value)}
            rows={2} style={{ ...inp, width: '100%', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onCancelar}
            style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={onGuardar}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', border: 'none', borderRadius: 10, color: '#000', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>
            💾 Guardar receta
          </button>
        </div>
      </div>
    </div>
  )
}
