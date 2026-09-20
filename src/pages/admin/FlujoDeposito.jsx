// ============================================================
// FLUJO DEPÓSITO (Admin)
// ============================================================
// Recibe las cargas de medias reses que envían los empleados del sector
// desposte (media_res_piezas / _kilo / _mayorista / _minorista). El admin las
// corrobora y aprueba o rechaza: es SOLO el acuse de recibo.
//
// Aprobar NO toca el stock ni crea un desposte — el despacho/desposte se
// carga a mano desde Depósito. La versión que lo hacía sola (ejecutarAprobacion
// + ModalConfirmarDesposte) quedó desconectada hace tiempo y se borró el
// 20/09/2026; sus controles de kg sobrevivieron en controlarKg(), que ahora
// sí se ven, en el panel de aprobación.
//
// Aprobar y rechazar se confirman DENTRO de la tarjeta: el confirm()/prompt()
// del navegador no existe en el iPhone ni en la PWA.
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { avisarCambioFlujo } from '../../lib/useFlujoNotificaciones'
import Paginador, { usePaginacion } from '../../components/Paginador'

import { fmtKg } from '../../lib/formatos'
// Fecha+hora de la aprobación en horario ARG (regla de oro: nunca la TZ del navegador)
const fmtFechaHora = ts => ts ? new Date(ts).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
}) : ''

// Panel de confirmación dentro de la tarjeta (reemplaza al confirm/prompt)
const cajaConfirmar = {
  padding: 10, borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface2)',
}
const btnSi = {
  flex: 1, padding: '8px 10px', border: 'none', borderRadius: 7, cursor: 'pointer',
  background: 'var(--green)', color: '#000', fontWeight: 700, fontSize: 12.5,
  fontFamily: "'DM Sans',sans-serif",
}
const btnNo = {
  padding: '8px 12px', borderRadius: 7, cursor: 'pointer', background: 'transparent',
  border: '1px solid var(--border2)', color: 'var(--text2)', fontWeight: 600, fontSize: 12.5,
  fontFamily: "'DM Sans',sans-serif",
}

const LABEL_TIPO = {
  media_res_piezas:     { label: 'En piezas', icono: '🥩', color: 'var(--gold)' },
  media_res_kilo:       { label: 'Venta por kilo', icono: '⚖️', color: '#7a9dff' },
  media_res_mayorista:  { label: 'Mayorista (entera)', icono: '📦', color: '#ffd17a' },
  media_res_minorista:  { label: 'Minorista (entera)', icono: '🏪', color: '#7dff7d' },
}

// ────────────────────────────────────────────────────────────
// Controles de kg antes de aprobar
// ────────────────────────────────────────────────────────────
// Estaban escondidos detrás de window.confirm dentro de una función que quedó
// sin uso, así que hacía rato no protegían de nada. Ahora se ven en el panel
// de aprobación: el bloqueo no deja seguir y los avisos piden un click extra.
// Rango real de una media res en Fabricius: 70-140 kg.
function controlarKg(f) {
  const piezas = Array.isArray(f.payload?.piezas) ? f.payload.piezas : []
  const kgPiezas = piezas.reduce((s, p) => s + (Number(p.kg) || 0), 0)
  const kgMR = Number(f.kg_media_res) || 0
  const avisos = []
  // Bloqueo: ninguna pieza puede pesar más que la media res entera. Es un
  // typo seguro (39.4 tipeado como 394), no algo para "aprobar igual".
  const inflada = kgMR > 0 ? piezas.find(p => (Number(p.kg) || 0) > kgMR) : null
  const bloqueo = inflada
    ? `La pieza "${inflada.nombre}" pesa ${fmtKg(inflada.kg)} y la media res entera ${fmtKg(kgMR)}. Rechazá el flujo y pedile al operario que revise.`
    : null
  if (kgMR > 150) avisos.push(`La media res declara ${fmtKg(kgMR)} — el rango real es 70-140 kg.`)
  if (kgMR > 0 && kgMR < 50) avisos.push(`La media res declara sólo ${fmtKg(kgMR)} — el rango real es 70-140 kg.`)
  if (kgMR > 0 && kgPiezas > kgMR * 1.1) {
    avisos.push(`La suma de las piezas (${fmtKg(kgPiezas)}) supera a la media res (${fmtKg(kgMR)}) por más del 10% — probablemente hay un kg con un dígito de más.`)
  }
  return { bloqueo, avisos }
}

