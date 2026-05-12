import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
function fmt(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

const FRANQUICIAS = [
  { nombre: 'ALVEAR', titular: 'Roxana', direccion: 'Carnicería Alvear' },
  { nombre: 'MONTE CRISTO', titular: 'Agustín', direccion: 'Monte Cristo' },
]

export default function Franquicias() {
  const [seleccionada, setSeleccionada] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [remitos, setRemitos] = useState([])
  const [showPago, setShowPago] = useState(false)
  const [pago, setPago] = useState({ importe: '', forma: 'efectivo', fecha: new Date().toISOString().split('T')[0], notas: '' })
  const [clientes, setClientes] = useState([])
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('clientes').select('*').order('nombre').then(({ data }) => setClientes(data || []))
  }, [])

  async function seleccionar(franquicia) {
    setSeleccionada(franquicia)
    setShowPago(false)
    setMsg(null)
    const { data: c } = await supabase.from('clientes').select('*').ilike('nombre', `%${franquicia.nombre}%`).single()
    setCliente(c || null)
    if (c) {
      const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('cliente_id', c.id).order('fecha', { ascending: false })
      setMovimientos(movs || [])
      const { data: rems } = await supabase.from('remitos').select('*').ilike('cliente_nombre', `%${franquicia.nombre}%`).order('created_at', { ascending: false })
      setRemitos(rems || [])
    } else {
      setMovimientos([])
      setRemitos([])
    }
  }

  async function registrarPago() {
    if (!pago.importe || !cliente) return
    const importe = parseFloat(pago.importe)
    const nuevoSaldo = (cliente.saldo || 0) - importe
    await supabase.from('movimientos_ctacte').insert({
      cliente_id: cliente.id, fecha: pago.fecha, tipo: 'pago',
      descripcion: `Pago — ${pago.forma}${pago.notas ? ' — ' + pago.notas : ''}`,
      debe: 0, haber: importe, saldo: nuevoSaldo
    })
    await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', cliente.id)
    setMsg({ type: 'success', msg: '✅ Pago registrado' })
    setPago({ importe: '', forma: 'efectivo', fecha: new Date().toISOString().split('T')[0], notas: '' })
    setShowPago(false)
    await seleccionar(seleccionada)
    setTimeout(() => setMsg(null), 3000)
  }

  function imprimirRemito(remito) {
    const items = remito.items || []
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Remito N° ${remito.numero}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; }
        .logo-title { font-size: 22px; font-weight: 900; letter-spacing: 2px; }
        .doc-no-valido { font-size: 10px; font-weight: 700; border: 1px solid #000; padding: 2px 6px; margin-bottom: 4px; text-align:center; }
        .remito-title { font-size: 24px; font-weight: 900; font-style: italic; }
        .campo { border-bottom: 1px solid #000; margin-bottom: 8px; padding-bottom: 2px; }
        .campo label { font-size: 10px; font-weight: 700; margin-right: 6px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; }
        td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; }
        td.desc { text-align: left; }
        .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; }
        .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; }
        @media print { body { padding: 10px; } }
      </style></head>
      <body>
        <div class="header">
          <div>
            <div class="logo-title">FABRICIUS</div>
            <div style="font-size:9px;color:#555">CARNICERÍAS · PREMIUM QUALITY</div>
            <div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div>
            <div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div>
          </div>
          <div style="text-align:right">
            <div class="doc-no-valido">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div>
            <div class="remito-title">REMITO</div>
            <div style="font-size:13px;font-weight:700">N° ${String(remito.numero).padStart(5, '0')}</div>
          </div>
        </div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div class="campo"><label>Señor/a:</label>${remito.cliente_nombre || ''}</div>
        <div class="campo"><label>Domicilio:</label>${remito.domicilio || ''}</div>
        <table>
          <thead><tr>
            <th style="width:40%">DESCRIPCIÓN</th>
            <th style="width:15%">KG</th>
            <th style="width:22%">PRECIO UNITARIO</th>
            <th style="width:23%">IMPORTE</th>
          </tr></thead>
          <tbody>
            ${items.map(item => `<tr>
              <td class="desc">${item.descripcion}</td>
              <td>${item.kg}</td>
              <td>$${Math.round(item.precio).toLocaleString('es-AR')}</td>
              <td>$${Math.round(item.importe).toLocaleString('es-AR')}</td>
            </tr>`).join('')}
            ${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}
          </tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div>
        </div>
        <div class="firma">Firma y aclaración: ________________________________</div>
        <script>window.onload = () => { window.print(); }</script>
      </body></html>
    `)
    win.document.close()
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div className="page-title">FRANQUICIAS</div>
      <div className="page-sub">Gestión de franquiciados — Alvear y Monte Cristo</div>

      {msg && (
        <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#7dff7d', fontWeight: 600 }}>
          {msg.msg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: seleccionada ? '280px 1fr' : '1fr', gap: 16 }}>

        {/* LISTA FRANQUICIAS */}
        <div>
          {FRANQUICIAS.map(f => (
            <div key={f.nombre} onClick={() => seleccionar(f)}
              style={{ background: seleccionada?.nombre === f.nombre ? 'var(--surface2)' : 'var(--surface)', border: `1px solid ${seleccionada?.nombre === f.nombre ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 12, padding: 20, marginBottom: 12, cursor: 'pointer', transition: 'all 0.2s' }}>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', marginBottom: 4 }}>🏪 {f.nombre}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{f.titular}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.direccion}</div>
              {clientes.find(c => c.nombre.toUpperCase().includes(f.nombre)) && (
                <div style={{ marginTop: 8 }}>
                  {(() => {
                    const c = clientes.find(cl => cl.nombre.toUpperCase().includes(f.nombre))
                    return <span style={{ color: c?.saldo > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700, fontSize: 13 }}>
                      {c?.saldo > 0 ? fmt(c.saldo) + ' debe' : '✅ Al día'}
                    </span>
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* DETALLE FRANQUICIA */}
        {seleccionada && (
          <div>
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="card-title">🏪 {seleccionada.nombre}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{seleccionada.titular} — {seleccionada.direccion}</div>
                </div>
                <button className="btn btn-ghost" onClick={() => setSeleccionada(null)}>✕</button>
              </div>

              {cliente ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '16px 0' }}>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SALDO</div>
                      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: cliente.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(cliente.saldo)}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{cliente.saldo > 0 ? 'DEBE' : 'AL DÍA'}</div>
                    </div>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>TOTAL COMPRAS</div>
                      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--amber)' }}>{fmt(movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0))}</div>
                    </div>
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>TOTAL PAGADO</div>
                      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--green)' }}>{fmt(movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0))}</div>
                    </div>
                  </div>

                  <button className="btn btn-gold" onClick={() => setShowPago(!showPago)}>💵 Registrar pago</button>

                  {showPago && (
                    <div style={{ marginTop: 16, padding: 16, background: 'var(--surface2)', borderRadius: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div className="form-group"><label>Importe ($)</label><input style={inp} type="number" value={pago.importe} onChange={e => setPago(p => ({ ...p, importe: e.target.value }))} placeholder="0" /></div>
                        <div className="form-group"><label>Forma de pago</label>
                          <select style={inp} value={pago.forma} onChange={e => setPago(p => ({ ...p, forma: e.target.value }))}>
                            <option value="efectivo">Efectivo</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="cheque">Cheque</option>
                            <option value="echeq">E-cheq</option>
                          </select>
                        </div>
                        <div className="form-group"><label>Fecha</label><input style={inp} type="date" value={pago.fecha} onChange={e => setPago(p => ({ ...p, fecha: e.target.value }))} /></div>
                        <div className="form-group"><label>Notas</label><input style={inp} value={pago.notas} onChange={e => setPago(p => ({ ...p, notas: e.target.value }))} placeholder="Cheque nro., banco..." /></div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" onClick={() => setShowPago(false)}>Cancelar</button>
                        <button className="btn btn-gold" onClick={registrarPago}>✅ Confirmar pago</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--muted)', marginTop: 12 }}>⚠️ Esta franquicia no tiene cliente vinculado. Creá el cliente en la sección Clientes con el nombre "{seleccionada.nombre}".</div>
              )}
            </div>

            {/* REMITOS */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">🧾 Remitos</div>
              <table>
                <thead><tr><th>N° Remito</th><th>Fecha</th><th>Total</th><th>Imprimir</th></tr></thead>
                <tbody>
                  {remitos.map(r => (
                    <tr key={r.id}>
                      <td><strong>N° {String(r.numero).padStart(5, '0')}</strong></td>
                      <td>{r.fecha}</td>
                      <td style={{ color: 'var(--gold)' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
                      <td><button onClick={() => imprimirRemito(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button></td>
                    </tr>
                  ))}
                  {remitos.length === 0 && <tr><td colSpan={4} className="empty">Sin remitos</td></tr>}
                </tbody>
              </table>
            </div>

            {/* CUENTA CORRIENTE */}
            <div className="card">
              <div className="card-title">📒 Cuenta Corriente</div>
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
                <tbody>
                  {movimientos.map(m => (
                    <tr key={m.id}>
                      <td>{m.fecha}</td>
                      <td><span className={`badge ${m.tipo === 'compra' ? 'badge-red' : 'badge-green'}`}>{m.tipo}</span></td>
                      <td>{m.descripcion}</td>
                      <td style={{ color: 'var(--red-light)' }}>{m.debe > 0 ? fmt(m.debe) : '—'}</td>
                      <td style={{ color: 'var(--green)' }}>{m.haber > 0 ? fmt(m.haber) : '—'}</td>
                      <td style={{ fontWeight: 600, color: m.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(m.saldo)}</td>
                    </tr>
                  ))}
                  {movimientos.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}