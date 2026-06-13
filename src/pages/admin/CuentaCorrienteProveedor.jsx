// ============================================================
// CUENTA CORRIENTE DE PROVEEDOR — extracto DEBE/HABER/SALDO
// ============================================================
// Se muestra dentro del perfil/legajo de un proveedor. Reemplaza el
// modelo de liquidación semanal por un libro mayor profesional, igual
// que la cuenta corriente de clientes.
//
//   🛒 Compra        → DEBE  (sube lo que le debemos)
//   💵 Pago/Entrega   → HABER (baja lo que le debemos)
//   saldo > 0 le debemos · < 0 a favor nuestro · = 0 al día
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { parseNumero, fmtPrecio } from '../../lib/formatos'
import { fechaHoyARG, esFechaFutura } from '../../lib/fechas'
import {
  cargarMovimientos, registrarCompraProv, registrarPagoProv,
  registrarAjusteProv, registrarSaldoInicialProv, eliminarMovimiento,
} from '../../lib/ctaProveedores'
import Paginador, { usePaginacion } from '../../components/Paginador'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

export default function CuentaCorrienteProveedor({ proveedor, saldoSugerido = 0, onSaldoChange }) {
  const [movs, setMovs] = useState([])
  const [loading, setLoading] = useState(true)
  const [accion, setAccion] = useState(null) // 'compra' | 'pago' | 'ajuste' | 'saldo_inicial' | null
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  // Forms
  const [fCompra, setFCompra] = useState({ fecha: fechaHoyARG(), importe: '', descripcion: '' })
  const [fPago, setFPago] = useState({ fecha: fechaHoyARG(), importe: '', forma: 'efectivo', notas: '' })
  const [fAjuste, setFAjuste] = useState({ fecha: fechaHoyARG(), sentido: 'debe', importe: '', descripcion: '' })
  const [fInicial, setFInicial] = useState({ fecha: fechaHoyARG(), importe: '' })

  useEffect(() => { cargar() }, [proveedor?.id])

  async function cargar() {
    if (!proveedor?.id) return
    setLoading(true)
    const data = await cargarMovimientos(proveedor.id)
    setMovs(data)
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 3500)
  }

  // El saldo corriente es el del último movimiento (ya viene calculado).
  const saldoActual = movs.length > 0 ? Number(movs[movs.length - 1].saldo) || 0 : 0
  const inicializada = movs.length > 0

  // Para la tabla: más nuevos primero (pero el saldo por fila ya está bien)
  const movsDesc = useMemo(() => [...movs].reverse(), [movs])
  const pag = usePaginacion(movsDesc, 20)

  async function despuesDeGuardar() {
    setGuardando(false)
    setAccion(null)
    await cargar()
    // Avisar al padre para refrescar la lista de proveedores con el saldo nuevo
    if (onSaldoChange) onSaldoChange()
  }

  async function guardarCompra() {
    const importe = parseNumero(fCompra.importe)
    if (importe <= 0) { showMsg('Ingresá un importe válido', 'error'); return }
    if (esFechaFutura(fCompra.fecha)) { showMsg(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    setGuardando(true)
    const { error } = await registrarCompraProv({
      proveedorId: proveedor.id, proveedorNombre: proveedor.nombre,
      fecha: fCompra.fecha, importe, descripcion: fCompra.descripcion || 'Compra',
    })
    if (error) { showMsg('❌ ' + error, 'error'); setGuardando(false); return }
    setFCompra({ fecha: fechaHoyARG(), importe: '', descripcion: '' })
    showMsg('✅ Compra registrada')
    await despuesDeGuardar()
  }

  async function guardarPago() {
    const importe = parseNumero(fPago.importe)
    if (importe <= 0) { showMsg('Ingresá un importe válido', 'error'); return }
    if (esFechaFutura(fPago.fecha)) { showMsg(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    const saldoDespues = saldoActual - importe
    if (!confirm(
      `¿Registrar pago de ${fmt(importe)} (${fPago.forma}) a ${proveedor.nombre}?\n\n` +
      `Saldo actual: ${fmt(saldoActual)}${saldoActual < 0 ? ' a favor' : ''}\n` +
      `Saldo después: ${fmt(saldoDespues)}${saldoDespues < 0 ? ' a favor' : saldoDespues > 0 ? ' (le debemos)' : ' (al día)'}`
    )) return
    setGuardando(true)
    const { error } = await registrarPagoProv({
      proveedorId: proveedor.id, proveedorNombre: proveedor.nombre,
      fecha: fPago.fecha, importe, forma: fPago.forma, notas: fPago.notas,
    })
    if (error) { showMsg('❌ ' + error, 'error'); setGuardando(false); return }
    setFPago({ fecha: fechaHoyARG(), importe: '', forma: 'efectivo', notas: '' })
    showMsg('✅ Pago registrado')
    await despuesDeGuardar()
  }

  async function guardarAjuste() {
    const importe = parseNumero(fAjuste.importe)
    if (importe <= 0) { showMsg('Ingresá un importe válido', 'error'); return }
    if (esFechaFutura(fAjuste.fecha)) { showMsg(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    setGuardando(true)
    const { error } = await registrarAjusteProv({
      proveedorId: proveedor.id, proveedorNombre: proveedor.nombre,
      fecha: fAjuste.fecha,
      debe: fAjuste.sentido === 'debe' ? importe : 0,
      haber: fAjuste.sentido === 'haber' ? importe : 0,
      descripcion: fAjuste.descripcion || 'Ajuste',
    })
    if (error) { showMsg('❌ ' + error, 'error'); setGuardando(false); return }
    setFAjuste({ fecha: fechaHoyARG(), sentido: 'debe', importe: '', descripcion: '' })
    showMsg('✅ Ajuste registrado')
    await despuesDeGuardar()
  }

  async function guardarSaldoInicial() {
    const importe = parseNumero(fInicial.importe)
    if (!confirm(
      `¿Inicializar la cuenta corriente de ${proveedor.nombre} con saldo ${fmt(importe)}` +
      `${importe > 0 ? ' (le debemos)' : importe < 0 ? ' a favor nuestro' : ''}?\n\n` +
      `Esto crea el punto de partida. Las compras y pagos nuevos corren sobre este saldo.`
    )) return
    setGuardando(true)
    const { error } = await registrarSaldoInicialProv({
      proveedorId: proveedor.id, proveedorNombre: proveedor.nombre,
      fecha: fInicial.fecha, saldoInicial: importe,
    })
    if (error) { showMsg('❌ ' + error, 'error'); setGuardando(false); return }
    showMsg('✅ Saldo inicial cargado')
    await despuesDeGuardar()
  }

  async function borrarMov(m) {
    if (!confirm(`¿Eliminar este movimiento del ${m.fecha} (${m.descripcion})?\n\nSe recalculará el saldo.`)) return
    const { error } = await eliminarMovimiento(m.id, proveedor.id)
    if (error) { showMsg('❌ ' + error, 'error'); return }
    showMsg('✅ Movimiento eliminado')
    await cargar()
    if (onSaldoChange) onSaldoChange()
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }
  const colorSaldo = saldoActual > 0 ? 'var(--red-light)' : saldoActual < 0 ? 'var(--green)' : 'var(--muted)'
  const labelSaldo = saldoActual > 0 ? '⚠️ Le debemos' : saldoActual < 0 ? '💚 Saldo a favor' : '✅ Al día'

  const TIPO_LABEL = {
    compra: '🛒 Compra', pago: '💵 Pago', ajuste: '🔧 Ajuste', saldo_inicial: '🏁 Saldo inicial',
  }

  return (
    <div className="card">
      {msg && (
        <div style={{ background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div className="card-title" style={{ margin: 0 }}>📒 Cuenta corriente</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>SALDO ACTUAL</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: colorSaldo, lineHeight: 1 }}>
            {fmt(saldoActual)}{saldoActual < 0 ? ' a favor' : ''}
          </div>
          <div style={{ fontSize: 11, color: colorSaldo }}>{labelSaldo}</div>
        </div>
      </div>

      {/* Cuenta sin inicializar → ofrecer saldo inicial */}
      {!loading && !inicializada && (
        <div style={{ background: 'rgba(255,209,122,0.06)', border: '1px solid var(--amber)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>🏁 Cuenta corriente sin inicializar</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Cargá el saldo inicial con el que arranca este proveedor. Sugerido según tu liquidación semanal anterior:
            <strong style={{ color: 'var(--text)' }}> {fmt(saldoSugerido)}{saldoSugerido < 0 ? ' a favor' : ''}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Saldo inicial ($) — negativo si está a favor nuestro</label>
              <input type="text" inputMode="decimal" value={fInicial.importe}
                onChange={e => setFInicial(f => ({ ...f, importe: e.target.value }))}
                placeholder={`Ej: ${Math.round(saldoSugerido)}`} style={inp} />
            </div>
            <button onClick={() => setFInicial(f => ({ ...f, importe: String(Math.round(saldoSugerido)) }))}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
              Usar sugerido
            </button>
            <button onClick={guardarSaldoInicial} disabled={guardando} className="btn btn-gold">
              {guardando ? 'Guardando...' : '🏁 Inicializar cuenta'}
            </button>
          </div>
        </div>
      )}

      {/* Botones de acción (solo si ya está inicializada) */}
      {inicializada && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setAccion(accion === 'compra' ? null : 'compra')}
            style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${accion === 'compra' ? 'var(--amber)' : 'var(--border)'}`, background: accion === 'compra' ? 'var(--amber)' : 'transparent', color: accion === 'compra' ? '#fff' : 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🛒 Registrar compra</button>
          <button onClick={() => setAccion(accion === 'pago' ? null : 'pago')}
            style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${accion === 'pago' ? 'var(--green)' : 'var(--border)'}`, background: accion === 'pago' ? 'var(--green)' : 'transparent', color: accion === 'pago' ? '#000' : 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>💵 Registrar pago / entrega</button>
          <button onClick={() => setAccion(accion === 'ajuste' ? null : 'ajuste')}
            style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${accion === 'ajuste' ? 'var(--gold)' : 'var(--border)'}`, background: accion === 'ajuste' ? 'var(--gold)' : 'transparent', color: accion === 'ajuste' ? '#000' : 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>🔧 Ajuste</button>
        </div>
      )}

      {/* Form: COMPRA */}
      {accion === 'compra' && (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={fCompra.fecha} max={fechaHoyARG()} onChange={e => setFCompra(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe ($)</label><input type="text" inputMode="decimal" autoFocus value={fCompra.importe} onChange={e => setFCompra(f => ({ ...f, importe: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--amber)' }} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Descripción</label><input value={fCompra.descripcion} onChange={e => setFCompra(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: Media res x4" style={inp} /></div>
          </div>
          {fCompra.importe && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Sube lo que le debemos en <strong style={{ color: 'var(--amber)' }}>{fmt(parseNumero(fCompra.importe))}</strong></div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setAccion(null)}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarCompra} disabled={guardando}>✅ Registrar compra</button>
          </div>
        </div>
      )}

      {/* Form: PAGO */}
      {accion === 'pago' && (() => {
        const imp = parseNumero(fPago.importe)
        const saldoDespues = saldoActual - imp
        return (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={fPago.fecha} max={fechaHoyARG()} onChange={e => setFPago(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe ($)</label><input type="text" inputMode="decimal" autoFocus value={fPago.importe} onChange={e => setFPago(f => ({ ...f, importe: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--green)' }} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Forma</label>
                <select value={fPago.forma} onChange={e => setFPago(f => ({ ...f, forma: e.target.value }))} style={inp}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="echeq">E-cheq</option>
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Notas</label><input value={fPago.notas} onChange={e => setFPago(f => ({ ...f, notas: e.target.value }))} placeholder="Cheque nro..." style={inp} /></div>
            </div>
            {fPago.importe && (
              <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>VAS A PAGAR</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--green)' }}>{fmt(imp)}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>SALDO DESPUÉS</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: saldoDespues > 0 ? 'var(--red-light)' : saldoDespues < 0 ? 'var(--green)' : 'var(--muted)' }}>{fmt(saldoDespues)}{saldoDespues < 0 ? ' a favor' : saldoDespues > 0 ? ' debe' : ' ✅'}</div></div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setAccion(null)}>Cancelar</button>
              <button className="btn btn-gold" onClick={guardarPago} disabled={guardando || imp <= 0}>✅ Registrar pago{imp > 0 ? ` de ${fmt(imp)}` : ''}</button>
            </div>
          </div>
        )
      })()}

      {/* Form: AJUSTE */}
      {accion === 'ajuste' && (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr', gap: 8, marginBottom: 10 }}>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={fAjuste.fecha} max={fechaHoyARG()} onChange={e => setFAjuste(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Sentido</label>
              <select value={fAjuste.sentido} onChange={e => setFAjuste(f => ({ ...f, sentido: e.target.value }))} style={inp}>
                <option value="debe">Sube deuda (DEBE)</option>
                <option value="haber">Baja deuda (HABER)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe ($)</label><input type="text" inputMode="decimal" value={fAjuste.importe} onChange={e => setFAjuste(f => ({ ...f, importe: e.target.value }))} placeholder="0" style={inp} /></div>
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Motivo</label><input value={fAjuste.descripcion} onChange={e => setFAjuste(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: corrección, nota de crédito..." style={inp} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setAccion(null)}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarAjuste} disabled={guardando}>✅ Registrar ajuste</button>
          </div>
        </div>
      )}

      {/* Extracto */}
      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Cargando movimientos...</p>
      ) : movs.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin movimientos. Inicializá la cuenta corriente arriba.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, minWidth: 640 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Concepto</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--amber)' }}>Debe</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--green)' }}>Haber</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Saldo</th>
                  <th style={{ textAlign: 'center', padding: '6px 4px' }}></th>
                </tr>
              </thead>
              <tbody>
                {pag.items.map(m => {
                  const cs = Number(m.saldo) > 0 ? 'var(--red-light)' : Number(m.saldo) < 0 ? 'var(--green)' : 'var(--muted)'
                  // Anulados: visibles pero marcados y tachados (no suman al saldo)
                  const tachado = m.anulado ? 'line-through' : 'none'
                  return (
                    <tr key={m.id} style={{ borderTop: '1px solid var(--border)', background: m.anulado ? 'rgba(255,50,50,0.07)' : 'transparent', opacity: m.anulado ? 0.65 : 1 }}>
                      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{m.fecha}</td>
                      <td style={{ padding: '6px 4px' }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 6 }}>{TIPO_LABEL[m.tipo] || m.tipo}</span>
                        <span style={{ textDecoration: tachado }}>{m.descripcion}</span>
                        {m.anulado && (
                          <span style={{ marginLeft: 6, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                            ❌ ANULADO{m.anulado_por ? ' por ' + m.anulado_por : ''}
                          </span>
                        )}
                        {m.registrado_por && (
                          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>✍️ Registrado por {m.registrado_por}</div>
                        )}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', textDecoration: tachado, color: Number(m.debe) > 0 ? 'var(--amber)' : 'var(--muted)', fontWeight: Number(m.debe) > 0 ? 700 : 400 }}>{Number(m.debe) > 0 ? fmt(m.debe) : '—'}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', textDecoration: tachado, color: Number(m.haber) > 0 ? 'var(--green)' : 'var(--muted)', fontWeight: Number(m.haber) > 0 ? 700 : 400 }}>{Number(m.haber) > 0 ? fmt(m.haber) : '—'}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: cs, fontWeight: 700 }}>{fmt(m.saldo)}{Number(m.saldo) < 0 ? ' a favor' : ''}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                        {!m.anulado && (
                          <button onClick={() => borrarMov(m)} title="Eliminar movimiento"
                            style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontSize: 11, color: 'var(--red-light)' }}>🗑️</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginador {...pag.controles} label="movimientos" />
        </>
      )}
    </div>
  )
}
