// Deposito.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export function Deposito() {
  const [tab, setTab] = useState('stock')
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [alert, setAlert] = useState(null)

  const tabs = [
    { id: 'stock', label: '📊 Stock' },
    { id: 'entradas', label: '📥 Entradas' },
    { id: 'salidas', label: '📤 Despachos' },
    { id: 'proveedores', label: '🏭 Proveedores' },
  ]

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const { data: e } = await supabase.from('entradas_deposito').select('*').order('fecha', { ascending: false }).limit(50)
    const { data: s } = await supabase.from('salidas_deposito').select('*').order('fecha', { ascending: false }).limit(50)
    setEntradas(e || [])
    setSalidas(s || [])
  }

  const stockBovino = entradas.filter(e => e.tipo === 'bovino_mr').reduce((s, e) => s + e.kg_real, 0)
    - salidas.filter(s => s.tipo === 'bovino_mr').reduce((s, e) => s + e.kg, 0)
  const stockPollo = entradas.filter(e => e.tipo === 'pollo').reduce((s, e) => s + e.kg, 0)
    - salidas.filter(s => s.tipo === 'pollo').reduce((s, e) => s + e.kg, 0)
  const stockCerdo = entradas.filter(e => e.tipo === 'cerdo').reduce((s, e) => s + e.kg, 0)
    - salidas.filter(s => s.tipo === 'cerdo').reduce((s, e) => s + e.kg, 0)

  return (
    <div>
      <div className="page-title">DEPÓSITO</div>
      <div className="page-sub">Stock, entradas, despachos y proveedores</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? 'var(--amber)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <div>
          <div className="grid4" style={{ marginBottom: 24 }}>
            {[
              { label: 'Bovino disponible', val: Math.max(0, stockBovino).toFixed(1) + ' kg', sub: Math.round(Math.max(0, stockBovino) / 105) + ' medias aprox', color: 'var(--gold)' },
              { label: 'Pollo disponible', val: Math.max(0, stockPollo).toFixed(1) + ' kg', sub: Math.round(Math.max(0, stockPollo) / 20) + ' cajones aprox', color: 'var(--blue)' },
              { label: 'Cerdo disponible', val: Math.max(0, stockCerdo).toFixed(1) + ' kg', sub: Math.round(Math.max(0, stockCerdo) / 107) + ' capones aprox', color: 'var(--amber)' },
              { label: 'Entradas semana', val: entradas.filter(e => { const d = new Date(e.fecha); const hoy = new Date(); return d >= new Date(hoy.setDate(hoy.getDate() - 7)) }).length, sub: 'últimos 7 días', color: 'var(--green)' },
            ].map(s => (
              <div key={s.label} className="stat">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color }}>{s.val}</div>
                <div className="stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">Últimas entradas registradas</div>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Proveedor</th><th>Descripción</th><th>Kg</th><th>Destino</th><th>Importe</th></tr></thead>
              <tbody>
                {entradas.slice(0, 10).map(e => (
                  <tr key={e.id}>
                    <td>{e.fecha}</td>
                    <td><span className="badge badge-gold">{e.tipo}</span></td>
                    <td>{e.proveedor_nombre}</td>
                    <td>{e.descripcion}</td>
                    <td>{e.kg} kg</td>
                    <td>{e.destino || '—'}</td>
                    <td style={{ color: 'var(--amber)' }}>${Math.round(e.importe || 0).toLocaleString('es-AR')}</td>
                  </tr>
                ))}
                {entradas.length === 0 && <tr><td colSpan={7} className="empty">Sin entradas registradas</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'entradas' && <EntradaForm onSaved={fetchData} showAlert={setAlert} />}
      {tab === 'salidas' && <SalidaForm onSaved={fetchData} showAlert={setAlert} />}
      {tab === 'proveedores' && <ProveedoresTab />}
    </div>
  )
}

