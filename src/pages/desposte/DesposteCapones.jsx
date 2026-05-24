// ============================================================
// DESPOSTE CAPONES — Operario carga kilos por pieza
// ============================================================
// Flujo:
// 1. Lista todos los capones disponibles en stock (entradas_deposito
//    tipo='cerdo' que aún no fueron despostadas)
// 2. Operario elige uno, le aparece el peso del capón
// 3. Carga kilos de cada pieza (piernas, carrés, pechitos, etc)
// 4. Confirma → se crea registro en `despostes`, se marca la
//    entrada como despostada, y se SUMA al stock de cada
//    cerdo_pierna/carre/etc el kilaje cargado.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { PIEZAS_CERDO } from '../../lib/modelosDesposte'
import { fechaHoyARG } from '../../lib/fechas'

async function sumarStock(tipo, kg) {
  const { data } = await supabase.from('stock_actual').select('*').eq('tipo', tipo).maybeSingle()
  if (data) {
    await supabase.from('stock_actual').update({ kg_disponible: (data.kg_disponible || 0) + kg }).eq('tipo', tipo)
  } else {
    await supabase.from('stock_actual').insert({ tipo, kg_disponible: kg })
  }
}

const fmt = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inp = {
  background: 'var(--surface2)', border: '2px solid var(--border)', color: 'var(--text)',
  borderRadius: 10, padding: '14px 16px', fontFamily: "'DM Sans', sans-serif",
  fontSize: 20, fontWeight: 700, width: '100%', boxSizing: 'border-box',
  textAlign: 'right',
}

