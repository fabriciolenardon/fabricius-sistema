// ============================================================
// /pedir/seguimiento/:token — el cliente sigue su pedido
// ============================================================
// Sin usuario: el token del link ES la llave (delivery_ver_pedido).
// Se refresca solo cada 20 segundos: cuando el local pesa, el cliente
// ve el total final y, si eligió transferencia, el alias para pagar.
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { pesos, fmtCantidad, TZ, nombreLindo } from '../../lib/delivery'
import { limpiarNumero } from '../../lib/whatsapp'
import { C, F, btnPrimario, btnSecundario, useModoDelivery } from './estilo'

const hora = v => v ? new Date(v).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''

export default function Seguimiento() {
  useModoDelivery('Tu pedido · Fabricius')
  const { token } = useParams()
  const navigate = useNavigate()
  const [p, setP] = useState(undefined)   // undefined = cargando, null = no existe
  const [copiado, setCopiado] = useState(false)
  const [avisando, setAvisando] = useState(false)

  async function cargar() {
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) { setP(null); return }
    const { data, error } = await supabase.rpc('delivery_ver_pedido', { p_token: token })
    if (error) return            // red caída: dejamos lo último que se vio
    setP(data || null)
  }
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 20000)
    return () => clearInterval(t)
  }, [token])

  async function copiarAlias() {
    try { await navigator.clipboard.writeText(p.alias); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { /* el alias queda a la vista para copiarlo a mano */ }
  }
  async function yaTransferi() {
    if (avisando) return
    setAvisando(true)
    await supabase.rpc('delivery_avisar_transferencia', { p_token: token })
    await cargar()
    setAvisando(false)
  }

  if (p === undefined) return <Marco><div style={{ padding: 24, color: C.muted }}>Cargando tu pedido…</div></Marco>
  if (p === null) {
    return (
      <Marco>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 style={{ margin: 0, fontFamily: F.display, fontSize: 24 }}>No encontramos ese pedido</h1>
          <p style={{ margin: 0, color: C.muted, lineHeight: 1.5 }}>Revisá que el link esté completo.</p>
          <button onClick={() => navigate('/pedir')} style={btnPrimario}>Hacer un pedido</button>
        </div>
      </Marco>
    )
  }

  const pesado = !!p.pesado_at
  const esTransf = p.forma_pago === 'transferencia'
  const cancelado = p.estado === 'cancelado'
  const totalMostrar = pesado ? p.total_final : p.total_aprox
  const titulo = cancelado ? 'Pedido cancelado'
    : p.estado === 'entregado' ? '¡Pedido entregado!'
    : p.estado === 'en_camino' ? 'Tu pedido va en camino'
    : p.estado === 'pagado' ? 'Recibimos tu pago'
    : pesado ? 'Tu pedido ya está pesado'
    : 'Recibimos tu pedido'

  const pasos = [
    { ok: true, titulo: 'Recibimos tu pedido', hora: hora(p.created_at) },
    { ok: pesado, titulo: pesado ? 'Lo pesamos: total final' : 'Lo estamos preparando y pesando', hora: hora(p.pesado_at), detalle: 'pesado' },
    ...(esTransf ? [{ ok: !!p.pagado_at, titulo: p.pagado_at ? 'Pago recibido' : 'Esperando tu transferencia', hora: hora(p.pagado_at), detalle: 'pago' }] : []),
    { ok: !!p.en_camino_at, titulo: 'En camino', hora: hora(p.en_camino_at) },
    { ok: !!p.entregado_at, titulo: 'Entregado', hora: hora(p.entregado_at) },
  ]
  const wa = limpiarNumero(p.whatsapp)
  const textoComprobante = encodeURIComponent(`Hola! Te mando el comprobante del pedido N° ${p.numero} (${pesos(p.total_final)})`)

  return (
    <Marco>
      <div style={{ background: C.ink, color: '#FFFFFF', padding: '36px 22px 22px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, color: '#E9E2D8' }}>Pedido N° {p.numero} · {p.direccion}</span>
        <h1 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 25 }}>{titulo}</h1>
      </div>

      <div style={{ padding: '20px 22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {cancelado ? (
          <div style={{ padding: 14, borderRadius: 12, background: C.soft, lineHeight: 1.5 }}>
            {p.motivo_cancelacion || 'El local canceló este pedido.'} Si tenés dudas, escribinos.
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {pasos.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 12, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: s.ok ? '#2E7D4F' : '#FFFFFF', border: s.ok ? 0 : '2px solid #C7BEB2',
                  }}>
                    {s.ok && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
                  </span>
                  {i < pasos.length - 1 && <span style={{ width: 2, flexGrow: 1, minHeight: 26, background: pasos[i + 1].ok ? '#2E7D4F' : C.line }} />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: i < pasos.length - 1 ? 16 : 0, flexGrow: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                    <b style={{ fontSize: 15, color: s.ok ? C.ink : C.muted, fontWeight: s.ok ? 700 : 500 }}>{s.titulo}</b>
                    {s.hora && <span style={{ fontSize: 13, color: C.muted }}>{s.hora}</span>}
                  </div>

                  {s.detalle === 'pesado' && (
                    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                      {(p.items || []).map((it, j) => (
                        <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ minWidth: 0 }}>{nombreLindo(it.nombre)} <span style={{ color: C.muted }}>{fmtCantidad(pesado && it.pesable ? (it.kg_real ?? it.cantidad) : it.cantidad, it.pesable)}</span></span>
                          <span style={{ whiteSpace: 'nowrap' }}>{pesado ? '' : '≈ '}{pesos(pesado ? (it.importe_real ?? it.importe) : it.importe)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted }}><span>Envío</span><span>{pesos(p.envio)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 17, paddingTop: 6, borderTop: '1px solid #EFEAE2' }}>
                        <span>{pesado ? 'Total a pagar' : 'Total aproximado'}</span><span>{pesado ? '' : '≈ '}{pesos(totalMostrar)}</span>
                      </div>
                      {!pesado && <span style={{ fontSize: 12, color: C.muted }}>Cuando lo pesemos te mostramos acá el total exacto.</span>}
                    </div>
                  )}

                  {s.detalle === 'pago' && pesado && !p.pagado_at && (
                    <div style={{ borderRadius: 12, background: C.aviso, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.5, color: C.avisoInk }}>
                      <span>Transferí <b>{pesos(p.total_final)}</b> a este alias y mandanos el comprobante. Apenas lo vemos, sale el pedido.</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FFFFFF', borderRadius: 10, padding: '10px 12px' }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16, color: C.ink, flexGrow: 1, userSelect: 'all', wordBreak: 'break-all' }}>{p.alias}</span>
                        <button onClick={copiarAlias} style={{ border: 0, background: C.ink, color: '#FFFFFF', borderRadius: 8, height: 36, padding: '0 12px', fontFamily: F.body, fontWeight: 700, cursor: 'pointer' }}>
                          {copiado ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                      {wa && (
                        <a href={`https://wa.me/${wa}?text=${textoComprobante}`} target="_blank" rel="noreferrer" style={{ ...btnSecundario, background: '#FFFFFF' }}>
                          Mandar el comprobante por WhatsApp
                        </a>
                      )}
                      {p.transferencia_avisada_at
                        ? <span style={{ fontWeight: 700, color: C.verde }}>Te avisamos apenas veamos la transferencia.</span>
                        : <button onClick={yaTransferi} disabled={avisando} style={{ ...btnPrimario, minHeight: 48, fontSize: 15 }}>{avisando ? 'Avisando…' : 'Ya transferí'}</button>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
          {esTransf ? 'Pagás por transferencia.' : `Pagás ${pesos(totalMostrar)}${pesado ? '' : ' aprox.'} en efectivo cuando te llega.`}
          {' '}Esta pantalla se actualiza sola.
        </div>
        <button onClick={() => navigate('/pedir')} style={btnSecundario}>Hacer otro pedido</button>
      </div>
    </Marco>
  )
}

function Marco({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: F.body }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>{children}</div>
    </div>
  )
}