function EntradaForm({ onSaved, showAlert }) {
  const [form, setForm] = useState({ tipo: '', proveedor: '', descripcion: '', fecha: new Date().toISOString().split('T')[0], kg: '', precioKg: '9800', merma: '', destino: 'DEPOSITO', importe: '' })

  async function guardar() {
    if (!form.tipo || !form.proveedor || !form.kg) { showAlert({ type: 'error', msg: 'Completá los campos requeridos' }); return }
    const kgReal = parseFloat(form.kg) * (1 - (parseFloat(form.merma) || 0) / 100)
    const importe = form.tipo === 'bovino_mr' ? parseFloat(form.kg) * parseFloat(form.precioKg) : parseFloat(form.importe) || 0
    const { error } = await supabase.from('entradas_deposito').insert({
      fecha: form.fecha, tipo: form.tipo, proveedor_nombre: form.proveedor,
      descripcion: form.descripcion || form.tipo, kg: parseFloat(form.kg), kg_real: kgReal,
      merma_pct: parseFloat(form.merma) || 0, precio_kg: parseFloat(form.precioKg) || 0,
      importe, destino: form.destino, cantidad: 1
    })
    if (error) { showAlert({ type: 'error', msg: error.message }); return }
    showAlert({ type: 'success', msg: '✅ Entrada registrada' })
    setForm(f => ({ ...f, descripcion: '', kg: '', importe: '' }))
    onSaved()
    setTimeout(() => showAlert(null), 3000)
  }

  return (
    <div className="card">
      <div className="card-title">Registrar entrada al depósito</div>
      <div className="form-row">
        <div className="form-group"><label>Tipo de producto</label>
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
            <option value="">— Seleccioná —</option>
            <option value="bovino_mr">🥩 Bovino — Media Res</option>
            <option value="bovino_corte">🥩 Bovino — Corte/Caja</option>
            <option value="bovino_brosa">🫀 Bovino — Brosa</option>
            <option value="cerdo">🐷 Cerdo — Capón</option>
            <option value="pollo">🍗 Pollo — Cajón</option>
            <option value="embutido">🌭 Embutido/Rebozado</option>
          </select>
        </div>
        <div className="form-group"><label>Fecha</label>
          <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Proveedor</label>
          <select value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}>
            <option value="">— Seleccioná —</option>
            {['PRETTO', 'LEO', 'BERTOSSI', 'INDACOR', 'BELMACO', 'CUBALA', 'LA AVENIDA', 'MOTTURA', 'BELBRUN', 'MELO CARBON', 'SHELL'].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Descripción</label>
          <input placeholder="Ej: Novillito Premium, Pollo entero..." value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Kg (remito)</label>
          <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
        </div>
        {form.tipo === 'bovino_mr' && <>
          <div className="form-group"><label>Precio/kg ($)</label>
            <input type="number" value={form.precioKg} onChange={e => setForm(f => ({ ...f, precioKg: e.target.value }))} />
          </div>
        </>}
      </div>
      {form.tipo === 'bovino_mr' && (
        <div className="form-row">
          <div className="form-group"><label>Merma % (opcional)</label>
            <input type="number" step="0.5" placeholder="2.5" value={form.merma} onChange={e => setForm(f => ({ ...f, merma: e.target.value }))} />
          </div>
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}>
              <option value="MITRE">Local Mitre</option>
              <option value="CENTRO">Centro</option>
              <option value="MONTE CRISTO">Monte Cristo</option>
              <option value="CLIENTE">Cliente externo</option>
              <option value="DEPOSITO">Queda en depósito</option>
            </select>
          </div>
        </div>
      )}
      <button className="btn btn-gold" onClick={guardar}>✅ Registrar entrada</button>
    </div>
  )
}

