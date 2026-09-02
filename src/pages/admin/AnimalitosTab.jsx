// ============================================================
// ANIMALITOS — lechón, cabrito y cordero (mig 137)
// ============================================================
// Se compran y se venden ENTEROS, y cada animal pesa distinto: no alcanza un
// bucket de kilos. Acá cada animal es una fila con su código (LE-001) y su
// peso, así se puede mirar la cámara desde el sistema cuando el cliente
// pregunta "¿tenés uno de 10 kg?".
//
// El INGRESO no vive acá: los animalitos entran por la solapa 📥 Ingresos como
// toda la mercadería, eligiendo el animalito en el tipo de producto y cargando
// el peso de cada uno (igual que las Cajas Bovinas). Esta pantalla es el stock:
// qué hay en la cámara, la salida y el historial. Salida: se pesa de nuevo al
// venderlo — ese peso es el definitivo y es el que baja del stock.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { fmtPrecio, fmtKg, parseNumero } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'
import {
  ANIMALITOS, labelDe,
  venderAnimalito, revertirVentaAnimalito, anularIngresoAnimalitos,
} from '../../lib/animalitos'

const fFecha = f => {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(String(f))) return f || '—'
  const [y, m, d] = String(f).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export default function AnimalitosTab({ onIrAIngresos }) {
  const [animales, setAnimales] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState(null)

  // Venta / confirmaciones inline (nunca window.confirm: iOS lo suprime sin
  // avisar y la acción se pierde).
  const [vendiendo, setVendiendo] = useState(null)   // { animal, cliente, kgFinal, precioKg, notas }
  const [confirmando, setConfirmando] = useState(null) // { accion:'revertir'|'anular', id }

  useEffect(() => { cargar() }, [])

  function showAlert(a) { setAlert(a); setTimeout(() => setAlert(null), 4000) }

  async function cargar() {
    setLoading(true)
    const [{ data: anim }, { data: cli }] = await Promise.all([
      supabase.from('animalitos_stock').select('*')
        .order('fecha_ingreso', { ascending: false }).order('id', { ascending: false }),
      // Para poder cargar la venta a la cuenta corriente de un mayorista.
      supabase.from('clientes').select('id, nombre, tipo, saldo').order('nombre'),
    ])
    setAnimales(anim || [])
    setClientes(cli || [])
    setLoading(false)
  }

  const disponibles = useMemo(() => animales.filter(a => a.estado === 'disponible'), [animales])
  const vendidos = useMemo(() => animales.filter(a => a.estado === 'vendido'), [animales])

  // Resumen por animalito: cuántos hay y cuántos kilos.
  const resumen = useMemo(() => ANIMALITOS.map(a => {
    const mios = disponibles.filter(x => x.tipo === a.id)
    return {
      ...a,
      cantidad: mios.length,
      // Los numeric de Supabase llegan como STRING.
      kg: mios.reduce((s, x) => s + (Number(x.kg) || 0), 0),
    }
  }), [disponibles])

  // Los ingresos se agrupan por la entrada que los trajo, para poder anular la
  // compra completa igual que en el historial de Ingresos.
  const ingresos = useMemo(() => {
    const porEntrada = {}
    animales.forEach(a => {
      const k = a.entrada_id || `sin-${a.id}`
      ;(porEntrada[k] = porEntrada[k] || { entrada_id: a.entrada_id, filas: [] }).filas.push(a)
    })
    return Object.values(porEntrada).map(g => {
      const f = g.filas
      return {
        entrada_id: g.entrada_id,
        tipo: f[0].tipo,
        fecha: f[0].fecha_ingreso,
        proveedor: f[0].proveedor_origen,
        precioKg: Number(f[0].precio_costo_kg) || 0,
        cantidad: f.length,
        kg: f.reduce((s, x) => s + (Number(x.kg) || 0), 0),
        codigos: f.map(x => x.codigo).join(', '),
        anulado: f.every(x => x.estado === 'anulado'),
        conVentas: f.some(x => x.estado === 'vendido'),
      }
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  }, [animales])

  const pagVendidos = usePaginacion(vendidos, 10)
  const pagIngresos = usePaginacion(ingresos, 10)

  async function confirmarVenta() {
    const v = vendiendo
    if (!v) return
    const kgFinal = parseNumero(v.kgFinal)
    const r = await venderAnimalito(v.animal, {
      fecha: v.fecha, cliente: v.cliente, clienteId: v.clienteId || null,
      aCtaCte: v.aCtaCte, kgFinal,
      precioVentaKg: parseNumero(v.precioKg), notas: v.notas,
    })
    if (r.error) { showAlert({ type: 'error', msg: r.error }); return }
    if (r.avisoCtaCte) showAlert({ type: 'error', msg: `⚠️ ${r.avisoCtaCte}` })
    else showAlert({ type: 'success', msg: r.ctaCte
      ? `✅ ${v.animal.codigo} vendido — ${fmtKg(r.kg)} fuera del stock y ${fmtPrecio(r.ctaCte)} a la cuenta de ${v.cliente}`
      : `✅ ${v.animal.codigo} vendido — ${fmtKg(r.kg)} fuera del stock` })
    setVendiendo(null)
    cargar()
  }

  async function revertir(animal) {
    const r = await revertirVentaAnimalito(animal)
    setConfirmando(null)
    if (r.error) { showAlert({ type: 'error', msg: r.error }); return }
    showAlert({ type: 'success', msg: r.ctaCteRevertida
      ? `↩️ ${animal.codigo} volvió al stock y se dio de baja el cargo en la cuenta corriente`
      : `↩️ ${animal.codigo} volvió al stock` })
    cargar()
  }

  async function anular(entradaId) {
    const r = await anularIngresoAnimalitos(entradaId)
    setConfirmando(null)
    if (r.error) { showAlert({ type: 'error', msg: r.error }); return }
    showAlert({ type: 'success', msg: `🗑️ Ingreso anulado — ${r.cantidad} animales y ${fmtKg(r.kgTotal)} fuera del stock` })
    cargar()
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }
  const th = { textAlign: 'left', padding: '7px 8px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }
  const td = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' }

  if (loading) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>

  return (
    <div>
      {alert && <div className={`alert alert-${alert.type}`}>{alert.msg}</div>}

      {/* ── QUÉ HAY EN LA CÁMARA ─────────────────────────────── */}
      <div style={{ ...card, marginBottom: 16, borderColor: 'var(--gold)' }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>🐑 Stock en vivo</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {resumen.map(r => (
            <div key={r.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{r.emoji} {r.label}</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 26, color: r.cantidad ? 'var(--gold)' : 'var(--muted)' }}>
                {r.cantidad} {r.cantidad === 1 ? 'unidad' : 'unidades'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtKg(r.kg)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* El ingreso NO vive acá: los animalitos entran por la solapa
          📥 Ingresos como toda la mercadería que llega al depósito. */}
      <div style={{ ...card, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Para cargar lechones, cabritos o corderos andá a <strong style={{ color: 'var(--text)' }}>📥 Ingresos</strong> y
          elegí el animalito en el tipo de producto, como con el resto de la mercadería.
          Ahí ponés el proveedor, el precio por kilo y el peso de cada animal.
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onIrAIngresos && onIrAIngresos()}>📥 Ir a Ingresos</button>
      </div>

      {/* ── EN CÁMARA AHORA ──────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
          🧊 En cámara ahora ({disponibles.length})
        </div>
        {disponibles.length === 0 ? (
          <div className="empty">No hay animalitos en stock</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 620 }}>
              <thead><tr>
                <th style={th}>Código</th>
                <th style={th}>Animalito</th>
                <th style={{ ...th, textAlign: 'right' }}>Peso</th>
                <th style={th}>Proveedor</th>
                <th style={th}>Ingresó</th>
                <th style={{ ...th, textAlign: 'right' }}>Costo/kg</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {disponibles.map(a => (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 700, color: 'var(--gold)' }}>{a.codigo}</td>
                    <td style={td}>{labelDe(a.tipo)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtKg(a.kg)}</td>
                    <td style={td}>{a.proveedor_origen || '—'}</td>
                    <td style={td}>{fFecha(a.fecha_ingreso)}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{fmtPrecio(Number(a.precio_costo_kg) || 0)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setVendiendo({
                          animal: a, fecha: fechaHoyARG(), cliente: '', clienteId: '',
                          aCtaCte: false,
                          kgFinal: String(Number(a.kg) || ''), precioKg: '', notas: '',
                        })}>Vender</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── PANEL DE VENTA (inline, sin window.confirm) ──────── */}
      {vendiendo && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
          <div className="card-title">
            Vender {vendiendo.animal.codigo} — {labelDe(vendiendo.animal.tipo)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
            Entró con {fmtKg(vendiendo.animal.kg)}. Pesalo de nuevo antes de entregarlo:
            el peso de acá es el que sale del stock.
          </div>
          <div className="form-row">
            <div className="form-group"><label>Peso final (kg)</label>
              <input type="text" inputMode="decimal" value={vendiendo.kgFinal}
                onChange={e => setVendiendo(v => ({ ...v, kgFinal: e.target.value }))} />
            </div>
            <div className="form-group"><label>Precio de venta por kilo</label>
              <input type="text" inputMode="decimal" placeholder="Opcional"
                value={vendiendo.precioKg}
                onChange={e => setVendiendo(v => ({ ...v, precioKg: e.target.value }))} />
            </div>
            <div className="form-group"><label>Fecha</label>
              <input type="date" value={vendiendo.fecha} max={fechaHoyARG()}
                onChange={e => setVendiendo(v => ({ ...v, fecha: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>¿A quién?</label>
              {/* Si es un cliente de la lista se elige acá: es lo que habilita
                  cargarlo a su cuenta corriente. Para una venta de mostrador
                  alcanza con escribir el nombre al lado. */}
              <select value={vendiendo.clienteId}
                onChange={e => {
                  const c = clientes.find(x => x.id === e.target.value)
                  setVendiendo(v => ({
                    ...v, clienteId: e.target.value,
                    cliente: c?.nombre || v.cliente,
                    aCtaCte: e.target.value ? v.aCtaCte : false,
                  }))
                }}>
                <option value="">— Venta de mostrador —</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Nombre</label>
              <input placeholder="Opcional" value={vendiendo.cliente}
                onChange={e => setVendiendo(v => ({ ...v, cliente: e.target.value }))} />
            </div>
            <div className="form-group"><label>Nota</label>
              <input placeholder="Opcional" value={vendiendo.notas}
                onChange={e => setVendiendo(v => ({ ...v, notas: e.target.value }))} />
            </div>
          </div>

          {/* Cuenta corriente: sólo con un cliente de la lista elegido. Carga
              el DEBE en su ledger; el saldo lo recalcula el sistema. */}
          {vendiendo.clienteId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={vendiendo.aCtaCte} style={{ width: 'auto' }}
                onChange={e => setVendiendo(v => ({ ...v, aCtaCte: e.target.checked }))} />
              Cargar esta venta a la cuenta corriente de {clientes.find(c => c.id === vendiendo.clienteId)?.nombre}
            </label>
          )}
          {parseNumero(vendiendo.kgFinal) > 0 && parseNumero(vendiendo.precioKg) > 0 && (
            <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
              {fmtKg(parseNumero(vendiendo.kgFinal))} × {fmtPrecio(parseNumero(vendiendo.precioKg))} ={' '}
              <strong style={{ color: 'var(--gold)', fontSize: 14 }}>
                {fmtPrecio(parseNumero(vendiendo.kgFinal) * parseNumero(vendiendo.precioKg))}
              </strong>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            {vendiendo.aCtaCte
              ? `Esto saca el animal del stock y le carga la deuda a ${clientes.find(c => c.id === vendiendo.clienteId)?.nombre || 'el cliente'} en su cuenta corriente. Si después revertís la salida, el movimiento se borra y el saldo se recalcula solo.`
              : 'Esto saca el animal del stock y queda registrado acá. El cobro se carga aparte, por Caja, como cualquier otra venta de mostrador.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={confirmarVenta}
              disabled={!(parseNumero(vendiendo.kgFinal) > 0)}>Confirmar salida</button>
            <button className="btn btn-ghost" onClick={() => setVendiendo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── VENDIDOS ─────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>✅ Salidos ({vendidos.length})</div>
        {vendidos.length === 0 ? (
          <div className="empty">Todavía no salió ninguno</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 620 }}>
                <thead><tr>
                  <th style={th}>Código</th>
                  <th style={th}>Animalito</th>
                  <th style={{ ...th, textAlign: 'right' }}>Peso</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Salió</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={th}></th>
                </tr></thead>
                <tbody>
                  {pagVendidos.items.map(a => (
                    <tr key={a.id}>
                      <td style={{ ...td, fontWeight: 700 }}>{a.codigo}</td>
                      <td style={td}>{labelDe(a.tipo)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtKg(a.kg)}</td>
                      <td style={td}>{a.cliente_nombre || '—'}</td>
                      <td style={td}>{fFecha(a.fecha_salida)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {a.total_venta ? fmtPrecio(Number(a.total_venta)) : '—'}
                        {a.movimiento_ctacte_id && (
                          <div style={{ fontSize: 10, color: 'var(--gold)' }}>cta cte</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {confirmando?.accion === 'revertir' && confirmando.id === a.id ? (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button className="btn btn-danger btn-sm" onClick={() => revertir(a)}>Sí, devolver</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmando(null)}>No</button>
                          </span>
                        ) : (
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => setConfirmando({ accion: 'revertir', id: a.id })}>↩️ Devolver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador {...pagVendidos.controles} label="salidas" />
          </>
        )}
      </div>

      {/* ── HISTORIAL DE INGRESOS ────────────────────────────── */}
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>📥 Ingresos</div>
        {ingresos.length === 0 ? (
          <div className="empty">Sin ingresos todavía</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 680 }}>
                <thead><tr>
                  <th style={th}>Fecha</th>
                  <th style={th}>Animalito</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Kilos</th>
                  <th style={th}>Códigos</th>
                  <th style={th}>Proveedor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Importe</th>
                  <th style={th}></th>
                </tr></thead>
                <tbody>
                  {pagIngresos.items.map((g, i) => (
                    <tr key={g.entrada_id || i} style={{ opacity: g.anulado ? 0.45 : 1 }}>
                      <td style={td}>{fFecha(g.fecha)}</td>
                      <td style={td}>{labelDe(g.tipo)}{g.anulado && ' (anulado)'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{g.cantidad}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtKg(g.kg)}</td>
                      <td style={{ ...td, fontSize: 11, color: 'var(--muted)' }}>{g.codigos}</td>
                      <td style={td}>{g.proveedor || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtPrecio(g.kg * g.precioKg)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {/* Con alguno ya vendido no se puede anular la compra:
                            primero hay que devolver ese animal al stock. */}
                        {g.anulado || !g.entrada_id ? null
                          : g.conVentas ? (
                            <span style={{ fontSize: 10, color: 'var(--muted)' }}>con ventas</span>
                          ) : confirmando?.accion === 'anular' && confirmando.id === g.entrada_id ? (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              <button className="btn btn-danger btn-sm" onClick={() => anular(g.entrada_id)}>Sí, anular</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmando(null)}>No</button>
                            </span>
                          ) : (
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => setConfirmando({ accion: 'anular', id: g.entrada_id })}>🗑️</button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador {...pagIngresos.controles} label="ingresos" />
          </>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Anular un ingreso saca los animales del stock y da de baja la compra en la
          cuenta corriente del proveedor. No se puede si alguno ya se vendió.
        </div>
      </div>
    </div>
  )
}