export default function DesposteCapones() {
  const [capones, setCapones] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [piezas, setPiezas] = useState({})
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('entradas_deposito')
      .select('*')
      .eq('tipo', 'cerdo')
      .eq('despostada', false)
      .order('fecha', { ascending: false })
    setCapones(data || [])
    setLoading(false)
  }

  function elegir(capon) {
    setSeleccionado(capon)
    setPiezas({})
  }

  function setKg(key, v) {
    setPiezas(p => ({ ...p, [key]: v }))
  }

  const kgCapon = seleccionado ? (Number(seleccionado.kg_real) || Number(seleccionado.kg) || 0) : 0
  const kgPiezas = PIEZAS_CERDO.reduce((s, p) => s + (Number(piezas[p.key]) || 0), 0)
  const merma = kgCapon - kgPiezas
  const mermaPct = kgCapon > 0 ? (merma / kgCapon) * 100 : 0

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  async function confirmar() {
    if (!seleccionado) return
    if (kgPiezas === 0) return aviso('Cargá al menos una pieza con kilos', 'error')
    if (merma < 0) {
      if (!confirm(`⚠️ Las piezas suman MÁS que el capón.\nKg capón: ${fmt(kgCapon)} · Piezas: ${fmt(kgPiezas)}\n¿Guardar igual?`)) return
    }
    if (mermaPct > 15 && merma > 0) {
      if (!confirm(`⚠️ La merma es ${mermaPct.toFixed(1)}% — eso es bastante alto.\n¿Estás seguro?`)) return
    }

    setGuardando(true)
    const hoy = fechaHoyARG()
    const piezasDetalle = PIEZAS_CERDO
      .map(p => ({ nombre: p.nombre, kg: Number(piezas[p.key]) || 0, stock: p.stock }))
      .filter(p => p.kg > 0)

    // 1) Crear el desposte
    const { data: desposteData, error: e1 } = await supabase.from('despostes').insert({
      fecha: hoy,
      entrada_id: seleccionado.id,
      modelo: 'CERDO',
      tipo_desposte: 'cerdo',
      tipo_animal: 'cerdo',
      kg_media_res: kgCapon,
      merma_pct: kgCapon > 0 ? (merma / kgCapon) * 100 : 0,
      kg_neto: kgPiezas,
      piezas: piezasDetalle,
      notas: `Despostado por operario sector desposte`,
    }).select().single()

    if (e1) { setGuardando(false); aviso('❌ Error guardando desposte: ' + e1.message, 'error'); return }

    // 2) Marcar la entrada como despostada
    const { error: e2 } = await supabase.from('entradas_deposito')
      .update({ despostada: true, desposte_id: desposteData.id })
      .eq('id', seleccionado.id)
    if (e2) console.warn('No se pudo marcar despostada:', e2.message)

    // 3) Sumar al stock real cada pieza con kg > 0
    for (const p of piezasDetalle) {
      await sumarStock(p.stock, p.kg)
    }

    aviso(`✅ Capón despostado · ${piezasDetalle.length} pieza(s) sumadas al stock`, 'success')
    setSeleccionado(null)
    setPiezas({})
    cargar()
    setGuardando(false)
  }

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: 16 }}>Cargando capones...</p>

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          padding: '18px 24px', borderRadius: 10, fontSize: 16, fontWeight: 700,
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 460,
        }}>{msg.texto}</div>
      )}

      {/* Lista de capones disponibles */}
      {!seleccionado && (
        <>
          <h2 style={{ fontSize: 22, marginBottom: 16 }}>🐷 Capones disponibles en stock</h2>
          {capones.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
              No hay capones cargados en stock todavía.
              <div style={{ fontSize: 12, marginTop: 8 }}>Pedile al admin que cargue capones desde Depósito.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {capones.map(c => (
                <button key={c.id} onClick={() => elegir(c)}
                  style={{
                    padding: 18, background: 'var(--surface)', border: '2px solid var(--border)',
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    transition: 'all .15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--gold)' }}
                  onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Entrada del {c.fecha}</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--gold)' }}>
                    {fmt(c.kg_real || c.kg)} kg
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.proveedor || c.descripcion || '— sin proveedor —'}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Carga de piezas */}
      {seleccionado && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 22, margin: 0 }}>🐷 Despostando capón</h2>
            <button onClick={() => { setSeleccionado(null); setPiezas({}) }}
              style={{ padding: '10px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              ← Volver a la lista
            </button>
          </div>

          {/* Resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <KPI label="🐷 KG CAPÓN" valor={fmt(kgCapon)} color="var(--gold)" />
            <KPI label="✂️ KG PIEZAS" valor={fmt(kgPiezas)} color={kgPiezas > 0 ? '#7dff7d' : 'var(--muted)'} />
            <KPI
              label={merma >= 0 ? '📉 MERMA' : '⚠️ EXCESO'}
              valor={`${fmt(Math.abs(merma))} (${Math.abs(mermaPct).toFixed(1)}%)`}
              color={merma < 0 ? '#ff8b8b' : mermaPct > 15 ? '#ffd17a' : '#7dff7d'}
            />
          </div>

          {/* Inputs de piezas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
            {PIEZAS_CERDO.map(p => (
              <div key={p.key} style={{ padding: 14, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <label style={{ fontSize: 14, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  {p.nombre}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" inputMode="decimal" step="0.01" min="0"
                    value={piezas[p.key] || ''}
                    onChange={e => setKg(p.key, e.target.value)}
                    placeholder="0"
                    style={inp} />
                  <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700 }}>kg</span>
                </div>
              </div>
            ))}
          </div>

          {/* Confirmar */}
          <button onClick={confirmar} disabled={guardando || kgPiezas === 0}
            style={{
              width: '100%', padding: '20px', background: kgPiezas === 0 ? 'var(--surface2)' : 'var(--green)',
              color: kgPiezas === 0 ? 'var(--muted)' : '#000', border: 'none', borderRadius: 12,
              cursor: kgPiezas === 0 ? 'not-allowed' : 'pointer',
              fontFamily: "'Bebas Neue', cursive", fontSize: 24, letterSpacing: 3,
            }}>
            {guardando ? '⏳ GUARDANDO...' : '✅ CONFIRMAR DESPOSTE Y SUMAR A STOCK'}
          </button>
        </div>
      )}
    </div>
  )
}

function KPI({ label, valor, color }) {
  return (
    <div style={{ padding: 14, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color }}>{valor}</div>
    </div>
  )
}
