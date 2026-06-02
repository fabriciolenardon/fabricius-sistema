// FranquiciaDashboard.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Paginador, { usePaginacion } from '../../components/Paginador'

import { fmtPrecio, fmtKg } from '../../lib/formatos'
function fmt(n) { return fmtPrecio(Math.abs(Number(n) || 0)) }

function useClienteFranquicia() {
  const { profile } = useAuth()
  const [cliente, setCliente] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    buscarCliente()
  }, [profile])

  async function buscarCliente() {
    setLoading(true)
    const nombreBuscar = profile?.sucursales?.nombre || profile?.nombre || ''
    const palabras = nombreBuscar.toUpperCase().split(/[\s-]+/)
    let clienteEncontrado = null
    for (const palabra of palabras) {
      if (palabra.length < 4) continue
      const { data } = await supabase.from('clientes').select('*').ilike('nombre', `%${palabra}%`).maybeSingle()
      if (data) { clienteEncontrado = data; break }
    }
    setCliente(clienteEncontrado)
    setLoading(false)
  }

  return { cliente, loading }
}

export function FranquiciaDashboard() {
  const { profile } = useAuth()
  const { cliente, loading } = useClienteFranquicia()
  const [movimientos, setMovimientos] = useState([])
  const [remitos, setRemitos] = useState([])
  const [notifNueva, setNotifNueva] = useState(null)

  useEffect(() => {
    if (!cliente) return
    cargarDatos()
    const canal = supabase.channel('remitos-franquicia')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'remitos', filter: `cliente_id=eq.${cliente.id}` }, (payload) => {
        setNotifNueva(payload.new)
        setTimeout(() => setNotifNueva(null), 8000)
        cargarDatos()
      }).subscribe()
    return () => supabase.removeChannel(canal)
  }, [cliente])

  async function cargarDatos() {
    if (!cliente) return
    const [{ data: movs }, { data: rems }] = await Promise.all([
      supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false }).limit(5),
      supabase.from('remitos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(3)
    ])
    setMovimientos(movs || [])
    setRemitos(rems || [])
  }

  const saldo = cliente?.saldo || 0
  const totCompras = movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0)
  const totPagado = movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0)

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)', textAlign: 'center' }}>Cargando...</div>

  return (
    <div>
      {notifNueva && (
        <div style={{ background: '#1a3a1a', border: '2px solid var(--green)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>🧾 Nuevo remito recibido!</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
              Remito N° {String(notifNueva.numero || '').padStart(5, '0')} — Total: <strong style={{ color: 'var(--gold)' }}>{fmt(notifNueva.total)}</strong>
            </div>
          </div>
          <button onClick={() => setNotifNueva(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
      )}

      <div style={{ background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, color: 'var(--gold)', letterSpacing: 2 }}>🏪 {profile?.nombre || 'Franquicia'}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Franquicia Carnicerías Fabricius</div>
        <span style={{ display: 'inline-block', marginTop: 10, background: 'var(--gold)', color: '#000', borderRadius: 6, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>FRANQUICIADO</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        <div style={{ background: saldo > 0 ? '#3a1a1a' : '#1a3a27', border: `2px solid ${saldo > 0 ? 'var(--red-light)' : 'var(--green)'}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, letterSpacing: 2 }}>SALDO ACTUAL</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 40, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldo)}</div>
          <div style={{ fontSize: 12, marginTop: 4, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{saldo > 0 ? '⚠️ Saldo adeudado' : '✅ Al día'}</div>
        </div>
        <div className="stat"><div className="stat-label">Total compras</div><div className="stat-value" style={{ color: 'var(--amber)' }}>{fmt(totCompras)}</div></div>
        <div className="stat"><div className="stat-label">Total pagado</div><div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totPagado)}</div></div>
      </div>

      {remitos.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
          <div className="card-title">🧾 Últimos remitos recibidos</div>
          {remitos.map(r => (
            <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>N° {String(r.numero).padStart(5, '0')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.fecha}</div>
                </div>
                <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(r.total)}</span>
              </div>
              {(r.items || []).map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', padding: '2px 8px' }}>
                  <span>• {item.descripcion} — {fmtKg(item.kg)}</span>
                  <span style={{ color: 'var(--text2)' }}>{fmt(item.importe)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">📒 Últimos movimientos</div>
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
  )
}

export function FranquiciaCtaCte() {
  const { cliente } = useClienteFranquicia()
  const [movimientos, setMovimientos] = useState([])

  useEffect(() => {
    if (!cliente) return
    supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false }).then(({ data }) => setMovimientos(data || []))
    const canal = supabase.channel('ctacte-franquicia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_ctacte', filter: `cliente_id=eq.${cliente.id}` }, () => {
        supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false }).then(({ data }) => setMovimientos(data || []))
      }).subscribe()
    return () => supabase.removeChannel(canal)
  }, [cliente])

  const saldo = cliente?.saldo || 0
  // Paginación del historial de cta cte de la franquicia
  const pagMov = usePaginacion(movimientos, 20)

  return (
    <div>
      <div className="page-title">MI CUENTA CORRIENTE</div>
      <div className="page-sub">Historial completo de compras y pagos</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
        <div style={{ background: saldo > 0 ? '#3a1a1a' : '#1a3a27', border: `2px solid ${saldo > 0 ? 'var(--red-light)' : 'var(--green)'}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>SALDO ACTUAL</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 48, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldo)}</div>
          <div style={{ fontSize: 12, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{saldo > 0 ? '⚠️ Saldo adeudado a Fabricius' : '✅ Al día'}</div>
        </div>
        <div className="stat"><div className="stat-label">Total compras</div><div className="stat-value" style={{ color: 'var(--amber)' }}>{fmt(movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0))}</div></div>
        <div className="stat"><div className="stat-label">Total pagado</div><div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0))}</div></div>
      </div>
      <div className="card">
        <div className="card-title">Historial completo ({movimientos.length})</div>
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
          <tbody>
            {pagMov.items.map(m => (
              <tr key={m.id}>
                <td>{m.fecha}</td>
                <td><span className={`badge ${m.tipo === 'compra' ? 'badge-red' : 'badge-green'}`}>{m.tipo}</span></td>
                <td>{m.descripcion}</td>
                <td style={{ color: 'var(--red-light)' }}>{m.debe > 0 ? fmt(m.debe) : '—'}</td>
                <td style={{ color: 'var(--green)' }}>{m.haber > 0 ? fmt(m.haber) : '—'}</td>
                <td style={{ fontWeight: 600, color: m.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(m.saldo)}</td>
              </tr>
            ))}
            {movimientos.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos registrados</td></tr>}
          </tbody>
        </table>
        <Paginador {...pagMov.controles} label="movimientos" />
      </div>
    </div>
  )
}

export function FranquiciaRemitos() {
  const { cliente } = useClienteFranquicia()
  const [remitos, setRemitos] = useState([])
  const [remitoAbierto, setRemitoAbierto] = useState(null)

  useEffect(() => {
    if (!cliente) return
    supabase.from('remitos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).then(({ data }) => setRemitos(data || []))
    const canal = supabase.channel('remitos-lista')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'remitos', filter: `cliente_id=eq.${cliente.id}` }, () => {
        supabase.from('remitos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).then(({ data }) => setRemitos(data || []))
      }).subscribe()
    return () => supabase.removeChannel(canal)
  }, [cliente])

  function imprimir(remito) {
    const items = remito.items || []
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Remito N° ${remito.numero}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; }
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
            <div style="font-size:22px;font-weight:900;letter-spacing:2px">FABRICIUS</div>
            <div style="font-size:9px;color:#555">CARNICERÍAS · PREMIUM QUALITY</div>
            <div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div>
            <div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;font-weight:700;border:1px solid #000;padding:2px 6px;margin-bottom:4px;text-align:center">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div>
            <div style="font-size:24px;font-weight:900;font-style:italic">REMITO</div>
            <div style="font-size:13px;font-weight:700">N° ${String(remito.numero).padStart(5, '0')}</div>
          </div>
        </div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div style="border-bottom:1px solid #000;margin-bottom:8px;padding-bottom:2px"><label style="font-size:10px;font-weight:700;margin-right:6px">Señor/a:</label>${remito.cliente_nombre || ''}</div>
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
              <td>${fmtKg(item.kg)}</td>
              <td>${fmtPrecio(item.precio)}</td>
              <td>${fmtPrecio(item.importe)}</td>
            </tr>`).join('')}
            ${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}
          </tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <div class="total-box">TOTAL: ${fmtPrecio(remito.total)}</div>
        </div>
        <div class="firma">Firma y aclaración: ________________________________</div>
        <script>window.onload = () => { window.print(); }</script>
      </body></html>
    `)
    win.document.close()
  }

  // Paginación del historial completo de remitos
  const pagRems = usePaginacion(remitos, 20)

  return (
    <div>
      <div className="page-title">MIS REMITOS</div>
      <div className="page-sub">Despachos recibidos desde el depósito Fabricius</div>
      <div className="card">
        <div className="card-title">{remitos.length} remitos</div>
        <table>
          <thead><tr><th>N° Remito</th><th>Fecha</th><th>Total</th><th>Detalle</th><th>Imprimir</th></tr></thead>
          <tbody>
            {pagRems.items.map(r => (
              <>
                <tr key={r.id}>
                  <td><strong>N° {String(r.numero).padStart(5, '0')}</strong></td>
                  <td>{r.fecha}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtPrecio(r.total || 0)}</td>
                  <td>
                    <button onClick={() => setRemitoAbierto(remitoAbierto === r.id ? null : r.id)}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text)' }}>
                      {remitoAbierto === r.id ? '▲ Ocultar' : '▼ Ver detalle'}
                    </button>
                  </td>
                  <td>
                    <button onClick={() => imprimir(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>
                  </td>
                </tr>
                {remitoAbierto === r.id && (
                  <tr key={r.id + '-detalle'}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <div style={{ background: 'var(--surface2)', padding: '12px 16px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Producto</th>
                              <th style={{ textAlign: 'center', padding: '4px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Kg</th>
                              <th style={{ textAlign: 'center', padding: '4px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Precio/kg</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Importe</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(r.items || []).map((item, i) => (
                              <tr key={i}>
                                <td style={{ padding: '6px 8px', fontSize: 13, fontWeight: 500 }}>{item.descripcion}</td>
                                <td style={{ padding: '6px 8px', fontSize: 13, textAlign: 'center' }}>{fmtKg(item.kg)}</td>
                                <td style={{ padding: '6px 8px', fontSize: 13, textAlign: 'center', color: 'var(--muted)' }}>{fmtPrecio(item.precio)}</td>
                                <td style={{ padding: '6px 8px', fontSize: 13, textAlign: 'right', color: 'var(--gold)', fontWeight: 700 }}>{fmtPrecio(item.importe)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: '1px solid var(--border)' }}>
                              <td colSpan={3} style={{ padding: '8px', fontSize: 13, fontWeight: 700, textAlign: 'right' }}>TOTAL</td>
                              <td style={{ padding: '8px', fontSize: 20, fontWeight: 700, textAlign: 'right', color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmtPrecio(r.total)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {remitos.length === 0 && <tr><td colSpan={5} className="empty">Sin remitos registrados aún</td></tr>}
          </tbody>
        </table>
        <Paginador {...pagRems.controles} label="remitos" />
      </div>
    </div>
  )
}

export default FranquiciaDashboard