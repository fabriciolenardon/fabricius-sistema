// ============================================================
// POLLO POR CAJONES — stock por variedad (en KG) + historiales
// ============================================================
// El pollo entra por cajón (~20 kg) y sale de dos formas:
//   - cajón entero (mayorista, salidas_deposito tipo='pollo_cajon': kg = cajones)
//   - al kilo (minorista: milanesa, pechuga fresca, etc. tipo='pollo': kg reales)
// Ambas salidas descuentan de SU VARIEDAD (pechuga, pata muslo, pollo, etc.).
// Por eso el stock se muestra en KILOS por variedad: ingresados − egresados.
// Los nombres históricos son inconsistentes → se agrupa por palabra clave de
// la variedad; lo que no matchea cae en "Otros".
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { fmtPrecio, fmtKg } from '../../lib/formatos'

const KG_POR_CAJON = 20
const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))
const fFecha = f => {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(String(f))) return f || '—'
  const [y, m, d] = String(f).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
const norm = s => String(s || '').toUpperCase().normalize('NFD')
  .replace(/×\s*\d+/g, '').replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '')

// Variedades de pollo. ORDEN = prioridad de match (lo más específico primero;
// POLLO último porque es genérico). Cada movimiento se asigna a la primera
// variedad cuya palabra clave esté contenida en el nombre normalizado.
// Las HAMBURGUESAS (de pollo y rellena) salen de la Pechuga B = Suprema, aunque
// el nombre diga "pollo" → regla con prioridad sobre POLLO.
const VARIEDADES = [
  { nombre: '⚙️ MDM (carne mecanizada)', kw: 'MDM' },
  { nombre: '🦅 Alita', kw: 'ALITA' },
  { nombre: '🍗 Pata Muslo', kw: 'PATAMUSLO' },
  { nombre: '🥩 Suprema', kw: 'HAMBURGUESA' }, // hamburguesa de pollo / rellena → pechuga B (suprema)
  { nombre: '🍖 Pechuga c/hueso', kw: 'PECHUGA' }, // milanesa de pechuga, pechuga fresca
  { nombre: '🥩 Suprema', kw: 'SUPREMA' },
  { nombre: '🐔 Pollo entero / fresco', kw: 'POLLO' }, // pollo fresco, arrollado de pollo, cajón pollo
]
function variedadDe(nombre) {
  const k = norm(nombre)
  for (const v of VARIEDADES) if (k.includes(v.kw)) return v.nombre
  return 'Otros / sin clasificar'
}

