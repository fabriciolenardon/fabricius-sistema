// ============================================================
// AJUSTE DE STOCK — Conteo físico y corrección manual
// ============================================================
// Permite al admin/dueño:
//   1) Ver todos los tipos de stock en una sola pantalla
//   2) Cargar el conteo físico real al lado del valor del sistema
//   3) Ver la diferencia (sobrante / faltante) y guardarla
//   4) Cada ajuste queda registrado en auditoría con motivo + valores
//      antes/después, así no se "pierde" cómo llegó el stock a ese número.
//
// Uso típico:
//   - El dueño hace conteo físico el sábado al cerrar
//   - Abre esta pantalla, escribe los kg / unidades reales
//   - Aprieta "Guardar ajustes" → quedan stocks limpios para el lunes
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { logAuditoria } from '../../lib/auditoria'

// Etiquetas legibles para cada tipo. Si llega un tipo desconocido se muestra
// el `tipo` crudo como fallback.
const LABELS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas Bovinas',
  bovino_brosa: '🫀 Brosa',
  cerdo: '🐷 Cerdo (capón entero)',
  cerdo_pierna: '🦵 Cerdo — Piernas',
  cerdo_carre: '🥩 Cerdo — Carré',
  cerdo_pechito: '🍖 Cerdo — Pechitos',
  cerdo_matambre: '🥩 Cerdo — Matambre',
  cerdo_paleta: '🥩 Cerdo — Paleta',
  cerdo_parrillero: '🥩 Cerdo — Carnaza',
  cerdo_bondiola: '🥩 Cerdo — Bondiola',
  cerdo_tocino: '🧀 Cerdo — Tocino',
  cerdo_cuero: '🟫 Cerdo — Cuero',
  cerdo_cabeza: '💀 Cerdo — Cabeza',
  cerdo_huesos: '🦴 Cerdo — Huesos',
  pollo: '🍗 Pollo',
  embutido: '🌭 Embutidos (comprados / sin clasificar)',
  emb_chorizo_parrillero: '🌭 Chorizo Parrillero (elab.)',
  emb_chorizo_saborizado: '🌭 Chorizo Saborizado (elab.)',
  emb_salchicha_parrillera: '🌭 Salchicha Parrillera (elab.)',
  emb_morcilla: '🖤 Morcilla (elab.)',
  emb_salame: '🥩 Salame Casero (elab.)',
  rebozado: '🧊 Rebozados',
  almacen: '🛒 Almacén',
  bebidas: '🥤 Bebidas',
  pieza_pierna: '🦵 Pieza — Pierna',
  pieza_cuarto_pistola: '🥩 Pieza — Cuarto pistola',
  pieza_costillar: '🍖 Pieza — Costillar Completo',
  pieza_cortito: '🥩 Pieza — Cortito',
  pieza_costeletal: '🥩 Pieza — Costeletal con Lomo',
  pieza_paleta: '🥩 Pieza — Paleta',
  pieza_parrillero: '🥩 Pieza — Parrillero',
  caja_cb: '📦 Caja CB',
  caja_pt: '📦 Caja PT',
}

// Tipos que se manejan por unidad (no por kg). La columna kg_disponible
// guarda la cantidad de unidades para estos. Se muestra "u" en vez de "kg".
const TIPOS_POR_UNIDAD = new Set(['almacen', 'bebidas', 'pollo', 'caja_cb', 'caja_pt', 'rebozado'])

const fmt = n => Math.round((Number(n) || 0) * 100) / 100

