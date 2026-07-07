import { useState } from 'react'
import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════
// MODAL EDITAR CLIENTE — la ficha del cliente en una ventana emergente, para
// corregir datos sin salir de la pantalla donde estás (ej. en pleno despacho).
// Mismos campos que la ficha de Clientes. NO toca el saldo ni la cta cte.
// Props: cliente (fila de `clientes`), onClose(), onSaved(clienteActualizado).
// ═══════════════════════════════════════════════════════════

export default function ModalEditarCliente({ cliente, onClose, onSaved }) {
  const [form, setForm] = useState({
    nombre: cliente.nombre || '',
    nombre_fantasia: cliente.nombre_fantasia || '',
    tipo: cliente.tipo || 'carniceria',
    telefono: cliente.telefono || '',
    localidad: cliente.localidad || '',
    domicilio: cliente.domicilio || '',
    cuit: cliente.cuit || '',
    lista_precios: cliente.lista_precios || 'carn',
    notas: cliente.notas || '',
    titular: cliente.titular || '',
    es_franquicia: !!cliente.es_franquicia,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const inp = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '9px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  async function guardar() {
    if (!form.nombre.trim()) { setError('El nombre no puede quedar vacío'); return }
    setGuardando(true)
    setError('')
    const { error: err } = await supabase.from('clientes').update({ ...form }).eq('id', cliente.id)
    setGuardando(false)
    if (err) { setError('No se pudo guardar: ' + err.message); return }
    onSaved?.({ ...cliente, ...form })
    onClose()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ borderColor: 'var(--gold)', width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>✏️ Editar cliente</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        <div className="form-row">
          <div className="form-group"><label>Nombre</label><input style={inp} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></div>
          <div className="form-group"><label>Nombre Fantasía</label><input style={inp} value={form.nombre_fantasia} onChange={e => setForm(f => ({ ...f, nombre_fantasia: e.target.value }))} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Tipo</label>
            <select style={inp} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
              <option value="carniceria">🥩 Carnicería</option>
              <option value="mayorista">📦 Gastronómico / Mayorista</option>
              <option value="minorista">🛒 Minorista</option>
              <option value="sucursal">🏪 Sucursal</option>
            </select>
          </div>
          <div className="form-group"><label>CUIT</label><input style={inp} value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))} placeholder="XX-XXXXXXXX-X" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Titular / dueño</label><input style={inp} value={form.titular} onChange={e => setForm(f => ({ ...f, titular: e.target.value }))} placeholder="Nombre del dueño (opcional)" /></div>
          <div className="form-group">
            <label>¿Es franquicia nuestra?</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--surface2)', border: `1px solid ${form.es_franquicia ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>
              <input type="checkbox" checked={form.es_franquicia} onChange={e => setForm(f => ({ ...f, es_franquicia: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
              🏪 Sí, es franquicia Fabricius
            </label>
          </div>
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
              <option value="min">🟢 Precio Minorista</option>
            </select>
          </div>
        </div>
        <div className="form-group"><label>Notas</label><input style={inp} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} /></div>

        {error && <div style={{ color: 'var(--red-light)', fontSize: 12, marginTop: 8 }}>⛔ {error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-gold" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : '💾 Guardar cambios'}</button>
        </div>
      </div>
    </div>
  )
}
