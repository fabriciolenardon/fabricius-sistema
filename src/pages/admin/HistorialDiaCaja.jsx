// ============================================================
// HISTORIAL DEL DÍA — panel inline para la vista Vender de Caja
// ============================================================
// Lista las ventas del turno de hoy (las mismas que ya carga la Caja
// en `ventasHoy`). Cada venta se puede clickear para desplegar el
// detalle: qué se vendió, cantidad, precio, importe, horario, forma
// de pago, descuento y notas. Va debajo del carrito.
// ============================================================
import { useState } from 'react'
import { fmtPrecio, fmtKg } from '../../lib/formatos'
import { useAuth } from '../../context/AuthContext'
import { anularVenta } from '../../lib/anularVenta'
import { imprimirTicketVenta } from '../../lib/ticketVenta'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

// Hora de la venta. Usa `hora` (ya guardada en horario local ARG) y,
// si falta, deriva de created_at forzando TZ Argentina.
function horaVenta(v) {
  if (v?.hora) return String(v.hora).slice(0, 5) // "HH:MM"
  if (v?.created_at) {
    return new Date(v.created_at).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
    })
  }
  return '—'
}

// Cantidad del ítem. Los items no guardan la unidad, así que inferimos:
// cantidad entera → unidades; con decimales → kilos (la carne va por kg).
function cantTxt(it) {
  const n = Number(it?.kg) || 0
  return Number.isInteger(n) ? `${n} u` : fmtKg(n)
}

function mediosPagoResumen(v) {
  const m = []
  if (Number(v.efectivo) > 0) m.push('💵')
  if (Number(v.debito) > 0) m.push('💳')
  if (Number(v.transferencia) > 0) m.push('🏦')
  return m.join(' ') || '—'
}

export default function HistorialDiaCaja({ ventas = [], onChange }) {
  const { isAdmin } = useAuth()
  const [abierta, setAbierta] = useState(null) // id de la venta expandida
  const [anulando, setAnulando] = useState(null) // id en proceso de anulación
  const totalDia = ventas.reduce((s, v) => s + (Number(v.total) || 0), 0)

  async function onAnular(v) {
    setAnulando(v.id)
    try {
      const r = await anularVenta(v, { isAdmin })
      if (r.ok) onChange?.()
    } finally {
      setAnulando(null)
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1, fontWeight: 700 }}>
          🧾 VENTAS DE HOY ({ventas.length})
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Total: <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(totalDia)}</span>
        </div>
      </div>

      {ventas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted)', fontSize: 12 }}>
          Todavía no hubo ventas hoy.
        </div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ventas.map((v, idx) => {
            const exp = abierta === v.id
            const nItems = Array.isArray(v.items) ? v.items.length : 0
            return (
              <div key={v.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
                <button
                  onClick={() => setAbierta(exp ? null : v.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 12 }}>{exp ? '▾' : '▸'}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--gold)' }}>{horaVenta(v)}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>#{ventas.length - idx}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{nItems} item{nItems !== 1 ? 's' : ''}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12 }}>{mediosPagoResumen(v)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)', minWidth: 78, textAlign: 'right' }}>{fmt(v.total)}</span>
                </button>

                {exp && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', background: 'var(--bg)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {(v.items || []).map((it, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '4px 2px', fontSize: 12 }}>{it.descripcion}</td>
                            <td style={{ padding: '4px 2px', fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{cantTxt(it)}</td>
                            <td style={{ padding: '4px 2px', fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(it.precio)}</td>
                            <td style={{ padding: '4px 2px', fontSize: 12, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--gold)' }}>{fmt(it.importe)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                      {Number(v.efectivo) > 0 && <span>💵 Efectivo {fmt(v.efectivo)}</span>}
                      {Number(v.debito) > 0 && <span>💳 Débito {fmt(v.debito)}</span>}
                      {Number(v.transferencia) > 0 && <span>🏦 Transferencia {fmt(v.transferencia)}</span>}
                      {Number(v.descuento_monto) > 0 && (
                        <span style={{ color: '#7ec8ff' }}>⚽ Descuento {v.descuento_pct ? `${v.descuento_pct}% ` : ''}−{fmt(v.descuento_monto)}</span>
                      )}
                    </div>
                    {v.notas && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>📝 {v.notas}</div>}
                    {/* Acciones por venta */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => imprimirTicketVenta(v)}
                        title="Imprimir el ticket de esta venta (comprobante no fiscal)"
                        style={{ padding: '6px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        🖨️ Imprimir
                      </button>
                      {isAdmin && (
                        <button onClick={() => onAnular(v)} disabled={anulando === v.id}
                          title="Anular venta y devolver el stock"
                          style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 6, cursor: anulando === v.id ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, opacity: anulando === v.id ? 0.5 : 1 }}>
                          {anulando === v.id ? '⏳ Anulando…' : '🗑️ Anular'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
