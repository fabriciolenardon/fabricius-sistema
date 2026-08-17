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
import { EPSILON_STOCK, stockNormalizado } from '../../lib/stockHelpers'

// Etiquetas legibles para cada tipo. Si llega un tipo desconocido se muestra
// el `tipo` crudo como fallback.
const LABELS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas Bovinas',
  bovino_brosa: '🫀 Brosa (genérico legacy — repartir y dejar en 0)',
  brosa_chinchulin: '🫀 Brosa — Chinchulín',
  brosa_corazon: '🫀 Brosa — Corazón',
  brosa_entrana: '🫀 Brosa — Entraña de Costillar',
  brosa_higado: '🫀 Brosa — Hígado',
  brosa_lengua: '🫀 Brosa — Lengua',
  brosa_molleja: '🫀 Brosa — Molleja',
  brosa_mondongo: '🫀 Brosa — Mondongo',
  brosa_rabo: '🫀 Brosa — Rabo',
  brosa_rinon: '🫀 Brosa — Riñón',
  brosa_sesos: '🫀 Brosa — Sesos (por unidad)',
  brosa_tripa_gorda: '🫀 Brosa — Tripa Gorda',
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
  embutido: '🌭 Embutidos (legacy — bucket eliminado, no usar)',
  emb_chorizo_parrillero: '🌭 Chorizo Parrillero (elab.)',
  emb_chorizo_saborizado: '🌭 Chorizo Saborizado (elab.)',
  emb_chorizo_colorado: '🌶️ Chorizo Colorado (elab.)',
  emb_salchicha_parrillera: '🌭 Salchicha Parrillera (elab.)',
  emb_morcilla: '🖤 Morcilla (elab.)',
  emb_salame_comun: '🥩 Salame Común Casero (elab.)',
  emb_salame_holanda: '🧀 Salame Holanda (elab.)',
  emb_salame_rockeford: '🧀 Salame Rockeford (elab.)',
  hamb_carne: '🍔 Hamburguesas de Carne (elab.)',
  hamb_pollo: '🍔 Hamburguesas de Pollo (elab.)',
  hamb_cerdo: '🍔 Hamburguesas de Cerdo (elab.)',
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
// brosa_sesos: el producto "SESOS (la unidad)" se vende por unidad (no
// pesable), así que su bucket también cuenta unidades.
const TIPOS_POR_UNIDAD = new Set(['almacen', 'bebidas', 'pollo', 'caja_cb', 'caja_pt', 'rebozado', 'brosa_sesos'])

const fmt = n => Math.round((Number(n) || 0) * 100) / 100
const fFecha = s => s ? new Date(s).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
}) : '—'

