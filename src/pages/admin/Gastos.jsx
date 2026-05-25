// Gastos.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { parseNumero } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'

// Display de precio con formato AR (incluye centavos si tiene)
import { fmtPrecio } from '../../lib/formatos'
function fmt(n) { return fmtPrecio(Math.abs(Number(n) || 0)) }

const CATEGORIAS = [
  { value: 'vehiculo', label: '🚗 Vehículo' },
  { value: 'peaje', label: '🛣️ Peaje' },
  { value: 'insumos', label: '📦 Insumos' },
  { value: 'limpieza', label: '🧹 Limpieza' },
  { value: 'tripas', label: '🔗 Tripas' },
  { value: 'art', label: '🏥 ART' },
  { value: 'impuestos', label: '📋 Impuestos / ARCA' },
  { value: 'luz', label: '💡 Luz' },
  { value: 'alquiler', label: '🏠 Alquiler' },
  { value: 'redes', label: '📱 Diseño / Redes' },
  { value: 'otro', label: '📝 Otro' },
]

const TIPOS = [
  { id: 'variable', label: '💸 Variable', color: 'var(--red-light)' },
  { id: 'fijo', label: '📌 Fijo', color: 'var(--blue)' },
  { id: 'socio', label: '👤 Socio', color: 'var(--gold)' },
  { id: 'ingreso', label: '💰 Ingreso', color: 'var(--green)' },
]

const FORM_VACIO = {
  fecha: fechaHoyARG(),
  categoria: '', descripcion: '', monto: '',
  forma: 'efectivo', socio: 'fabricio', origenIngreso: '', notas: ''
}

