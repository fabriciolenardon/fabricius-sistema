// Deposito.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'

export function Deposito() {
  const [tab, setTab] = useState('stock')
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [alert, setAlert] = useState(null)
  const [remitoActual, setRemitoActual] = useState(null)

  const tabs = [
    { id: 'stock', label: '📊 Stock' },
    { id: 'entradas', label: '📥 Entradas' },
    { id: 'salidas', label: '📤 Despachos' },
    { id: 'remitos', label: '🧾 Remitos' },
    { id: 'proveedores', label: '🏭 Proveedores' },
  ]

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const { data: e } = await supabase.from('entradas_deposito').select('*').order('fecha', { ascending: false }).limit(50)
    const { data: s } = await supabase.from('salidas_deposito').select('*').order('fecha', { ascending: false }).limit(50)
    setEntradas(e || [])
    setSalidas(s || [])
  }

  const stockBovino = entradas.filter(e => e.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg_real || 0), 0)
    - salidas.filter(s => s.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg || 0), 0)
  const stockPollo = entradas.filter(e => e.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0)
    - salidas.filter(s => s.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0)
  const stockCerdo = entradas.filter(e => e.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0)
    - salidas.filter(s => s.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0)

  return (
    <div>
      <div className="page-title">DEPÓSITO</div>
      <div className="page-sub">Stock, entradas, despachos y proveedores</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

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
      {tab === 'salidas' && <SalidaForm onSaved={fetchData} showAlert={setAlert} onRemito={setRemitoActual} setTab={setTab} />}
      {tab === 'remitos' && <RemitosTab remitoActual={remitoActual} />}
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
        {form.tipo === 'bovino_mr' && (
          <div className="form-group"><label>Precio/kg ($)</label>
            <input type="number" value={form.precioKg} onChange={e => setForm(f => ({ ...f, precioKg: e.target.value }))} />
          </div>
        )}
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

function SalidaForm({ onSaved, showAlert, onRemito, setTab }) {
  const [form, setForm] = useState({ destino: 'MITRE', clienteNombre: '', domicilio: '', fecha: new Date().toISOString().split('T')[0], categoria: '', productoId: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })
  const [items, setItems] = useState([])
  const [todosPrecios, setTodosPrecios] = useState([])

  useEffect(() => {
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setTodosPrecios(data || []))
  }, [])

  const CATEGORIAS = {
    bovino_corte: '🥩 Bovinos — Cortes',
    bovino_brosa: '🫀 Brosas',
    bovino_pieza: '🍖 Piezas',
    cerdo_corte: '🐷 Cerdo',
    embutido: '🌭 Embutidos',
    pollo: '🍗 Pollo Cajones',
    rebozado: '🧊 Rebozados',
  }

  const categorias = [...new Set(todosPrecios.map(p => p.categoria))]
  const productosFiltrados = todosPrecios.filter(p => p.categoria === form.categoria)

  function getLista(dest) { return dest === 'mayorista' ? 'precio_mayorista' : 'precio_carniceria' }

  function onProductoChange(id) {
    if (!id) return
    const prod = todosPrecios.find(p => p.id === id)
    if (!prod) return
    const precio = prod[getLista(form.destino)] || prod.precio_mayorista || 0
    setForm(f => ({ ...f, productoId: id, precio }))
  }

  function agregarItem() {
    if (!form.kg || !form.precio || !form.productoId) { showAlert({ type: 'error', msg: 'Seleccioná producto y completá kg' }); return }
    const prod = todosPrecios.find(p => p.id === form.productoId)
    const item = {
      descripcion: prod?.nombre || '',
      kg: parseFloat(form.kg),
      precio: parseFloat(form.precio),
      importe: parseFloat(form.kg) * parseFloat(form.precio),
      tipo: form.categoria
    }
    setItems(prev => [...prev, item])
    setForm(f => ({ ...f, kg: '', productoId: '', precio: '' }))
  }

  function quitarItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  const total = items.reduce((s, i) => s + i.importe, 0)

  async function guardar() {
    if (items.length === 0) { showAlert({ type: 'error', msg: 'Agregá al menos un producto' }); return }
    for (const item of items) {
      await supabase.from('salidas_deposito').insert({
        fecha: form.fecha, cliente_nombre: form.clienteNombre || form.destino,
        tipo: item.tipo, descripcion: item.descripcion,
        kg: item.kg, precio_kg: item.precio,
        total: item.importe, lista: getLista(form.destino),
        cobro: form.cobro, notas: form.notas
      })
    }
    const { data: remitoData } = await supabase.from('remitos').insert({
      fecha: form.fecha, cliente_nombre: form.clienteNombre || form.destino,
      domicilio: form.domicilio, items, total, cobro: form.cobro, notas: form.notas
    }).select().single()

    showAlert({ type: 'success', msg: '✅ Despacho registrado — Remito generado' })
    onRemito(remitoData)
    setItems([])
    setForm(f => ({ ...f, kg: '', notas: '', clienteNombre: '', domicilio: '', productoId: '', precio: '' }))
    onSaved()
    setTimeout(() => { showAlert(null); setTab('remitos') }, 1500)
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
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
        <div className="form-row">
          <div className="form-group"><label>Señor/a</label>
            <input placeholder="Nombre del cliente" value={form.clienteNombre} onChange={e => setForm(f => ({ ...f, clienteNombre: e.target.value }))} />
          </div>
          <div className="form-group"><label>Domicilio</label>
            <input placeholder="Dirección" value={form.domicilio} onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Categoría</label>
            <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, productoId: '', precio: '' }))}>
              <option value="">— Seleccioná —</option>
              {categorias.map(c => <option key={c} value={c}>{CATEGORIAS[c] || c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Producto</label>
            <select value={form.productoId} onChange={e => onProductoChange(e.target.value)} disabled={!form.categoria}>
              <option value="">— Seleccioná producto —</option>
              {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Kg</label>
            <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
          </div>
          <div className="form-group"><label>Precio/kg</label>
            <input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} style={{ borderColor: 'var(--gold)' }} />
          </div>
        </div>
        <button className="btn btn-ghost" onClick={agregarItem} style={{ marginBottom: 16 }}>➕ Agregar producto al remito</button>

        {items.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Descripción</th><th>Kg</th><th>Precio/kg</th><th>Importe</th><th></th></tr></thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.descripcion}</td>
                    <td>{item.kg} kg</td>
                    <td>${Math.round(item.precio).toLocaleString('es-AR')}</td>
                    <td style={{ color: 'var(--gold)' }}>${Math.round(item.importe).toLocaleString('es-AR')}</td>
                    <td><button onClick={() => quitarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', marginTop: 8 }}>
              TOTAL: ${Math.round(total).toLocaleString('es-AR')}
            </div>
          </div>
        )}

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
        <button className="btn btn-gold" onClick={guardar}>📤 Registrar despacho y generar remito</button>
      </div>
    </div>
  )
}

