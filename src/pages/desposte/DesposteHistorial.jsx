// ============================================================
// DESPOSTE HISTORIAL — Timeline unificado del sector
// ============================================================
// Combina en un solo listado cronologico (fecha + hora) todo lo que
// hace el operario del desposte:
//
//   1. Capones despostados (tabla `despostes` con tipo_animal=cerdo)
//      → el operario los procesa directo desde DesposteCapones y se
//      registra el desposte completo, sumando piezas al stock.
//
//   2. Medias reses enviadas al admin (tabla `flujo_deposito`)
//      → el operario carga datos desde DesposteMediaRes y el admin
//      las procesa despues desde el panel. Cada envio tiene estado:
//      pendiente / aprobado / rechazado.
//
// Si un envio de flujo_deposito ya fue aprobado y genero un desposte,
// mostramos solo el flujo (no duplicamos con el desposte resultante).
// Cada item es expandible para ver el detalle de piezas y notas.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { fmtKg } from '../../lib/formatos'

const FECHA_FMT = { day: '2-digit', month: '2-digit', year: '2-digit' }

export default function DesposteHistorial() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [filtro, setFiltro] = useState('todos') // todos | cerdo | bovino

  useEffect(() => { cargar() }, [])

  // Realtime: actualiza el historial al instante cuando el operario
  // confirma un desposte o cuando el admin aprueba/rechaza un flujo.
  useEffect(() => {
    let timer = null
    const debouncedReload = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cargar(), 400)
    }
    const canal = supabase.channel('desposte-historial-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'despostes' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flujo_deposito' }, debouncedReload)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(canal) }
  }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: despostes }, { data: flujo }] = await Promise.all([
      fetchAllRows(() => supabase.from('despostes').select('*').order('created_at', { ascending: false })),
      fetchAllRows(() => supabase.from('flujo_deposito').select('*').order('created_at', { ascending: false })),
    ])

    // Si un flujo ya fue aprobado y creó un desposte, no duplicamos.
    // Mostramos el flujo (que tiene el estado de aprobación y el
    // empleado_nombre) y omitimos el desposte resultante.
    const desposteIdsDeFlujo = new Set((flujo || []).map(f => f.desposte_id).filter(Boolean))
    const despostesUnicos = (despostes || []).filter(d => !desposteIdsDeFlujo.has(d.id))

    const lista = [
      ...despostesUnicos.map(d => ({
        id: 'd-' + d.id,
        ts: d.created_at,
        fecha: d.fecha,
        origen: 'desposte',
        tipo_animal: d.tipo_animal || (d.tipo_desposte === 'cerdo' ? 'cerdo' : 'bovino'),
        tipo_desposte: d.tipo_desposte,
        modelo: d.modelo,
        kg_total: Number(d.kg_media_res) || 0,
        kg_neto: Number(d.kg_neto) || 0,
        merma_pct: Number(d.merma_pct) || 0,
        piezas: d.piezas,
        notas: d.notas,
        estado: 'registrado',
        empleado: null,
      })),
      ...(flujo || []).map(f => ({
        id: 'f-' + f.id,
        ts: f.created_at,
        fecha: f.fecha,
        hora_explicita: f.hora,
        origen: 'flujo',
        tipo_animal: 'bovino',
        tipo_desposte: f.tipo,
        modelo: f.modelo,
        kg_total: Number(f.kg_media_res) || 0,
        kg_neto: Number(f.payload?.kg_piezas_total) || 0,
        piezas: f.payload?.piezas,
        notas: f.notas,
        notas_admin: f.notas_admin,
        aprobado_por_nombre: f.aprobado_por_nombre,
        estado: f.estado, // pendiente | aprobado | rechazado
        empleado: f.empleado_nombre,
      })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts))

    setItems(lista)
    setLoading(false)
  }

  const filtrados = items.filter(it => filtro === 'todos' || it.tipo_animal === filtro)
  const pag = usePaginacion(filtrados, 20)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>📋 Historial desposte</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'todos',  label: '📋 Todo' },
            { id: 'cerdo',  label: '🐷 Capones' },
            { id: 'bovino', label: '🐄 Medias' },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              style={{
                padding: '8px 14px', borderRadius: 8,
                border: `1px solid ${filtro === f.id ? 'var(--gold)' : 'var(--border)'}`,
                background: filtro === f.id ? 'var(--gold)' : 'transparent',
                color: filtro === f.id ? '#000' : 'var(--muted)',
                cursor: 'pointer', fontSize: 13, fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        Cada item ordenado por fecha y hora. Tocá uno para ver el detalle de piezas y notas.
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>⏳ Cargando historial...</div>
      ) : filtrados.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
          Sin actividad registrada en este filtro.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pag.items.map(it => (
              <ItemHistorial
                key={it.id}
                item={it}
                expandido={expandido === it.id}
                onToggle={() => setExpandido(expandido === it.id ? null : it.id)}
              />
            ))}
          </div>
          <Paginador {...pag.controles} label="registros" />
        </>
      )}
    </div>
  )
}