function SalidaForm({ onSaved, showAlert }) {
  const [form, setForm] = useState({ destino: 'MITRE', clienteNombre: '', fecha: new Date().toISOString().split('T')[0], categoria: '', productoIdx: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })

  const listaPrecios = {
    bovino_mr: [
      { nombre: 'Media Res Premium (Novillito/Vaquillona)', carn: 10300, may: 10300 },
      { nombre: 'Media Res Overo Chico', carn: 9800, may: 9800 },
    ],
    bovino_corte: [
      { nombre: 'Cuadril / Nalga / Peceto', carn: 17955, may: 18720, min: 20800 },
      { nombre: 'Vacío', carn: 16150, may: 17500, min: 19500 },
      { nombre: 'Matambre', carn: 17100, may: 18900, min: 21000 },
      { nombre: 'Costilla', carn: 16625, may: 17820, min: 19800 },
    ],
  }

  function getListaDestino(dest) { return dest === 'mayorista' ? 'may' : 'carn' }

  function onProductoChange(idx) {
    if (!form.categoria || idx === '') return
    const prod = listaPrecios[form.categoria]?.[parseInt(idx)]
    if (!prod) return
    const lista = getListaDestino(form.destino)
    setForm(f => ({ ...f, productoIdx: idx, precio: prod[lista] || '' }))
  }

  const total = (parseFloat(form.kg) || 0) * (parseFloat(form.precio) || 0)

  async function guardar() {
    if (!form.kg || !form.precio) { showAlert({ type: 'error', msg: 'Ingresá kg y precio' }); return }
    const cat = form.categoria
    const prod = listaPrecios[cat]?.[parseInt(form.productoIdx)]
    const { error } = await supabase.from('salidas_deposito').insert({
      fecha: form.fecha, cliente_nombre: form.clienteNombre || form.destino,
      tipo: cat, descripcion: prod?.nombre || form.categoria,
      kg: parseFloat(form.kg), precio_kg: parseFloat(form.precio),
      total, lista: getListaDestino(form.destino), cobro: form.cobro, notas: form.notas
    })
    if (error) { showAlert({ type: 'error', msg: error.message }); return }
    showAlert({ type: 'success', msg: '✅ Despacho registrado' })
    setForm(f => ({ ...f, kg: '', notas: '' }))
    onSaved()
    setTimeout(() => showAlert(null), 3000)
  }

  return (
    <div className="card">
      <div className="card-title">Registrar despacho</div>
      <div className="form-row">
        <div className="form-group"><label>Destino</label>
          <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}>
            <option value="MITRE">Local Mitre</option>
            <option value="CENTRO">Centro (asociado)</option>
            <option value="MONTE CRISTO">Monte Cristo (asociado)</option>
            <option value="carniceria">Carnicería cliente</option>
            <option value="mayorista">Gastronómico / Mayorista</option>
          </select>
        </div>
        <div className="form-group"><label>Fecha</label>
          <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
        </div>
      </div>
      {['carniceria', 'mayorista'].includes(form.destino) && (
        <div className="form-group"><label>Nombre del cliente</label>
          <input placeholder="Nombre" value={form.clienteNombre} onChange={e => setForm(f => ({ ...f, clienteNombre: e.target.value }))} />
        </div>
      )}
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Lista asignada</span>
        <span className={`badge ${form.destino === 'mayorista' ? 'badge-blue' : 'badge-gold'}`}>
          {form.destino === 'mayorista' ? 'Mayorista (−10%)' : 'Carnicería'}
        </span>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Categoría</label>
          <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, productoIdx: '', precio: '' }))}>
            <option value="">— Seleccioná —</option>
            <option value="bovino_mr">🥩 Bovino — Media Res</option>
            <option value="bovino_corte">🥩 Bovino — Cortes</option>
            <option value="cerdo_corte">🐷 Cerdo — Cortes</option>
            <option value="pollo">🍗 Pollo — Cajones</option>
          </select>
        </div>
        <div className="form-group"><label>Producto</label>
          <select value={form.productoIdx} onChange={e => onProductoChange(e.target.value)} disabled={!form.categoria}>
            <option value="">— Seleccioná producto —</option>
            {(listaPrecios[form.categoria] || []).map((p, i) => <option key={i} value={i}>{p.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Kg</label>
          <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
        </div>
        <div className="form-group"><label>Precio/kg (auto)</label>
          <input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} style={{ borderColor: 'var(--gold)' }} />
        </div>
      </div>
      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Total despacho</span>
        <span style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)' }}>${Math.round(total).toLocaleString('es-AR')}</span>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Forma de cobro</label>
          <select value={form.cobro} onChange={e => setForm(f => ({ ...f, cobro: e.target.value }))}>
            <option value="cta_cte">Cuenta corriente</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="echeq">E-cheq</option>
          </select>
        </div>
        <div className="form-group"><label>Notas</label>
          <input placeholder="Observaciones" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
        </div>
      </div>
      <button className="btn btn-gold" onClick={guardar}>📤 Registrar despacho</button>
    </div>
  )
}

function ProveedoresTab() {
  const [pagos, setPagos] = useState([])
  const [form, setForm] = useState({ proveedor: '', importe: '', forma: 'transferencia', fecha: new Date().toISOString().split('T')[0], notas: '' })

  useEffect(() => {
    supabase.from('pagos_proveedores').select('*').order('fecha', { ascending: false }).limit(20).then(({ data }) => setPagos(data || []))
  }, [])

  async function guardar() {
    if (!form.proveedor || !form.importe) return
    await supabase.from('pagos_proveedores').insert({ ...form, importe: parseFloat(form.importe) })
    setForm(f => ({ ...f, importe: '', notas: '' }))
    supabase.from('pagos_proveedores').select('*').order('fecha', { ascending: false }).limit(20).then(({ data }) => setPagos(data || []))
  }

  return (
    <div className="grid2">
      <div className="card">
        <div className="card-title">Registrar pago a proveedor</div>
        <div className="form-group"><label>Proveedor</label>
          <select value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}>
            <option value="">— Seleccioná —</option>
            {['PRETTO', 'LEO', 'BERTOSSI', 'INDACOR', 'BELMACO', 'CUBALA', 'LA AVENIDA', 'MOTTURA', 'MELO CARBON'].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Importe ($)</label>
            <input type="number" value={form.importe} onChange={e => setForm(f => ({ ...f, importe: e.target.value }))} />
          </div>
          <div className="form-group"><label>Forma de pago</label>
            <select value={form.forma} onChange={e => setForm(f => ({ ...f, forma: e.target.value }))}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque (endoso)</option>
              <option value="echeq">E-cheq</option>
            </select>
          </div>
        </div>
        <div className="form-group"><label>Notas</label>
          <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Cheque nro., banco, etc." />
        </div>
        <button className="btn btn-gold" onClick={guardar}>✅ Registrar pago</button>
      </div>
      <div className="card">
        <div className="card-title">Últimos pagos</div>
        <table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Importe</th><th>Forma</th></tr></thead>
          <tbody>
            {pagos.map(p => (
              <tr key={p.id}>
                <td>{p.fecha}</td>
                <td><strong>{p.proveedor_nombre}</strong></td>
                <td style={{ color: 'var(--green)' }}>${Math.round(p.importe).toLocaleString('es-AR')}</td>
                <td><span className="badge badge-blue">{p.forma}</span></td>
              </tr>
            ))}
            {pagos.length === 0 && <tr><td colSpan={4} className="empty">Sin pagos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Deposito
