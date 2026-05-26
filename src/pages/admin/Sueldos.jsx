// Sueldos.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import Paginador, { usePaginacion } from '../../components/Paginador'

const EMPLEADOS_DEFAULT = [
  { id: 1, apellido: 'FRONTERA', nombre: 'GERMAN GABRIEL', valor_hora: 6000, modalidad: 'hora', cbu: '' },
  { id: 2, apellido: 'ARNAUDO', nombre: 'ELIAS COLO', valor_hora: 5500, modalidad: 'hora', cbu: '0200382311000030167612' },
  { id: 3, apellido: 'PAEZ', nombre: 'LUCIANO', valor_hora: 5000, modalidad: 'hora', cbu: '' },
  { id: 4, apellido: 'SCIENZA', nombre: 'CAMILA', valor_hora: 5000, modalidad: 'hora', cbu: 'Camilabelenscienza' },
  { id: 5, apellido: 'FRONTERA', nombre: 'GIULIANA', valor_hora: 6000, modalidad: 'hora', cbu: 'giu.frontera' },
  { id: 6, apellido: 'MANSILLA', nombre: 'PRISCILA', valor_hora: 5000, modalidad: 'hora', cbu: '' },
]

// Mapeo de nombres del iVMS a IDs de empleados.
// Importante: las claves se comparan en lowercase y por inclusión, así
// que conviene que sean substrings únicos del nombre real (ej. "colo"
// solo matchea Elias Colo Arnaudo). El iVMS a veces emite el nombre
// completo y a veces solo el apodo de la tarjeta — por eso hay varios
// alias para la misma persona.
const NOMBRE_A_EMPLEADO = {
  'alberto elias arnaudo': 2,
  'elias arnaudo': 2,
  'arnaudo': 2,
  'colo': 2,                 // tarjeta secundaria del iVMS para el mismo empleado
  'german frontera': 1,
  'frontera german': 1,
  'german gabriel frontera': 1,
  'luciano paez': 3,
  'paez luciano': 3,
  'camila scienza': 4,
  'scienza camila': 4,
  'giuliana frontera': 5,
  'frontera giuliana': 5,
  'priscila mansilla': 6,
  'mansilla priscila': 6,
}

function buscarEmpleado(nombreRaw) {
  const lower = nombreRaw.toLowerCase().trim()
  for (const [key, id] of Object.entries(NOMBRE_A_EMPLEADO)) {
    if (lower.includes(key) || key.includes(lower)) return id
  }
  return null
}

function calcularHorasTurno(fichadas) {
  // fichadas: array de strings 'HH:MM:SS'
  // Agrupar en turnos: mañana (antes de 15:00) y tarde (desde 15:00)
  const manana = fichadas.filter(h => parseInt(h.split(':')[0]) < 15).sort()
  const tarde = fichadas.filter(h => parseInt(h.split(':')[0]) >= 15).sort()

  let horas = 0

  function diffHoras(h1, h2) {
    const [a, b, c] = h1.split(':').map(Number)
    const [d, e, f] = h2.split(':').map(Number)
    return ((d * 3600 + e * 60 + f) - (a * 3600 + b * 60 + c)) / 3600
  }

  // ---- Turno mañana ----
  // Regla de Fabricio: primera marca = ingreso, segunda marca (si está antes
  // de las 15hs) = egreso. Si NO hay marca de salida, asumir 14:00 como
  // horario de salida — vale tanto para casos sin marcas de tarde como para
  // casos donde el empleado siguió trabajando a la tarde (esa parte la cuenta
  // el bloque de "tarde" más abajo).
  if (manana.length >= 2) {
    horas += diffHoras(manana[0], manana[manana.length - 1])
  } else if (manana.length === 1) {
    // Solo una fichada de mañana → entrada sin salida. Asumir egreso 14:00.
    // Si la única marca cae después de las 14:00 (ej. el cajero marcó solo
    // al salir, sin marcar la entrada), el cálculo daría negativo — en ese
    // caso lo dejamos en 0 y el admin lo ajusta manualmente desde el form.
    const hManana = diffHoras(manana[0], '14:00:00')
    if (hManana > 0) horas += hManana
  }

  // ---- Turno tarde ----
  if (tarde.length >= 2) {
    horas += diffHoras(tarde[0], tarde[tarde.length - 1])
  } else if (tarde.length === 1 && manana.length === 0) {
    horas += 4 // estimado si solo hay una fichada de tarde
  }

  return Math.round(horas * 2) / 2 // redondear a 0.5
}

