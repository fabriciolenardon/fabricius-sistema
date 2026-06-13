// PedidosWhatsapp.jsx — Bandeja de solicitudes que tomó Iris por WhatsApp.
// Son pedidos entrantes "auto con barreras": Iris los registró pero NO cerró
// la venta. Acá el equipo confirma disponibilidad/precio con el cliente y va
// marcando el estado (nuevo → visto → atendido / descartado).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const TZ_ARG = 'America/Argentina/Cordoba'
const ahora = () => new Date().toISOString()

// Fecha+hora legible en horario de Argentina (ej "13/06 20:44").
function fmtFechaHora(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ_ARG, day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(',', '')
}

const ESTADO_INFO = {
  nuevo:      { label: '🔴 Nuevo',      color: 'var(--red-light)' },
  visto:      { label: '👀 Visto',      color: 'var(--blue)' },
  atendido:   { label: '✅ Atendido',   color: 'var(--green)' },
  descartado: { label: '⚫ Descartado', color: 'var(--muted)' },
}

const FILTROS = [
  { key: 'nuevo',      label: 'Nuevos' },
  { key: 'visto',      label: 'Vistos' },
  { key: 'atendido',   label: 'Atendidos' },
  { key: 'descartado', label: 'Descartados' },
  { key: 'todos',      label: 'Todos' },
]

export default function PedidosWhatsapp() {
  const { profile } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [filtro, setFiltro] = useState('nuevo')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cargar()
    const canal = supabase.channel('pedidos-wa-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_whatsapp' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('pedidos_whatsapp').select('*').order('created_at', { ascending: false })
    setPedidos(data || [])
    setLoading(false)
  }

  async function cambiarEstado(p, estado) {
    const update = { estado }
    if (estado === 'atendido' || estado === 'descartado') {
      update.atendido_por = profile?.nombre || 'Admin'
      update.atendido_en = ahora()
    }
    const { error } = await supabase.from('pedidos_whatsapp').update(update).eq('id', p.id)
    if (error) { alert('❌ Error: ' + error.message); return }
    cargar()
  }

  // Al abrir un pedido "nuevo" en la lista lo dejamos visto automáticamente
  // sería invasivo; preferimos que el usuario marque. Botones explícitos.

  const visibles = filtro === 'todos' ? pedidos : pedidos.filter(p => p.estado === filtro)
  const countNuevos = pedidos.filter(p => p.estado === 'nuevo').length

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, letterSpacing: 1, margin: 0, color: 'var(--text)' }}>
          💬 Pedidos por WhatsApp
        </h1>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
          Solicitudes que tomó Iris. Confirmá disponibilidad y precio final con el cliente.
        </div>
      </div>

      {/* Filtros por estado */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTROS.map(f => {
          const activo = filtro === f.key
          const n = f.key === 'todos' ? pedidos.length : pedidos.filter(p => p.estado === f.key).length
          return (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              style={{ padding: '7px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: '1px solid ' + (activo ? 'var(--gold)' : 'var(--border)'),
                background: activo ? 'var(--gold)' : 'var(--surface)',
                color: activo ? '#000' : 'var(--muted)', fontFamily: "'DM Sans', sans-serif" }}>
              {f.label} {n > 0 && <span style={{ opacity: 0.8 }}>({n})</span>}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>
          {filtro === 'nuevo' && countNuevos === 0 ? '✅ No hay pedidos nuevos sin ver' : 'No hay pedidos en este estado'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibles.map(p => {
            const info = ESTADO_INFO[p.estado] || ESTADO_INFO.nuevo
            const waLink = `https://wa.me/${String(p.telefono || '').replace(/[^0-9]/g, '')}`
            return (
              <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${info.color}`, borderRadius: 12, padding: 14 }}>
                {/* Cabecera: estado + hora */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: info.color }}>{info.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFechaHora(p.created_at)}</span>
                </div>

                {/* Contacto */}
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  {p.nombre_contacto || 'Sin nombre'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>📱 {p.telefono}</div>

                {/* Resumen del pedido */}
                {p.resumen_pedido && (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                    📝 {p.resumen_pedido}
                  </div>
                )}

                {/* Mensaje original */}
                <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 10 }}>
                  💬 “{p.mensaje_cliente}”
                </div>

                {/* Quién lo atendió */}
                {(p.estado === 'atendido' || p.estado === 'descartado') && p.atendido_por && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                    {p.estado === 'atendido' ? 'Atendido' : 'Descartado'} por {p.atendido_por} · {fmtFechaHora(p.atendido_en)}
                  </div>
                )}

                {/* Acciones */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={waLink} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', background: 'var(--green)', color: '#000' }}>
                    💬 Responder
                  </a>
                  {p.estado === 'nuevo' && (
                    <button onClick={() => cambiarEstado(p, 'visto')} style={btnSec}>👀 Marcar visto</button>
                  )}
                  {p.estado !== 'atendido' && (
                    <button onClick={() => cambiarEstado(p, 'atendido')} style={btnSec}>✅ Atendido</button>
                  )}
                  {p.estado !== 'descartado' && (
                    <button onClick={() => cambiarEstado(p, 'descartado')} style={btnSec}>⚫ Descartar</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const btnSec = {
  padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)',
  fontFamily: "'DM Sans', sans-serif",
}