function ItemHistorial({ item, expandido, onToggle }) {
  const fechaHora = formatearFechaHora(item.ts, item.fecha, item.hora_explicita)
  const tipoLabel = getTipoLabel(item)
  const colorTipo = item.tipo_animal === 'cerdo' ? '#ff8b8b' : '#a78bfa'
  const badge = getBadge(item.estado)

  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid var(--border)`,
      borderRadius: 10, borderLeft: `4px solid ${colorTipo}`,
      overflow: 'hidden',
    }}>
      <button onClick={onToggle}
        style={{
          width: '100%', padding: '14px 16px', background: 'transparent',
          border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: "'DM Sans', sans-serif",
        }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>
          {item.tipo_animal === 'cerdo' ? '🐷' : '🐄'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{tipoLabel}</span>
            {item.modelo && item.modelo !== 'CERDO' && (
              <span style={{ fontSize: 11, background: 'var(--surface2)', padding: '2px 8px', borderRadius: 6, color: 'var(--gold)' }}>
                Modelo {item.modelo}
              </span>
            )}
            <BadgeEstado badge={badge} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {fechaHora}
            {item.empleado && <span> · por <strong style={{ color: 'var(--text2)' }}>{item.empleado}</strong></span>}
            {item.estado === 'aprobado' && item.aprobado_por_nombre && (
              <span> · aprobó <strong style={{ color: '#7dff7d' }}>{item.aprobado_por_nombre}</strong></span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)' }}>
            {fmtKg(item.kg_total)}
          </div>
          {item.kg_neto > 0 && item.kg_neto !== item.kg_total && (
            <div style={{ fontSize: 10, color: 'var(--green)' }}>
              Neto: {fmtKg(item.kg_neto)}
            </div>
          )}
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 6 }}>
          {expandido ? '▲' : '▼'}
        </div>
      </button>

      {expandido && (
        <div style={{ padding: '0 16px 16px 50px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
          {/* Piezas */}
          {Array.isArray(item.piezas) && item.piezas.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Piezas
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {item.piezas.filter(Boolean).map((p, i) => (
                  <div key={i} style={{ padding: '6px 10px', background: 'var(--surface)', borderRadius: 6, fontSize: 12 }}>
                    <div style={{ color: 'var(--muted)' }}>{p.nombre}</div>
                    <div style={{ fontWeight: 700, color: 'var(--gold)' }}>{fmtKg(p.kg)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Merma para despostes confirmados */}
          {item.merma_pct > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Merma: <strong style={{ color: item.merma_pct > 8 ? '#ffd17a' : '#7dff7d' }}>{item.merma_pct.toFixed(1)}%</strong>
            </div>
          )}

          {/* Notas operario */}
          {item.notas && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Notas</div>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text2)' }}>"{item.notas}"</div>
            </div>
          )}

          {/* Notas del admin (para flujos aprobados/rechazados) */}
          {item.notas_admin && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Respuesta del admin</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{item.notas_admin}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BadgeEstado({ badge }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700,
      background: badge.bg, color: badge.color,
      padding: '2px 8px', borderRadius: 6,
      whiteSpace: 'nowrap',
    }}>
      {badge.label}
    </span>
  )
}

function getBadge(estado) {
  if (estado === 'pendiente') return { bg: '#3a2a14', color: '#ffd17a', label: '⏳ PENDIENTE' }
  if (estado === 'aprobado')  return { bg: '#1a2a1a', color: '#7dff7d', label: '✅ APROBADO' }
  if (estado === 'rechazado') return { bg: '#3a1a1a', color: '#ff8b8b', label: '❌ RECHAZADO' }
  return { bg: '#1a2a1a', color: '#7dff7d', label: '✅ REGISTRADO' }
}

function getTipoLabel(item) {
  // Para despostes ya registrados
  if (item.origen === 'desposte') {
    if (item.tipo_desposte === 'cerdo')      return 'Capón despostado'
    if (item.tipo_desposte === 'piezas')     return 'Media res — despostada en piezas'
    if (item.tipo_desposte === 'kilo')       return 'Media res — desposte por kilo'
    if (item.tipo_desposte === 'pieza_kilo') return 'Pieza convertida a cortes'
    return 'Desposte'
  }
  // Para flujos enviados al admin (medias reses)
  if (item.tipo_desposte === 'media_res_piezas')     return 'Media res — Piezas (al admin)'
  if (item.tipo_desposte === 'media_res_kilo')       return 'Media res — Venta por kilo (al admin)'
  if (item.tipo_desposte === 'media_res_mayorista')  return 'Media res — Mayorista entera (al admin)'
  if (item.tipo_desposte === 'media_res_minorista')  return 'Media res — Minorista entera (al admin)'
  return 'Envío al admin'
}

function formatearFechaHora(timestamp, fechaFallback, horaFallback) {
  // Preferimos created_at (timestamp completo). Si no existe, armamos
  // desde fecha + hora del registro.
  try {
    if (timestamp) {
      // Parser defensivo: Postgres a veces devuelve `2026-05-26 15:00:00`
      // sin TZ explicita para columnas `timestamp without time zone`. JS
      // interpreta esos strings como hora local → bug de 3 horas en
      // Argentina (UTC-3). Si detectamos que el string NO trae TZ,
      // agregamos 'Z' para forzar interpretacion UTC (el server de
      // Supabase guarda en UTC). Para columnas ya convertidas a TIMESTAMPTZ
      // el string trae `+00:00` y este chequeo no las toca.
      const tieneTZ = /(Z|[+\-]\d{2}:?\d{2})$/.test(timestamp.trim())
      const d = new Date(tieneTZ ? timestamp : timestamp.replace(' ', 'T') + 'Z')
      return d.toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    }
  } catch {}
  const fechaStr = fechaFallback
    ? new Date(fechaFallback + 'T12:00').toLocaleDateString('es-AR', FECHA_FMT)
    : '—'
  return `${fechaStr}${horaFallback ? ' · ' + horaFallback.substring(0, 5) : ''}`
}
