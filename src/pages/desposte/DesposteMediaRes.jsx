// ============================================================
// DESPOSTE MEDIA RES — Operario, 3 sub-modos
// ============================================================
// NO modifica stock. Solo crea un registro en `flujo_deposito`
// con estado 'pendiente' para que el admin lo procese desde
// el panel de administración.
//
// Sub-modos:
//   1. Piezas  → elige modelo A/B/C + carga kg de media res
//   2. Kilo    → carga kg de media res destinada a venta por kg
//   3. Mayorista / Minorista → carga kg de media res entera
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MODELOS_DESPOSTE } from '../../lib/modelosDesposte'

const fmt = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inp = {
  background: 'var(--surface2)', border: '2px solid var(--border)', color: 'var(--text)',
  borderRadius: 10, padding: '14px 16px', fontFamily: "'DM Sans', sans-serif",
  fontSize: 20, fontWeight: 700, width: '100%', boxSizing: 'border-box', textAlign: 'right',
}

const SUBMODOS = [
  { id: 'piezas',     label: 'Desposte en piezas (A/B/C)', icono: '🥩', color: 'var(--gold)' },
  { id: 'kilo',       label: 'Desposte para venta por KILO', icono: '⚖️', color: '#7a9dff' },
  { id: 'mayorista',  label: 'Venta MAYORISTA (entera)',    icono: '📦', color: '#ffd17a' },
  { id: 'minorista',  label: 'Venta MINORISTA (entera)',    icono: '🏪', color: '#7dff7d' },
]

