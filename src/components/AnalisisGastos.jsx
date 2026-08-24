// ============================================================
// AnalisisGastos.jsx — pestaña "💰 Costos y Precios" de Productividad (Dirección).
// ============================================================
// Tres preguntas, tres bloques:
//   1) ¿A dónde se va la plata?  → cascada Facturación → Ganancia
//   2) ¿Cuánto se llevó CADA gasto? → % sobre facturación y sobre la
//      estructura, más $/día y $/kg vendido
//   3) ¿Qué precio tiene que tener un producto? → calculadora que
//      le carga al costo la estructura real del negocio
//
// Los totales salen de calcularEstructura() (lib/analisisGastos.js),
// que arma el período con la MISMA lógica del Cierre.
// ============================================================
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { fechaHoyARG } from '../lib/fechas'
import { fmtPrecio, fmtKg, parseNumero } from '../lib/formatos'
import { useEsMovil } from '../lib/useEsMovil'
import { lunesDeLaSemana } from '../lib/cierreAuto'
import { calcularEstructura, precioSugerido, rentabilidadDe, promediosDeListas, mermaDeProducto, mermasCargadas } from '../lib/analisisGastos'
import { CATEGORIAS_SISTEMA } from '../lib/categoriasPrecios'

const $ = n => fmtPrecio(Math.abs(Number(n) || 0))
// Los % se muestran con coma (es-AR) y "—" cuando no se pueden calcular
// (facturación en 0, o período sin ganancia: dividir por ≤0 no dice nada).
const pctTxt = (p, dec = 1) => (p == null || !isFinite(p) ? '—' : `${p.toFixed(dec).replace('.', ',')}%`)

function fmtFechaCorta(f) {
  if (!f) return '—'
  const [, m, d] = String(f).substring(0, 10).split('-')
  return `${d}/${m}`
}

