// =============================================
// CLIENTES & CUENTA CORRIENTE
// =============================================
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function Clientes() {
  const [clientes, setClientes] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', tipo: 'carniceria', telefono: '', localidad: '', cuit: '', lista_precios: 'carn', notas: '' })

  useEffect(() => { fetchClientes() }, [])

  async function fetchClientes() {
    const { data } = await supabase.from('clientes').select('*').order('nombre')
    setClientes(data || [])
  }

  async function seleccionar(cliente) {
    setSeleccionado(cliente)
    const { data } = await supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false })
    setMovimientos(data || [])
  }

  async function guardarCliente() {
    if (!form.nombre) return
    await supabase.from('clientes').insert({ ...form, saldo: 0 })
    setForm({ nombre: '', tipo: 'carniceria', telefono: '', localidad: '', cuit: '', lista_precios: 'carn', notas: '' })
    setShowForm(false)
    fetchClientes()
  }

  const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
  const totalDeuda = clientes.filter(c => c.saldo > 0).reduce((s, c) => s + c.saldo, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div className="page-title">CLIENTES & CTA. CTE.</div>
          <div className="page-sub">Carnicerías, gastronómicos, sucursales</div>
        </div>
        <button className="btn btn-gold" onClick={() => setShowForm(!showForm)}>+ Nuevo cliente</button>
      </div>

      {showForm && (
        <div className="card" style={{ borderColor: 'var(--teal)', marginBottom: 20 }}>
          <div className="card-title">Nuevo cliente</div>
          <div className="form-row">
            <div className="form-group"><label>Nombre</label><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></div>
            <div className="form-group"><label>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                <option value="carniceria">🥩 Carnicería</option>
                <option value="mayorista">📦 Gastronómico / Mayorista</option>
                <option value="sucursal">🏪 Sucursal</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Teléfono</label><input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} /></div>
            <div className="form-group"><label>Localidad</label><input value={form.localidad} onChange={e => setForm(f => ({ ...f, localidad: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>CUIT</label><input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} /></div>
            <div className="form-group"><label>Lista de precios</label>
              <select value={form.lista_precios} onChange={e => setForm(f => ({ ...f, lista_precios: e.target.value }))}>
                <option value="carn">🔴 Precio Carnicería</option>
                <option value="may">🟡 Precio Mayorista</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarCliente}>Guardar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
        <div className="stat"><div className="stat-label">Total adeudado</div><div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalDeuda)}</div></div>
        <div className="stat"><div className="stat-label">Clientes registrados</div><div className="stat-value" style={{ color: 'var(--gold)' }}>{clientes.length}</div></div>
      </div>

      <div className="grid2">
        <div>
          <div className="card">
            <div className="card-title">Clientes</div>
            {clientes.map(c => (
              <div key={c.id} onClick={() => seleccionar(c)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.localidad} · {c.tipo}</div>
                </div>
                <span style={{ color: c.saldo > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700 }}>
                  {c.saldo > 0 ? fmt(c.saldo) + ' debe' : c.saldo < 0 ? fmt(c.saldo) + ' a favor' : 'Al día'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {seleccionado && (
          <div className="card" style={{ borderColor: 'var(--teal)' }}>
            <div className="card-title">
              {seleccionado.nombre}
              <button className="btn btn-ghost btn-sm" onClick={() => setSeleccionado(null)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SALDO</div>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: seleccionado.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(seleccionado.saldo)}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>COMPRAS</div>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--amber)' }}>{fmt(movimientos.filter(m => m.debe > 0).reduce((s, m) => s + m.debe, 0))}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>PAGADO</div>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--green)' }}>{fmt(movimientos.filter(m => m.haber > 0).reduce((s, m) => s + m.haber, 0))}</div>
              </div>
            </div>
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
        )}
      </div>
    </div>
  )
}

export default Clientes
