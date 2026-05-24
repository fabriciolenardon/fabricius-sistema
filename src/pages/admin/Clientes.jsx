// =============================================
// CLIENTES & CUENTA CORRIENTE
// =============================================
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'

// URL publica de produccion del portal — NO usar window.location.origin para evitar URLs de preview de Vercel
const PORTAL_URL = 'https://fabricius-sistema.vercel.app/login'

export function Clientes() {
  const [clientes, setClientes] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [remitos, setRemitos] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showPago, setShowPago] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [pago, setPago] = useState({ importe: '', forma: 'efectivo', fecha: fechaHoyARG(), notas: '' })
  const [form, setForm] = useState({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '' })
  // Modal de gestion del portal: { tipo: 'habilitar'|'credenciales'|'revocar', cliente, email, credenciales, loading }
  const [modalPortal, setModalPortal] = useState(null)

  useEffect(() => { fetchClientes() }, [])

  async function fetchClientes() {
    const { data } = await supabase.from('clientes').select('*').order('nombre')
    setClientes(data || [])
  }
async function seleccionar(cliente) {
    setSeleccionado(cliente)
    setShowPago(false)
    setShowForm(false)
    const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('cliente_id', cliente.id).order('fecha', { ascending: false })
    setMovimientos(movs || [])
    const { data: rems } = await supabase.from('remitos').select('*').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(20)
    setRemitos(rems || [])
  }
 async function anularRemitoCliente(remito) {
  if (!confirm(`¿Anular Remito N° ${String(remito.numero).padStart(5,'0')} por $${Math.round(remito.total).toLocaleString('es-AR')}?`)) return
  const { data: { user } } = await supabase.auth.getUser()
  const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
  const eliminadoPor = perfil?.nombre || user.email
  await supabase.from('remitos').update({
    eliminado: true,
    eliminado_por: eliminadoPor,
    eliminado_en: new Date().toISOString()
  }).eq('id', remito.id)
  const nuevoSaldo = (seleccionado.saldo || 0) - remito.total
  await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', seleccionado.id)
  await supabase.from('movimientos_ctacte').delete().eq('remito_id', remito.id)
  setSeleccionado(prev => ({ ...prev, saldo: nuevoSaldo }))
  setClientes(prev => prev.map(c => c.id === seleccionado.id ? { ...c, saldo: nuevoSaldo } : c))
  const { data: rems } = await supabase.from('remitos').select('*').eq('cliente_id', seleccionado.id).order('created_at', { ascending: false }).limit(20)
  setRemitos(rems || [])
}
async function eliminarMovimiento(mov) {
  if (!confirm(`¿Eliminar este movimiento de ${fmt(mov.debe || mov.haber)}?`)) return
  await supabase.from('movimientos_ctacte').delete().eq('id', mov.id)
  
  let nuevoSaldo
  if (mov.tipo === 'compra') {
    // Era una venta — al eliminarla el cliente debe menos
    nuevoSaldo = (seleccionado.saldo || 0) - mov.debe
  } else {
    // Era un pago — al eliminarlo el cliente debe más
    nuevoSaldo = (seleccionado.saldo || 0) + mov.haber
  }
  
  await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', seleccionado.id)
  const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('cliente_id', seleccionado.id).order('fecha', { ascending: false })
  setMovimientos(movs || [])
  setSeleccionado(prev => ({ ...prev, saldo: nuevoSaldo }))
  setClientes(prev => prev.map(c => c.id === seleccionado.id ? { ...c, saldo: nuevoSaldo } : c))
}
  // ============================================================
  // PORTAL DE CLIENTES
  // ============================================================
  function abrirModalHabilitarPortal(cliente) {
    setModalPortal({ tipo: 'habilitar', cliente, email: cliente.email_portal || '', loading: false })
  }

  function abrirModalRevocarPortal(cliente) {
    setModalPortal({ tipo: 'revocar', cliente, loading: false })
  }

  function abrirModalCompartirAcceso(cliente) {
    setModalPortal({ tipo: 'compartir', cliente, password: '' })
  }

  async function habilitarPortal() {
    if (!modalPortal?.cliente) return
    const email = (modalPortal.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Email inválido')
      return
    }
    setModalPortal(m => ({ ...m, loading: true }))
    const { data, error } = await supabase.functions.invoke('crear-acceso-cliente', {
      body: { cliente_id: modalPortal.cliente.id, email }
    })
    if (error || !data?.ok) {
      const msg = data?.error || error?.message || 'Error desconocido al habilitar portal'
      alert('❌ ' + msg)
      setModalPortal(m => ({ ...m, loading: false }))
      return
    }
    // Mostrar credenciales y refrescar lista
    setModalPortal({ tipo: 'credenciales', cliente: modalPortal.cliente, credenciales: { email: data.email, password: data.password }, loading: false })
    await fetchClientes()
    if (seleccionado?.id === modalPortal.cliente.id) {
      setSeleccionado(prev => ({ ...prev, tiene_portal: true, email_portal: data.email }))
    }
  }

  async function revocarPortal() {
    if (!modalPortal?.cliente) return
    setModalPortal(m => ({ ...m, loading: true }))
    const { data, error } = await supabase.functions.invoke('revocar-acceso-cliente', {
      body: { cliente_id: modalPortal.cliente.id }
    })
    if (error || !data?.ok) {
      const msg = data?.error || error?.message || 'Error desconocido al revocar portal'
      alert('❌ ' + msg)
      setModalPortal(m => ({ ...m, loading: false }))
      return
    }
    await fetchClientes()
    if (seleccionado?.id === modalPortal.cliente.id) {
      setSeleccionado(prev => ({ ...prev, tiene_portal: false, email_portal: null }))
    }
    setModalPortal(null)
    alert('✅ Portal revocado')
  }

  function copiarTexto(texto) {
    navigator.clipboard.writeText(texto).then(() => {
      // feedback visual breve
    }).catch(() => alert('No se pudo copiar al portapapeles'))
  }

  function abrirFormNuevo() {
    setEditandoId(null)
    setForm({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '' })
    setShowForm(true)
    setSeleccionado(null)
  }

  function abrirFormEditar(cliente) {
    setEditandoId(cliente.id)
    setForm({
      nombre: cliente.nombre || '',
      nombre_fantasia: cliente.nombre_fantasia || '',
      tipo: cliente.tipo || 'carniceria',
      telefono: cliente.telefono || '',
      localidad: cliente.localidad || '',
      domicilio: cliente.domicilio || '',
      cuit: cliente.cuit || '',
      lista_precios: cliente.lista_precios || 'carn',
      notas: cliente.notas || ''
    })
    setShowForm(true)
  }

  async function guardarCliente() {
    if (!form.nombre) return
    if (editandoId) {
      await supabase.from('clientes').update({ ...form }).eq('id', editandoId)
      // Actualizar seleccionado si es el mismo
      if (seleccionado?.id === editandoId) {
        setSeleccionado(prev => ({ ...prev, ...form }))
      }
    } else {
      await supabase.from('clientes').insert({ ...form, saldo: 0 })
    }
    setForm({ nombre: '', nombre_fantasia: '', tipo: 'carniceria', telefono: '', localidad: '', domicilio: '', cuit: '', lista_precios: 'carn', notas: '' })
    setShowForm(false)
    setEditandoId(null)
    fetchClientes()
  }

  async function eliminarCliente(cliente) {
    if (!confirm(`¿Eliminar a ${cliente.nombre}? Esta acción no se puede deshacer.`)) return
    await supabase.from('clientes').delete().eq('id', cliente.id)
    if (seleccionado?.id === cliente.id) setSeleccionado(null)
    fetchClientes()
  }

  async function registrarPago() {
    if (!pago.importe || !seleccionado) return
    const importe = parseFloat(pago.importe)
    const nuevoSaldo = (seleccionado.saldo || 0) - importe
    await supabase.from('movimientos_ctacte').insert({
      cliente_id: seleccionado.id,
      fecha: pago.fecha,
      tipo: 'pago',
      descripcion: `Pago — ${pago.forma}${pago.notas ? ' — ' + pago.notas : ''}`,
      debe: 0,
      haber: importe,
      saldo: nuevoSaldo
    })
    await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', seleccionado.id)
    setPago({ importe: '', forma: 'efectivo', fecha: fechaHoyARG(), notas: '' })
    setShowPago(false)
    await fetchClientes()
    await seleccionar({ ...seleccionado, saldo: nuevoSaldo })
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
        .logo-sub { font-size: 9px; color: #555; }
        .doc-no-valido { font-size: 10px; font-weight: 700; border: 1px solid #000; padding: 2px 6px; margin-bottom: 4px; text-align:center; }
        .remito-title { font-size: 24px; font-weight: 900; font-style: italic; }
        .nro { font-size: 13px; font-weight: 700; }
        .campo { border-bottom: 1px solid #000; margin-bottom: 8px; padding-bottom: 2px; }
        .campo label { font-size: 10px; font-weight: 700; margin-right: 6px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; }
        td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; }
        td.desc { text-align: left; }
        .total-row { display: flex; justify-content: flex-end; margin-top: 8px; }
        .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; }
        .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; }
        @media print { body { padding: 10px; } }
      </style></head>
      <body>
        <div class="header">
          <div>
            <div class="logo-title">FABRICIUS</div>
            <div class="logo-sub">CARNICERÍAS · PREMIUM QUALITY</div>
            <div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div>
            <div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div>
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
        <div class="total-row"><div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div></div>
        <div class="firma">Firma y aclaración: ________________________________</div>
        <script>window.onload = () => { window.print(); }</script>
      </body></html>
    `)
    win.document.close()
  }

  const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
  const totalDeuda = clientes.filter(c => c.saldo > 0).reduce((s, c) => s + c.saldo, 0)
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div className="page-title">CLIENTES & CTA. CTE.</div>
          <div className="page-sub">Carnicerías, gastronómicos, sucursales</div>
        </div>
        <button className="btn btn-gold" onClick={abrirFormNuevo}>+ Nuevo cliente</button>
      </div>

      {showForm && (
        <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 20 }}>
          <div className="card-title">{editandoId ? '✏️ Editar cliente' : 'Nuevo cliente'}</div>
          <div className="form-row">
            <div className="form-group"><label>Nombre</label><input style={inp} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></div>
            <div className="form-group"><label>Nombre Fantasía</label><input style={inp} value={form.nombre_fantasia} onChange={e => setForm(f => ({ ...f, nombre_fantasia: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                <option value="carniceria">🥩 Carnicería</option>
                <option value="mayorista">📦 Gastronómico / Mayorista</option>
                <option value="sucursal">🏪 Sucursal</option>
              </select>
            </div>
            <div className="form-group"><label>CUIT</label><input style={inp} value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} placeholder="XX-XXXXXXXX-X" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Teléfono</label><input style={inp} value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} /></div>
            <div className="form-group"><label>Localidad</label><input style={inp} value={form.localidad} onChange={e => setForm(f => ({ ...f, localidad: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Domicilio</label><input style={inp} value={form.domicilio} onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))} /></div>
            <div className="form-group"><label>Lista de precios</label>
              <select style={inp} value={form.lista_precios} onChange={e => setForm(f => ({ ...f, lista_precios: e.target.value }))}>
                <option value="carn">🔴 Precio Carnicería</option>
                <option value="may">🟡 Precio Mayorista</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label>Notas</label><input style={inp} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditandoId(null) }}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarCliente}>{editandoId ? '💾 Guardar cambios' : 'Guardar cliente'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
        <div className="stat"><div className="stat-label">Total adeudado</div><div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalDeuda)}</div></div>
        <div className="stat"><div className="stat-label">Clientes registrados</div><div className="stat-value" style={{ color: 'var(--gold)' }}>{clientes.length}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: seleccionado ? '1fr 2fr' : '1fr', gap: 16 }}>
        <div className="card">
          <div className="card-title">Clientes</div>
          {clientes.map(c => (
            <div key={c.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid var(--border)', borderRadius: 6, background: seleccionado?.id === c.id ? 'var(--surface2)' : 'transparent' }}>
              <div onClick={() => seleccionar(c)} style={{ flex: 1, cursor: 'pointer' }}>
                <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.nombre_fantasia ? `"${c.nombre_fantasia}" · ` : ''}{c.localidad} · {c.tipo}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.tiene_portal && <span title="Portal habilitado" style={{ fontSize: 13, color: 'var(--green)' }}>📱</span>}
                <span style={{ color: c.saldo > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700, fontSize: 13 }}>
                  {c.saldo > 0 ? fmt(c.saldo) + ' debe' : c.saldo < 0 ? fmt(Math.abs(c.saldo)) + ' a favor' : '✅ Al día'}
                </span>
                <button onClick={() => abrirFormEditar(c)}
                  style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>✏️</button>
                <button onClick={() => eliminarCliente(c)}
                  style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
              </div>
            </div>
          ))}
          {clientes.length === 0 && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Sin clientes registrados</p>}
        </div>

        {seleccionado && (
          <div>
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="card-title" style={{ marginBottom: 4 }}>{seleccionado.nombre}</div>
                  {seleccionado.nombre_fantasia && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>"{seleccionado.nombre_fantasia}"</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => abrirFormEditar(seleccionado)}>✏️ Editar</button>
                  <button className="btn btn-ghost" onClick={() => setSeleccionado(null)}>✕</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'CUIT', val: seleccionado.cuit || '—' },
                  { label: 'Teléfono', val: seleccionado.telefono || '—' },
                  { label: 'Localidad', val: seleccionado.localidad || '—' },
                  { label: 'Domicilio', val: seleccionado.domicilio || '—' },
                  { label: 'Lista precios', val: seleccionado.lista_precios === 'may' ? '🟡 Mayorista' : '🔴 Carnicería' },
                  { label: 'Tipo', val: seleccionado.tipo },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.val}</div>
                  </div>
                ))}
              </div>

              {/* PORTAL DEL CLIENTE */}
              <div style={{ background: seleccionado.tiene_portal ? '#1a2a1a' : 'var(--surface2)', border: `1px solid ${seleccionado.tiene_portal ? '#2d5a2d' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: seleccionado.tiene_portal ? 'var(--green)' : 'var(--muted)', marginBottom: 4 }}>
                    {seleccionado.tiene_portal ? '📱 Portal HABILITADO' : '📱 Portal de cliente'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {seleccionado.tiene_portal
                      ? `Ingresa con: ${seleccionado.email_portal}`
                      : 'Permite que este cliente vea su cuenta y remitos online.'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {seleccionado.tiene_portal ? (
                    <>
                      <button onClick={() => abrirModalCompartirAcceso(seleccionado)} style={{ background: '#0f4220', border: '1px solid var(--green)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>💬 Compartir acceso</button>
                      <button onClick={() => abrirModalRevocarPortal(seleccionado)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>❌ Revocar acceso</button>
                    </>
                  ) : (
                    <button onClick={() => abrirModalHabilitarPortal(seleccionado)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>📱 Habilitar portal</button>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SALDO</div>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: seleccionado.saldo > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(seleccionado.saldo)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{seleccionado.saldo > 0 ? 'DEBE' : seleccionado.saldo < 0 ? 'A FAVOR' : 'AL DÍA'}</div>
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
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
  <div className="card-title">🧾 Remitos</div>
  <table>
    <thead><tr><th>N° Remito</th><th>Fecha</th><th>Total</th><th>Imprimir</th></tr></thead>
    <tbody>
      {remitos.map(r => (
        <tr key={r.id} style={{ background: r.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: r.eliminado ? 0.8 : 1 }}>
          <td>
            <strong>N° {String(r.numero).padStart(5, '0')}</strong>
            {r.eliminado && <span style={{ marginLeft: 8, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO por {r.eliminado_por}</span>}
          </td>
          <td>{r.fecha}</td>
          <td style={{ color: r.eliminado ? 'var(--muted)' : 'var(--gold)', textDecoration: r.eliminado ? 'line-through' : 'none' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
          <td>{!r.eliminado && <button onClick={() => imprimirRemito(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>}</td>
        </tr>
      ))}
      {remitos.length === 0 && <tr><td colSpan={4} className="empty">Sin remitos</td></tr>}
    </tbody>
  </table>
</div>
          </div>
        )}
      </div>

      {/* MODAL DE PORTAL DE CLIENTE */}
      {modalPortal && (
        <div onClick={() => !modalPortal.loading && setModalPortal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 520, width: '100%' }}>
            {modalPortal.tipo === 'habilitar' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 8 }}>📱 Habilitar portal — {modalPortal.cliente.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  Ingresá un email para el cliente. El sistema generará una contraseña aleatoria que vas a poder copiar y pasarle por WhatsApp.
                </div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email del cliente</label>
                <input
                  type="email"
                  autoFocus
                  placeholder="cliente@ejemplo.com"
                  value={modalPortal.email}
                  onChange={e => setModalPortal(m => ({ ...m, email: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} disabled={modalPortal.loading} className="btn btn-ghost">Cancelar</button>
                  <button onClick={habilitarPortal} disabled={modalPortal.loading || !modalPortal.email} className="btn btn-gold">
                    {modalPortal.loading ? 'Creando...' : '✅ Crear acceso'}
                  </button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'credenciales' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--green)', letterSpacing: 1, marginBottom: 8 }}>✅ Portal habilitado</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Cliente: <strong>{modalPortal.cliente.nombre}</strong></div>
                <div style={{ background: '#2a1a0a', border: '1px solid var(--gold)', borderRadius: 10, padding: 16, marginTop: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>⚠️ COPIÁ ESTOS DATOS AHORA — la contraseña no se vuelve a mostrar</div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Email</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{modalPortal.credenciales.email}</div>
                      <button onClick={() => copiarTexto(modalPortal.credenciales.email)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>📋 Copiar</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Contraseña</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--gold)', letterSpacing: 1 }}>{modalPortal.credenciales.password}</div>
                      <button onClick={() => copiarTexto(modalPortal.credenciales.password)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>📋 Copiar</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Link del portal</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{PORTAL_URL}</div>
                      <button onClick={() => copiarTexto(PORTAL_URL)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>📋 Copiar</button>
                    </div>
                  </div>
                  <button
                    onClick={() => copiarTexto(`Hola ${modalPortal.cliente.nombre}, te habilité tu portal de cliente en Fabricius Carnes.\n\n🔗 Ingresá acá:\n${PORTAL_URL}\n\n🔐 Tus datos:\nEmail: ${modalPortal.credenciales.email}\nContraseña: ${modalPortal.credenciales.password}\n\nVas a poder ver tu saldo, remitos y movimientos cuando quieras.`)}
                    style={{ background: '#0f4220', border: '1px solid var(--green)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 12 }}
                  >💬 Copiar mensaje completo para WhatsApp</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} className="btn btn-gold">Listo</button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'compartir' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1, marginBottom: 8 }}>💬 Compartir acceso — {modalPortal.cliente.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                  El portal ya está habilitado. Escribí la contraseña que le diste al cliente para armar el mensaje de WhatsApp con todos los datos.
                  <br /><br />
                  <strong>La contraseña no se guarda</strong> — solo se usa para armar el mensaje.
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Email del cliente</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', background: 'var(--surface2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>{modalPortal.cliente.email_portal}</div>

                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Contraseña que le diste al cliente</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Escribí la contraseña..."
                  value={modalPortal.password}
                  onChange={e => setModalPortal(m => ({ ...m, password: e.target.value }))}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', boxSizing: 'border-box', marginBottom: 12, fontFamily: 'monospace' }}
                />

                <div style={{ background: '#2a1a0a', border: '1px solid var(--gold)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Link del portal</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', flex: 1 }}>{PORTAL_URL}</div>
                    <button onClick={() => copiarTexto(PORTAL_URL)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>📋 Copiar</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} className="btn btn-ghost">Cerrar</button>
                  <button
                    onClick={() => copiarTexto(`Hola ${modalPortal.cliente.nombre}, te habilité tu portal de cliente en Fabricius Carnes.\n\n🔗 Ingresá acá:\n${PORTAL_URL}\n\n🔐 Tus datos:\nEmail: ${modalPortal.cliente.email_portal}\nContraseña: ${modalPortal.password}\n\nVas a poder ver tu saldo, remitos y movimientos cuando quieras.`)}
                    disabled={!modalPortal.password.trim()}
                    style={{ background: modalPortal.password.trim() ? 'var(--green)' : 'var(--surface2)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: modalPortal.password.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, color: modalPortal.password.trim() ? '#fff' : 'var(--muted)' }}
                  >💬 Copiar mensaje para WhatsApp</button>
                </div>
              </>
            )}

            {modalPortal.tipo === 'revocar' && (
              <>
                <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--red-light)', letterSpacing: 1, marginBottom: 8 }}>❌ Revocar acceso</div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>
                  Vas a revocar el acceso al portal de <strong>{modalPortal.cliente.nombre}</strong>. El cliente ya no podrá ingresar.
                  <br /><br />
                  El historial de cuenta corriente y remitos NO se borra. Podés volver a habilitarlo cuando quieras.
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalPortal(null)} disabled={modalPortal.loading} className="btn btn-ghost">Cancelar</button>
                  <button onClick={revocarPortal} disabled={modalPortal.loading} style={{ background: 'var(--red-light)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                    {modalPortal.loading ? 'Revocando...' : '❌ Revocar acceso'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Clientes
