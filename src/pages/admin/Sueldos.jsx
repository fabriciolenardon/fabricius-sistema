// Sueldos.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
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

const MESES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
// Nombre lindo para un mes calendario 'YYYY-MM' (fallback cuando la semana no
// cae en ningún mes operativo cargado en Cierre → Por Mes).
function nombreMesCalendario(ym) {
  const [y, m] = ym.split('-')
  return `${MESES_ES[parseInt(m)] || ym} ${y}`
}
// dd/mm de una fecha 'YYYY-MM-DD' sin desfasar por zona horaria.
function fmtDdMm(d) {
  if (!d) return ''
  return new Date(d + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
// Agrega las liquidaciones de un período en un informe por empleado (suma
// horas, bruto, viáticos, adelantos, boletas y neto de sueldo). Los conceptos
// extra del mes (aguinaldo, vacaciones) se suman aparte y arman el TOTAL a
// cobrar. Number() porque las columnas numeric de Supabase vuelven como string.
function informeEmpleados(liqs, conceptos = []) {
  const map = {}
  const ensure = (nombre) => {
    if (!map[nombre]) map[nombre] = { nombre, horas: 0, bruto: 0, viaticos: 0, adelantos: 0, boletas: 0, netoSueldo: 0, aguinaldo: 0, vacaciones: 0, neto: 0, semanas: 0 }
    return map[nombre]
  }
  for (const l of liqs) {
    const g = ensure(l.empleado_nombre || '—')
    g.horas += Number(l.horas) || 0
    g.bruto += Number(l.bruto) || 0
    g.viaticos += Number(l.viaticos) || 0
    g.adelantos += Number(l.adelantos) || 0
    g.boletas += Number(l.boletas) || 0
    g.netoSueldo += Number(l.neto) || 0
    g.semanas += 1
  }
  // Un empleado puede tener un concepto sin liquidación esa semana (ej. mes de
  // vacaciones sin fichar) — ensure() lo crea igual para que aparezca.
  for (const c of conceptos) {
    const g = ensure(c.empleado_nombre || '—')
    if (c.tipo === 'aguinaldo') g.aguinaldo += Number(c.monto) || 0
    else if (c.tipo === 'vacaciones') g.vacaciones += Number(c.monto) || 0
  }
  for (const g of Object.values(map)) g.neto = g.netoSueldo + g.aguinaldo + g.vacaciones
  return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
}
const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }

export default function Sueldos() {
  const [tab, setTab] = useState('liquidacion')
  const [liquidaciones, setLiquidaciones] = useState([])
  const [inicio, setInicio] = useState('')
  const [fin, setFin] = useState('')
  const [horas, setHoras] = useState({})
  const [boletas, setBoletas] = useState({})
  const [adelantos, setAdelantos] = useState({})
  const [viaticos, setViaticos] = useState({})       // monto de viáticos por empleado (suma al neto)
  const [viaticosOn, setViaticosOn] = useState({})   // toggle: si está activado, suma y aparece en el resumen
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [detalleImport, setDetalleImport] = useState([])
  // Empleados cargados de la base (valor_hora editable). Fallback al hardcode.
  const [empleados, setEmpleados] = useState(EMPLEADOS_DEFAULT)
  const [editHora, setEditHora] = useState({})     // valor_hora tipeado en la pestaña Empleados
  const [guardandoEmp, setGuardandoEmp] = useState(null)
  const [meses, setMeses] = useState([])           // meses operativos (calendario del cierre mensual)
  const [semanasAbiertas, setSemanasAbiertas] = useState({}) // toggle "ver semanas" por mes en el historial
  const [conceptos, setConceptos] = useState([])   // aguinaldos / vacaciones por mes+empleado
  const [extrasAbiertos, setExtrasAbiertos] = useState({})   // toggle panel de extras por mes
  const [extraEdit, setExtraEdit] = useState({})   // edición inline: `${mesKey}_${empId}` → { aguinaldo, vacDias, vacMonto }
  const [guardandoExtra, setGuardandoExtra] = useState(null)

  useEffect(() => {
    fetchLiquidaciones()
    cargarEmpleados()
    cargarMeses()
    cargarConceptos()
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
    const { data } = await fetchAllRows(() => supabase.from('liquidaciones_sueldos').select('*').order('semana_inicio', { ascending: false }))
    setLiquidaciones(data || [])
  }

  async function cargarMeses() {
    // Meses operativos = mismo calendario que usa el Cierre mensual (rango
    // fecha_inicio→fecha_cierre por semanas enteras). Sirven para agrupar el
    // historial de sueldos por mes real de la empresa, no por mes calendario.
    const { data } = await supabase.from('meses_operativos').select('*').order('fecha_inicio', { ascending: false })
    setMeses(data || [])
  }

  async function cargarConceptos() {
    // Aguinaldos y vacaciones cargados por mes (tabla conceptos_sueldos).
    const { data } = await supabase.from('conceptos_sueldos').select('*')
    setConceptos(data || [])
  }

  async function cargarEmpleados() {
    // Los empleados (con su valor hora) viven en la tabla empleados_sueldos.
    // Si la tabla está vacía o falla, se usa el hardcode como fallback.
    const { data } = await supabase.from('empleados_sueldos').select('*').eq('activo', true).order('id')
    if (data && data.length) setEmpleados(data.map(e => ({ ...e, valor_hora: Number(e.valor_hora) || 0 })))
  }

  // Guarda el nuevo valor hora de un empleado (pestaña Empleados).
  async function guardarHora(emp) {
    const v = parseFloat(editHora[emp.id])
    if (!(v > 0)) { setAlert({ type: 'error', msg: 'Ingresá un valor hora válido' }); return }
    setGuardandoEmp(emp.id)
    const { error } = await supabase.from('empleados_sueldos')
      .update({ valor_hora: v, updated_at: new Date().toISOString() }).eq('id', emp.id)
    setGuardandoEmp(null)
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    setEditHora(h => { const n = { ...h }; delete n[emp.id]; return n })
    setAlert({ type: 'success', msg: `✅ Valor hora de ${emp.nombre} actualizado a ${fmt(v)}` })
    cargarEmpleados()
    setTimeout(() => setAlert(null), 3500)
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

      // Deduplicar marcas cercanas dentro del mismo empleado-día.
      // Caso 1: rebote del lector biométrico — la persona pasa la tarjeta
      //   y como el lector no confirma al primer intento, pasa una segunda
      //   vez, generando dos fichadas con apenas segundos de diferencia.
      // Caso 2: empleado con dos tarjetas asignadas (ej. Arnaudo tiene
      //   id 3 y id 25 en el iVMS). Las dos tarjetas suelen pasar al
      //   mismo tiempo cuando el empleado entra → dos fichadas idénticas.
      // Threshold: 5 minutos. Más conservador que eso (ej. 30 seg) deja
      // pasar muchos rebotes; más amplio (ej. 30 min) pisaría marcas
      // legítimas (ej. entrada → ir al baño → marca de salida).
      const THRESH_DEDUP_SEG = 5 * 60
      const horaASeg = h => {
        const [a, b, c] = h.split(':').map(Number)
        return a * 3600 + b * 60 + c
      }
      for (const val of Object.values(porEmpleadoFecha)) {
        val.horas.sort()
        const dedupe = []
        for (const h of val.horas) {
          if (dedupe.length === 0 || horaASeg(h) - horaASeg(dedupe[dedupe.length - 1]) >= THRESH_DEDUP_SEG) {
            dedupe.push(h)
          }
        }
        val.horas = dedupe
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
  function getAdelantos(empId) { return parseFloat(adelantos[empId]) || 0 }
  function getViaticos(empId) { return parseFloat(viaticos[empId]) || 0 }
  // ¿El toggle de viáticos está activado para este empleado? Si el usuario no lo
  // tocó, usa el default del empleado (tiene_viaticos): pre-activado solo para
  // los que cobran viáticos (Luciano y Giuliana).
  function viaticosActivo(emp) {
    return emp.id in viaticosOn ? viaticosOn[emp.id] : !!emp.tiene_viaticos
  }

  function calcNeto(emp) {
    const h = getHoras(emp.id)
    const b = getBoletas(emp.id)
    const a = getAdelantos(emp.id)
    const vOn = viaticosActivo(emp)
    const v = vOn ? getViaticos(emp.id) : 0      // viáticos SUMAN, solo si el toggle está activo
    const bruto = h * emp.valor_hora
    const neto = Math.max(0, bruto + v - a - b)
    return { bruto, neto, h, b, a, v, vOn }
  }

  const totalBruto = empleados.reduce((s, e) => s + calcNeto(e).bruto, 0)
  const totalBoletas = empleados.reduce((s, e) => s + calcNeto(e).b, 0)
  const totalAdelantos = empleados.reduce((s, e) => s + calcNeto(e).a, 0)
  const totalViaticos = empleados.reduce((s, e) => s + calcNeto(e).v, 0)
  const totalNeto = empleados.reduce((s, e) => s + calcNeto(e).neto, 0)

  async function guardarLiquidacion() {
    if (!inicio || !fin) { setAlert({ type: 'error', msg: 'Seleccioná el período' }); return }
    if (totalNeto === 0) { setAlert({ type: 'error', msg: 'Cargá las horas de al menos un empleado' }); return }
    setLoading(true)
    const rows = empleados.map(emp => {
      const { bruto, neto, h, b, a, v } = calcNeto(emp)
      return { semana_inicio: inicio, semana_fin: fin, empleado_nombre: `${emp.apellido}, ${emp.nombre}`, horas: h, bruto, viaticos: v, adelantos: a, boletas: b, neto }
    }).filter(r => r.horas > 0)
    const { error } = await supabase.from('liquidaciones_sueldos').insert(rows)
    setLoading(false)
    if (error) { setAlert({ type: 'error', msg: error.message }); return }
    setAlert({ type: 'success', msg: '✅ Liquidación confirmada y guardada' })
    setHoras({}); setBoletas({}); setAdelantos({}); setViaticos({}); setViaticosOn({}); setDetalleImport([])
    fetchLiquidaciones()
    setTimeout(() => setAlert(null), 4000)
  }

  // Imprime un resumen de pago simple (sin logos) para un empleado: horas,
  // valor hora, sueldo bruto, adelantos (resta), boletas (resta) y neto.
  function imprimirResumen(emp) {
    const { bruto, neto, h, b, a, v, vOn } = calcNeto(emp)
    if (h <= 0) { setAlert({ type: 'error', msg: 'Cargá las horas de ese empleado antes de imprimir el resumen' }); return }
    const fmtF = d => d ? new Date(d + 'T12:00').toLocaleDateString('es-AR') : ''
    const periodo = inicio && fin ? `${fmtF(inicio)} al ${fmtF(fin)}` : ''
    const fila = (label, valor, opts = {}) =>
      `<tr class="${opts.cls || ''}"><td style="padding:6px 0;color:#444">${label}</td><td style="padding:6px 0;text-align:right;font-weight:700;${opts.color ? `color:${opts.color};` : ''}">${valor}</td></tr>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Resumen — ${emp.apellido}</title>
      <style>
        @page { margin: 12mm; }
        body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; padding:16px; }
        .box { width: 330px; border: 2px solid #111; border-radius: 12px; padding: 18px 22px; }
        .nombre { font-size: 18px; font-weight: 800; }
        .periodo { font-size: 11px; color:#666; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        tr.sep td { border-top: 1px dashed #bbb; padding-top: 10px; }
        tr.neto td { border-top: 2px solid #111; font-size: 19px; padding-top: 10px; }
      </style></head><body onload="window.print()">
      <div class="box">
        <div class="nombre">${emp.apellido}, ${emp.nombre}</div>
        <div class="periodo">Liquidación ${periodo}</div>
        <table>
          ${fila('Horas trabajadas', h + ' h')}
          ${fila('Valor hora', fmt(emp.valor_hora))}
          ${fila('Sueldo (bruto)', fmt(bruto), { cls: 'sep' })}
          ${vOn && v > 0 ? fila('Viáticos', '+ ' + fmt(v), { color: '#1e7e34' }) : ''}
          ${a > 0 ? fila('Adelantos', '− ' + fmt(a), { color: '#c0392b' }) : ''}
          ${b > 0 ? fila('Boletas', '− ' + fmt(b), { color: '#c0392b' }) : ''}
          ${fila('NETO A COBRAR', fmt(neto), { cls: 'neto' })}
        </table>
      </div></body></html>`
    const w = window.open('', '_blank', 'width=440,height=600')
    if (!w) { setAlert({ type: 'error', msg: 'Habilitá las ventanas emergentes para poder imprimir' }); return }
    w.document.write(html); w.document.close()
  }

  // Historial agrupado por MES (mismo calendario que el Cierre mensual) y,
  // dentro de cada mes, por semana. Cada semana se ubica en el mes operativo
  // cuyo rango [fecha_inicio, fecha_cierre] la contiene; si no cae en ninguno,
  // fallback al mes calendario de la semana_inicio.
  const hoyStr = fechaHoyARG(new Date())
  const historialPorMes = useMemo(() => {
    const grupos = {}
    for (const l of liquidaciones) {
      const mOp = meses.find(m => l.semana_inicio >= m.fecha_inicio && l.semana_inicio <= m.fecha_cierre)
      const key = mOp ? (mOp.mes || mOp.fecha_inicio) : l.semana_inicio.substring(0, 7)
      if (!grupos[key]) {
        grupos[key] = {
          key,
          orden: mOp ? mOp.fecha_inicio : l.semana_inicio.substring(0, 7),
          etiqueta: mOp ? mOp.etiqueta : nombreMesCalendario(l.semana_inicio.substring(0, 7)),
          inicio: mOp ? mOp.fecha_inicio : null,
          cierre: mOp ? mOp.fecha_cierre : null,
          // Cerrado = el mes ya terminó (su fecha de cierre quedó en el pasado).
          // Para el fallback calendario, cerrado si el mes es anterior al actual.
          cerrado: mOp ? mOp.fecha_cierre < hoyStr : l.semana_inicio.substring(0, 7) < hoyStr.substring(0, 7),
          liqs: [],
        }
      }
      grupos[key].liqs.push(l)
    }
    return Object.values(grupos).sort((a, b) => b.orden.localeCompare(a.orden))
  }, [liquidaciones, meses, hoyStr])

  const pagMeses = usePaginacion(historialPorMes, 6)

  // "Sueldo mensual" de referencia por empleado = su mejor bruto mensual de todo
  // el historial. Se usa para sugerir las vacaciones (Comercio: sueldo/25 × días)
  // sin que el propio mes de vacaciones — con menos horas fichadas — lo achique.
  const brutoMaxPorEmp = useMemo(() => {
    const res = {}
    for (const mes of historialPorMes) {
      const perEmp = {}
      for (const l of mes.liqs) {
        const k = l.empleado_nombre
        perEmp[k] = (perEmp[k] || 0) + (Number(l.bruto) || 0)
      }
      for (const [k, v] of Object.entries(perEmp)) res[k] = Math.max(res[k] || 0, v)
    }
    return res
  }, [historialPorMes])

  // Guarda (upsert) o borra los conceptos extra de un empleado en un mes:
  // aguinaldo y vacaciones. Monto 0 o vacío → se borra el concepto.
  async function guardarExtras(mesKey, emp) {
    const key = `${mesKey}_${emp.id}`
    const e = extraEdit[key]
    if (!e) return
    const nombre = `${emp.apellido}, ${emp.nombre}`
    setGuardandoExtra(key)
    const ag = parseFloat(e.aguinaldo) || 0
    const vm = parseFloat(e.vacMonto) || 0
    const vd = parseInt(e.vacDias) || null
    const ops = []
    ops.push(ag > 0
      ? supabase.from('conceptos_sueldos').upsert({ mes: mesKey, empleado_id: emp.id, empleado_nombre: nombre, tipo: 'aguinaldo', monto: ag, detalle: '50% del bruto del mes', updated_at: new Date().toISOString() }, { onConflict: 'mes,empleado_id,tipo' })
      : supabase.from('conceptos_sueldos').delete().eq('mes', mesKey).eq('empleado_id', emp.id).eq('tipo', 'aguinaldo'))
    ops.push(vm > 0
      ? supabase.from('conceptos_sueldos').upsert({ mes: mesKey, empleado_id: emp.id, empleado_nombre: nombre, tipo: 'vacaciones', monto: vm, dias: vd, detalle: vd ? `${vd} días corridos · sueldo/25 (Comercio)` : 'Vacaciones', updated_at: new Date().toISOString() }, { onConflict: 'mes,empleado_id,tipo' })
      : supabase.from('conceptos_sueldos').delete().eq('mes', mesKey).eq('empleado_id', emp.id).eq('tipo', 'vacaciones'))
    const results = await Promise.all(ops)
    setGuardandoExtra(null)
    const err = results.find(r => r.error)
    if (err) { setAlert({ type: 'error', msg: err.error.message }); return }
    setExtraEdit(s => { const n = { ...s }; delete n[key]; return n })
    setAlert({ type: 'success', msg: `✅ Extras de ${emp.nombre} guardados` })
    cargarConceptos()
    setTimeout(() => setAlert(null), 3000)
  }

  // Imprime el informe mensual: una fila por empleado con horas, bruto,
  // viáticos, adelantos, boletas, aguinaldo, vacaciones y total del mes.
  function imprimirInformeMes(mes) {
    const conceptosMes = conceptos.filter(c => c.mes === mes.key)
    const informe = informeEmpleados(mes.liqs, conceptosMes)
    if (informe.length === 0) { setAlert({ type: 'error', msg: 'No hay liquidaciones en este mes' }); return }
    const tot = informe.reduce((s, e) => ({
      horas: s.horas + e.horas, bruto: s.bruto + e.bruto, viaticos: s.viaticos + e.viaticos,
      adelantos: s.adelantos + e.adelantos, boletas: s.boletas + e.boletas,
      netoSueldo: s.netoSueldo + e.netoSueldo, aguinaldo: s.aguinaldo + e.aguinaldo, vacaciones: s.vacaciones + e.vacaciones, neto: s.neto + e.neto,
    }), { horas: 0, bruto: 0, viaticos: 0, adelantos: 0, boletas: 0, netoSueldo: 0, aguinaldo: 0, vacaciones: 0, neto: 0 })
    const hayAg = tot.aguinaldo > 0
    const hayVac = tot.vacaciones > 0
    const periodo = mes.inicio && mes.cierre ? `${fmtDdMm(mes.inicio)} al ${fmtDdMm(mes.cierre)}` : ''
    const th = t => `<th style="text-align:right;padding:8px 10px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;color:#555">${t}</th>`
    const td = (v, opts = {}) => `<td style="text-align:${opts.align || 'right'};padding:7px 10px;border-bottom:1px solid #ddd;${opts.bold ? 'font-weight:700;' : ''}">${v}</td>`
    const filas = informe.map(e => `<tr>
        ${td(e.nombre, { align: 'left', bold: true })}
        ${td(e.horas + ' h')}
        ${td(fmt(e.bruto))}
        ${td(e.viaticos > 0 ? '+' + fmt(e.viaticos) : '—')}
        ${td(e.adelantos > 0 ? '−' + fmt(e.adelantos) : '—')}
        ${td(e.boletas > 0 ? '−' + fmt(e.boletas) : '—')}
        ${td(fmt(e.netoSueldo))}
        ${hayAg ? td(e.aguinaldo > 0 ? '+' + fmt(e.aguinaldo) : '—') : ''}
        ${hayVac ? td(e.vacaciones > 0 ? '+' + fmt(e.vacaciones) : '—') : ''}
        ${td(fmt(e.neto), { bold: true })}
      </tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Informe ${mes.etiqueta}</title>
      <style>
        @page { margin: 12mm; }
        body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; padding:20px; }
        h1 { font-size: 20px; margin:0 0 2px; }
        .periodo { font-size: 12px; color:#666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        tfoot td { border-top: 2px solid #111; font-weight: 800; padding:9px 10px; }
      </style></head><body onload="window.print()">
      <h1>Informe mensual de sueldos — ${mes.etiqueta}</h1>
      <div class="periodo">${periodo ? 'Período ' + periodo + ' · ' : ''}${mes.cerrado ? 'Mes cerrado' : 'Mes en curso'}</div>
      <table>
        <thead><tr>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;color:#555">Empleado</th>
          ${th('Horas')}${th('Bruto')}${th('Viáticos')}${th('Adelantos')}${th('Boletas')}${th('Sueldo')}${hayAg ? th('Aguinaldo') : ''}${hayVac ? th('Vacaciones') : ''}${th('Total')}
        </tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr>
          ${td('TOTAL', { align: 'left' })}
          ${td(tot.horas + ' h')}
          ${td(fmt(tot.bruto))}
          ${td(tot.viaticos > 0 ? '+' + fmt(tot.viaticos) : '—')}
          ${td(tot.adelantos > 0 ? '−' + fmt(tot.adelantos) : '—')}
          ${td(tot.boletas > 0 ? '−' + fmt(tot.boletas) : '—')}
          ${td(fmt(tot.netoSueldo))}
          ${hayAg ? td('+' + fmt(tot.aguinaldo)) : ''}
          ${hayVac ? td('+' + fmt(tot.vacaciones)) : ''}
          ${td(fmt(tot.neto))}
        </tr></tfoot>
      </table>
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=600')
    if (!w) { setAlert({ type: 'error', msg: 'Habilitá las ventanas emergentes para poder imprimir' }); return }
    w.document.write(html); w.document.close()
  }

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
                      const emp = empleados.find(e => e.id === parseInt(d.empId))
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
            {empleados.map(emp => {
              const { bruto, neto, v, vOn } = calcNeto(emp)
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
                  {/* Viáticos: toggle clickeable. Si está activo SUMA al neto y
                      aparece en el resumen; si no, ni se suma ni se muestra. */}
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label onClick={() => setViaticosOn(o => ({ ...o, [emp.id]: !viaticosActivo(emp) }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 3, cursor: 'pointer', color: vOn ? '#22c55e' : 'var(--muted)', fontWeight: vOn ? 700 : 400 }}>
                      <input type="checkbox" checked={vOn} readOnly style={{ cursor: 'pointer' }} />
                      ✈️ Viáticos ($) — suma {vOn ? '· aparece en el resumen' : ''}
                    </label>
                    {vOn && (
                      <input style={{ ...inp, borderColor: '#22c55e' }} type="number" placeholder="0" value={viaticos[emp.id] || ''} onChange={e => setViaticos(v => ({ ...v, [emp.id]: e.target.value }))} />
                    )}
                  </div>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Adelantos ($) — se restan</label>
                    <input style={inp} type="number" placeholder="0" value={adelantos[emp.id] || ''} onChange={e => setAdelantos(a => ({ ...a, [emp.id]: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Boletas / Descuentos ($) — se restan</label>
                    <input style={inp} type="number" placeholder="0" value={boletas[emp.id] || ''} onChange={e => setBoletas(b => ({ ...b, [emp.id]: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Bruto: {fmt(bruto)}</div>
                      {vOn && v > 0 && <div style={{ fontSize: 10, color: '#22c55e' }}>Viáticos: +{fmt(v)}</div>}
                      {getAdelantos(emp.id) > 0 && <div style={{ fontSize: 10, color: 'var(--red-light)' }}>Adelantos: -{fmt(getAdelantos(emp.id))}</div>}
                      {getBoletas(emp.id) > 0 && <div style={{ fontSize: 10, color: 'var(--red-light)' }}>Boletas: -{fmt(getBoletas(emp.id))}</div>}
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: neto > 0 ? '#a78bfa' : 'var(--muted)' }}>{fmt(neto)}</div>
                  </div>
                  <button onClick={() => imprimirResumen(emp)} disabled={getHoras(emp.id) <= 0}
                    style={{ width: '100%', marginTop: 10, padding: '7px', background: 'transparent', border: '1px solid #7c3aed', color: getHoras(emp.id) > 0 ? '#a78bfa' : 'var(--muted)', borderRadius: 8, cursor: getHoras(emp.id) > 0 ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 12, opacity: getHoras(emp.id) > 0 ? 1 : 0.5 }}>
                    🖨️ Imprimir resumen
                  </button>
                  {emp.cbu && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>📲 {emp.cbu}</div>}
                </div>
              )
            })}
          </div>

          {/* RESUMEN */}
          <div className="card" style={{ borderColor: '#7c3aed' }}>
            <div className="card-title">Resumen de liquidación</div>
            <table>
              <thead><tr><th>Empleado</th><th>Horas</th><th>Valor/h</th><th>Bruto</th><th>Viáticos</th><th>Adelantos</th><th>Boletas</th><th>NETO</th><th></th></tr></thead>
              <tbody>
                {empleados.map(emp => {
                  const { bruto, neto, h, b, a, v, vOn } = calcNeto(emp)
                  return (
                    <tr key={emp.id} style={{ opacity: h === 0 ? 0.4 : 1 }}>
                      <td><strong>{emp.apellido}, {emp.nombre}</strong></td>
                      <td>{h > 0 ? h + 'h' : '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmt(emp.valor_hora)}</td>
                      <td style={{ color: '#a78bfa' }}>{fmt(bruto)}</td>
                      <td style={{ color: '#22c55e' }}>{vOn && v > 0 ? '+' + fmt(v) : '—'}</td>
                      <td style={{ color: 'var(--red-light)' }}>{a > 0 ? '-' + fmt(a) : '—'}</td>
                      <td style={{ color: 'var(--red-light)' }}>{b > 0 ? '-' + fmt(b) : '—'}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(neto)}</td>
                      <td>{h > 0 && <button onClick={() => imprimirResumen(emp)} title="Imprimir resumen" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 13 }}>🖨️</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface2)' }}>
                  <td colSpan={3}><strong>TOTAL</strong></td>
                  <td style={{ color: '#a78bfa', fontWeight: 700 }}>{fmt(totalBruto)}</td>
                  <td style={{ color: '#22c55e', fontWeight: 700 }}>{totalViaticos > 0 ? '+' + fmt(totalViaticos) : '—'}</td>
                  <td style={{ color: 'var(--red-light)', fontWeight: 700 }}>{totalAdelantos > 0 ? '-' + fmt(totalAdelantos) : '—'}</td>
                  <td style={{ color: 'var(--red-light)', fontWeight: 700 }}>{totalBoletas > 0 ? '-' + fmt(totalBoletas) : '—'}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{fmt(totalNeto)}</td>
                  <td></td>
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
          {empleados.map(emp => {
            const editando = editHora[emp.id] !== undefined
            return (
            <div key={emp.id} className="card">
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: '#a78bfa', marginBottom: 4 }}>{emp.apellido}</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{emp.nombre}</div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Valor hora ($)</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" step="100" style={{ ...inp, padding: '6px 10px', borderColor: editando ? '#7c3aed' : 'var(--border)' }}
                    value={editando ? editHora[emp.id] : emp.valor_hora}
                    onChange={e => setEditHora(h => ({ ...h, [emp.id]: e.target.value }))} />
                  <button onClick={() => guardarHora(emp)} disabled={!editando || guardandoEmp === emp.id}
                    style={{ padding: '6px 12px', background: editando ? '#7c3aed' : 'var(--surface)', color: editando ? '#fff' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: editando ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {guardandoEmp === emp.id ? '⏳' : '💾 Guardar'}
                  </button>
                </div>
              </div>
              {emp.cbu && (
                <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px' }}>
                  📲 {emp.cbu}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {tab === 'historial' && (
        <div>
          {pagMeses.items.map(mes => {
            const conceptosMes = conceptos.filter(c => c.mes === mes.key)
            const informe = informeEmpleados(mes.liqs, conceptosMes)
            const totalMes = informe.reduce((s, e) => s + e.neto, 0)
            const totHoras = informe.reduce((s, e) => s + e.horas, 0)
            const totBruto = informe.reduce((s, e) => s + e.bruto, 0)
            const totSueldo = informe.reduce((s, e) => s + e.netoSueldo, 0)
            const totAguinaldo = informe.reduce((s, e) => s + e.aguinaldo, 0)
            const totVac = informe.reduce((s, e) => s + e.vacaciones, 0)
            const hayAg = totAguinaldo > 0
            const hayVac = totVac > 0
            const hayExtras = hayAg || hayVac
            const semanasMes = [...new Set(mes.liqs.map(l => l.semana_inicio))].sort((a, b) => b.localeCompare(a))
            const abierto = !!semanasAbiertas[mes.key]
            const extrasOpen = !!extrasAbiertos[mes.key]
            return (
              <div key={mes.key} className="card" style={{ marginBottom: 20, borderColor: '#7c3aed' }}>
                {/* Encabezado del mes */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  <div>
                    <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      📅 {mes.etiqueta}
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: mes.cerrado ? '#1a2a1a' : '#2a2416', color: mes.cerrado ? '#7dff7d' : '#ffcf5c', border: `1px solid ${mes.cerrado ? '#2d5a2d' : '#5a4a2a'}` }}>
                        {mes.cerrado ? '✅ Cerrado' : '⏳ En curso'}
                      </span>
                    </div>
                    {mes.inicio && mes.cierre && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{fmtDdMm(mes.inicio)} al {fmtDdMm(mes.cierre)} · {semanasMes.length} semana{semanasMes.length !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hayExtras ? 'Total del mes' : 'Neto del mes'}</div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--gold)' }}>{fmt(totalMes)}</div>
                    {hayExtras && <div style={{ fontSize: 10, color: 'var(--muted)' }}>sueldos {fmt(totSueldo)}{hayAg ? ` · aguinaldo +${fmt(totAguinaldo)}` : ''}{hayVac ? ` · vacaciones +${fmt(totVac)}` : ''}</div>}
                  </div>
                </div>

                {/* Informe mensual por empleado */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
                    {mes.cerrado ? 'Informe del mes (por empleado)' : 'Acumulado del mes (por empleado)'}
                  </div>
                  <button onClick={() => imprimirInformeMes(mes)}
                    style={{ background: 'transparent', border: '1px solid #7c3aed', color: '#a78bfa', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    🖨️ Imprimir informe
                  </button>
                </div>
                <table>
                  <thead><tr>
                    <th>Empleado</th><th>Horas</th><th>Bruto</th><th>Viáticos</th><th>Adelantos</th><th>Boletas</th>
                    <th>{hayExtras ? 'Sueldo' : 'Neto'}</th>
                    {hayAg && <th>Aguinaldo</th>}
                    {hayVac && <th>Vacaciones</th>}
                    {hayExtras && <th>Total</th>}
                  </tr></thead>
                  <tbody>
                    {informe.map(e => (
                      <tr key={e.nombre}>
                        <td><strong>{e.nombre}</strong></td>
                        <td>{e.horas > 0 ? e.horas + 'h' : '—'}</td>
                        <td style={{ color: '#a78bfa' }}>{fmt(e.bruto)}</td>
                        <td style={{ color: '#22c55e' }}>{e.viaticos > 0 ? '+' + fmt(e.viaticos) : '—'}</td>
                        <td style={{ color: 'var(--red-light)' }}>{e.adelantos > 0 ? '-' + fmt(e.adelantos) : '—'}</td>
                        <td style={{ color: 'var(--red-light)' }}>{e.boletas > 0 ? '-' + fmt(e.boletas) : '—'}</td>
                        <td style={{ color: hayExtras ? 'var(--text)' : 'var(--gold)', fontWeight: 700 }}>{fmt(e.netoSueldo)}</td>
                        {hayAg && <td style={{ color: '#f0abfc' }}>{e.aguinaldo > 0 ? '+' + fmt(e.aguinaldo) : '—'}</td>}
                        {hayVac && <td style={{ color: '#7dd3fc' }}>{e.vacaciones > 0 ? '+' + fmt(e.vacaciones) : '—'}</td>}
                        {hayExtras && <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(e.neto)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td><strong>TOTAL</strong></td>
                      <td><strong>{totHoras > 0 ? totHoras + 'h' : '—'}</strong></td>
                      <td style={{ color: '#a78bfa', fontWeight: 700 }}>{fmt(totBruto)}</td>
                      <td colSpan={3}></td>
                      <td style={{ color: hayExtras ? 'var(--text)' : 'var(--gold)', fontWeight: 700, fontFamily: hayExtras ? undefined : "'Bebas Neue',cursive", fontSize: hayExtras ? undefined : 18 }}>{fmt(totSueldo)}</td>
                      {hayAg && <td style={{ color: '#f0abfc', fontWeight: 700 }}>+{fmt(totAguinaldo)}</td>}
                      {hayVac && <td style={{ color: '#7dd3fc', fontWeight: 700 }}>+{fmt(totVac)}</td>}
                      {hayExtras && <td style={{ color: 'var(--gold)', fontWeight: 700, fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(totalMes)}</td>}
                    </tr>
                  </tfoot>
                </table>

                {/* Editor de aguinaldo / vacaciones del mes */}
                <button onClick={() => setExtrasAbiertos(s => ({ ...s, [mes.key]: !extrasOpen }))}
                  style={{ marginTop: 14, marginRight: 8, background: extrasOpen ? '#7c3aed' : 'none', border: '1px solid #7c3aed', color: extrasOpen ? '#fff' : '#a78bfa', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                  {extrasOpen ? '▲ Cerrar aguinaldo / vacaciones' : '🎁 Cargar aguinaldo / vacaciones'}
                </button>

                {extrasOpen && (
                  <div style={{ marginTop: 12, border: '1px solid #7c3aed', borderRadius: 10, padding: 14, background: 'var(--surface2)' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                      Aguinaldo = 50% del bruto del mes · Vacaciones (Comercio) = sueldo mensual ÷ 25 × días corridos (14 = 2 semanas, hasta 5 años). Los montos son editables.
                    </div>
                    {empleados.map(emp => {
                      const nombre = `${emp.apellido}, ${emp.nombre}`
                      const brutoMes = mes.liqs.filter(l => l.empleado_nombre === nombre).reduce((s, l) => s + (Number(l.bruto) || 0), 0)
                      const brutoRef = brutoMaxPorEmp[nombre] || brutoMes
                      const key = `${mes.key}_${emp.id}`
                      const agSaved = conceptosMes.find(c => c.empleado_id === emp.id && c.tipo === 'aguinaldo')
                      const vacSaved = conceptosMes.find(c => c.empleado_id === emp.id && c.tipo === 'vacaciones')
                      const ed = extraEdit[key] || {
                        aguinaldo: agSaved ? String(Number(agSaved.monto)) : '',
                        vacDias: vacSaved?.dias ? String(vacSaved.dias) : '',
                        vacMonto: vacSaved ? String(Number(vacSaved.monto)) : '',
                      }
                      const setEd = patch => setExtraEdit(s => ({ ...s, [key]: { ...ed, ...patch } }))
                      const aguinaldoSugerido = Math.round(brutoMes * 0.5)
                      const vacDiasNum = parseInt(ed.vacDias) || 14
                      const vacSugerido = Math.round((brutoRef / 25) * vacDiasNum)
                      const dirty = extraEdit[key] !== undefined
                      return (
                        <div key={emp.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 2fr auto', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{emp.apellido}, {emp.nombre}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>bruto mes {fmt(brutoMes)} · ref {fmt(brutoRef)}</div>
                          </div>
                          {/* Aguinaldo */}
                          <div>
                            <label style={{ fontSize: 10, color: '#f0abfc', display: 'block', marginBottom: 2 }}>Aguinaldo ($)</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input style={{ ...inp, padding: '5px 8px', fontSize: 13 }} type="number" placeholder="0" value={ed.aguinaldo} onChange={e => setEd({ aguinaldo: e.target.value })} />
                              <button title={`50% de ${fmt(brutoMes)}`} onClick={() => setEd({ aguinaldo: String(aguinaldoSugerido) })} disabled={brutoMes <= 0}
                                style={{ padding: '0 8px', background: 'transparent', border: '1px solid #f0abfc', color: '#f0abfc', borderRadius: 6, cursor: brutoMes > 0 ? 'pointer' : 'not-allowed', fontSize: 11, whiteSpace: 'nowrap', opacity: brutoMes > 0 ? 1 : 0.4 }}>50%</button>
                            </div>
                          </div>
                          {/* Vacaciones */}
                          <div>
                            <label style={{ fontSize: 10, color: '#7dd3fc', display: 'block', marginBottom: 2 }}>Vacaciones — días + monto ($)</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input style={{ ...inp, padding: '5px 8px', fontSize: 13, width: 60 }} type="number" placeholder="días" value={ed.vacDias} onChange={e => setEd({ vacDias: e.target.value })} />
                              <input style={{ ...inp, padding: '5px 8px', fontSize: 13 }} type="number" placeholder="0" value={ed.vacMonto} onChange={e => setEd({ vacMonto: e.target.value })} />
                              <button title={`${vacDiasNum} días × (${fmt(brutoRef)} ÷ 25)`} onClick={() => setEd({ vacDias: String(vacDiasNum), vacMonto: String(vacSugerido) })} disabled={brutoRef <= 0}
                                style={{ padding: '0 8px', background: 'transparent', border: '1px solid #7dd3fc', color: '#7dd3fc', borderRadius: 6, cursor: brutoRef > 0 ? 'pointer' : 'not-allowed', fontSize: 11, whiteSpace: 'nowrap', opacity: brutoRef > 0 ? 1 : 0.4 }}>auto</button>
                            </div>
                          </div>
                          <button onClick={() => guardarExtras(mes.key, emp)} disabled={!dirty || guardandoExtra === key}
                            style={{ padding: '7px 12px', background: dirty ? '#7c3aed' : 'var(--surface)', color: dirty ? '#fff' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: dirty ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {guardandoExtra === key ? '⏳' : '💾'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Detalle semanal (colapsable) */}
                <button onClick={() => setSemanasAbiertas(s => ({ ...s, [mes.key]: !abierto }))}
                  style={{ marginTop: 14, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                  {abierto ? '▲ Ocultar semanas' : `▼ Ver detalle por semana (${semanasMes.length})`}
                </button>

                {abierto && semanasMes.map(semana => {
                  const liqSemana = mes.liqs.filter(l => l.semana_inicio === semana)
                  const totalSemana = liqSemana.reduce((s, l) => s + (Number(l.neto) || 0), 0)
                  return (
                    <div key={semana} style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          Semana {fmtDdMm(semana)} → {fmtDdMm(liqSemana[0]?.semana_fin || semana)}
                        </div>
                        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)' }}>TOTAL: {fmt(totalSemana)}</div>
                      </div>
                      <table>
                        <thead><tr><th>Empleado</th><th>Horas</th><th>Bruto</th><th>Viáticos</th><th>Adelantos</th><th>Boletas</th><th>Neto</th></tr></thead>
                        <tbody>
                          {liqSemana.map(l => (
                            <tr key={l.id}>
                              <td><strong>{l.empleado_nombre}</strong></td>
                              <td>{l.horas > 0 ? l.horas + 'h' : '—'}</td>
                              <td style={{ color: '#a78bfa' }}>{fmt(l.bruto)}</td>
                              <td style={{ color: '#22c55e' }}>{l.viaticos > 0 ? '+' + fmt(l.viaticos) : '—'}</td>
                              <td style={{ color: 'var(--red-light)' }}>{l.adelantos > 0 ? '-' + fmt(l.adelantos) : '—'}</td>
                              <td style={{ color: 'var(--red-light)' }}>{l.boletas > 0 ? '-' + fmt(l.boletas) : '—'}</td>
                              <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(l.neto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {liquidaciones.length === 0 && <div className="card"><p style={{ color: 'var(--muted)', textAlign: 'center' }}>Sin liquidaciones registradas</p></div>}
          <Paginador {...pagMeses.controles} label="meses" />
        </div>
      )}
    </div>
  )
}