export default function Gastos() {
  const [gastos, setGastos] = useState([])
  const [tipo, setTipo] = useState('variable')
  const [form, setForm] = useState(FORM_VACIO)
  const [alert, setAlert] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [filtroMes, setFiltroMes] = useState(fechaHoyARG().substring(0, 7))
  const [filtroPeriodo, setFiltroPeriodo] = useState('mes')

  useEffect(() => { fetchGastos() }, [])

  async function fetchGastos() {
    // Sin .limit — paginamos en cliente para mostrar TODOS los gastos
    const { data } = await supabase.from('gastos').select('*').order('fecha', { ascending: false })
    setGastos(data || [])
  }

  function showAlert(msg, type = 'success') {
    setAlert({ msg, type })
    setTimeout(() => setAlert(null), 3000)
  }

  async function guardar() {
    if (!form.descripcion || !form.monto) { showAlert('Completá descripción y monto', 'error'); return }
    const datos = {
      fecha: form.fecha, tipo,
      categoria: tipo === 'socio' || tipo === 'ingreso' ? '' : form.categoria,
      descripcion: form.descripcion, monto: parseNumero(form.monto),
      forma: form.forma,
      socio: tipo === 'socio' ? form.socio : null,
      origen_ingreso: tipo === 'ingreso' ? form.origenIngreso : null,
      notas: form.notas
    }
    if (editandoId) {
      const { error } = await supabase.from('gastos').update(datos).eq('id', editandoId)
      if (error) { showAlert(error.message, 'error'); return }
      showAlert('✅ Gasto actualizado')
      setEditandoId(null)
    } else {
      const { error } = await supabase.from('gastos').insert(datos)
      if (error) { showAlert(error.message, 'error'); return }
      showAlert('✅ Registrado correctamente')
    }
    setForm(FORM_VACIO)
    fetchGastos()
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro?')) return
    await supabase.from('gastos').delete().eq('id', id)
    showAlert('🗑️ Eliminado')
    if (editandoId === id) { setEditandoId(null); setForm(FORM_VACIO) }
    fetchGastos()
  }

  function editar(g) {
    setEditandoId(g.id)
    setTipo(g.tipo)
    setForm({
      fecha: g.fecha,
      categoria: g.categoria || '',
      descripcion: g.descripcion || '',
      monto: g.monto?.toString() || '',
      forma: g.forma || 'efectivo',
      socio: g.socio || 'fabricio',
      origenIngreso: g.origen_ingreso || '',
      notas: g.notas || ''
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Filtrar por período
  const hoy = new Date()
  const gastosFiltrados = gastos.filter(g => {
    if (filtroPeriodo === 'mes') return g.fecha?.startsWith(filtroMes)
    if (filtroPeriodo === 'semana') {
      const d = new Date(g.fecha + 'T12:00')
      const diffDays = Math.floor((hoy - d) / (1000 * 60 * 60 * 24))
      return diffDays >= 0 && diffDays <= 7
    }
    return true // todos
  })

  // Totales del período filtrado
  const totVar = gastosFiltrados.filter(g => g.tipo === 'variable').reduce((s, g) => s + (g.monto || 0), 0)
  const totFijo = gastosFiltrados.filter(g => g.tipo === 'fijo').reduce((s, g) => s + (g.monto || 0), 0)
  const totSocio = gastosFiltrados.filter(g => g.tipo === 'socio').reduce((s, g) => s + (g.monto || 0), 0)
  const totIngreso = gastosFiltrados.filter(g => g.tipo === 'ingreso').reduce((s, g) => s + (g.monto || 0), 0)
  const totalEgresos = totVar + totFijo + totSocio
  const balance = totIngreso - totalEgresos

  // Meses disponibles
  const mesesDisp = [...new Set(gastos.map(g => g.fecha?.substring(0, 7)))].filter(Boolean).sort().reverse()

  // Paginación del listado filtrado (todos los tipos juntos, ordenados por fecha)
  const pag = usePaginacion(gastosFiltrados, 25)

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div className="page-title">GASTOS</div>
      <div className="page-sub">Variables, fijos, socios e ingresos extra</div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { id: 'semana', label: '📅 Esta semana' },
          { id: 'mes', label: '📆 Este mes' },
          { id: 'todos', label: '📋 Todos' },
        ].map(p => (
          <button key={p.id} onClick={() => setFiltroPeriodo(p.id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${filtroPeriodo === p.id ? 'var(--gold)' : 'var(--border)'}`, background: filtroPeriodo === p.id ? 'var(--gold)' : 'transparent', color: filtroPeriodo === p.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {p.label}
          </button>
        ))}
        {filtroPeriodo === 'mes' && (
          <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
            style={{ ...inp, width: 'auto', fontSize: 13 }}>
            {mesesDisp.map(m => (
              <option key={m} value={m}>{new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{gastosFiltrados.length} registros</span>
      </div>

      {/* STATS */}
      <div className="grid4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Variables', val: totVar, color: 'var(--red-light)', icon: '💸' },
          { label: 'Fijos', val: totFijo, color: 'var(--blue)', icon: '📌' },
          { label: 'Socios', val: totSocio, color: 'var(--gold)', icon: '👤' },
          { label: 'Ingresos extra', val: totIngreso, color: 'var(--green)', icon: '💰' },
        ].map(s => (
          <div key={s.label} className="stat">
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{fmt(s.val)}</div>
          </div>
        ))}
      </div>

      {/* BALANCE */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="stat" style={{ flex: 1 }}>
          <div className="stat-label">Total egresos del período</div>
          <div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalEgresos)}</div>
        </div>
        <div className="stat" style={{ flex: 1, borderColor: balance >= 0 ? 'var(--green)' : 'var(--red-light)' }}>
          <div className="stat-label">Balance (ingresos − egresos)</div>
          <div className="stat-value" style={{ color: balance >= 0 ? 'var(--green)' : 'var(--red-light)' }}>
            {balance >= 0 ? '+' : ''}{fmt(balance)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16 }}>
        {/* FORMULARIO */}
        <div className="card">
          <div className="card-title">{editandoId ? '✏️ Editando registro' : 'Cargar registro'}</div>

          {editandoId && (
            <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>✏️ Editando</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditandoId(null); setForm(FORM_VACIO) }}>Cancelar</button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {TIPOS.map(t => (
              <button key={t.id} onClick={() => setTipo(t.id)}
                style={{ padding: '7px 12px', borderRadius: 8, border: `2px solid ${tipo === t.id ? t.color : 'var(--border)'}`, background: tipo === t.id ? t.color + '22' : 'transparent', color: tipo === t.id ? t.color : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="form-row">
            <div className="form-group"><label>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
            </div>
            {tipo === 'socio' && (
              <div className="form-group"><label>Socio</label>
                <select value={form.socio} onChange={e => setForm(f => ({ ...f, socio: e.target.value }))} style={inp}>
                  <option value="fabricio">Fabricio Lenardon</option>
                  <option value="ariel">Ariel Garrone</option>
                </select>
              </div>
            )}
            {tipo !== 'socio' && tipo !== 'ingreso' && (
              <div className="form-group"><label>Categoría</label>
                <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} style={inp}>
                  <option value="">— Seleccioná —</option>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}
            {tipo === 'ingreso' && (
              <div className="form-group"><label>Origen</label>
                <select value={form.origenIngreso} onChange={e => setForm(f => ({ ...f, origenIngreso: e.target.value }))} style={inp}>
                  <option value="alquiler_sucursal">🏠 Alquiler Sucursal</option>
                  <option value="alquiler_maquinas">⚙️ Alquiler máquinas</option>
                  <option value="contrato">📋 Pago contrato</option>
                  <option value="otro">💰 Otro ingreso</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-group"><label>Descripción</label>
            <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Ej: Mecánico Kangoo, ART Roxana..." style={inp} />
          </div>

          <div className="form-row">
            <div className="form-group"><label>Monto ($)</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                style={{ ...inp, borderColor: form.monto ? 'var(--gold)' : 'var(--border)' }} />
            </div>
            <div className="form-group"><label>Forma de pago</label>
              <select value={form.forma} onChange={e => setForm(f => ({ ...f, forma: e.target.value }))} style={inp}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">📲 Transferencia</option>
                <option value="debito">💳 Débito</option>
                <option value="cheque">📄 Cheque</option>
              </select>
            </div>
          </div>

          <div className="form-group"><label>Notas (opcional)</label>
            <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Observaciones..." style={inp} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {editandoId && <button className="btn btn-ghost" onClick={() => { setEditandoId(null); setForm(FORM_VACIO) }}>Cancelar</button>}
            <button className="btn btn-gold" onClick={guardar} style={{ flex: 1 }}>
              {editandoId ? '💾 Guardar cambios' : '✅ Registrar'}
            </button>
          </div>
        </div>

        {/* LISTADO */}
        <div className="card">
          <div className="card-title">
            {filtroPeriodo === 'semana' ? 'Gastos de la semana' : filtroPeriodo === 'mes' ? `Gastos de ${new Date(filtroMes + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}` : 'Todos los gastos'}
          </div>

          {/* Listado plano paginado — el desglose por tipo ya se ve en las
              4 tarjetas de stats arriba. Cada fila lleva su badge de tipo. */}
          {gastosFiltrados.length === 0
            ? <div className="empty">Sin registros para este período</div>
            : pag.items.map(g => {
                const t = TIPOS.find(x => x.id === g.tipo) || TIPOS[0]
                return (
                  <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ background: t.color + '22', color: t.color, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.label}</span>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.descripcion}</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {g.fecha} · {g.forma}
                        {g.socio ? ` · ${g.socio}` : ''}
                        {g.categoria ? ` · ${CATEGORIAS.find(c => c.value === g.categoria)?.label || g.categoria}` : ''}
                      </div>
                      {g.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{g.notas}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: g.tipo === 'ingreso' ? 'var(--green)' : t.color, fontSize: 13 }}>
                        {g.tipo === 'ingreso' ? '+' : '−'}{fmt(g.monto)}
                      </span>
                      <button onClick={() => editar(g)}
                        style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>✏️</button>
                      <button onClick={() => eliminar(g.id)}
                        style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button>
                    </div>
                  </div>
                )
              })}
          <Paginador {...pag.controles} label="registros" />
        </div>
      </div>
    </div>
  )
}