export default function PolloCajonesTab() {
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [stockKg, setStockKg] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: ent }, { data: sal }, { data: stk }] = await Promise.all([
      supabase.from('entradas_deposito').select('*').eq('tipo', 'pollo')
        .order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('salidas_deposito').select('*').in('tipo', ['pollo', 'pollo_cajon'])
        .order('fecha', { ascending: false }).order('id', { ascending: false }),
      supabase.from('stock_actual').select('kg_disponible').eq('tipo', 'pollo').maybeSingle(),
    ])
    setEntradas(ent || [])
    setSalidas(sal || [])
    setStockKg(Number(stk?.kg_disponible) || 0)
    setLoading(false)
  }

  // Stock por variedad, todo en KG: ingresos − egresos.
  const filas = useMemo(() => {
    const agg = {}
    const get = v => (agg[v] || (agg[v] = { inKg: 0, outKg: 0 }))
    entradas.forEach(e => { get(variedadDe(e.descripcion)).inKg += Number(e.kg) || 0 })
    salidas.forEach(s => {
      const v = get(variedadDe(s.descripcion))
      // cajón entero: kg del registro = cantidad de cajones → × 20 kg
      // al kilo: kg del registro = kilos reales
      v.outKg += s.tipo === 'pollo_cajon' ? (Number(s.kg) || 0) * KG_POR_CAJON : (Number(s.kg) || 0)
    })
    // Orden: variedades del catálogo primero (en su orden, sin duplicar), "Otros" al final
    const orden = [...new Set([...VARIEDADES.map(v => v.nombre), 'Otros / sin clasificar'])]
    return orden.filter(v => agg[v]).map(v => ({
      nombre: v, inKg: agg[v].inKg, outKg: agg[v].outKg, stockKg: agg[v].inKg - agg[v].outKg,
    }))
  }, [entradas, salidas])

  const totIn = filas.reduce((s, r) => s + r.inKg, 0)
  const totOut = filas.reduce((s, r) => s + r.outKg, 0)
  const totStock = filas.reduce((s, r) => s + r.stockKg, 0)

  const pagEnt = usePaginacion(entradas, 12)
  const pagSal = usePaginacion(salidas, 12)

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }
  const th = { textAlign: 'left', padding: '7px 8px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }
  const td = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' }

  if (loading) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>

  return (
    <div>
      {/* Stock por variedad (en KG) */}
      <div style={{ ...card, marginBottom: 16, borderColor: 'var(--gold)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🍗 Stock en vivo por variedad (en kg)</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pollo total (sistema): <strong style={{ color: 'var(--gold)' }}>{fmtKg(stockKg)}</strong></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 520 }}>
            <thead><tr>
              <th style={th}>Variedad</th>
              <th style={{ ...th, textAlign: 'right' }}>Ingresados (kg)</th>
              <th style={{ ...th, textAlign: 'right' }}>Egresados (kg)</th>
              <th style={{ ...th, textAlign: 'right' }}>Stock (kg)</th>
            </tr></thead>
            <tbody>
              {filas.map((r, i) => (
                <tr key={i} style={{ opacity: r.nombre.startsWith('Otros') ? 0.7 : 1 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.nombre}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#7dff7d' }}>{fmtKg(r.inKg)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#ff8b8b' }}>{fmtKg(r.outKg)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: r.stockKg > 0 ? 'var(--gold)' : 'var(--muted)' }}>{fmtKg(r.stockKg)}</td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 18 }}>Sin movimientos de pollo.</td></tr>}
              {filas.length > 0 && (
                <tr style={{ borderTop: '2px solid var(--gold)' }}>
                  <td style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#7dff7d' }}>{fmtKg(totIn)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#ff8b8b' }}>{fmtKg(totOut)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--gold)' }}>{fmtKg(totStock)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
          📌 Stock por variedad = kg ingresados − kg egresados. Las ventas al kg (minorista: milanesa, pechuga fresca, etc.) descuentan de su variedad; los cajones enteros (mayorista) se cuentan a {KG_POR_CAJON} kg c/u. Para registros viejos con nombres distintos puede ser aproximado.
        </div>
      </div>

      {/* Historiales en dos columnas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {/* Entradas */}
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, color: '#7dff7d' }}>📥 Historial de entradas</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead><tr><th style={th}>Fecha</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Kg</th><th style={{ ...th, textAlign: 'right' }}>Importe</th></tr></thead>
              <tbody>
                {pagEnt.items.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fFecha(e.fecha)}</td>
                    <td style={td}>{e.descripcion || '—'}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{e.proveedor_nombre || ''}</div></td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtKg(e.kg)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(e.importe)}</td>
                  </tr>
                ))}
                {entradas.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 18 }}>Sin entradas.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 12px 10px' }}><Paginador {...pagEnt.controles} label="entradas" /></div>
        </div>

        {/* Salidas */}
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, color: '#ff8b8b' }}>📤 Historial de salidas</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead><tr><th style={th}>Fecha</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Kg</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>
                {pagSal.items.map(s => {
                  const esCajon = s.tipo === 'pollo_cajon'
                  const kgEq = esCajon ? (Number(s.kg) || 0) * KG_POR_CAJON : (Number(s.kg) || 0)
                  return (
                    <tr key={s.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fFecha(s.fecha)}</td>
                      <td style={td}>{s.descripcion || (esCajon ? 'Pollo (cajón)' : 'Pollo')}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.cliente_nombre || ''}{esCajon ? ` · ${Number(s.kg) || 0} cajón(es)` : ' · x kg'}</div></td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtKg(kgEq)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(s.total)}</td>
                    </tr>
                  )
                })}
                {salidas.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 18 }}>Sin salidas.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 12px 10px' }}><Paginador {...pagSal.controles} label="salidas" /></div>
        </div>
      </div>
    </div>
  )
}