// `gastos` es opcional: si la pantalla que lo monta ya los tiene cargados
// (Gastos), los pasa y evitamos la consulta; si no (Productividad), los
// trae la pantalla. Paginado — un año de gastos pasa las 1000 filas.
export default function AnalisisGastos({ gastos: gastosProp }) {
  const esMovil = useEsMovil()
  const [mesesOp, setMesesOp] = useState([])
  const [gastosPropios, setGastosPropios] = useState(null)
  const [modo, setModo] = useState('mesop')   // mesop | mesophist | mes | mesant | semana | rango
  const [mesOpId, setMesOpId] = useState('')  // mes operativo elegido en "Meses anteriores"
  const [rango, setRango] = useState({ desde: '', hasta: fechaHoyARG() })
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState(null) // categoría expandida en la tabla
  const [precios, setPrecios] = useState([])
  // Comisiones y rentabilidad viven acá arriba porque los usan los DOS
  // bloques de abajo: el promedio de cada lista y la calculadora. Si cada
  // uno tuviera los suyos, dirían cosas distintas en la misma pantalla.
  const [comis, setComis] = useState('3')
  const [rent, setRent] = useState('15')
  // Merma por producto: la MISMA config que usa el desposte
  // (Depósito → Merma por producto). La calculadora la lee para
  // autocompletar el % — no se carga una merma aparte acá.
  const [mermaConfig, setMermaConfig] = useState(null)

  const gastos = gastosProp || gastosPropios

  useEffect(() => {
    supabase.from('meses_operativos').select('id,mes,etiqueta,fecha_inicio,fecha_cierre')
      .order('fecha_inicio', { ascending: false })
      .then(({ data }) => setMesesOp(data || []))
    if (!gastosProp) {
      fetchAllRows(() => supabase.from('gastos').select('*').order('fecha', { ascending: false }))
        .then(({ data }) => setGastosPropios(data || []))
        .catch(() => setGastosPropios([]))
    }
    fetchAllRows(() => supabase.from('precios')
      .select('id, nombre, categoria, pesable, kg_por_unidad, precio_minorista, precio_mayorista, precio_carniceria')
      .order('nombre'))
      .then(({ data }) => setPrecios(data || []))
      .catch(() => setPrecios([]))
    supabase.from('config_sistema').select('valor').eq('clave', 'merma_conversion').maybeSingle()
      .then(({ data }) => setMermaConfig(data?.valor || null))
  }, [gastosProp])

  // Los meses operativos ya cerrados (el vigente ya tiene su propio botón).
  // Vienen ordenados por fecha_inicio desc, así que el primero es el último cerrado.
  const mesesOpCerrados = useMemo(
    () => mesesOp.filter(m => m.fecha_cierre && m.fecha_cierre < fechaHoyARG()),
    [mesesOp])

  // Apenas llegan los meses, dejamos preseleccionado el último cerrado.
  useEffect(() => {
    if (!mesOpId && mesesOpCerrados.length) setMesOpId(String(mesesOpCerrados[0].id))
  }, [mesesOpCerrados, mesOpId])

  // Rango efectivo según el modo elegido
  const periodo = useMemo(() => {
    const hoy = fechaHoyARG()
    if (modo === 'rango') return { desde: rango.desde || hoy.slice(0, 8) + '01', hasta: rango.hasta || hoy }
    if (modo === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
    if (modo === 'semana') return { desde: lunesDeLaSemana(), hasta: hoy }
    if (modo === 'mesant') {
      const d = new Date(hoy + 'T12:00'); d.setDate(1); d.setMonth(d.getMonth() - 1)
      const ini = fechaHoyARG(d)
      const fin = new Date(d); fin.setMonth(fin.getMonth() + 1); fin.setDate(0)
      return { desde: ini, hasta: fechaHoyARG(fin) }
    }
    if (modo === 'mesophist') {
      // Mes operativo elegido a mano: las fechas salen del inicio/cierre
      // cargados en Cierre → Por Mes. Si todavía está en curso, cortamos hoy
      // (un período que termina en el futuro daría $/día y $/kg diluidos).
      const m = mesesOp.find(x => String(x.id) === String(mesOpId)) || mesesOpCerrados[0]
      if (!m) return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
      // Un mes que todavía no arrancó se muestra entero: cortarlo en "hoy"
      // daría desde > hasta y la consulta volvería vacía sin decir por qué.
      if (hoy < m.fecha_inicio) return { desde: m.fecha_inicio, hasta: m.fecha_cierre, etiqueta: m.etiqueta }
      return { desde: m.fecha_inicio, hasta: hoy < m.fecha_cierre ? hoy : m.fecha_cierre, etiqueta: m.etiqueta }
    }
    // mes operativo vigente (o el último cargado); si no hay ninguno, mes calendario
    const vig = mesesOp.find(m => hoy >= m.fecha_inicio && hoy <= m.fecha_cierre) || mesesOp[0]
    if (!vig) return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
    return { desde: vig.fecha_inicio, hasta: hoy < vig.fecha_cierre ? hoy : vig.fecha_cierre, etiqueta: vig.etiqueta }
  }, [modo, rango, mesesOp, mesOpId, mesesOpCerrados])

  useEffect(() => {
    // Sin los gastos todavía cargados no calculamos: los totales saldrían
    // bien igual (los trae el cierre) pero el detalle por concepto quedaría
    // vacío por un instante, que es peor que esperar.
    if (!gastos) return
    let vivo = true
    setCargando(true); setError('')
    calcularEstructura(periodo.desde, periodo.hasta, gastos)
      .then(r => { if (vivo) { setData(r); setCargando(false) } })
      .catch(e => { if (vivo) { setError(e.message || 'No se pudo calcular'); setCargando(false) } })
    return () => { vivo = false }
  }, [periodo.desde, periodo.hasta, gastos])

  const btn = activo => ({
    padding: '7px 14px', borderRadius: 8,
    border: `2px solid ${activo ? 'var(--gold)' : 'var(--border)'}`,
    background: activo ? 'var(--gold)' : 'transparent',
    color: activo ? '#000' : 'var(--muted)',
    cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 12,
  })
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13 }

  return (
    <div>
      {/* ── Selector de período ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'mesop', l: '📅 Mes operativo' },
            ...(mesesOpCerrados.length ? [{ id: 'mesophist', l: '🗓️ Meses anteriores' }] : []),
            { id: 'mes', l: 'Mes calendario' },
            { id: 'mesant', l: 'Mes anterior' },
            { id: 'semana', l: 'Esta semana' },
            { id: 'rango', l: 'Rango…' },
          ].map(o => (
            <button key={o.id} style={btn(modo === o.id)} onClick={() => setModo(o.id)}>{o.l}</button>
          ))}
          {modo === 'mesophist' && (
            <select style={inp} value={mesOpId} onChange={e => setMesOpId(e.target.value)}>
              {mesesOpCerrados.map(m => (
                <option key={m.id} value={m.id}>
                  {m.etiqueta || m.mes} ({fmtFechaCorta(m.fecha_inicio)} → {fmtFechaCorta(m.fecha_cierre)})
                </option>
              ))}
            </select>
          )}
          {modo === 'rango' && (
            <>
              <input type="date" style={inp} value={rango.desde} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))} />
              <span style={{ color: 'var(--muted)' }}>→</span>
              <input type="date" style={inp} value={rango.hasta} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))} />
            </>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          {fmtFechaCorta(periodo.desde)} → {fmtFechaCorta(periodo.hasta)}
          {periodo.etiqueta ? ` · ${periodo.etiqueta}` : ''}
          {data ? ` · ${data.periodo.dias} día${data.periodo.dias !== 1 ? 's' : ''}` : ''}
        </div>
      </div>

      {cargando && <div className="empty" style={{ padding: 40 }}>⏳ Calculando la estructura del período…</div>}
      {!!error && <div className="empty" style={{ padding: 40, color: 'var(--red-light)' }}>❌ {error}</div>}

      {!cargando && !error && data && (
        <>
          <Cascada d={data} esMovil={esMovil} />
          <Coeficientes d={data} />
          <TablaGastos d={data} abierta={abierta} setAbierta={setAbierta} esMovil={esMovil} />
          <PromedioListas d={data} precios={precios} esMovil={esMovil} comis={comis} rent={rent} />
          <Calculadora d={data} precios={precios} esMovil={esMovil} mermaConfig={mermaConfig}
            comis={comis} setComis={setComis} rent={rent} setRent={setRent} />
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 1) CASCADA — de la facturación a la ganancia
// ────────────────────────────────────────────────────────────
function Cascada({ d, esMovil }) {
  const filas = [
    { l: '💵 FACTURACIÓN', v: d.facturacion, tipo: 'total', sub: `Mostrador ${$(d.ventas.minorista)} · Mayorista ${$(d.ventas.mayorista)}` },
    { l: '🥩 Mercadería (compras)', v: -d.mercaderia, tipo: 'resta' },
    { l: 'MARGEN BRUTO', v: d.margenBruto, tipo: 'sub' },
    { l: '👷 Sueldos', v: -d.sueldos, tipo: 'resta' },
    { l: '📌 Gastos fijos', v: -d.fijos, tipo: 'resta' },
    { l: '💸 Gastos variables', v: -d.variables, tipo: 'resta' },
    { l: 'RESULTADO OPERATIVO', v: d.resultadoOperativo, tipo: 'sub' },
    { l: '👤 Retiros de socios', v: -d.socios, tipo: 'resta' },
    { l: '🏆 GANANCIA', v: d.ganancia, tipo: 'total' },
  ]
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">💵 A dónde se fue cada peso facturado</div>
      <div style={{ display: 'grid', gap: 2 }}>
        {filas.map((f, i) => {
          const p = d.facturacion > 0 ? (Math.abs(f.v) / d.facturacion) * 100 : 0
          const esTotal = f.tipo === 'total', esSub = f.tipo === 'sub'
          const color = f.v < 0 ? 'var(--red-light)' : esTotal || esSub ? 'var(--green)' : 'var(--text)'
          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: esMovil ? '1fr auto' : '1fr 140px 70px',
              gap: 8, alignItems: 'center',
              padding: '8px 10px', borderRadius: 8,
              background: esTotal ? 'var(--surface)' : esSub ? 'rgba(255,255,255,0.03)' : 'transparent',
              borderTop: esSub || esTotal ? '1px solid var(--border)' : 'none',
            }}>
              <div>
                <div style={{ fontWeight: esTotal || esSub ? 800 : 600, fontSize: esTotal ? 14 : 13 }}>{f.l}</div>
                {f.sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{f.sub}</div>}
                {!esMovil && (
                  <div style={{ height: 4, borderRadius: 4, marginTop: 4, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: color, opacity: 0.7 }} />
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontWeight: esTotal || esSub ? 800 : 600, color, fontSize: esTotal ? 16 : 14, whiteSpace: 'nowrap' }}>
                {f.v < 0 ? '−' : ''}{$(f.v)}
              </div>
              {!esMovil && (
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{pctTxt(p)}</div>
              )}
            </div>
          )
        })}
      </div>
      {d.ganancia <= 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gold)' }}>
          ⚠️ El período no cerró con ganancia. Ojo: en períodos cortos la compra de una
          media res puede caer adentro y la venta afuera.
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 2) COEFICIENTES — los números que se usan para poner precios
// ────────────────────────────────────────────────────────────
function Coeficientes({ d }) {
  const c = d.coef
  const cards = [
    { l: 'Carga estructural', v: pctTxt(c.cargaPct), sub: 'de cada $100 vendidos se van en sueldos + fijos + variables', color: 'var(--gold)' },
    { l: 'Margen bruto', v: pctTxt(c.margenBrutoPct), sub: 'lo que queda después de pagar la mercadería', color: 'var(--blue)' },
    { l: 'Ganancia neta', v: pctTxt(c.gananciaPct), sub: 'sobre la facturación del período', color: d.ganancia >= 0 ? 'var(--green)' : 'var(--red-light)' },
    { l: 'Estructura por día', v: $(c.estructuraPorDia), sub: 'lo que cuesta abrir la persiana cada día' },
    { l: 'Estructura por kg vendido', v: c.estructuraPorKg != null ? $(c.estructuraPorKg) : '—', sub: d.kgVendidos > 0 ? `${d.kgVendidos.toFixed(0)} kg vendidos en el período` : 'sin kg vendidos cargados' },
    { l: 'Punto de equilibrio', v: c.puntoEquilibrio != null ? $(c.puntoEquilibrio) : '—', sub: c.puntoEquilibrioDia != null ? `hay que facturar ${$(c.puntoEquilibrioDia)} por día para no perder` : 'sin margen bruto no hay equilibrio', color: 'var(--gold)' },
  ]
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">🎯 Los números para poner precios</div>
      <div className="grid3">
        {cards.map((k, i) => (
          <div className="stat" key={i}>
            <div className="stat-label">{k.l}</div>
            <div className="stat-value" style={{ fontSize: 22, color: k.color || 'var(--text)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>{k.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 3) TABLA — cuánto se llevó cada gasto
// ────────────────────────────────────────────────────────────
function TablaGastos({ d, abierta, setAbierta, esMovil }) {
  const th = { padding: '7px 8px', textAlign: 'right', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }
  const Fila = ({ f, hijo, onClick }) => (
    <tr onClick={onClick} style={{ borderTop: '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default', background: hijo ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
      <td style={{ padding: '7px 8px', paddingLeft: hijo ? 26 : 8, fontWeight: hijo ? 500 : 700, fontSize: hijo ? 11 : 12 }}>
        {f.label}{hijo && f.veces > 1 ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ×{f.veces}</span> : null}
      </td>
      <td style={{ ...td, fontWeight: hijo ? 500 : 700 }}>{$(f.monto)}</td>
      <td style={{ ...td, color: 'var(--gold)' }}>{pctTxt(f.pctFacturacion, 2)}</td>
      {!esMovil && <td style={{ ...td, color: 'var(--muted)' }}>{pctTxt(f.pctEstructura)}</td>}
      {!esMovil && <td style={{ ...td, color: 'var(--muted)' }}>{$(f.porDia)}</td>}
      {!esMovil && <td style={{ ...td, color: 'var(--muted)' }}>{f.porKg != null ? $(f.porKg) : '—'}</td>}
    </tr>
  )

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">🧾 Cuánto se llevó cada gasto</div>
      {/* Acá había un "% de tu ganancia" (cuánto crecería la ganancia si el
          gasto no existiera). Se sacó por pedido de Fabricio: la ganancia es
          un resto chico contra la facturación, así que cualquier gasto normal
          daba porcentajes enormes —la mercadería marcaba 974,3%— que no
          hablan del gasto sino de lo flaco que quedó el resto. Las dos
          lecturas que quedan sí tienen una base estable: la facturación y el
          total de la estructura. */}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        Tocá una categoría para abrir el detalle (luz, internet, alquiler… uno por uno).
        <b> % facturación</b> = de cada peso que entra. <b>% de la estructura</b> = qué parte
        de todo lo que gastás es este gasto.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Concepto</th>
              <th style={th}>$ del período</th>
              <th style={th}>% facturación</th>
              {!esMovil && <th style={th}>% de la estructura</th>}
              {!esMovil && <th style={th}>$ por día</th>}
              {!esMovil && <th style={th}>$ por kg</th>}
            </tr>
          </thead>
          <tbody>
            {/* Bloques grandes primero (mercadería, sueldos, fijos, variables, socios) */}
            {d.bloques.map(b => <Fila key={b.clave} f={b} />)}
            <tr><td colSpan={esMovil ? 3 : 6} style={{ padding: '12px 8px 4px', color: 'var(--muted)', fontSize: 11, fontWeight: 700 }}>DETALLE POR CATEGORÍA</td></tr>
            {d.lineas.map(l => {
              const k = l.tipo + '|' + l.categoria
              const open = abierta === k
              return (
                <Fragment key={k}>
                  <Fila
                    f={{ ...l, label: `${open ? '▾' : '▸'} ${l.label}` }}
                    onClick={() => setAbierta(open ? null : k)} />
                  {open && l.conceptos.map((c, i) => <Fila key={k + i} f={c} hijo />)}
                </Fragment>
              )
            })}
            {d.lineas.length === 0 && (
              <tr><td colSpan={esMovil ? 3 : 6} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>Sin gastos cargados en este período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 4) PROMEDIO DEL KILO EN CADA LISTA
// ────────────────────────────────────────────────────────────
// El protagonista es la TABLA POR CATEGORÍA: bovino cortes, cerdo cortes,
// embutidos, pollo por kilo, pollo por cajón… cada una con su promedio en
// cada lista. Un promedio que mezcla todas las categorías no sirve para
// decidir nada: junta el pollo por cajón a $3.800 con los embutidos a
// $21.000 y da un número que no es el precio de nada.
//
// Al pie, el promedio de cada LISTA mirada como lista: la suma del precio
// por kilo de todos sus artículos dividida la cantidad de artículos. No
// entran los kilos despachados ni la plata facturada — es cómo está parada
// la lista, no lo que se cobró.
function PromedioListas({ d, precios, esMovil, comis, rent }) {
  const listas = useMemo(() => promediosDeListas(precios, d.vendidoPorCategoria), [precios, d])

  // Lo que puede costarte el kilo de esa categoría para que, después de la
  // estructura y las comisiones, quede la rentabilidad buscada.
  const libre = 1 - (d.coef.cargaPct + parseNumero(comis) + parseNumero(rent)) / 100

  const etiquetaCat = c => CATEGORIAS_SISTEMA.find(x => x.clave === c)?.label || c

  const filas = useMemo(() => {
    const m = new Map()
    for (const l of listas) {
      for (const c of l.categorias) {
        const row = m.get(c.categoria) || { categoria: c.categoria, kg: 0, productos: 0 }
        row.kg += c.kg || 0
        row.productos = Math.max(row.productos, c.productos || 0)
        row[l.codigo] = c.promedio
        m.set(c.categoria, row)
      }
    }
    // Cobrado real de la categoría: plata facturada ÷ kilos que salieron,
    // sin importar por qué lista salió. Es el único sin supuestos.
    for (const v of d.vendidoPorCategoria || []) {
      const row = m.get(v.categoria)
      if (row && v.realPorKg != null) row.realTotal = v.realPorKg
    }
    return [...m.values()].sort((a, b) => b.kg - a.kg)
  }, [listas, d])

  if (!precios.length) return null

  const th = { padding: '6px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">📋 Promedio del kilo por categoría, en cada lista</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Cada categoría con su propio promedio: el de la lista sale de los precios cargados,
        el <b>cobrado real</b> sale de la plata facturada dividida los kilos que salieron
        (ahí ya están adentro el mix, las ofertas y los descuentos).
        El <b>costo máximo</b> es hasta cuánto podés pagar ese kilo para que, después de la
        estructura ({pctTxt(d.coef.cargaPct)}) y las comisiones ({pctTxt(parseNumero(comis))}),
        te quede {pctTxt(parseNumero(rent))} limpio.
        Solo entran los productos que se venden por kilo; los bultos se dividen por los kilos que traen.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--muted)' }}>
              <th style={{ ...th, textAlign: 'left' }}>Categoría</th>
              {!esMovil && <th style={th}>Artículos</th>}
              {!esMovil && <th style={th}>Kg vendidos</th>}
              <th style={th}>🟢 Minorista</th>
              <th style={th}>🟡 Mayorista</th>
              <th style={th}>🔴 Carnicería</th>
              <th style={th}>Cobrado real</th>
              {!esMovil && <th style={th}>Costo máx. por kg</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 8px', fontWeight: 600 }}>{etiquetaCat(f.categoria)}</td>
                {!esMovil && <td style={{ ...td, color: 'var(--muted)' }}>{f.productos || '—'}</td>}
                {!esMovil && <td style={{ ...td, color: 'var(--muted)' }}>{f.kg > 0 ? fmtKg(f.kg, { decimales: 0 }) : '—'}</td>}
                <td style={td}>{f.min != null ? $(f.min) : '—'}</td>
                <td style={td}>{f.may != null ? $(f.may) : '—'}</td>
                <td style={td}>{f.carn != null ? $(f.carn) : '—'}</td>
                <td style={{ ...td, color: 'var(--green)', fontWeight: 700 }}>{f.realTotal != null ? $(f.realTotal) : '—'}</td>
                {!esMovil && (
                  <td style={{ ...td, color: 'var(--gold)' }}>
                    {f.realTotal != null && libre > 0 ? $(f.realTotal * libre) : '—'}
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td colSpan={esMovil ? 5 : 8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                Sin categorías con precio cargado.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pie: el promedio de la LISTA, solo con sus precios. No entran los
          kilos despachados ni la plata facturada: es la suma del precio por
          kilo de todos los artículos dividida la cantidad de artículos. */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
          Promedio del kilo de cada lista — suma del precio por kilo de todos los artículos ÷ cantidad de artículos:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(3, 1fr)', gap: 10 }}>
          {listas.map(l => (
            <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '8px 12px', background: 'var(--surface)', borderRadius: 8 }}>
              <span style={{ fontSize: 12 }}>{l.label}</span>
              <span style={{ textAlign: 'right' }}>
                <b style={{ fontSize: 15, color: l.simple != null ? 'var(--green)' : 'var(--muted)' }}>
                  {l.simple != null ? $(l.simple) : '—'}
                </b>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {l.productos > 0 ? `${l.productos} artículos` : 'sin precios cargados'}
                </div>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 5) CALCULADORA — cuánto tiene que salir el kilo de UN producto
// ────────────────────────────────────────────────────────────
// Se arranca eligiendo el producto: el que quieras, sea o no el que
// acabás de comprar. El costo lo ponés a mano (es lo que te salió ESA
// compra) y la merma se completa sola con la que ya tenés cargada en
// Depósito → Merma por producto — la misma que usa el desposte, no una
// aparte. Encima van la carga estructural del negocio, las comisiones e
// impuestos y la rentabilidad que buscás, y sale el precio de ese
// producto en particular, comparado contra lo que hoy cobrás en cada lista.
function Calculadora({ d, precios, esMovil, mermaConfig, comis, setComis, rent, setRent }) {
  const [prodId, setProdId] = useState('')
  const [costo, setCosto] = useState('')
  const [merma, setMerma] = useState('0')
  const [mermaFuente, setMermaFuente] = useState('')
  // Cómo se vende ESA compra. La misma pieza no rinde igual según qué le
  // hagas: si el cortito se desposta hay 27% de merma, pero si se revende
  // entero salen los mismos kilos que entraron y no hay merma ninguna.
  const [modoVenta, setModoVenta] = useState('cortes')   // cortes | entero
  const [mermaCargada, setMermaCargada] = useState(null) // {pct, fuente} del producto
  const [carga, setCarga] = useState(String((d.coef.cargaPct || 0).toFixed(1)).replace('.', ','))
  const [incluirSocios, setIncluirSocios] = useState(false)

  // Al cambiar el período (o el interruptor de socios) recalculamos la carga
  // sugerida. Queda editable: es un punto de partida, no una imposición.
  const cargaReal = useMemo(() => {
    const base = d.estructura + (incluirSocios ? d.socios : 0)
    return d.facturacion > 0 ? (base / d.facturacion) * 100 : 0
  }, [d, incluirSocios])
  useEffect(() => { setCarga(cargaReal.toFixed(1).replace('.', ',')) }, [cargaReal])

  const prod = precios.find(p => String(p.id) === prodId) || null

  // Elegir el producto completa la merma con la que YA está cargada. Queda
  // editable: una compra puntual puede rendir distinto que la tabla.
  useEffect(() => {
    const p = precios.find(x => String(x.id) === prodId)
    setModoVenta('cortes')
    if (!p) { setMermaCargada(null); setMermaFuente(''); return }
    const m = mermaDeProducto(p, mermaConfig)
    setMermaCargada(m)
    if (m) {
      setMerma(String(m.pct).replace('.', ','))
      setMermaFuente(m.fuente)
    } else {
      setMerma('0')
      setMermaFuente('sin merma cargada para este producto — elegí una de abajo o ponela a mano')
    }
  }, [prodId, precios, mermaConfig])

  // El interruptor "lo desposto / lo revendo entero". Revenderlo entero no
  // es merma 0 por descuido: es que salen los mismos kilos que entraron.
  const elegirModo = modo => {
    setModoVenta(modo)
    if (modo === 'entero') {
      setMerma('0')
      setMermaFuente('lo revendés entero: salen los mismos kilos que entraron, no hay merma')
    } else if (mermaCargada) {
      setMerma(String(mermaCargada.pct).replace('.', ','))
      setMermaFuente(mermaCargada.fuente)
    }
  }

  // Las mermas cargadas, para ponerlas de un click aunque no haya producto elegido.
  const chips = useMemo(() => mermasCargadas(mermaConfig), [mermaConfig])

  // El selector agrupado por categoría, con la carne primero (es lo que se
  // costea todos los días) y el resto en el orden del catálogo.
  const grupos = useMemo(() => {
    const orden = CATEGORIAS_SISTEMA.map(c => c.clave)
    const m = new Map()
    for (const p of precios) {
      const k = p.categoria || 'otros'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(p)
    }
    const idx = k => { const i = orden.indexOf(k); return i < 0 ? 99 : i }
    return [...m.entries()]
      .sort((a, b) => idx(a[0]) - idx(b[0]))
      .map(([clave, items]) => ({
        clave,
        label: CATEGORIAS_SISTEMA.find(c => c.clave === clave)?.label || clave,
        items,
      }))
  }, [precios])

  // Los bultos (cajones) tienen el precio por bulto: la cuenta va por kilo.
  const kgPorUnidad = Number(prod?.kg_por_unidad) || 0
  const aKg = v => (kgPorUnidad > 0 ? v / kgPorUnidad : v)

  const r = precioSugerido({
    costoKg: parseNumero(costo),
    mermaPct: parseNumero(merma),
    cargaPct: parseNumero(carga),
    comisionesPct: parseNumero(comis),
    rentabilidadPct: parseNumero(rent),
  })

  // Lo que deja HOY cada lista para ese producto, con el mismo costo y la
  // misma merma. Las tres juntas: el mismo kilo no rinde igual en cada una.
  const LISTAS_CMP = [
    { campo: 'precio_minorista', label: '🟢 Minorista' },
    { campo: 'precio_mayorista', label: '🟡 Mayorista' },
    { campo: 'precio_carniceria', label: '🔴 Carnicería' },
  ]
  const comparacion = prod ? LISTAS_CMP.map(l => {
    const precioKg = aKg(Number(prod[l.campo]) || 0)
    return {
      ...l,
      precioKg,
      res: precioKg > 0 ? rentabilidadDe({
        precio: precioKg,
        costoKg: parseNumero(costo),
        mermaPct: parseNumero(merma),
        cargaPct: parseNumero(carga),
        comisionesPct: parseNumero(comis),
      }) : null,
    }
  }) : []

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '9px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const campo = (l, v, set, ayuda, sufijo) => (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{l}</label>
      <div style={{ position: 'relative' }}>
        <input style={inp} value={v} onChange={e => set(e.target.value)} inputMode="decimal" />
        {sufijo && <span style={{ position: 'absolute', right: 10, top: 9, color: 'var(--muted)', fontSize: 13 }}>{sufijo}</span>}
      </div>
      {ayuda && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, lineHeight: 1.3 }}>{ayuda}</div>}
    </div>
  )
  const th = { padding: '6px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--muted)' }
  const td = { padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div className="card">
      <div className="card-title">🧮 Cuánto tiene que salir el kilo</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Elegí el producto, poné lo que te costó <b>esa</b> compra y, si es una pieza o una media res,
        la merma sale sola de la que tenés cargada en <b>Depósito → Merma por producto</b> (para el
        resto la elegís de un click ahí abajo). Encima se le carga la estructura real
        del negocio ({pctTxt(cargaReal)} de todo lo que vendés) más las comisiones. La cuenta
        <b> divide, no suma</b>: para que después de pagar todo quede tu rentabilidad, el precio es
        <i> costo ÷ (1 − estructura − comisiones − rentabilidad)</i>. Multiplicar el costo por 1,40 para
        "ganar 40%" deja mucho menos de lo que parece.
      </div>

      {/* El producto manda: define la merma que se autocompleta y contra qué
          precios se compara el resultado. El costo va suelto — es el de la
          compra de hoy, no tiene por qué ser el del producto elegido. */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
          ¿A qué producto le sacás la cuenta?
        </label>
        <select style={{ ...inp, maxWidth: esMovil ? '100%' : 460 }} value={prodId} onChange={e => setProdId(e.target.value)}>
          <option value="">— elegí un producto (o dejalo suelto y cargá la merma a mano) —</option>
          {grupos.map(g => (
            <optgroup key={g.clave} label={g.label}>
              {g.items.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </optgroup>
          ))}
        </select>
        {kgPorUnidad > 0 && (
          <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 4 }}>
            Se vende por bulto de {fmtKg(kgPorUnidad, { decimales: 0 })} — toda la cuenta va por kilo.
          </div>
        )}
      </div>

      {/* La misma pieza son dos negocios distintos. Despostarla tiene la merma
          cargada; revenderla entera no tiene ninguna, porque salen los mismos
          kilos que entraron. Sin esto había que acordarse de poner 0 a mano. */}
      {prod && mermaCargada && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>
            ¿Qué hacés con esta compra?
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'cortes', l: '🔪 La convierto a cortes', sub: `merma ${pctTxt(mermaCargada.pct)}` },
              { id: 'entero', l: '📦 La revendo entera', sub: 'sin merma: salen los kilos que entraron' },
            ].map(o => {
              const activo = modoVenta === o.id
              return (
                <button key={o.id} type="button" onClick={() => elegirModo(o.id)}
                  style={{
                    textAlign: 'left', padding: '7px 14px', borderRadius: 10, cursor: 'pointer',
                    fontFamily: "'DM Sans',sans-serif",
                    border: `2px solid ${activo ? 'var(--gold)' : 'var(--border)'}`,
                    background: activo ? 'var(--gold)' : 'var(--surface)',
                    color: activo ? '#000' : 'var(--muted)',
                  }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{o.l}</div>
                  <div style={{ fontSize: 10, opacity: 0.8 }}>{o.sub}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(5, 1fr)', gap: 12, marginBottom: 10 }}>
        {campo('Costo de compra por kg', costo, setCosto, 'lo que te sale el kilo al proveedor', '$')}
        {campo('Merma / rendimiento', merma, setMerma,
          mermaFuente || 'hueso, grasa, goteo: % que se pierde', '%')}
        {campo('Carga estructural', carga, setCarga, `sugerido por tus números: ${pctTxt(cargaReal)}`, '%')}
        {campo('Comisiones e impuestos', comis, setComis, 'posnet, tarjetas, IIBB, impuesto al cheque', '%')}
        {campo('Rentabilidad buscada', rent, setRent, 'lo que querés que quede limpio', '%')}
      </div>

      {/* Las mermas que ya están cargadas, a un click. */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>Mermas cargadas:</span>
          {chips.map(c => (
            <button key={c.label} type="button" title={c.detalle}
              onClick={() => { setModoVenta('cortes'); setMerma(String(c.pct).replace('.', ',')); setMermaFuente(`${c.label}: ${c.detalle}`) }}
              style={{
                padding: '3px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 10,
                fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)',
              }}>
              {c.label} {pctTxt(c.pct, 1)}
            </button>
          ))}
        </div>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)', marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={incluirSocios} onChange={e => setIncluirSocios(e.target.checked)} />
        Cargarle también los retiros de socios ({pctTxt(d.facturacion > 0 ? (d.socios / d.facturacion) * 100 : null)} de la facturación)
        <span style={{ fontSize: 10 }}>— por defecto no: el retiro sale de la ganancia, no es costo del producto</span>
      </label>

      {r.error && <div style={{ color: 'var(--red-light)', fontSize: 12, marginBottom: 10 }}>⚠️ {r.error}</div>}

      {r.precio != null && parseNumero(costo) > 0 && (
        <>
          {prod && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <b style={{ color: 'var(--gold)' }}>{prod.nombre}</b>
              <span style={{ color: 'var(--muted)' }}>
                {' '}— costo {$(parseNumero(costo))}/kg, merma {pctTxt(parseNumero(merma))}
                {mermaCargada ? (modoVenta === 'entero' ? ' · se revende entero' : ' · se convierte a cortes') : ''}
              </span>
            </div>
          )}
          <div className="grid4" style={{ marginBottom: 14 }}>
            <div className="stat">
              <div className="stat-label">Costo real por kg vendible</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{$(r.costoReal)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {parseNumero(merma) > 0 ? 'compra + merma' : 'sin merma: es el costo de compra'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Precio de venta sugerido</div>
              <div className="stat-value" style={{ fontSize: 26, color: 'var(--gold)' }}>{$(r.precio)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>por kg, final al público</div>
            </div>
            <div className="stat">
              <div className="stat-label">Multiplicador sobre el costo</div>
              <div className="stat-value" style={{ fontSize: 20 }}>×{(r.multiplicador || 0).toFixed(2).replace('.', ',')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>el "por cuánto multiplico" real</div>
            </div>
            <div className="stat">
              <div className="stat-label">Te queda limpio</div>
              <div className="stat-value" style={{ fontSize: 20, color: 'var(--green)' }}>{$(r.reparto.ganancia)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>por cada kg vendido</div>
            </div>
          </div>

          {/* Reparto de cada peso del precio */}
          <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--muted)' }}>Cómo se reparte ese precio:</div>
          <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 8 }}>
            {[
              { l: 'Mercadería', v: r.reparto.mercaderia, c: '#7a4a2a' },
              { l: 'Estructura', v: r.reparto.estructura, c: 'var(--gold)' },
              { l: 'Comisiones', v: r.reparto.comisiones, c: 'var(--blue)' },
              { l: 'Ganancia', v: r.reparto.ganancia, c: 'var(--green)' },
            ].map((s, i) => {
              const p = (s.v / r.precio) * 100
              return (
                <div key={i} title={`${s.l}: ${$(s.v)} (${pctTxt(p)})`}
                  style={{ width: `${Math.max(0, p)}%`, background: s.c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#000', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {p > 10 ? `${s.l} ${pctTxt(p, 0)}` : ''}
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
            Mercadería {$(r.reparto.mercaderia)} · Estructura {$(r.reparto.estructura)} ·
            Comisiones {$(r.reparto.comisiones)} · Ganancia {$(r.reparto.ganancia)}
          </div>

          {/* Contra lo que hoy cobrás por ese producto, en las tres listas */}
          {prod && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                Lo que <b>{prod.nombre}</b> te deja hoy en cada lista, con este costo y esta merma:
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>Lista</th>
                      <th style={th}>Precio hoy por kg</th>
                      <th style={th}>Te queda limpio</th>
                      {!esMovil && <th style={th}>% del precio</th>}
                      <th style={th}>Contra el sugerido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparacion.map(c => (
                      <tr key={c.campo} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 8px', fontWeight: 600 }}>{c.label}</td>
                        <td style={td}>{c.precioKg > 0 ? $(c.precioKg) : '—'}</td>
                        <td style={{ ...td, fontWeight: 700, color: c.res ? (c.res.ganancia >= 0 ? 'var(--green)' : 'var(--red-light)') : 'var(--muted)' }}>
                          {c.res ? `${c.res.ganancia < 0 ? '−' : ''}${$(c.res.ganancia)}` : '—'}
                        </td>
                        {!esMovil && (
                          <td style={{ ...td, color: 'var(--muted)' }}>
                            {c.res ? pctTxt(c.res.gananciaPct) : '—'}
                          </td>
                        )}
                        <td style={{ ...td, color: c.precioKg >= r.precio ? 'var(--green)' : 'var(--gold)' }}>
                          {c.precioKg > 0
                            ? `${c.precioKg >= r.precio ? '+' : '−'}${$(c.precioKg - r.precio)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                En verde estás por encima del piso que te deja tu rentabilidad; en dorado te falta para llegar.
              </div>
            </div>
          )}
        </>
      )}

      {!(parseNumero(costo) > 0) && (
        <div className="empty" style={{ padding: 24, fontSize: 13 }}>
          Cargá el costo de compra por kg para ver el precio sugerido.
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <b>Sobre el IVA:</b> si comprás con factura A, el IVA que pagás es crédito fiscal y se descuenta
        del que cobrás — no es costo del producto, es plata que pasa por el medio. El IVA sí es costo
        cuando comprás sin factura o a monotributista y después vendés con IVA. Por eso la calculadora
        trabaja con importes NETOS y deja las comisiones/IIBB aparte.
      </div>
    </div>
  )
}