export default function AjusteStock() {
  // Solo el DUEÑO ajusta stock (pedido de Fabricio 14/08/2026): ser admin no
  // alcanza — Ariel y Giuliana también lo son. Ver lib/permisos.js.
  const { isCEO } = useAuth()
  const [stocks, setStocks] = useState([])
  const [historial, setHistorial] = useState([])  // ajustes registrados (auditoría) = desfasajes
  const [loading, setLoading] = useState(true)
  const [contados, setContados] = useState({}) // { tipo: 'string del input' }
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [filtro, setFiltro] = useState('todos') // 'todos' | 'negativos' | 'modificados'
  // Confirmaciones INLINE (nada de window.confirm: en iPhone/PWA lo suprimen sin
  // error y la acción se pierde en silencio — regla de oro N°4).
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  const [confirmGuardar, setConfirmGuardar] = useState(null) // { cambios, motivo }

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data, error }, { data: hist }] = await Promise.all([
      supabase.from('stock_actual').select('*').order('tipo'),
      // Cada ajuste de stock quedó logueado en auditoría = un desfasaje histórico.
      supabase.from('auditoria_log')
        .select('id, fecha, entidad_id, valores_antes, valores_despues, descripcion, usuario_nombre')
        .eq('entidad', 'stock_actual')
        .order('fecha', { ascending: false })
        .limit(500),
    ])
    if (error) console.error(error)
    setStocks(data || [])
    setHistorial(hist || [])
    setContados({})
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success', ms = 3500) {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), ms)
  }

  // Lista de filas con la diferencia ya calculada (memo para no recalcular en cada tecla)
  const filas = useMemo(() => stocks.map(s => {
    // stockNormalizado: un bucket vaciado queda con residuo de float
    // (-0,0000000000000036) que se muestra como 0 pero es < 0 — se pintaba en
    // rojo, contaba como negativo y "0 → 0" daba un ajuste fantasma de +0.
    const actual = stockNormalizado(s.kg_disponible)
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
      // Una diferencia que se muestra como 0 no es un ajuste: no tiene sentido
      // escribir en stock_actual (ni loguear en auditoría) un cambio de 0.
      modificado: tieneInput && !Number.isNaN(contado) && Math.abs(diferencia) >= EPSILON_STOCK,
    }
  }), [stocks, contados])

  // Filtro de la tabla
  const filasVisibles = useMemo(() => {
    if (filtro === 'negativos') return filas.filter(f => f.actual < 0)
    if (filtro === 'modificados') return filas.filter(f => f.modificado)
    return filas
  }, [filas, filtro])

  // ── Historial de desfasajes: cada ajuste registrado = un desfasaje (físico − sistema) ──
  const desfasajes = useMemo(() => (historial || []).map(r => {
    const tipo = r.entidad_id
    // Normalizado también acá: hay ajustes viejos cuyo "antes" es el residuo
    // de float (-0,0000000000000036) y se listaban como un desfasaje de +0.
    const antes = stockNormalizado(r.valores_antes?.kg_disponible)
    const despues = stockNormalizado(r.valores_despues?.kg_disponible)
    return {
      id: r.id, tipo,
      label: LABELS[tipo] || tipo,
      unidad: TIPOS_POR_UNIDAD.has(tipo) ? 'u' : 'kg',
      antes, despues, dif: stockNormalizado(despues - antes),
      motivo: r.valores_despues?.motivo || '—',
      fecha: r.fecha, usuario: r.usuario_nombre || '—',
    }
  }).filter(d => d.tipo), [historial])

  // Acumulado por producto (para detectar desfasajes recurrentes vs puntuales)
  const resumenDesfasajes = useMemo(() => {
    const m = new Map()
    for (const d of desfasajes) {
      const cur = m.get(d.tipo) || { tipo: d.tipo, label: d.label, unidad: d.unidad, n: 0, total: 0, ultimo: null }
      cur.n += 1; cur.total += d.dif
      if (!cur.ultimo || d.fecha > cur.ultimo) cur.ultimo = d.fecha
      m.set(d.tipo, cur)
    }
    return [...m.values()].map(x => ({ ...x, prom: x.n ? x.total / x.n : 0 }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  }, [desfasajes])

  const cantModificados = filas.filter(f => f.modificado).length

  function setContado(tipo, val) {
    // Si estaba abierta una confirmación, la invalidamos: lo que se muestra en
    // el panel tiene que ser siempre lo que se va a guardar.
    setConfirmGuardar(null)
    setContados(c => ({ ...c, [tipo]: val }))
  }

  function limpiar() {
    if (cantModificados === 0) return
    setConfirmGuardar(null)
    setConfirmLimpiar(true)
  }

  function ejecutarLimpiar() {
    setContados({})
    setMotivo('')
    setConfirmLimpiar(false)
  }

  // Paso 1: validar y abrir el panel de confirmación inline con el resumen.
  function pedirGuardar() {
    if (!isCEO) {
      showMsg('Solo el dueño puede ajustar stock', 'error')
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
    setConfirmLimpiar(false)
    setConfirmGuardar({ cambios, motivo: motivo.trim() })
  }

  // Paso 2: escribir en stock_actual lo que se mostró en el panel.
  async function guardarAjustes() {
    if (!confirmGuardar) return
    const { cambios, motivo: motivoTxt } = confirmGuardar

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
        descripcion: `Ajuste de stock "${c.label}": ${c.actual} → ${c.contado} (${signo}${fmt(c.diferencia)} ${c.unidad}). Motivo: ${motivoTxt}`,
        valoresAntes: { tipo: c.tipo, kg_disponible: c.actual },
        valoresDespues: { tipo: c.tipo, kg_disponible: c.contado, motivo: motivoTxt },
      })
    }
    setGuardando(false)
    setConfirmGuardar(null)

    if (errores.length > 0) {
      showMsg(`Se guardaron ${cambios.length - errores.length} de ${cambios.length}. Errores: ${errores.join('; ')}`, 'error', 8000)
    } else {
      showMsg(`✅ ${cambios.length} ajuste(s) guardado(s) y registrado(s) en auditoría`, 'success', 5000)
    }
    setContados({})
    setMotivo('')
    await cargar()
  }

  if (!isCEO) {
    return (
      <div style={{ padding: 20, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#ff6b6b' }}>
        🔒 El ajuste de stock es exclusivo del dueño de la empresa.
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          Si contaste stock y no coincide con el sistema, avisale a Fabricio con el detalle
          (producto, kg contados y por qué) para que lo corrija él.
        </div>
      </div>
    )
  }

  const inp = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 6, padding: '6px 10px',
    fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%',
    boxSizing: 'border-box', textAlign: 'right',
  }
  const thL = { textAlign: 'left', padding: '8px 10px', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }
  const thR = { ...thL, textAlign: 'right' }
  const tdR = { padding: '6px 10px', textAlign: 'right' }
  const colorDif = v => v < 0 ? '#ff8b8b' : v > 0 ? '#7dff7d' : 'var(--muted)'

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
                  // f.modificado ya trae la tolerancia: una diferencia que
                  // redondea a 0 se muestra neutra, no como "+0" en verde.
                  const colorDif = !f.modificado ? 'var(--muted)'
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
                          : !f.modificado ? '0'
                          : (f.diferencia > 0 ? '+' : '') + fmt(f.diferencia)
                        }
                        {f.diferencia != null && f.modificado && (
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

      {/* Footer con motivo + guardar.
          La confirmación es INLINE (window.confirm no se muestra en iOS/PWA y el
          ajuste se perdía en silencio). Mientras está abierto el panel se oculta
          el form para que lo que se ve sea exactamente lo que se va a escribir. */}
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        {confirmGuardar ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              📋 Confirmar {confirmGuardar.cambios.length} ajuste{confirmGuardar.cambios.length === 1 ? '' : 's'} de stock
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Revisá los cambios antes de escribirlos en el stock. Esto edita el stock directamente
              y queda registrado en auditoría con tu nombre.
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
                  <thead><tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                    <th style={thL}>Producto</th>
                    <th style={thR}>Sistema → Contado</th>
                    <th style={thR}>Diferencia</th>
                  </tr></thead>
                  <tbody>
                    {confirmGuardar.cambios.map(c => (
                      <tr key={c.tipo} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>{c.label}</td>
                        <td style={{ ...tdR, whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                          {fmt(c.actual)} → <b style={{ color: 'var(--text)' }}>{fmt(c.contado)}</b> {c.unidad}
                        </td>
                        <td style={{ ...tdR, color: colorDif(c.diferencia), fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {c.diferencia > 0 ? '+' : ''}{fmt(c.diferencia)} {c.unidad}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Motivo</div>
              <div style={{ fontSize: 13, fontWeight: 700, wordBreak: 'break-word' }}>{confirmGuardar.motivo}</div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={guardarAjustes} disabled={guardando}
                style={{ padding: '12px 20px', background: guardando ? 'var(--surface2)' : 'var(--gold)', color: guardando ? 'var(--muted)' : '#000', border: 'none', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 800 }}>
                {guardando ? '⏳ Guardando…' : '✅ Sí, guardar'}
              </button>
              <button onClick={() => setConfirmGuardar(null)} disabled={guardando}
                style={{ padding: '12px 20px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Motivo del ajuste (obligatorio)
              </label>
              <input
                value={motivo}
                onChange={e => { setConfirmGuardar(null); setMotivo(e.target.value) }}
                placeholder="Ej: Conteo físico fin de semana · Carga inicial almacén · Corrección venta mal cargada"
                style={{ ...inp, textAlign: 'left' }}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Queda guardado en el log de auditoría para poder rastrear el cambio después.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {confirmLimpiar ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>¿Descartar todo?</span>
                  <button onClick={ejecutarLimpiar}
                    style={{ padding: '10px 14px', background: '#3a1a1a', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>
                    Sí, descartar
                  </button>
                  <button onClick={() => setConfirmLimpiar(false)}
                    style={{ padding: '10px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button onClick={limpiar} disabled={cantModificados === 0}
                  style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: cantModificados === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: cantModificados === 0 ? 0.4 : 1 }}>
                  ✕ Limpiar
                </button>
              )}
              <button onClick={pedirGuardar} disabled={guardando || cantModificados === 0}
                style={{ padding: '10px 20px', background: cantModificados > 0 && !guardando ? 'var(--gold)' : 'var(--surface2)', color: cantModificados > 0 && !guardando ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: (guardando || cantModificados === 0) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 800 }}>
                {guardando ? '⏳ Guardando…' : `💾 Guardar ${cantModificados} ajuste${cantModificados === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HISTORIAL DE DESFASAJES — de los ajustes registrados */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">📉 Historial de desfasajes</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Cada ajuste que guardaste (físico vs sistema) queda acá. <b>Diferencia = físico − sistema.</b>{' '}
          Recurrente del mismo signo = probable <b>merma</b> o tema del sistema · Puntual y grande = probable <b>error de carga</b>.
        </div>

        {desfasajes.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
            Todavía no hay ajustes registrados. Cuando guardes un conteo físico arriba, aparece acá.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>📊 Acumulado por producto</div>
            <div style={{ overflowX: 'auto', marginBottom: 18 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                <thead><tr style={{ background: 'var(--surface2)' }}>
                  <th style={thL}>Producto</th><th style={thR}>Ajustes</th>
                  <th style={thR}>Desfasaje acum.</th><th style={thR}>Promedio</th><th style={thR}>Último</th>
                </tr></thead>
                <tbody>
                  {resumenDesfasajes.map(r => (
                    <tr key={r.tipo} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.label}</td>
                      <td style={tdR}>{r.n}</td>
                      <td style={{ ...tdR, color: colorDif(r.total), fontWeight: 700 }}>{r.total > 0 ? '+' : ''}{fmt(r.total)} {r.unidad}</td>
                      <td style={{ ...tdR, color: 'var(--muted)' }}>{r.prom > 0 ? '+' : ''}{fmt(r.prom)} {r.unidad}</td>
                      <td style={{ ...tdR, color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{fFecha(r.ultimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🕒 Detalle (últimos {Math.min(desfasajes.length, 80)})</div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 660 }}>
                <thead><tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                  <th style={thL}>Fecha</th><th style={thL}>Producto</th><th style={thR}>Sistema → Físico</th>
                  <th style={thR}>Dif.</th><th style={thL}>Motivo</th><th style={thL}>Por</th>
                </tr></thead>
                <tbody>
                  {desfasajes.slice(0, 80).map(d => (
                    <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fFecha(d.fecha)}</td>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{d.label}</td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmt(d.antes)} → {fmt(d.despues)}</td>
                      <td style={{ ...tdR, color: colorDif(d.dif), fontWeight: 700, whiteSpace: 'nowrap' }}>{d.dif > 0 ? '+' : ''}{fmt(d.dif)} {d.unidad}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{d.motivo}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d.usuario}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
