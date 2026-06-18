// ============================================================
// BALANCE / CIERRE DE EJERCICIO — pestaña de Facturación
// ============================================================
// Arma el balance anual de una cuenta (pensado para FABRICIUS SAS):
//   - Estado de Resultados: Ventas/Compras netas salen solas de las
//     facturas del período; gastos, existencias e impuesto a las
//     ganancias se cargan a mano.
//   - Estado de Situación Patrimonial: Activo / Pasivo / Patrimonio
//     Neto cargados a mano, con la existencia final y el resultado del
//     ejercicio enganchados automáticamente, y chequeo de cuadre.
//   - Cerrar ejercicio: congela un snapshot inmutable y abre el siguiente.
//   - Exportar PDF estilo contador.
// ============================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtPrecio, fmtNumero, parseNumero } from '../../lib/formatos'
import {
  SECCIONES_ER, SECCIONES_ESP, RUBROS_DEFAULT,
  rubrosDefaultParaEjercicio, computeBalance,
} from '../../lib/balance'
import { exportarBalancePdf } from '../../lib/balancePdf'

const fmt$ = n => fmtPrecio(Number(n) || 0)
const fmtFecha = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-AR') : '—'
// Suma un año y resta un día a una fecha ISO (yyyy-mm-dd) sin líos de TZ.
function masUnAnoMenosUnDia(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y + 1, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  return dt.toISOString().slice(0, 10)
}
// Suma N días a una fecha ISO (yyyy-mm-dd).
function sumarDias(iso, n) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
// Primer día del año fiscal julio→junio vigente (el que cierra el 30/06 actual).
function inicioFiscalActual() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  return `${m >= 7 ? y : y - 1}-07-01`
}

const inp = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif",
  fontSize: 14, width: '100%', boxSizing: 'border-box',
}
const card = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 18, marginBottom: 16,
}

// Input de monto: mantiene lo que el usuario tipea (sin reformatear mientras
// escribe) y avisa el número parseado en vivo para los totales.
function MontoInput({ value, onChange, disabled, style }) {
  const fmtIn = v => (Number(v) ? fmtNumero(Number(v), 2) : '')
  const [txt, setTxt] = useState(() => fmtIn(value))
  const [foco, setFoco] = useState(false)
  useEffect(() => { if (!foco) setTxt(fmtIn(value)) }, [value, foco])  // eslint-disable-line
  return (
    <input
      inputMode="decimal" disabled={disabled}
      value={txt}
      onFocus={() => setFoco(true)}
      onChange={e => { setTxt(e.target.value); onChange(parseNumero(e.target.value)) }}
      onBlur={() => { setFoco(false); setTxt(fmtIn(value)) }}
      style={{ ...inp, textAlign: 'right', ...style, ...(disabled ? { opacity: .6 } : {}) }}
      placeholder="0,00"
    />
  )
}

// Una fila editable rubro + monto + borrar.
function LineaRow({ linea, onRubro, onMonto, onDelete, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <input
        value={linea.rubro} disabled={disabled}
        onChange={e => onRubro(e.target.value)}
        style={{ ...inp, flex: 1, fontSize: 13 }}
      />
      <div style={{ width: 160 }}>
        <MontoInput value={linea.monto} onChange={onMonto} disabled={disabled} />
      </div>
      {!disabled && (
        <button onClick={onDelete} title="Quitar rubro"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, width: 24 }}>×</button>
      )}
    </div>
  )
}