export default function DesposteMediaRes() {
  const { profile } = useAuth()
  const [submodo, setSubmodo] = useState(null) // null = pantalla de elección
  const [mediasRes, setMediasRes] = useState([])
  const [seleccionada, setSeleccionada] = useState(null)
  const [kgManual, setKgManual] = useState('')
  const [modelo, setModelo] = useState('A')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [misEnvios, setMisEnvios] = useState([])
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: mr }, { data: env }] = await Promise.all([
      supabase.from('entradas_deposito').select('*')
        .eq('tipo', 'bovino_mr').eq('despostada', false).eq('reservada', false)
        .order('fecha', { ascending: false }),
      supabase.from('flujo_deposito').select('*')
        .order('created_at', { ascending: false }).limit(10),
    ])
    setMediasRes(mr || [])
    setMisEnvios(env || [])
  }

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4500)
  }

  function elegirModo(id) {
    setSubmodo(id)
    setSeleccionada(null)
    setKgManual('')
    setModelo('A')
    setNotas('')
  }

  function reset() {
    setSubmodo(null)
    setSeleccionada(null)
    setKgManual('')
    setModelo('A')
    setNotas('')
  }

  async function enviar() {
    const kg = Number(kgManual) || 0
    if (kg <= 0) return aviso('Cargá los kilos de la media res', 'error')

    const tipoFlujo = submodo === 'piezas' ? 'media_res_piezas'
      : submodo === 'kilo' ? 'media_res_kilo'
      : submodo === 'mayorista' ? 'media_res_mayorista'
      : 'media_res_minorista'

    const payload = { submodo }
    if (submodo === 'piezas') {
      payload.modelo = modelo
      payload.modelo_nombre = MODELOS_DESPOSTE[modelo]?.nombre
    }
    if (seleccionada) {
      payload.entrada_fecha = seleccionada.fecha
      payload.entrada_kg_real = seleccionada.kg_real || seleccionada.kg
      payload.proveedor = seleccionada.proveedor
    }

    setGuardando(true)
    const { error } = await supabase.from('flujo_deposito').insert({
      empleado_id: profile?.id,
      empleado_nombre: profile?.nombre,
      tipo: tipoFlujo,
      entrada_id: seleccionada?.id || null,
      kg_media_res: kg,
      modelo: submodo === 'piezas' ? modelo : null,
      payload,
      notas: notas || null,
      estado: 'pendiente',
    })
    setGuardando(false)
    if (error) return aviso('❌ ' + error.message, 'error')

    aviso('✅ Enviado al admin para que procese · vas a poder ver el estado abajo', 'success')
    reset()
    cargar()
  }

  // ── Pantalla 1: elegir modo ──
  if (!submodo) {
    return (
      <div>
        {msg && <Toast msg={msg} />}
        <h2 style={{ fontSize: 22, marginBottom: 16 }}>🐄 Desposte Media Res — elegí qué tipo</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
          {SUBMODOS.map(m => (
            <button key={m.id} onClick={() => elegirModo(m.id)}
              style={{
                padding: 24, background: 'var(--surface)', border: `2px solid var(--border)`,
                borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                transition: 'border .15s',
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = m.color }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
              <div style={{ fontSize: 36 }}>{m.icono}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: m.color }}>{m.label}</div>
            </button>
          ))}
        </div>

        {/* Historial de envíos recientes */}
        {misEnvios.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, color: 'var(--muted)', marginBottom: 8 }}>📋 Últimos envíos al admin</h3>
            <div style={{ background: 'var(--surface)', borderRadius: 10, overflow: 'hidden' }}>
              {misEnvios.map(e => (
                <div key={e.id} style={{
                  padding: '12px 16px', borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {LABEL_TIPO[e.tipo] || e.tipo}
                      {e.modelo && ` · Modelo ${e.modelo}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {e.fecha} {e.hora} · {fmt(e.kg_media_res)} kg
                      {e.empleado_nombre && ` · por ${e.empleado_nombre}`}
                    </div>
                  </div>
                  <BadgeEstado estado={e.estado} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Pantalla 2: cargar datos ──
  const modoInfo = SUBMODOS.find(m => m.id === submodo)
  const necesitaModelo = submodo === 'piezas'

  return (
    <div>
      {msg && <Toast msg={msg} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>{modoInfo?.icono} {modoInfo?.label}</h2>
        <button onClick={reset}
          style={{ padding: '10px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          ← Volver
        </button>
      </div>

      {/* Selector de media res (opcional, también pueden cargar a mano) */}
      {mediasRes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
            Media res del stock (opcional — también podés tipear los kilos a mano abajo)
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {mediasRes.slice(0, 8).map(mr => {
              const sel = seleccionada?.id === mr.id
              return (
                <button key={mr.id} onClick={() => { setSeleccionada(sel ? null : mr); setKgManual(sel ? '' : String(mr.kg_real || mr.kg || '')) }}
                  style={{
                    padding: 12, background: sel ? 'var(--gold)22' : 'var(--surface)',
                    border: `2px solid ${sel ? 'var(--gold)' : 'var(--border)'}`,
                    color: sel ? 'var(--gold)' : 'var(--text)',
                    borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{mr.fecha}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(mr.kg_real || mr.kg)} kg</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{mr.proveedor || '—'}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Modelo si corresponde */}
      {necesitaModelo && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Modelo de desposte</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {Object.entries(MODELOS_DESPOSTE).map(([id, m]) => {
              const activo = modelo === id
              return (
                <button key={id} onClick={() => setModelo(id)}
                  style={{
                    padding: 14, background: activo ? 'var(--gold)22' : 'var(--surface)',
                    border: `2px solid ${activo ? 'var(--gold)' : 'var(--border)'}`,
                    color: activo ? 'var(--gold)' : 'var(--text)',
                    borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{m.icono}</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Modelo {id}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{m.nombre}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Kg de la media res */}
      <div style={{ marginBottom: 20, padding: 18, background: 'var(--surface)', borderRadius: 12 }}>
        <label style={{ fontSize: 14, color: 'var(--muted)', display: 'block', marginBottom: 8, fontWeight: 600 }}>
          ⚖️ Kg de la media res
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="number" inputMode="decimal" step="0.01" min="0"
            value={kgManual} onChange={e => setKgManual(e.target.value)}
            placeholder="Ej: 95.5" autoFocus
            style={{ ...inp, fontSize: 28, borderColor: 'var(--gold)' }} />
          <span style={{ fontSize: 18, color: 'var(--muted)', fontWeight: 700 }}>kg</span>
        </div>
      </div>

      {/* Notas */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Notas (opcional)</label>
        <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej: para cliente Pérez..."
          style={{ ...inp, fontSize: 14, textAlign: 'left', fontWeight: 400 }} />
      </div>

      {/* Confirmar */}
      <button onClick={enviar} disabled={guardando || !kgManual || Number(kgManual) <= 0}
        style={{
          width: '100%', padding: 22,
          background: (!kgManual || Number(kgManual) <= 0) ? 'var(--surface2)' : 'var(--green)',
          color: (!kgManual || Number(kgManual) <= 0) ? 'var(--muted)' : '#000',
          border: 'none', borderRadius: 12,
          cursor: (!kgManual || Number(kgManual) <= 0) ? 'not-allowed' : 'pointer',
          fontFamily: "'Bebas Neue', cursive", fontSize: 26, letterSpacing: 3,
        }}>
        {guardando ? '⏳ ENVIANDO...' : '📤 ENVIAR AL ADMIN'}
      </button>
      <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>
        El admin lo va a procesar y cargar al sistema desde el panel "Flujo Depósito".
      </div>
    </div>
  )
}

function Toast({ msg }) {
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 1000,
      padding: '18px 24px', borderRadius: 10, fontSize: 16, fontWeight: 700,
      background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
      color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
      border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 460,
    }}>{msg.texto}</div>
  )
}

function BadgeEstado({ estado }) {
  const cfg = {
    pendiente:  { bg: '#3a2a14', color: '#ffd17a', label: '⏳ Pendiente' },
    aprobado:   { bg: '#1a2a1a', color: '#7dff7d', label: '✅ Aprobado' },
    rechazado:  { bg: '#3a1a1a', color: '#ff8b8b', label: '❌ Rechazado' },
  }[estado] || { bg: 'var(--surface2)', color: 'var(--muted)', label: estado }
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
      {cfg.label}
    </span>
  )
}

const LABEL_TIPO = {
  media_res_piezas:     'En piezas',
  media_res_kilo:       'Venta por kilo',
  media_res_mayorista:  'Mayorista (entera)',
  media_res_minorista:  'Minorista (entera)',
}