export default function AjusteStock() {
  const { isAdmin } = useAuth()
  const [stocks, setStocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [contados, setContados] = useState({}) // { tipo: 'string del input' }
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [filtro, setFiltro] = useState('todos') // 'todos' | 'negativos' | 'modificados'

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase
      .from('stock_actual')
      .select('*')
      .order('tipo')
    if (error) console.error(error)
    setStocks(data || [])
    setContados({})
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success', ms = 3500) {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), ms)
  }

  // Lista de filas con la diferencia ya calculada (memo para no recalcular en cada tecla)
  const filas = useMemo(() => stocks.map(s => {
    const actual = Number(s.kg_disponible) || 0
    const contadoStr = contados[s.tipo]
    const tieneInput = contadoStr !== undefined && contadoStr !== ''
    const contado = tieneInput ? Number(contadoStr) : null
    const diferencia = tieneInput ? (contado - actual) : null
    return {
      ...s,
      label: LABELS[s.tipo] || s.tipo,
      unidad: TIPOS_POR_UNIDAD.has(s.tipo) ? 'u' : 'kg',
      actual,
      contado,
      diferencia,
      modificado: tieneInput && diferencia !== 0 && !Number.isNaN(contado),
    }
  }), [stocks, contados])

  // Filtro de la tabla
  const filasVisibles = useMemo(() => {
    if (filtro === 'negativos') return filas.filter(f => f.actual < 0)
    if (filtro === 'modificados') return filas.filter(f => f.modificado)
    return filas
  }, [filas, filtro])

  const cantModificados = filas.filter(f => f.modificado).length

  function setContado(tipo, val) {
    setContados(c => ({ ...c, [tipo]: val }))
  }

  function limpiar() {
    if (cantModificados === 0) return
    if (!confirm('¿Descartar todos los valores cargados?')) return
    setContados({})
    setMotivo('')
  }

  async function guardarAjustes() {
    if (!isAdmin) {
      showMsg('Solo el admin puede ajustar stock', 'error')
      return
    }
    const cambios = filas.filter(f => f.modificado)
    if (cambios.length === 0) {
      showMsg('No hay valores nuevos para guardar', 'error')
      return
    }
    if (!motivo.trim()) {
      showMsg('Cargá un motivo del ajuste (ej: "Conteo físico fin de semana")', 'error')
      return
    }
    const resumen = cambios.map(c => {
      const signo = c.diferencia > 0 ? '+' : ''
      return `${c.label}: ${c.actual} → ${c.contado} (${signo}${fmt(c.diferencia)} ${c.unidad})`
    }).join('\n')
    if (!confirm(`📋 GUARDAR AJUSTES (${cambios.length})\n\n${resumen}\n\nMotivo: ${motivo}\n\n¿Confirmar?`)) return

    setGuardando(true)
    const errores = []
    for (const c of cambios) {
      // 1) Actualizar el stock
      const { error } = await supabase
        .from('stock_actual')
        .update({ kg_disponible: c.contado })
        .eq('tipo', c.tipo)
      if (error) { errores.push(`${c.label}: ${error.message}`); continue }

      // 2) Loguear el ajuste en auditoría — no bloquea si falla
      const signo = c.diferencia > 0 ? '+' : ''
      await logAuditoria({
        accion: 'update',
        modulo: 'deposito',
        entidad: 'stock_actual',
        entidad_id: c.tipo,
        descripcion: `Ajuste de stock "${c.label}": ${c.actual} → ${c.contado} (${signo}${fmt(c.diferencia)} ${c.unidad}). Motivo: ${motivo}`,
        valoresAntes: { tipo: c.tipo, kg_disponible: c.actual },
        valoresDespues: { tipo: c.tipo, kg_disponible: c.contado, motivo },
      })
    }
    setGuardando(false)

    if (errores.length > 0) {
      showMsg(`Se guardaron ${cambios.length - errores.length} de ${cambios.length}. Errores: ${errores.join('; ')}`, 'error', 8000)
    } else {
      showMsg(`✅ ${cambios.length} ajuste(s) guardado(s) y registrado(s) en auditoría`, 'success', 5000)
    }
    setContados({})
    setMotivo('')
    await cargar()
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 20, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#ff6b6b' }}>
        🔒 Solo el administrador puede acceder al ajuste de stock.
      </div>
    )
  }

  const inp = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 6, padding: '6px 10px',
    fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%',
    boxSizing: 'border-box', textAlign: 'right',
  }

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
        <div className="card-title">🔧 Ajuste manual de stock</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Cargá el conteo físico real al lado del valor del sistema. Solo se guardan las filas
          donde escribiste algo nuevo y distinto. Cada cambio queda registrado en auditoría con
          tu nombre, fecha, el motivo y los valores antes/después.
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#ffd17a', background: 'rgba(255,209,122,0.06)', border: '1px solid #6a5a2a', padding: '8px 12px', borderRadius: 6 }}>
          ⚠️ Esto edita directamente el stock — no genera entradas ni salidas. Para sumar mercadería comprada usá Depósito → Entradas.
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { id: 'todos', label: `Todos (${filas.length})` },
          { id: 'negativos', label: `🚨 Negativos (${filas.filter(f => f.actual < 0).length})` },
          { id: 'modificados', label: `✏️ Modificados (${cantModificados})` },
        ].map(b => (
          <button key={b.id} onClick={() => setFiltro(b.id)}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: `1px solid ${filtro === b.id ? 'var(--gold)' : 'var(--border)'}`,
              background: filtro === b.id ? 'var(--gold)' : 'transparent',
              color: filtro === b.id ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
            {b.label}
          </button>
        ))}
        <button onClick={cargar} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
          🔄 Recargar
        </button>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando stocks...</p>}

      {!loading && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Tipo</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Sistema</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', width: 140 }}>Conteo físico</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', width: 130 }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin filas para mostrar</td></tr>
                )}
                {filasVisibles.map(f => {
                  const colorActual = f.actual < 0 ? '#ff6b6b' : f.actual === 0 ? 'var(--muted)' : 'var(--text)'
                  const colorDif = f.diferencia == null ? 'var(--muted)'
                    : f.diferencia === 0 ? 'var(--muted)'
                    : f.diferencia > 0 ? '#7dff7d'
                    : '#ff8b8b'
                  return (
                    <tr key={f.tipo} style={{ borderTop: '1px solid var(--border)', background: f.modificado ? 'rgba(201,168,76,0.04)' : 'transparent' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                        {f.label}
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{f.tipo}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: colorActual }}>
                        {fmt(f.actual)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{f.unidad}</span>
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        <input
                          type="number" step="0.01"
                          value={contados[f.tipo] ?? ''}
                          onChange={e => setContado(f.tipo, e.target.value)}
                          placeholder={String(fmt(f.actual))}
                          style={{ ...inp, borderColor: f.modificado ? 'var(--gold)' : 'var(--border)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: colorDif }}>
                        {f.diferencia == null ? '—'
                          : f.diferencia === 0 ? '0'
                          : (f.diferencia > 0 ? '+' : '') + fmt(f.diferencia)
                        }
                        {f.diferencia != null && f.diferencia !== 0 && (
                          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{f.unidad}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer con motivo + guardar */}
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Motivo del ajuste (obligatorio)
            </label>
            <input
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: Conteo físico fin de semana · Carga inicial almacén · Corrección venta mal cargada"
              style={{ ...inp, textAlign: 'left' }}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Queda guardado en el log de auditoría para poder rastrear el cambio después.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={limpiar} disabled={cantModificados === 0}
              style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: cantModificados === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: cantModificados === 0 ? 0.4 : 1 }}>
              ✕ Limpiar
            </button>
            <button onClick={guardarAjustes} disabled={guardando || cantModificados === 0}
              style={{ padding: '10px 20px', background: cantModificados > 0 && !guardando ? 'var(--gold)' : 'var(--surface2)', color: cantModificados > 0 && !guardando ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: (guardando || cantModificados === 0) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 800 }}>
              {guardando ? '⏳ Guardando…' : `💾 Guardar ${cantModificados} ajuste${cantModificados === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