// Bloque de una sección (gastos, activo_corriente, etc.) con sus líneas + total.
function Seccion({ titulo, estado, seccion, lineas, total, disabled, onChange, anclas }) {
  const propias = lineas.filter(l => l.estado === estado && l.seccion === seccion)
  const set = next => onChange(estado, seccion, next)
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>{titulo}</div>
      {propias.map((l, i) => (
        <LineaRow
          key={l.id || l._tmp} linea={l} disabled={disabled}
          onRubro={v => set(propias.map((x, j) => j === i ? { ...x, rubro: v } : x))}
          onMonto={v => set(propias.map((x, j) => j === i ? { ...x, monto: v } : x))}
          onDelete={() => set(propias.filter((_, j) => j !== i))}
        />
      ))}
      {/* renglones "ancla" no editables (existencia final, resultado del ejercicio) */}
      {(anclas || []).map((a, i) => (
        <div key={'a' + i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, opacity: .85 }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>{a.rubro} <span style={{ fontSize: 11 }}>(automático)</span></div>
          <div style={{ width: 160, textAlign: 'right', paddingRight: 34, fontSize: 13, fontWeight: 600 }}>{fmt$(a.monto)}</div>
        </div>
      ))}
      {!disabled && (
        <button
          onClick={() => set([...propias, { _tmp: 'n' + Date.now() + Math.random(), estado, seccion, rubro: '', monto: 0 }])}
          style={{ background: 'transparent', border: '1px dashed var(--border)', color: 'var(--muted)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, marginTop: 2 }}>
          + Agregar rubro
        </button>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
        <span>Total {titulo}</span><span>{fmt$(total)}</span>
      </div>
    </div>
  )
}

// Fila de resumen del Estado de Resultados.
function ResRow({ label, valor, fuerte, chico, indent, signo }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: indent ? '3px 0 3px 16px' : '4px 0',
      fontWeight: fuerte ? 700 : 400, fontSize: fuerte ? 14 : 13,
      color: chico ? 'var(--muted)' : 'var(--text)',
    }}>
      <span>{label}</span>
      <span>{signo === '-' && Number(valor) ? '(' + fmt$(valor).replace('-', '') + ')' : fmt$(valor)}</span>
    </div>
  )
}