function RemitosTab({ remitoActual }) {
  const [remitos, setRemitos] = useState([])
  const [seleccionado, setSeleccionado] = useState(remitoActual)

  useEffect(() => {
    supabase.from('remitos').select('*').order('created_at', { ascending: false }).limit(20).then(({ data }) => setRemitos(data || []))
  }, [])

  useEffect(() => {
    if (remitoActual) setSeleccionado(remitoActual)
  }, [remitoActual])

  function imprimir(remito) {
    const items = remito.items || []
    const win = window.open('', '_blank')
    win.document.write(`
      <html>
      <head>
        <title>Remito N° ${remito.numero}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; }
          .logo-title { font-size: 22px; font-weight: 900; letter-spacing: 2px; }
          .logo-sub { font-size: 9px; color: #555; }
          .doc-no-valido { font-size: 10px; font-weight: 700; text-align: center; border: 1px solid #000; padding: 2px 6px; margin-bottom: 4px; }
          .remito-title { font-size: 24px; font-weight: 900; font-style: italic; }
          .nro { font-size: 13px; font-weight: 700; }
          .direccion { font-size: 10px; color: #444; margin-bottom: 6px; }
          .telefono { font-size: 11px; font-weight: 700; background: #000; color: #fff; padding: 3px 8px; display: inline-block; border-radius: 4px; margin-bottom: 12px; }
          .campo { border-bottom: 1px solid #000; margin-bottom: 8px; padding-bottom: 2px; }
          .campo label { font-size: 10px; font-weight: 700; margin-right: 6px; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0; }
          th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; }
          td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; }
          td.desc { text-align: left; }
          .total-row { display: flex; justify-content: flex-end; margin-top: 8px; }
          .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; }
          .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; color: #555; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo-title">FABRICIUS</div>
            <div class="logo-sub">CARNICERÍAS · PREMIUM QUALITY</div>
            <div class="direccion">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div>
            <div class="telefono">📱 3574 400346</div>
          </div>
          <div style="text-align:right">
            <div class="doc-no-valido">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div>
            <div class="remito-title">REMITO</div>
            <div class="nro">N° ${String(remito.numero).padStart(5, '0')}</div>
          </div>
        </div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div class="campo"><label>Señor/a:</label>${remito.cliente_nombre || ''}</div>
        <div class="campo"><label>Domicilio:</label>${remito.domicilio || ''}</div>
        <table>
          <thead>
            <tr>
              <th style="width:40%">DESCRIPCIÓN</th>
              <th style="width:15%">KG</th>
              <th style="width:22%">PRECIO UNITARIO</th>
              <th style="width:23%">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td class="desc">${item.descripcion}</td>
                <td>${item.kg}</td>
                <td>$${Math.round(item.precio).toLocaleString('es-AR')}</td>
                <td>$${Math.round(item.importe).toLocaleString('es-AR')}</td>
              </tr>
            `).join('')}
            ${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}
          </tbody>
        </table>
        <div class="total-row">
          <div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div>
        </div>
        <div class="firma">Firma y aclaración: ________________________________</div>
        <script>window.onload = () => { window.print(); }</script>
      </body>
      </html>
    `)
    win.document.close()
  }

  return (
    <div>
      {seleccionado && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
          <div className="card-title">🧾 Remito N° {String(seleccionado.numero).padStart(5, '0')} — {seleccionado.cliente_nombre}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-gold" onClick={() => imprimir(seleccionado)}>🖨️ Imprimir remito</button>
            <button className="btn btn-ghost" onClick={() => setSeleccionado(null)}>✕ Cerrar</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-title">Historial de remitos</div>
        <table>
          <thead><tr><th>N° Remito</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Acción</th></tr></thead>
          <tbody>
            {remitos.map(r => (
              <tr key={r.id}>
                <td><strong>N° {String(r.numero).padStart(5, '0')}</strong></td>
                <td>{r.fecha}</td>
                <td>{r.cliente_nombre}</td>
                <td style={{ color: 'var(--gold)' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
                <td><button onClick={() => imprimir(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button></td>
              </tr>
            ))}
            {remitos.length === 0 && <tr><td colSpan={5} className="empty">Sin remitos</td></tr>}
          </tbody>
        </table>
      </div>
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
    await supabase.from('pagos_proveedores').insert({
      proveedor_nombre: form.proveedor, importe: parseFloat(form.importe),
      forma: form.forma, fecha: form.fecha, notas: form.notas
    })
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
