// FranquiciaDashboard.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

function fmt(n) { return '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR') }

export function FranquiciaDashboard() {
  const { profile } = useAuth()
  const [cliente, setCliente] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const sucursalNombre = profile?.sucursales?.nombre || ''

  useEffect(() => {
    if (!sucursalNombre) return
    supabase.from('clientes').select('*').ilike('nombre', `%${sucursalNombre}%`).single().then(({ data }) => {
      setCliente(data)
      if (data) supabase.from('movimientos_ctacte').select('*').eq('cliente_id', data.id).order('fecha', { ascending: false }).limit(5).then(({ data: movs }) => setMovimientos(movs || []))
    })
  }, [sucursalNombre])

  const saldo = cliente?.saldo || 0
  const totCompras = movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0)
  const totPagado = movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0)

  return (
    <div>
      <div style={{ background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, color: 'var(--gold)', letterSpacing: 2 }}>{profile?.sucursales?.nombre || profile?.nombre}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{profile?.sucursales?.direccion}</div>
        <span className="badge badge-gold" style={{ marginTop: 10, display: 'inline-block' }}>Franquicia Fabricius</span>
      </div>

      <div className="grid3" style={{ marginBottom: 24 }}>
        <div style={{ background: saldo > 0 ? '#3a1a1a' : '#1a3a27', border: `1px solid ${saldo > 0 ? 'var(--red)' : 'var(--green)'}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, letterSpacing: 2, textTransform: 'uppercase' }}>Saldo actual</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 40, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldo)}</div>
          <div style={{ fontSize: 12, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)', marginTop: 4 }}>{saldo > 0 ? '⚠️ Saldo adeudado' : '✅ Al día'}</div>
        </div>
        <div className="stat"><div className="stat-label">Total compras</div><div className="stat-value" style={{ color: 'var(--amber)' }}>{fmt(totCompras)}</div></div>
        <div className="stat"><div className="stat-label">Total pagado</div><div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totPagado)}</div></div>
      </div>

      <div className="card">
        <div className="card-title">Últimos movimientos</div>
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
  const { profile } = useAuth()
  const [cliente, setCliente] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const sucursalNombre = profile?.sucursales?.nombre || ''

  useEffect(() => {
    if (!sucursalNombre) return
    supabase.from('clientes').select('*').ilike('nombre', `%${sucursalNombre}%`).single().then(({ data }) => {
      setCliente(data)
      if (data) supabase.from('movimientos_ctacte').select('*').eq('cliente_id', data.id).order('fecha', { ascending: false }).then(({ data: movs }) => setMovimientos(movs || []))
    })
  }, [sucursalNombre])

  const saldo = cliente?.saldo || 0
  return (
    <div>
      <div className="page-title">MI CUENTA CORRIENTE</div>
      <div className="page-sub">Historial completo de compras y pagos</div>
      <div className="grid2" style={{ marginBottom: 20 }}>
        <div style={{ background: saldo > 0 ? '#3a1a1a' : '#1a3a27', border: `1px solid ${saldo > 0 ? 'var(--red)' : 'var(--green)'}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>SALDO ACTUAL</div>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 48, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldo)}</div>
          <div style={{ fontSize: 12, color: saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{saldo > 0 ? '⚠️ Saldo adeudado a Fabricius' : '✅ Al día'}</div>
        </div>
        <div>
          <div className="stat" style={{ marginBottom: 12 }}>
            <div className="stat-label">Total compras</div>
            <div className="stat-value" style={{ color: 'var(--amber)' }}>{fmt(movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0))}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total pagado</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0))}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Historial completo</div>
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
            {movimientos.length === 0 && <tr><td colSpan={6} className="empty">Sin movimientos registrados</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FranquiciaRemitos() {
  const { profile } = useAuth()
  const [remitos, setRemitos] = useState([])
  const sucursalNombre = profile?.sucursales?.nombre || ''

  useEffect(() => {
    if (!sucursalNombre) return
    supabase.from('salidas_deposito').select('*').ilike('cliente_nombre', `%${sucursalNombre}%`).order('fecha', { ascending: false }).then(({ data }) => setRemitos(data || []))
  }, [sucursalNombre])

  return (
    <div>
      <div className="page-title">MIS REMITOS</div>
      <div className="page-sub">Despachos recibidos desde el depósito Fabricius</div>
      <div className="card">
        <table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Descripción</th><th>Kg</th><th>Precio/kg</th><th>Total</th></tr></thead>
          <tbody>
            {remitos.map(r => (
              <tr key={r.id}>
                <td>{r.fecha}</td>
                <td><span className="badge badge-gold">{r.tipo}</span></td>
                <td>{r.descripcion}</td>
                <td>{r.kg} kg</td>
                <td style={{ color: 'var(--amber)' }}>${Math.round(r.precio_kg || 0).toLocaleString('es-AR')}</td>
                <td style={{ color: 'var(--gold)', fontWeight: 700 }}>${Math.round(r.total || 0).toLocaleString('es-AR')}</td>
              </tr>
            ))}
            {remitos.length === 0 && <tr><td colSpan={6} className="empty">Sin remitos registrados aún</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FranquiciaPrecios() {
  const precios = [
    { nombre: 'Media Res Premium (Novillito/Vaquillona)', precio: 10300 },
    { nombre: 'Cuadril / Nalga / Peceto', precio: 17955 },
    { nombre: 'Vacío', precio: 16150 },
    { nombre: 'Costilla', precio: 16625 },
    { nombre: 'Matambre', precio: 17100 },
    { nombre: 'Tapa de Asado', precio: 16150 },
    { nombre: 'Tapa de Nalga', precio: 14630 },
    { nombre: 'Aguja Especial', precio: 13245 },
    { nombre: 'Hamburguesa Bovina', precio: 14535 },
    { nombre: 'Osobuco', precio: 8550 },
    { nombre: 'Bondiola Cerdo', precio: 7500 },
    { nombre: 'Chorizo Parrillero', precio: 7300 },
    { nombre: 'Morcilla', precio: 5500 },
    { nombre: 'Cajón Pollo INDA x 20kg', precio: 76000 },
  ]
  return (
    <div>
      <div className="page-title">LISTA DE PRECIOS</div>
      <div className="page-sub">Precios vigentes — Lista Carnicería Fabricius</div>
      <div className="card" style={{ borderColor: 'var(--gold)' }}>
        <div className="card-title">🔴 Precios Carnicería — vigentes</div>
        <table>
          <thead><tr><th>Producto</th><th>Precio/kg</th></tr></thead>
          <tbody>
            {precios.map((p, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                <td style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)' }}>${Math.round(p.precio).toLocaleString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 16, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
          Precios actualizados por la administración central de Carnicerias Fabricius. Ante cualquier consulta contactar a Fabricio o Ariel.
        </div>
      </div>
    </div>
  )
}

export default FranquiciaDashboard