export default function FlujoDeposito() {
  const { user, profile } = useAuth()
  const [flujos, setFlujos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('pendiente')
  const [msg, setMsg] = useState(null)
  // Aprobar/rechazar se confirman DENTRO de la tarjeta: en el iPhone y en la
  // PWA el confirm()/prompt() del navegador se suprime sin error y la acción
  // se perdía en silencio (misma regla que el arqueo, PR #220).
  const [accion, setAccion] = useState(null)   // { id, tipo: 'aprobar' | 'rechazar' }
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  function pedirAccion(f, tipo, motivoPrevio = '') { setMotivo(motivoPrevio); setAccion({ id: f.id, tipo }) }
  function cerrarAccion() { if (!guardando) { setAccion(null); setMotivo('') } }

  useEffect(() => {
    cargar()
    // Realtime: cuando un empleado envía algo, refrescar
    const canal = supabase.channel('flujo-deposito-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flujo_deposito' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('flujo_deposito').select('*').order('created_at', { ascending: false })
    setFlujos(data || [])
    setLoading(false)
  }

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  // Actualiza el flujo en el estado local AL INSTANTE — sin esperar el realtime
  // (que puede no llegar) ni recargar la lista entera. Así la tarjeta cambia
  // de estado apenas se aprueba/rechaza y sale sola del filtro "Pendiente".
  function marcarLocal(id, cambios) {
    setFlujos(fs => fs.map(x => x.id === id ? { ...x, ...cambios } : x))
    // Y el badge del menú recuenta al toque, sin esperar el realtime.
    avisarCambioFlujo()
  }

  const filtrados = useMemo(() => {
    if (filtroEstado === 'todos') return flujos
    return flujos.filter(f => f.estado === filtroEstado)
  }, [flujos, filtroEstado])

  const pag = usePaginacion(filtrados, 20)
  const pendientes = flujos.filter(f => f.estado === 'pendiente').length

  // El motivo lo escribe en el campo de la tarjeta (`motivo`), no en un prompt.
  async function rechazar(f) {
    if (guardando) return
    setGuardando(true)
    const cambios = {
      estado: 'rechazado',
      notas_admin: motivo.trim() || 'Rechazado sin motivo',
      aprobado_por: user?.id,
      aprobado_por_nombre: profile?.nombre || null,
      aprobado_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('flujo_deposito').update(cambios).eq('id', f.id)
    if (error) { setGuardando(false); aviso('❌ ' + error.message, 'error'); return }
    marcarLocal(f.id, cambios)
    // Liberar la media res reservada: vuelve a estar disponible para el desposte
    if (f.entrada_id) {
      await supabase.from('entradas_deposito').update({ reservada: false }).eq('id', f.entrada_id)
    }
    setGuardando(false)
    setAccion(null)
    setMotivo('')
    aviso('Rechazado — la media res vuelve a estar disponible')
  }

  // Aprobar = confirmar recepción de la info. NO toca el stock ni crea un
  // desposte. El despacho/desposte de esta media res se carga MANUALMENTE
  // desde Depósito (ahí recién se descuenta el stock y se marca despostada).
  // La media queda como "Aprobada" (reservada) en el sector desposte hasta
  // que el admin cargue el despacho a mano.
  // Lo confirma el panel de la tarjeta, no un confirm() del navegador.
  async function aprobar(f) {
    if (guardando) return
    setGuardando(true)
    const cambios = {
      estado: 'aprobado',
      notas_admin: 'Recepción confirmada. El despacho/desposte se carga manualmente desde Depósito.',
      aprobado_por: user?.id,
      aprobado_por_nombre: profile?.nombre || null,
      aprobado_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('flujo_deposito').update(cambios).eq('id', f.id)
    setGuardando(false)
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    marcarLocal(f.id, cambios)
    setAccion(null)
    aviso('✅ Recepción confirmada')
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando flujo...</p>

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: 70, right: 20, zIndex: 1000,
          padding: '14px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700,
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📥 Flujo Depósito</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Cargas que envió el sector desposte para que las apruebes y proceses
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['pendiente', 'aprobado', 'rechazado', 'todos'].map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${filtroEstado === e ? 'var(--gold)' : 'var(--border)'}`,
                background: filtroEstado === e ? 'var(--gold)' : 'transparent',
                color: filtroEstado === e ? '#000' : 'var(--muted)',
                cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>
              {e === 'pendiente' && pendientes > 0 && '🔔 '}
              {e.charAt(0).toUpperCase() + e.slice(1)}
              {e === 'pendiente' && pendientes > 0 && ` (${pendientes})`}
            </button>
          ))}
        </div>
      </div>

      {pendientes > 0 && filtroEstado === 'pendiente' && (
        <div style={{ padding: 12, background: '#3a2a14', border: '1px solid #ffd17a', borderRadius: 8, color: '#ffd17a', marginBottom: 12, fontSize: 13 }}>
          🔔 Tenés <strong>{pendientes}</strong> carga(s) pendiente(s) de aprobar. Aprobar crea automáticamente el desposte en el sistema.
        </div>
      )}

      {filtrados.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
          Sin flujos {filtroEstado !== 'todos' ? filtroEstado + 's' : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pag.items.map(f => {
              const info = LABEL_TIPO[f.tipo] || { label: f.tipo, icono: '📋', color: 'var(--muted)' }
              const ctrl = controlarKg(f)
              return (
                <div key={f.id} className="card" style={{ padding: 14, borderColor: f.estado === 'pendiente' ? '#ffd17a' : 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 250 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 20 }}>{info.icono}</span>
                        <strong style={{ fontSize: 16, color: info.color }}>{info.label}</strong>
                        {f.modelo && <span style={{ background: 'var(--gold)22', color: 'var(--gold)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Modelo {f.modelo}</span>}
                        <BadgeEstado estado={f.estado} />
                      </div>
                      <div style={{ fontSize: 13 }}>
                        <strong style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue', cursive", fontSize: 22 }}>{fmtKg(f.kg_media_res, { decimales: 2 })}</strong>
                        <span style={{ color: 'var(--muted)', marginLeft: 12 }}>
                          {f.fecha} {f.hora?.slice(0, 5)} · por {f.empleado_nombre || '—'}
                        </span>
                      </div>
                      {f.payload?.modelo_nombre && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          📋 {f.payload.modelo_nombre}
                        </div>
                      )}
                      {Array.isArray(f.payload?.piezas) && f.payload.piezas.length > 0 && (
                        <div style={{ marginTop: 6, padding: 8, background: 'var(--surface2)', borderRadius: 6 }}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>PIEZAS CARGADAS</div>
                          {f.payload.piezas.map((p, i) => (
                            <div key={i} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                              <span>{p.nombre}</span>
                              <strong style={{ color: 'var(--gold)' }}>{fmtKg(p.kg, { decimales: 2 })}</strong>
                            </div>
                          ))}
                          <div style={{ fontSize: 11, color: '#7dff7d', marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                            <strong>Total piezas:</strong>
                            <strong>{fmtKg(f.payload.kg_piezas_total || f.payload.piezas.reduce((s, p) => s + (Number(p.kg) || 0), 0), { decimales: 2 })}</strong>
                          </div>
                        </div>
                      )}
                      {f.payload?.proveedor && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          Proveedor entrada: {f.payload.proveedor}
                        </div>
                      )}
                      {f.notas && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>📝 {f.notas}</div>
                      )}
                      {f.notas_admin && (
                        <div style={{ fontSize: 11, color: '#7a9dff', marginTop: 4 }}>👨‍💼 Admin: {f.notas_admin}</div>
                      )}
                      {f.estado !== 'pendiente' && (f.aprobado_por_nombre || f.aprobado_at) && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: f.estado === 'aprobado' ? '#7dff7d' : '#ff8b8b', marginTop: 4 }}>
                          {f.estado === 'aprobado' ? '✅ Confirmado' : '❌ Rechazado'} por {f.aprobado_por_nombre || '—'}
                          {f.aprobado_at ? ` · ${fmtFechaHora(f.aprobado_at)}` : ''}
                        </div>
                      )}
                    </div>
                    {f.estado === 'pendiente' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220, maxWidth: 260 }}>
                        {/* La confirmación pasa acá adentro: el confirm() del
                            navegador no existe en el iPhone ni en la PWA. */}
                        {accion?.id === f.id && accion.tipo === 'aprobar' ? (
                          <div style={cajaConfirmar}>
                            {/* Controles de kg: el bloqueo no deja aprobar; los
                                avisos piden confirmar a sabiendas. */}
                            {ctrl.bloqueo ? (
                              <div style={{ fontSize: 12, color: '#ff8b8b', lineHeight: 1.45 }}>
                                <b>🚫 No se puede aprobar.</b><br />{ctrl.bloqueo}
                              </div>
                            ) : (
                              <>
                                {ctrl.avisos.map((a, n) => (
                                  <div key={n} style={{ fontSize: 11.5, color: '#ffd17a', lineHeight: 1.45, marginBottom: 8 }}>
                                    ⚠️ {a}
                                  </div>
                                ))}
                                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>
                                  ¿Confirmar la recepción? Queda <b style={{ color: '#7dff7d' }}>APROBADO</b>.
                                  El stock NO se toca acá — el despacho/desposte lo cargás a mano desde Depósito.
                                </div>
                              </>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                              {ctrl.bloqueo ? (
                                <button onClick={() => pedirAccion(f, 'rechazar', ctrl.bloqueo)} disabled={guardando}
                                  style={{ ...btnSi, background: '#8b2a2a', color: '#fff' }}>
                                  ❌ Rechazar
                                </button>
                              ) : (
                                <button onClick={() => aprobar(f)} disabled={guardando}
                                  style={ctrl.avisos.length ? { ...btnSi, background: '#ffd17a' } : btnSi}>
                                  {guardando ? 'Guardando…' : (ctrl.avisos.length ? '⚠️ Aprobar igual' : '✅ Sí, confirmar')}
                                </button>
                              )}
                              <button onClick={cerrarAccion} disabled={guardando} style={btnNo}>Cancelar</button>
                            </div>
                          </div>
                        ) : accion?.id === f.id && accion.tipo === 'rechazar' ? (
                          <div style={cajaConfirmar}>
                            <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700, marginBottom: 6 }}>
                              Motivo del rechazo <span style={{ fontWeight: 500, color: 'var(--muted)' }}>(opcional)</span>
                            </div>
                            <input value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') rechazar(f); if (e.key === 'Escape') cerrarAccion() }}
                              placeholder="Ej: los kg no cierran"
                              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 12.5,
                                borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--surface)',
                                color: 'var(--text)', fontFamily: "'DM Sans',sans-serif" }} />
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
                              La media res vuelve a estar disponible para el desposte.
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                              <button onClick={() => rechazar(f)} disabled={guardando}
                                style={{ ...btnSi, background: '#8b2a2a', color: '#fff' }}>
                                {guardando ? 'Guardando…' : '❌ Rechazar'}
                              </button>
                              <button onClick={cerrarAccion} disabled={guardando} style={btnNo}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button onClick={() => pedirAccion(f, 'aprobar')}
                              style={{ padding: '10px 14px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                              ✅ Aprobar (confirmar recepción)
                            </button>
                            <button onClick={() => pedirAccion(f, 'rechazar')}
                              style={{ padding: '8px 14px', background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                              ❌ Rechazar
                            </button>
                            <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>
                              El despacho/desposte se carga a mano desde Depósito
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <Paginador {...pag.controles} label="flujos" />
        </>
      )}

    </div>
  )
}

function BadgeEstado({ estado }) {
  const cfg = {
    pendiente:  { bg: '#3a2a14', color: '#ffd17a', label: '⏳ Pendiente' },
    aprobado:   { bg: '#1a2a1a', color: '#7dff7d', label: '✅ Aprobado' },
    rechazado:  { bg: '#3a1a1a', color: '#ff8b8b', label: '❌ Rechazado' },
  }[estado] || { bg: 'var(--surface2)', color: 'var(--muted)', label: estado }
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
      {cfg.label}
    </span>
  )
}
