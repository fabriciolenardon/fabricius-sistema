// ============================================================
// COMBOS DE VENTA — editor admin (Precios → 🍱 Combos)
// ============================================================
// Combos/bolsones armados que se venden a precio fijo. Cada combo tiene
// una lista de productos (elegidos del catálogo real `precios`) con su kg.
// En la Caja, un botón agrega TODOS esos productos al carrito (para que el
// stock se descuente igual que una venta normal) repartiendo el precio del
// combo entre las líneas. Por eso cada ítem guarda el producto_id real: de
// ahí salen categoria + stock_origen y el descuento de stock es exacto.
//
// Las plantillas pre-cargan los combos del cartel (SALSA, FAMILIAR, etc.)
// con sus kg y precios, e intentan enganchar cada ítem al producto del
// catálogo por nombre. SIEMPRE verificá el producto enganchado antes de
// guardar (el match es una sugerencia).
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtPrecio } from '../../lib/formatos'
import { useAuth } from '../../context/AuthContext'
import { SUCURSAL_CENTRAL } from '../../lib/permisos'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

const VACIO = { nombre: '', emoji: '🍱', precio: '', disponible: true, orden: 0, items: [] }

// Precio "normal" minorista de un producto (para el cartelito de ahorro).
const precioNormal = p => Number(p?.precio_minorista || p?.precio_carniceria || 0)

// ── Plantillas del cartel ─────────────────────────────────────────────
// kw = palabras clave para enganchar el producto del catálogo (todas deben
// estar en el nombre). kg = cantidad. Conversiones confirmadas por Fabricio:
//   1 pollo entero = 2,3 kg · 1 tapa de nalga = 2 kg
//   2 chorizos = 0,350 · 3 chorizos = 0,500 · 1 morcilla = 0,300 · 2 morcillas = 0,600
const PLANTILLAS = [
  { nombre: 'SALSA', emoji: '🧂', precio: 57000, items: [
    { label: 'Aguja', kw: ['aguja'], kg: 1 },
    { label: 'Molida', kw: ['molida'], kg: 1 },
    { label: 'Chorizo', kw: ['chorizo'], kg: 1 },
    { label: 'Carnaza', kw: ['carnaza'], kg: 1 },
    { label: 'Alitas', kw: ['alita'], kg: 1 },
  ] },
  { nombre: 'FAMILIAR', emoji: '👨‍👩‍👧', precio: 93000, items: [
    { label: 'Osobuco', kw: ['osobuco'], kg: 1 },
    { label: 'Carne molida', kw: ['molida'], kg: 1 },
    { label: 'Bifes de ternera', kw: ['bife', 'ternera'], kg: 1 },
    { label: 'Bifes de cerdo', kw: ['bife', 'cerdo'], kg: 1 },
    { label: 'Costeleta de ternera', kw: ['costeleta', 'ternera'], kg: 1 },
    { label: 'Costeleta de cerdo', kw: ['costeleta', 'cerdo'], kg: 1 },
    { label: 'Pollo entero (2,3 kg)', kw: ['pollo', 'entero'], kg: 2.3 },
  ] },
  { nombre: 'REBOZADO', emoji: '🍤', precio: 45000, items: [
    { label: 'Mila de ternera', kw: ['milanesa', 'ternera'], kg: 1 },
    { label: 'Mila de cerdo', kw: ['milanesa', 'cerdo'], kg: 1 },
    { label: 'Mila de pollo', kw: ['milanesa', 'pollo'], kg: 1 },
    { label: 'Patitas JyQ', kw: ['patita'], kg: 0.5 },
    { label: 'Nuggets', kw: ['nugget'], kg: 0.5 },
  ] },
  { nombre: 'ASADO ECO', emoji: '🔥', precio: 43000, items: [
    { label: 'Falda', kw: ['falda'], kg: 1 },
    { label: 'Bocado', kw: ['bocado'], kg: 1 },
    { label: 'Costilla de cerdo', kw: ['costilla', 'cerdo'], kg: 1 },
    { label: '2 Chorizos (0,350 kg)', kw: ['chorizo'], kg: 0.35 },
    { label: '1 Morcilla (0,300 kg)', kw: ['morcilla'], kg: 0.3 },
  ] },
  { nombre: 'ASADO PREMIUM', emoji: '🥩', precio: 47000, items: [
    { label: 'Tira costilla ternera (0,5 kg)', kw: ['costilla', 'ternera'], kg: 0.5 },
    { label: 'Tira costilla cerdo (0,5 kg)', kw: ['costilla', 'cerdo'], kg: 0.5 },
    { label: 'Vacío de cerdo (0,5 kg)', kw: ['vac', 'cerdo'], kg: 0.5 },
    { label: 'Vacío de ternera (0,5 kg)', kw: ['vac', 'ternera'], kg: 0.5 },
    { label: '3 Chorizos (0,500 kg)', kw: ['chorizo'], kg: 0.5 },
    { label: '2 Morcillas (0,600 kg)', kw: ['morcilla'], kg: 0.6 },
  ] },
  { nombre: 'BOVINO', emoji: '🐄', precio: 79000, items: [
    { label: 'Aguja de costeleta', kw: ['aguja', 'costeleta'], kg: 1 },
    { label: 'Molida', kw: ['molida'], kg: 1 },
    { label: 'Bifes', kw: ['bife'], kg: 1 },
    { label: 'Tapa de nalga (2 kg)', kw: ['tapa', 'nalga'], kg: 2 },
  ] },
  { nombre: 'CERDO', emoji: '🐷', precio: 34500, items: [
    { label: 'Milanesas de cerdo', kw: ['milanesa', 'cerdo'], kg: 1 },
    { label: 'Costeletas de cerdo', kw: ['costeleta', 'cerdo'], kg: 1 },
    { label: 'Chorizo', kw: ['chorizo'], kg: 1 },
    { label: 'Hamburguesas', kw: ['hamburguesa'], kg: 1 },
  ] },
  { nombre: 'POLLO', emoji: '🍗', precio: 38000, items: [
    { label: 'Pata muslo', kw: ['pata', 'muslo'], kg: 1 },
    { label: 'Milanesas de pollo', kw: ['milanesa', 'pollo'], kg: 1 },
    { label: 'Pechuga', kw: ['pechuga'], kg: 1 },
    { label: 'Pollo entero (2,3 kg)', kw: ['pollo', 'entero'], kg: 2.3 },
  ] },
]