export default function TabBalance({ cuentas }) {
  const candidatas = useMemo(
    () => (cuentas || []).filter(c => c.activa !== false),
    [cuentas]
  )
  const defaultCuenta = useMemo(() => {
    const sas = candidatas.find(c => ['sas', 'responsable_inscripto'].includes(c.tipo)) || candidatas[0]
    return sas?.id || null
  }, [candidatas])

  const [cuentaId, setCuentaId] = useState(defaultCuenta)
  useEffect(() => { if (!cuentaId && defaultCuenta) setCuentaId(defaultCuenta) }, [defaultCuenta]) // eslint-disable-line

  const [ejercicios, setEjercicios] = useState([])
  const [ejId, setEjId] = useState(null)
  const [ej, setEj] = useState(null)          // ejercicio seleccionado (editable)
  const [lineas, setLineas] = useState([])
  const [auto, setAuto] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const cuenta = candidatas.find(c => c.id === cuentaId) || null

  const cargarEjercicios = useCallback(async (cid, preferEjId) => {
    if (!cid) return
    setLoading(true)
    const { data } = await supabase.from('ejercicios').select('*').eq('cuenta_id', cid).order('numero', { ascending: true })
    const list = data || []
    setEjercicios(list)
    const pick = preferEjId
      ? list.find(e => e.id === preferEjId)
      : (list.find(e => e.estado === 'abierto') || list[list.length - 1])
    setEjId(pick?.id || null)
    setLoading(false)
  }, [])

  useEffect(() => { if (cuentaId) cargarEjercicios(cuentaId) }, [cuentaId, cargarEjercicios])

  // Cargar el ejercicio seleccionado (sus líneas + totales automáticos)
  useEffect(() => {
    if (!ejId) { setEj(null); setLineas([]); setAuto(null); return }
    let cancel = false
    ;(async () => {
      setLoading(true)
      const ejRow = ejercicios.find(e => e.id === ejId)
      if (!ejRow) { setLoading(false); return }
      const [{ data: ls }, { data: a }] = await Promise.all([
        supabase.from('ejercicio_lineas').select('*').eq('ejercicio_id', ejId).order('orden', { ascending: true }),
        supabase.rpc('ejercicio_resultados_auto', { p_cuenta: ejRow.cuenta_id, p_desde: ejRow.fecha_inicio, p_hasta: ejRow.fecha_cierre }),
      ])
      if (cancel) return
      setEj({ ...ejRow })
      setLineas((ls || []).map(l => ({ ...l, monto: Number(l.monto) || 0 })))
      setAuto(a || {})
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [ejId, ejercicios])

  const cerrado = ej?.estado === 'cerrado'
  // Para un ejercicio cerrado, render desde el snapshot congelado.
  const snap = cerrado ? ej?.snapshot : null
  const calc = useMemo(() => {
    if (cerrado && snap?.calc) return snap.calc
    return computeBalance(ej, lineas, auto)
  }, [ej, lineas, auto, cerrado, snap])
  const lineasView = cerrado && snap?.lineas ? snap.lineas : lineas

  // ── edición de secciones ──
  function onSeccionChange(estado, seccion, nuevas) {
    setLineas(prev => [
      ...prev.filter(l => !(l.estado === estado && l.seccion === seccion)),
      ...nuevas.map(n => ({ ...n, estado, seccion })),
    ])
  }
  const setEjCampo = (campo, val) => setEj(p => ({ ...p, [campo]: val }))

  // ── guardar (columnas del ejercicio + reemplazo de líneas) ──
  async function guardar(silent) {
    if (!ej || cerrado) return
    setSaving(true); setMsg('')
    try {
      const { error: e1 } = await supabase.from('ejercicios').update({
        existencia_inicial: Number(ej.existencia_inicial) || 0,
        existencia_final: Number(ej.existencia_final) || 0,
        impuesto_ganancias: Number(ej.impuesto_ganancias) || 0,
        notas: ej.notas || null,
        updated_at: new Date().toISOString(),
      }).eq('id', ej.id)
      if (e1) throw e1
      // reemplazar líneas: borrar todas e insertar el estado local
      const { error: e2 } = await supabase.from('ejercicio_lineas').delete().eq('ejercicio_id', ej.id)
      if (e2) throw e2
      const payload = lineas.map((l, i) => ({
        ejercicio_id: ej.id, estado: l.estado, seccion: l.seccion,
        rubro: l.rubro || '—', monto: Number(l.monto) || 0, orden: i,
      }))
      if (payload.length) {
        const { error: e3 } = await supabase.from('ejercicio_lineas').insert(payload)
        if (e3) throw e3
      }
      if (!silent) setMsg('✓ Guardado')
    } catch (err) {
      setMsg('Error al guardar: ' + (err.message || err))
    } finally {
      setSaving(false)
      if (!silent) setTimeout(() => setMsg(''), 2500)
    }
  }

  // ── cerrar ejercicio ──
  async function cerrar() {
    if (!ej) return
    const c = computeBalance(ej, lineas, auto)
    const aviso = c.cuadra
      ? `Vas a CERRAR el ${ej.denominacion}.\n\nResultado del ejercicio: ${fmt$(c.resultadoEjercicio)}\n\nEsto congela el balance (no se podrá editar) y abre el ejercicio siguiente. ¿Confirmás?`
      : `⚠ EL BALANCE NO CUADRA.\nDiferencia Activo − (Pasivo + PN): ${fmt$(c.diferencia)}\n\nUn balance debería cuadrar en 0. Podés cerrar igual, pero revisá los datos.\n\n¿Cerrar de todas formas?`
    if (!window.confirm(aviso)) return
    setSaving(true); setMsg('')
    try {
      await guardar(true)  // persistir el estado actual antes de congelar
      const snapshot = {
        cuenta: { id: cuenta.id, nombre: cuenta.nombre, razon_social: cuenta.razon_social, cuit: cuenta.cuit, tipo: cuenta.tipo },
        ejercicio: { numero: ej.numero, denominacion: ej.denominacion, fecha_inicio: ej.fecha_inicio, fecha_cierre: ej.fecha_cierre,
          existencia_inicial: Number(ej.existencia_inicial) || 0, existencia_final: Number(ej.existencia_final) || 0, impuesto_ganancias: Number(ej.impuesto_ganancias) || 0 },
        auto, lineas: lineas.map((l, i) => ({ estado: l.estado, seccion: l.seccion, rubro: l.rubro, monto: Number(l.monto) || 0, orden: i })),
        calc: c,
        generado_at: new Date().toISOString(),
      }
      const { data, error } = await supabase.rpc('cerrar_ejercicio', {
        p_ejercicio_id: ej.id, p_snapshot: snapshot,
        p_resultado: c.resultadoEjercicio, p_activo: c.totalActivo, p_pasivo: c.totalPasivo, p_pn: c.totalPN,
      })
      if (error) throw error
      // Sembrar el catálogo estándar en el ejercicio nuevo + arrastrar resultados no asignados
      const nuevoId = data?.nuevo_ejercicio_id
      if (nuevoId) {
        const priorNoAsig = lineas
          .filter(l => l.seccion === 'patrimonio_neto' && /no asignad/i.test(l.rubro))
          .reduce((a, l) => a + (Number(l.monto) || 0), 0)
        const carry = priorNoAsig + c.resultadoEjercicio
        const seed = rubrosDefaultParaEjercicio(nuevoId).map(s =>
          (s.seccion === 'patrimonio_neto' && /no asignad/i.test(s.rubro)) ? { ...s, monto: carry } : s
        )
        await supabase.from('ejercicio_lineas').insert(seed)
      }
      setMsg('✓ Ejercicio cerrado. Se abrió el siguiente.')
      await cargarEjercicios(cuentaId, ej.id)  // recargar; el cerrado queda visible
    } catch (err) {
      setMsg('Error al cerrar: ' + (err.message || err))
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ── eliminar ejercicio (solo abierto) ──
  async function eliminarEjercicio() {
    if (!ej || cerrado) return
    const tieneDatos = lineas.some(l => Number(l.monto) !== 0) ||
      Number(ej.existencia_inicial) || Number(ej.existencia_final) || Number(ej.impuesto_ganancias)
    const aviso = tieneDatos
      ? `Vas a ELIMINAR "${ej.denominacion}" y todo lo cargado en él.\n\nEsto NO se puede deshacer. ¿Seguro?`
      : `¿Eliminar "${ej.denominacion}"? Está vacío.`
    if (!window.confirm(aviso)) return
    setSaving(true); setMsg('')
    try {
      // el filtro estado='abierto' es una red extra: nunca borra un ejercicio cerrado
      const { error } = await supabase.from('ejercicios').delete().eq('id', ej.id).eq('estado', 'abierto')
      if (error) throw error
      setEjId(null); setEj(null)
      await cargarEjercicios(cuentaId)
      setMsg('✓ Ejercicio eliminado')
    } catch (err) {
      setMsg('Error al eliminar: ' + (err.message || err))
    } finally {
      setSaving(false); setTimeout(() => setMsg(''), 3000)
    }
  }

  async function exportarPdf() {
    try {
      await exportarBalancePdf({
        cuenta: cerrado ? snap.cuenta : cuenta,
        ejercicio: ej,
        calc,
        lineas: lineasView,
      })
    } catch (err) { setMsg('Error al exportar PDF: ' + (err.message || err)) }
  }

  // ── crear primer ejercicio ──
  const [nuevo, setNuevo] = useState(null)  // { fecha_inicio, fecha_cierre, denominacion }
  function abrirNuevo() {
    const ordenados = [...ejercicios].sort((a, b) => a.numero - b.numero)
    const ultimo = ordenados[ordenados.length - 1]
    const next = ultimo ? ultimo.numero + 1 : 1
    // Primer ejercicio → año fiscal jul→jun vigente; siguientes → día después del último cierre.
    const inicioDefault = ultimo ? sumarDias(ultimo.fecha_cierre, 1) : inicioFiscalActual()
    setNuevo({
      numero: next,
      fecha_inicio: inicioDefault,
      fecha_cierre: masUnAnoMenosUnDia(inicioDefault),
      denominacion: `Ejercicio Económico N° ${next}`,
    })
  }
  async function crearEjercicio() {
    if (!nuevo || !cuentaId) return
    setSaving(true); setMsg('')
    try {
      const { data, error } = await supabase.from('ejercicios').insert({
        cuenta_id: cuentaId, numero: nuevo.numero, denominacion: nuevo.denominacion,
        fecha_inicio: nuevo.fecha_inicio, fecha_cierre: nuevo.fecha_cierre, estado: 'abierto',
      }).select().single()
      if (error) throw error
      await supabase.from('ejercicio_lineas').insert(rubrosDefaultParaEjercicio(data.id))
      setNuevo(null)
      await cargarEjercicios(cuentaId, data.id)
      setMsg('✓ Ejercicio creado')
    } catch (err) {
      setMsg('Error: ' + (err.message || err))
    } finally { setSaving(false); setTimeout(() => setMsg(''), 3000) }
  }

  // ============================================================
  // Render
  // ============================================================
  const ventasNetas = cerrado ? snap.calc.ventasNetas : (auto?.ventas_netas || 0)
  const comprasNetas = cerrado ? snap.calc.comprasNetas : (auto?.compras_netas || 0)

  return (
    <div>
      {/* Selector de cuenta + ejercicio */}
      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Cuenta</div>
          <select value={cuentaId || ''} onChange={e => setCuentaId(Number(e.target.value))} style={{ ...inp, width: 280 }}>
            {candidatas.map(c => (
              <option key={c.id} value={c.id}>{c.nombre?.trim()} {['sas', 'responsable_inscripto'].includes(c.tipo) ? '🏢' : ''}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Ejercicio</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {ejercicios.map(e => (
              <button key={e.id} onClick={() => setEjId(e.id)}
                style={{
                  padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                  background: e.id === ejId ? 'var(--gold)' : 'var(--surface)', color: e.id === ejId ? '#000' : 'var(--text)',
                  fontSize: 12, fontWeight: 700,
                }}>
                N° {e.numero} {e.estado === 'cerrado' ? '🔒' : '✏️'}
              </button>
            ))}
            {!cerrado && (
              <button onClick={abrirNuevo}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
        </div>
      </div>

      {msg && <div style={{ ...card, padding: 12, color: msg.startsWith('Error') ? '#e66' : 'var(--gold)' }}>{msg}</div>}

      {/* Formulario crear ejercicio */}
      {nuevo && (
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Crear ejercicio</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Denominación</div>
              <input value={nuevo.denominacion} onChange={e => setNuevo({ ...nuevo, denominacion: e.target.value })} style={{ ...inp, width: 260 }} /></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Inicio</div>
              <input type="date" value={nuevo.fecha_inicio}
                onChange={e => setNuevo({ ...nuevo, fecha_inicio: e.target.value, fecha_cierre: masUnAnoMenosUnDia(e.target.value) })} style={{ ...inp, width: 160 }} /></div>
            <div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Cierre</div>
              <input type="date" value={nuevo.fecha_cierre} onChange={e => setNuevo({ ...nuevo, fecha_cierre: e.target.value })} style={{ ...inp, width: 160 }} /></div>
            <button onClick={crearEjercicio} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 700, cursor: 'pointer' }}>Crear</button>
            <button onClick={() => setNuevo(null)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando…</p>}

      {!loading && !ej && !nuevo && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>
          Esta cuenta todavía no tiene ejercicios. Tocá <b>+ Nuevo</b> para crear el primero.
        </div>
      )}

      {!loading && ej && (
        <>
          {/* Encabezado del ejercicio */}
          <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{ej.denominacion} {cerrado && <span style={{ fontSize: 12, color: 'var(--muted)' }}>🔒 CERRADO</span>}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtFecha(ej.fecha_inicio)} → {fmtFecha(ej.fecha_cierre)} · {cuenta?.razon_social?.trim() || cuenta?.nombre?.trim()} · CUIT {cuenta?.cuit}</div>
              {cerrado && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Cerrado el {fmtFecha(ej.cerrado_at)}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={exportarPdf} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 700, cursor: 'pointer' }}>📄 Exportar PDF</button>
              {!cerrado && <button onClick={() => guardar(false)} disabled={saving} style={{ padding: '9px 16px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer' }}>{saving ? '…' : '💾 Guardar'}</button>}
              {!cerrado && <button onClick={cerrar} disabled={saving} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer' }}>🔒 Cerrar ejercicio</button>}
              {!cerrado && <button onClick={eliminarEjercicio} disabled={saving} title="Eliminar este ejercicio" style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(200,60,60,.5)', background: 'transparent', color: '#c84040', fontWeight: 700, cursor: 'pointer' }}>🗑 Eliminar</button>}
            </div>
          </div>

          {/* Cuadre */}
          <div style={{
            ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderColor: calc.cuadra ? 'rgba(40,160,80,.5)' : 'rgba(200,60,60,.6)',
            background: calc.cuadra ? 'rgba(40,160,80,.07)' : 'rgba(200,60,60,.07)',
          }}>
            <div>
              <span style={{ fontWeight: 800, fontSize: 15 }}>{calc.cuadra ? '✓ El balance cuadra' : '⚠ El balance NO cuadra'}</span>
              {!calc.cuadra && <span style={{ marginLeft: 12, color: 'var(--muted)' }}>Diferencia Activo − (Pasivo + PN): <b>{fmt$(calc.diferencia)}</b></span>}
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, color: calc.resultadoEjercicio >= 0 ? '#3a9d52' : '#c84040' }}>
              Resultado del ejercicio: {fmt$(calc.resultadoEjercicio)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
            {/* ================= ESTADO DE RESULTADOS ================= */}
            <div style={card}>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12, color: 'var(--gold)' }}>📈 Estado de Resultados</div>

              <ResRow label="Ventas netas (sin IVA)" valor={ventasNetas} fuerte />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, marginTop: -2 }}>
                Automático de {cerrado ? snap?.auto?.ventas_cant : auto?.ventas_cant || 0} facturas emitidas
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Costo de mercadería vendida</div>
              <div style={{ paddingLeft: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Existencia inicial</span>
                  <div style={{ width: 160 }}><MontoInput value={ej.existencia_inicial} disabled={cerrado} onChange={v => setEjCampo('existencia_inicial', v)} /></div>
                </div>
                <ResRow label="(+) Compras netas" valor={comprasNetas} indent chico />
                <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 16, marginTop: -2 }}>
                  Automático de {cerrado ? snap?.auto?.compras_cant : auto?.compras_cant || 0} facturas recibidas
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>(−) Existencia final</span>
                  <div style={{ width: 160 }}><MontoInput value={ej.existencia_final} disabled={cerrado} onChange={v => setEjCampo('existencia_final', v)} /></div>
                </div>
                <ResRow label="= Costo de mercadería vendida" valor={calc.cmv} indent />
              </div>

              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
              <ResRow label="Resultado bruto" valor={calc.resultadoBruto} fuerte />

              <div style={{ marginTop: 10 }}>
                <Seccion titulo={SECCIONES_ER.gastos} estado="resultados" seccion="gastos"
                  lineas={lineasView} total={calc.gastos} disabled={cerrado} onChange={onSeccionChange} />
              </div>

              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
              <ResRow label="Resultado antes de impuesto a las ganancias" valor={calc.resultadoAntesImp} fuerte />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0', paddingLeft: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>(−) Impuesto a las ganancias</span>
                <div style={{ width: 160 }}><MontoInput value={ej.impuesto_ganancias} disabled={cerrado} onChange={v => setEjCampo('impuesto_ganancias', v)} /></div>
              </div>

              <div style={{ borderTop: '2px solid var(--gold)', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, color: calc.resultadoEjercicio >= 0 ? '#3a9d52' : '#c84040' }}>
                <span>RESULTADO DEL EJERCICIO</span><span>{fmt$(calc.resultadoEjercicio)}</span>
              </div>
            </div>

            {/* ================= ESTADO DE SITUACIÓN PATRIMONIAL ================= */}
            <div style={card}>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12, color: 'var(--gold)' }}>🏦 Estado de Situación Patrimonial</div>

              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', margin: '4px 0 8px' }}>ACTIVO</div>
              <Seccion titulo={SECCIONES_ESP.activo_corriente} estado="patrimonial" seccion="activo_corriente"
                lineas={lineasView} total={calc.activoCorriente} disabled={cerrado} onChange={onSeccionChange}
                anclas={[{ rubro: 'Bienes de cambio (existencia final)', monto: calc.bienesCambio }]} />
              <Seccion titulo={SECCIONES_ESP.activo_no_corriente} estado="patrimonial" seccion="activo_no_corriente"
                lineas={lineasView} total={calc.activoNoCorriente} disabled={cerrado} onChange={onSeccionChange} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, borderTop: '2px solid var(--border)', paddingTop: 8 }}>
                <span>TOTAL ACTIVO</span><span>{fmt$(calc.totalActivo)}</span>
              </div>

              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', margin: '16px 0 8px' }}>PASIVO</div>
              <Seccion titulo={SECCIONES_ESP.pasivo_corriente} estado="patrimonial" seccion="pasivo_corriente"
                lineas={lineasView} total={calc.pasivoCorriente} disabled={cerrado} onChange={onSeccionChange} />
              <Seccion titulo={SECCIONES_ESP.pasivo_no_corriente} estado="patrimonial" seccion="pasivo_no_corriente"
                lineas={lineasView} total={calc.pasivoNoCorriente} disabled={cerrado} onChange={onSeccionChange} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, borderTop: '2px solid var(--border)', paddingTop: 8 }}>
                <span>TOTAL PASIVO</span><span>{fmt$(calc.totalPasivo)}</span>
              </div>

              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', margin: '16px 0 8px' }}>PATRIMONIO NETO</div>
              <Seccion titulo={SECCIONES_ESP.patrimonio_neto} estado="patrimonial" seccion="patrimonio_neto"
                lineas={lineasView} total={calc.pnManual + calc.resultadoEjercicio} disabled={cerrado} onChange={onSeccionChange}
                anclas={[{ rubro: 'Resultado del ejercicio', monto: calc.resultadoEjercicio }]} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, borderTop: '2px solid var(--border)', paddingTop: 8 }}>
                <span>TOTAL PASIVO + PATRIMONIO NETO</span><span>{fmt$(calc.totalPasivo + calc.totalPN)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