import { fmtPrecio } from '../../lib/formatos'
function fmt(n) { return fmtPrecio(Number(n) || 0) }
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function Sueldos() {
  const [tab, setTab] = useState('liquidacion')
  const [liquidaciones, setLiquidaciones] = useState([])
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')
  const [horas, setHoras] = useState({})
  const [boletas, setBoletas] = useState({})
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [detalleImport, setDetalleImport] = useState([])

  useEffect(() => {
    fetchLiquidaciones()
    const hoy = new Date()
    const dia = hoy.getDay()
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - (dia === 0 ? 6 : dia - 1))
    const sabado = new Date(lunes); sabado.setDate(lunes.getDate() + 5)
    // fechaHoyARG en lugar de toISOString — sin esto, los lunes después de
    // las 21hs ARG la semana arrancaba un día más adelante.
    setInicio(fechaHoyARG(lunes))
    setFin(fechaHoyARG(sabado))
  }, [])

  async function fetchLiquidaciones() {
    // Sin .limit() — paginamos en cliente con usePaginacion para mostrar TODAS las semanas
    const { data } = await supabase.from('liquidaciones_sueldos').select('*').order('semana_inicio', { ascending: false })
    setLiquidaciones(data || [])
  }

  async function importarExcel(e) {
    const file = e.target.files[0]
    if (!file) return
    setImportando(true)
    setDetalleImport([])

    try {
      const text = await file.text()
      const esCSV = file.name.toLowerCase().endsWith('.csv')

      // Para el .xls/.xlsx del iVMS (que en realidad es HTML disfrazado)
      // parseamos con DOMParser y leemos <tr>/<td>. Para el nuevo formato
      // .csv que exporta el iVMS actualizado parseamos por separador de
      // comas — formato simple sin escapes (los nombres no tienen comas).
      let filasCols
      if (esCSV) {
        const lineas = text.split(/\r?\n/).filter(l => l.trim())
        // Saltar la fila del header
        filasCols = lineas.slice(1).map(l => l.split(',').map(c => c.trim()))
      } else {
        const parser = new DOMParser()
        const doc = parser.parseFromString(text, 'text/html')
        filasCols = Array.from(doc.querySelectorAll('tr'))
          .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()))
      }

      // Registros: { empleadoId, fecha, hora }
      const registros = []
      for (const cols of filasCols) {
        if (cols.length < 4) continue
        // Columnas (mismo orden en CSV y XLS): ID persona, Nombre, Departamento, Hora, ...
        const nombre = cols[1]
        const horaStr = cols[3] // '2026-04-29 14:21:24'
        if (!nombre || !horaStr || !horaStr.includes('-')) continue
        const empId = buscarEmpleado(nombre)
        if (!empId) continue
        const [fecha, hora] = horaStr.split(' ')
        registros.push({ empId, fecha, hora })
      }

      // Agrupar por empleado y fecha
      const porEmpleadoFecha = {}
      for (const r of registros) {
        const key = `${r.empId}_${r.fecha}`
        if (!porEmpleadoFecha[key]) porEmpleadoFecha[key] = { empId: r.empId, fecha: r.fecha, horas: [] }
        porEmpleadoFecha[key].horas.push(r.hora)
      }

      // Calcular horas totales por empleado
      const horasPorEmpleado = {}
      const detalle = []
      for (const [key, val] of Object.entries(porEmpleadoFecha)) {
        const h = calcularHorasTurno(val.horas)
        if (!horasPorEmpleado[val.empId]) horasPorEmpleado[val.empId] = 0
        horasPorEmpleado[val.empId] += h
        detalle.push({ empId: val.empId, fecha: val.fecha, horas: h, fichadas: val.horas.sort() })
      }

      // Redondear a 0.5
      for (const id in horasPorEmpleado) {
        horasPorEmpleado[id] = Math.round(horasPorEmpleado[id] * 2) / 2
      }

      setHoras(horasPorEmpleado)
      setDetalleImport(detalle.sort((a, b) => a.fecha.localeCompare(b.fecha)))

      // Detectar período
      const fechas = registros.map(r => r.fecha).sort()
      if (fechas.length > 0) {
        setInicio(fechas[0])
        setFin(fechas[fechas.length - 1])
      }

      setAlert({ type: 'success', msg: `✅ Importado! ${registros.length} fichadas procesadas` })
    } catch (err) {
      setAlert({ type: 'error', msg: '❌ Error al leer el archivo: ' + err.message })
    }
    setImportando(false)
    setTimeout(() => setAlert(null), 4000)
    e.target.value = ''
  }

  function getHoras(empId) { return parseFloat(horas[empId]) || 0 }
  function getBoletas(empId) { return parseFloat(boletas[empId]) || 0 }

  function calcNeto(emp) {
    const h = getHoras(emp.id)
    const b = getBoletas(emp.id)
    const bruto = h * emp.valor_hora
    const neto = Math.max(0, bruto - b)
    return { bruto, neto, h, b }
  }

  const totalBruto = EMPLEADOS_DEFAULT.reduce((s, e) => s + calcNeto(e).bruto, 0)
  const totalBoletas = EMPLEADOS_DEFAULT.reduce((s, e) => s + calcNeto(e).b, 0)
  const totalNeto = EMPLEADOS_DEFAULT.reduce((s, e) => s + calcNeto(e).neto, 0)

  async function guardarLiquidacion() {
    if (!inicio || !fin) { setAlert({ type: 'error', msg: 'Seleccioná el período' }); return }
    if (totalNeto === 0) { setAlert({ type: 'error', msg: 'Cargá las horas de al menos un empleado' }); return }
    setLoading(true)
    const rows = EMPLEADOS_DEFAULT.map(emp => {
      const { bruto, neto, h, b } = calcNeto(emp)
      return { semana_inicio: inicio, semana_fin: fin, empleado_nombre: `${emp.apellido}, ${emp.nombre}`, horas: h, bruto, boletas: b, neto }
    }).filter(r => r.horas > 0)
    const { error } = await supabase.from('liquidaciones_sueldos').insert(rows)
    setLoading(false)
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    setAlert({ type: 'success', msg: '✅ Liquidación confirmada y guardada' })
    setHoras({}); setBoletas({}); setDetalleImport([])
    fetchLiquidaciones()
    setTimeout(() => setAlert(null), 4000)
  }

  // Lista única de semanas (ordenadas) y paginada — antes era slice(0,10)
  const semanasAll = [...new Set(liquidaciones.map(l => l.semana_inicio))]
  const pagSemanas = usePaginacion(semanasAll, 10)

  return (
    <div>
      <div className="page-title">SUELDOS</div>
      <div className="page-sub">Liquidación semanal del personal</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[{ id: 'liquidacion', label: '💰 Liquidación' }, { id: 'empleados', label: '👥 Empleados' }, { id: 'historial', label: '📋 Historial' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: tab === t.id ? '#7c3aed' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>

      {alert && (
        <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>
          {alert.msg}
        </div>
      )}

      {tab === 'liquidacion' && (
        <div>
          {/* IMPORTAR iVMS */}
          <div className="card" style={{ marginBottom: 16, borderColor: '#7c3aed' }}>
            <div className="card-title">📂 Importar planilla iVMS</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Subí el archivo .xls exportado del iVMS y el sistema calculará las horas automáticamente.
            </div>
            <label style={{ display: 'inline-block', padding: '10px 20px', background: '#7c3aed', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
              {importando ? '⏳ Procesando...' : '📂 Seleccionar archivo iVMS (.csv / .xls)'}
              <input type="file" accept=".csv,.xls,.xlsx,.html,.htm" onChange={importarExcel} style={{ display: 'none' }} disabled={importando} />
            </label>

            {detalleImport.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>Detalle de fichadas importadas:</div>
                <table>
                  <thead><tr><th>Empleado</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Horas</th></tr></thead>
                  <tbody>
                    {detalleImport.map((d, i) => {
                      const emp = EMPLEADOS_DEFAULT.find(e => e.id === parseInt(d.empId))
                      return (
                        <tr key={i}>
                          <td>{emp ? `${emp.apellido}, ${emp.nombre}` : d.empId}</td>
                          <td>{new Date(d.fecha + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                          <td style={{ color: 'var(--green)' }}>{d.fichadas[0]?.substring(0, 5)}</td>
                          <td style={{ color: 'var(--amber)' }}>{d.fichadas[d.fichadas.length - 1]?.substring(0, 5)}</td>
                          <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{d.horas}h</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* PERÍODO */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Período</div>
            <div className="form-row">
              <div className="form-group"><label>Inicio</label><input style={inp} type="date" value={inicio} onChange={e => setInicio(e.target.value)} /></div>
              <div className="form-group"><label>Fin</label><input style={inp} type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
            </div>
          </div>

          {/* TARJETAS EMPLEADOS */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
            {EMPLEADOS_DEFAULT.map(emp => {
              const { bruto, neto } = calcNeto(emp)
              return (
                <div key={emp.id} className="card" style={{ marginBottom: 0, borderColor: neto > 0 ? '#7c3aed' : 'var(--border)' }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.apellido}, {emp.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>${emp.valor_hora.toLocaleString('es-AR')}/hora</div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Horas trabajadas</label>
                    <input style={{ ...inp, borderColor: getHoras(emp.id) > 0 ? '#7c3aed' : 'var(--border)' }} type="number" step="0.5" placeholder="0" value={horas[emp.id] || ''} onChange={e => setHoras(h => ({ ...h, [emp.id]: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Boletas / Descuentos ($)</label>
                    <input style={inp} type="number" placeholder="0" value={boletas[emp.id] || ''} onChange={e => setBoletas(b => ({ ...b, [emp.id]: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Bruto: {fmt(bruto)}</div>
                      {getBoletas(emp.id) > 0 && <div style={{ fontSize: 10, color: 'var(--red-light)' }}>Desc: -{fmt(getBoletas(emp.id))}</div>}
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: neto > 0 ? '#a78bfa' : 'var(--muted)' }}>{fmt(neto)}</div>
                  </div>
                  {emp.cbu && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>📲 {emp.cbu}</div>}
                </div>
              )
            })}
          </div>

          {/* RESUMEN */}
          <div className="card" style={{ borderColor: '#7c3aed' }}>
            <div className="card-title">Resumen de liquidación</div>
            <table>
              <thead><tr><th>Empleado</th><th>Horas</th><th>Valor/h</th><th>Bruto</th><th>Boletas</th><th>NETO</th></tr></thead>
              <tbody>
                {EMPLEADOS_DEFAULT.map(emp => {
                  const { bruto, neto, h, b } = calcNeto(emp)
                  return (
                    <tr key={emp.id} style={{ opacity: h === 0 ? 0.4 : 1 }}>
                      <td><strong>{emp.apellido}, {emp.nombre}</strong></td>
                      <td>{h > 0 ? h + 'h' : '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmt(emp.valor_hora)}</td>
                      <td style={{ color: '#a78bfa' }}>{fmt(bruto)}</td>
                      <td style={{ color: 'var(--red-light)' }}>{b > 0 ? fmt(b) : '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(neto)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface2)' }}>
                  <td colSpan={3}><strong>TOTAL</strong></td>
                  <td style={{ color: '#a78bfa', fontWeight: 700 }}>{fmt(totalBruto)}</td>
                  <td style={{ color: 'var(--red-light)', fontWeight: 700 }}>{fmt(totalBoletas)}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{fmt(totalNeto)}</td>
                </tr>
              </tfoot>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={guardarLiquidacion} disabled={loading}
                style={{ padding: '10px 24px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                {loading ? 'Guardando...' : '✅ Confirmar liquidación semanal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'empleados' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {EMPLEADOS_DEFAULT.map(emp => (
            <div key={emp.id} className="card">
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: '#a78bfa', marginBottom: 4 }}>{emp.apellido}</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{emp.nombre}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Valor hora</span>
                <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{fmt(emp.valor_hora)}</span>
              </div>
              {emp.cbu && (
                <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px' }}>
                  📲 {emp.cbu}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'historial' && (
        <div>
          {pagSemanas.items.map(semana => {
            const liqSemana = liquidaciones.filter(l => l.semana_inicio === semana)
            const totalSemana = liqSemana.reduce((s, l) => s + (l.neto || 0), 0)
            return (
              <div key={semana} className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="card-title" style={{ margin: 0 }}>
                    Semana {new Date(semana + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} → {new Date((liqSemana[0]?.semana_fin || semana) + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>TOTAL: {fmt(totalSemana)}</div>
                </div>
                <table>
                  <thead><tr><th>Empleado</th><th>Horas</th><th>Bruto</th><th>Boletas</th><th>Neto</th></tr></thead>
                  <tbody>
                    {liqSemana.map(l => (
                      <tr key={l.id}>
                        <td><strong>{l.empleado_nombre}</strong></td>
                        <td>{l.horas > 0 ? l.horas + 'h' : '—'}</td>
                        <td style={{ color: '#a78bfa' }}>{fmt(l.bruto)}</td>
                        <td style={{ color: 'var(--red-light)' }}>{l.boletas > 0 ? fmt(l.boletas) : '—'}</td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(l.neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          {liquidaciones.length === 0 && <div className="card"><p style={{ color: 'var(--muted)', textAlign: 'center' }}>Sin liquidaciones registradas</p></div>}
          <Paginador {...pagSemanas.controles} label="semanas" />
        </div>
      )}
    </div>
  )
}