// Engancha un producto del catálogo por palabras clave (todas en el nombre).
function matchProducto(precios, kw) {
  const kws = (kw || []).map(k => k.toLowerCase())
  if (!kws.length) return null
  const cand = precios.filter(p => {
    const n = (p.nombre || '').toLowerCase()
    return kws.every(k => n.includes(k))
  })
  return cand[0] || null
}

export default function CombosEditor({ precios = [] }) {
  // Los combos de la central los ve toda boca (mig 118): son bolsones de la
  // marca, con el precio armado por la central. Una sucursal los vende pero no
  // los toca — y puede armar los suyos, que sólo ve ella.
  const { isSucursal: esSucursal } = useAuth()
  const esDeLaCentral = c => c.sucursal_id === SUCURSAL_CENTRAL
  const puedeTocar = c => !esSucursal || !esDeLaCentral(c)
  const [combos, setCombos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(null)   // id | 'nuevo' | null
  const [form, setForm] = useState(VACIO)
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Buscador por fila de ítem: { [idx]: 'texto' } y qué fila tiene el dropdown abierto.
  const [buscar, setBuscar] = useState({})
  const [openRow, setOpenRow] = useState(null)

  useEffect(() => { cargar() }, [])

  // Realtime: el combo es UNA fila que comparten todas las bocas, así que
  // cuando la central le cambia el precio, la sucursal que tiene esta
  // pantalla abierta tiene que verlo sin apretar F5. Mismo canal que usa la
  // Caja. No hace falta filtrar por boca: la RLS ya decide qué filas le
  // llegan a cada uno.
  useEffect(() => {
    let timer = null
    const canal = supabase.channel('combos-editor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combos_venta' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => cargar(), 400)
      })
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(canal) }
  }, [])

  function mostrarMsg(t) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('combos_venta').select('*').order('orden').order('nombre')
    setCombos(data || [])
    setLoading(false)
  }

  function nuevo() {
    setForm(VACIO)
    setBuscar({}); setOpenRow(null)
    setEditando('nuevo')
  }

  function editar(c) {
    setForm({
      nombre: c.nombre || '', emoji: c.emoji || '🍱',
      precio: String(c.precio ?? ''), disponible: c.disponible !== false,
      orden: c.orden || 0,
      items: (c.items || []).map(it => ({ producto_id: it.producto_id || '', nombre: it.nombre || '', kg: it.kg ?? '' })),
    })
    setBuscar({}); setOpenRow(null)
    setEditando(c.id)
  }

  function cancelar() { setEditando(null); setForm(VACIO); setBuscar({}); setOpenRow(null) }

  // Carga una plantilla del cartel, enganchando cada ítem al catálogo.
  function usarPlantilla(tpl) {
    const items = tpl.items.map(it => {
      const p = matchProducto(precios, it.kw)
      return { producto_id: p?.id || '', nombre: p?.nombre || it.label, kg: it.kg }
    })
    setForm({ nombre: tpl.nombre, emoji: tpl.emoji, precio: String(tpl.precio), disponible: true, orden: 0, items })
    setBuscar({}); setOpenRow(null)
    setEditando('nuevo')
    const faltan = items.filter(i => !i.producto_id).length
    mostrarMsg(faltan > 0
      ? `🍱 Plantilla ${tpl.nombre} cargada · ⚠️ ${faltan} producto(s) sin enganchar, elegilos a mano`
      : `🍱 Plantilla ${tpl.nombre} cargada · verificá los productos enganchados`)
  }

  // ── Edición de ítems ──
  function addItem() { setForm(f => ({ ...f, items: [...f.items, { producto_id: '', nombre: '', kg: 1 }] })) }
  function removeItem(idx) { setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) })) }
  function setItemKg(idx, kg) { setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, kg } : it) })) }
  function setItemProducto(idx, prod) {
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, producto_id: prod.id, nombre: prod.nombre } : it) }))
    setOpenRow(null); setBuscar(b => ({ ...b, [idx]: '' }))
  }

  async function guardar() {
    const nombre = form.nombre.trim()
    const precio = Number(form.precio)
    if (!nombre) return mostrarMsg('❌ Poné un nombre al combo')
    if (!precio || precio <= 0) return mostrarMsg('❌ El precio del combo debe ser mayor a 0')
    if (!form.items.length) return mostrarMsg('❌ Agregá al menos un producto')
    for (const it of form.items) {
      if (!it.producto_id) return mostrarMsg('❌ Hay un ítem sin producto enganchado')
      if (!(Number(it.kg) > 0)) return mostrarMsg('❌ Cada ítem necesita kg mayor a 0')
    }
    const payload = {
      nombre, emoji: form.emoji || null, precio,
      disponible: !!form.disponible, orden: Number(form.orden) || 0,
      items: form.items.map(it => ({ producto_id: it.producto_id, nombre: it.nombre, kg: Number(it.kg) })),
      updated_at: new Date().toISOString(),
    }
    setGuardando(true)
    let error
    if (editando && editando !== 'nuevo') {
      ;({ error } = await supabase.from('combos_venta').update(payload).eq('id', editando))
    } else {
      ;({ error } = await supabase.from('combos_venta').insert(payload))
    }
    setGuardando(false)
    if (error) return mostrarMsg('❌ Error al guardar: ' + error.message)
    mostrarMsg('✅ Combo guardado')
    cancelar()
    cargar()
  }

  async function borrar(c) {
    if (!confirm(`¿Borrar el combo "${c.nombre}"?`)) return
    const { error } = await supabase.from('combos_venta').delete().eq('id', c.id)
    if (error) return mostrarMsg('❌ Error al borrar: ' + error.message)
    mostrarMsg('🗑️ Combo borrado')
    cargar()
  }

  async function toggleDisponible(c) {
    const { error } = await supabase.from('combos_venta')
      .update({ disponible: !c.disponible, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) return mostrarMsg('❌ ' + error.message)
    cargar()
  }

  // Suma "suelta" (a precio normal) vs precio del combo → ahorro.
  const preview = useMemo(() => {
    let suelto = 0
    let faltan = 0
    for (const it of form.items) {
      const p = precios.find(x => x.id === it.producto_id)
      if (!p) { faltan++; continue }
      suelto += (Number(it.kg) || 0) * precioNormal(p)
    }
    const combo = Number(form.precio) || 0
    const ahorro = suelto - combo
    const pct = suelto > 0 ? Math.round(ahorro / suelto * 100) : 0
    return { suelto, combo, ahorro, pct, faltan }
  }, [form.items, form.precio, precios])

  if (loading) return <div style={{ color: 'var(--muted)', padding: 20 }}>Cargando combos…</div>

  return (
    <div>
      {msg && (
        <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg}</div>
      )}

      {/* ── FORMULARIO (crear / editar) ── */}
      {editando ? (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="card-title">{editando === 'nuevo' ? '🍱 Nuevo combo' : '✏️ Editar combo'}</div>
            <button onClick={cancelar} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 160px', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Emoji</label>
              <input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} style={{ ...inp, textAlign: 'center' }} maxLength={4} />
            </div>
            <div>
              <label style={lbl}>Nombre del combo</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={inp} placeholder="ej. ASADO ECO" />
            </div>
            <div>
              <label style={lbl}>Precio del combo</label>
              <input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} style={{ ...inp, textAlign: 'right', fontWeight: 700 }} placeholder="0" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={form.disponible} onChange={e => setForm(f => ({ ...f, disponible: e.target.checked }))} style={{ width: 16, height: 16 }} />
              Disponible (aparece en la Caja)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
              Orden
              <input type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: e.target.value }))} style={{ ...inp, width: 70, padding: '6px 8px' }} />
            </label>
          </div>

          {/* Ítems del combo */}
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>PRODUCTOS QUE CONTIENE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {form.items.map((it, idx) => {
              const prod = precios.find(p => p.id === it.producto_id)
              const term = (buscar[idx] || '').toLowerCase().trim()
              const opciones = term
                ? precios.filter(p => (p.nombre || '').toLowerCase().includes(term)).slice(0, 30)
                : precios.slice(0, 30)
              return (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 36px', gap: 8, alignItems: 'start' }}>
                  <div style={{ position: 'relative' }}>
                    {prod && openRow !== idx ? (
                      <div onClick={() => { setOpenRow(idx); setBuscar(b => ({ ...b, [idx]: '' })) }}
                        style={{ ...inp, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{prod.nombre}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(precioNormal(prod))}/kg ✎</span>
                      </div>
                    ) : (
                      <>
                        <input
                          autoFocus={openRow === idx}
                          value={buscar[idx] || ''}
                          onChange={e => { setBuscar(b => ({ ...b, [idx]: e.target.value })); setOpenRow(idx) }}
                          onFocus={() => setOpenRow(idx)}
                          placeholder={it.nombre ? `⚠️ ${it.nombre} — elegí el producto` : 'Buscar producto…'}
                          style={{ ...inp, borderColor: it.producto_id ? 'var(--border)' : '#7a5a2a' }} />
                        {openRow === idx && (
                          <div style={{ position: 'absolute', zIndex: 30, top: 42, left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {opciones.length === 0 && <div style={{ padding: 10, color: 'var(--muted)', fontSize: 13 }}>Sin resultados</div>}
                            {opciones.map(p => (
                              <div key={p.id} onClick={() => setItemProducto(idx, p)}
                                style={{ padding: '8px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                                <span style={{ fontSize: 13 }}>{p.nombre}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.categoria} · {fmt(precioNormal(p))}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" step="0.001" value={it.kg} onChange={e => setItemKg(idx, e.target.value)}
                      style={{ ...inp, textAlign: 'right' }} placeholder="kg" />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>kg</span>
                  </div>
                  <button onClick={() => removeItem(idx)} title="Quitar"
                    style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#ff6b6b', cursor: 'pointer', fontSize: 16, height: 38 }}>×</button>
                </div>
              )
            })}
          </div>
          <button onClick={addItem} style={{ padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            + Agregar producto
          </button>

          {/* Preview ahorro */}
          {form.items.length > 0 && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>Suelto: <strong style={{ color: 'var(--text)' }}>{fmt(preview.suelto)}</strong></span>
              <span style={{ color: 'var(--muted)' }}>Combo: <strong style={{ color: 'var(--gold)' }}>{fmt(preview.combo)}</strong></span>
              {preview.ahorro > 0
                ? <span style={{ color: '#7dff7d', fontWeight: 700 }}>Ahorro: {fmt(preview.ahorro)} (−{preview.pct}%)</span>
                : preview.combo > 0 && <span style={{ color: '#ffb86b', fontWeight: 700 }}>⚠️ El combo NO sale más barato que suelto</span>}
              {preview.faltan > 0 && <span style={{ color: '#ff6b6b' }}>⚠️ {preview.faltan} sin producto</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={guardar} disabled={guardando}
              style={{ padding: '10px 24px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 14 }}>
              {guardando ? '⏳ Guardando…' : '💾 Guardar combo'}
            </button>
            <button onClick={cancelar} style={{ padding: '10px 24px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <button onClick={nuevo} style={{ padding: '10px 20px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
            + Nuevo combo
          </button>
        </div>
      )}

      {/* ── PLANTILLAS DEL CARTEL ── */}
      {!editando && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>🪄 PLANTILLAS DEL CARTEL</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Cargan el combo con sus kg y precio, e intentan enganchar cada producto del catálogo por nombre. Verificá los productos antes de guardar.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PLANTILLAS.map(tpl => (
              <button key={tpl.nombre} onClick={() => usarPlantilla(tpl)}
                style={{ padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {tpl.emoji} {tpl.nombre} · {fmt(tpl.precio)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── LISTA DE COMBOS ── */}
      {combos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
          Todavía no hay combos. Creá uno con “+ Nuevo combo” o cargá una plantilla del cartel.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {combos.map(c => (
            <div key={c.id} className="card" style={{ padding: 14, opacity: c.disponible ? 1 : 0.55, borderColor: c.disponible ? 'var(--border)' : '#5a2a2a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{c.emoji} {c.nombre}</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)', lineHeight: 1 }}>{fmt(c.precio)}</div>
                </div>
                {esSucursal && esDeLaCentral(c) && (
                  <span style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 700, background: 'rgba(201,168,76,0.12)', border: '1px solid var(--gold)', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
                    🔒 de la central
                  </span>
                )}
                {!c.disponible && <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 700, background: '#3a1a1a', borderRadius: 6, padding: '3px 7px' }}>NO DISP.</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                {(c.items || []).map((it, i) => (
                  <div key={i}>• {Number(it.kg)} kg — {it.nombre}</div>
                ))}
              </div>
              {/* Un combo de la central lo vende la sucursal pero no lo toca:
                  sin botones, para no ofrecer algo que la base va a rebotar. */}
              {!puedeTocar(c) ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
                  Lo arma la central. Vos lo vendés desde la Caja.
                </div>
              ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => editar(c)} style={{ flex: 1, padding: '7px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✏️ Editar</button>
                <button onClick={() => toggleDisponible(c)} style={{ flex: 1, padding: '7px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, color: c.disponible ? '#ffb86b' : '#7dff7d', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {c.disponible ? '⏸️ Pausar' : '▶️ Activar'}
                </button>
                <button onClick={() => borrar(c)} style={{ padding: '7px 10px', background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 7, color: '#ff6b6b', cursor: 'pointer', fontSize: 12 }}>🗑️</button>
              </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const lbl = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }
