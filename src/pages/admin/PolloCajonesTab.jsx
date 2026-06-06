// ============================================================
// POLLO POR CAJONES — stock por cajón (en vivo) + historiales
// ============================================================
// El pollo se compra/vende por cajón (productos pollo_cajon, ~20 kg c/u).
// El stock por cajón se calcula como ENTRADAS − SALIDAS matcheando por
// nombre normalizado (los nombres históricos son inconsistentes, así que
// para registros viejos es aproximado; cargando con el producto del
// desplegable queda exacto).
//   - Entradas: entradas_deposito tipo='pollo' (cantidad = cajones, kg).
//   - Salidas de cajón: salidas_deposito tipo='pollo_cajon' (kg = cajones vendidos).
//   - Salidas al kg (tipo='pollo'): productos derivados (milanesa, pechuga
//     fresca…) — se listan en el historial pero NO descuentan un cajón puntual.
// Abajo: historial de ENTRADAS y de SALIDAS, en dos columnas, paginados.
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { fmtPrecio, fmtKg } from '../../lib/formatos'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))
const fFecha = f => {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(String(f))) return f || '—'
  const [y, m, d] = String(f).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
// Normaliza un nombre para matchear cajón ↔ movimiento: mayúsculas, sin
// acentos, sin "×N", sin "(...)", sin espacios ni símbolos.
const norm = s => String(s || '').toUpperCase().normalize('NFD')
  .replace(/×\s*\d+/g, '').replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '')

export default function PolloCajonesTab() {
  const [catalogo, setCatalogo] = useState([])
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [stockKg, setStockKg] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: cat }, { data: ent }, { data: sal }, { data: stk }] = await Promise.all([
      supabase.from('precios').select('nombre, categoria, kg_por_unidad').eq('categoria', 'pollo_cajon').order('nombre'),
      supabase.from('entradas_deposito').select('*').eq('tipo', 'pollo')
        .order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('salidas_deposito').select('*').in('tipo', ['pollo', 'pollo_cajon'])
        .order('fecha', { ascending: false }).order('id', { ascending: false }),
      supabase.from('stock_actual').select('kg_disponible').eq('tipo', 'pollo').maybeSingle(),
    ])
    setCatalogo(cat || [])
    setEntradas(ent || [])
    setSalidas(sal || [])
    setStockKg(Number(stk?.kg_disponible) || 0)
    setLoading(false)
  }

  // Stock por cajón = Σ entradas (cajones) − Σ salidas de cajón (cajones).
  const filas = useMemo(() => {
    // Acumular entradas por clave normalizada
    const inMap = {}, outMap = {}
    entradas.forEach(e => {
      const k = norm(e.descripcion)
      if (!inMap[k]) inMap[k] = { caj: 0, kg: 0 }
      inMap[k].caj += Number(e.cantidad) || 0
      inMap[k].kg += Number(e.kg) || 0
    })
    salidas.forEach(s => {
      if (s.tipo !== 'pollo_cajon') return // solo cajones enteros descuentan cajón
      const k = norm(s.descripcion)
      if (!outMap[k]) outMap[k] = { caj: 0 }
      outMap[k].caj += Number(s.kg) || 0 // en salidas de cajón, kg = cajones vendidos
    })
    const usados = new Set()
    const rows = (catalogo || []).map(p => {
      const k = norm(p.nombre)
      usados.add(k)
      const kpu = Number(p.kg_por_unidad) || 20
      const inC = inMap[k]?.caj || 0
      const outC = outMap[k]?.caj || 0
      const stockCaj = inC - outC
      return {
        nombre: p.nombre.trim(), kpu,
        inCaj: inC, outCaj: outC,
        stockCaj, stockKg: stockCaj * kpu,
      }
    })
    // "Otros / sin clasificar": entradas cuyo nombre no matchea ningún cajón del catálogo
    let otrosCaj = 0, otrosKg = 0
    Object.entries(inMap).forEach(([k, v]) => { if (!usados.has(k)) { otrosCaj += v.caj; otrosKg += v.kg } })
    if (otrosCaj > 0 || otrosKg > 0) {
      rows.push({ nombre: 'Otros / sin clasificar', kpu: 0, inCaj: otrosCaj, outCaj: 0, stockCaj: otrosCaj, stockKg: otrosKg, otros: true })
    }
    return rows
  }, [catalogo, entradas, salidas])

  const totStockCaj = filas.reduce((s, r) => s + (r.stockCaj > 0 ? r.stockCaj : 0), 0)

  const pagEnt = usePaginacion(entradas, 12)
  const pagSal = usePaginacion(salidas, 12)

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }
  const th = { textAlign: 'left', padding: '7px 8px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }
  const td = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' }

  if (loading) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>

  return (
    <div>
      {/* Stock por cajón (en vivo) */}
      <div style={{ ...card, marginBottom: 16, borderColor: 'var(--gold)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🍗 Stock en vivo por cajón</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pollo total: <strong style={{ color: 'var(--gold)' }}>{fmtKg(stockKg)}</strong> · {totStockCaj} cajones</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 560 }}>
            <thead><tr>
              <th style={th}>Cajón</th>
              <th style={{ ...th, textAlign: 'right' }}>Ingresados</th>
              <th style={{ ...th, textAlign: 'right' }}>Vendidos</th>
              <th style={{ ...th, textAlign: 'right' }}>Stock (cajones)</th>
              <th style={{ ...th, textAlign: 'right' }}>Stock (kg)</th>
            </tr></thead>
            <tbody>
              {filas.map((r, i) => (
                <tr key={i} style={{ opacity: r.otros ? 0.7 : 1 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.nombre}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{r.inCaj}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{r.outCaj || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: r.stockCaj > 0 ? '#7dff7d' : 'var(--muted)' }}>{r.stockCaj}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{r.otros ? fmtKg(r.stockKg) : fmtKg(r.stockKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
          📌 Stock = cajones ingresados − cajones vendidos enteros. Las ventas al kg (milanesa, pechuga fresca, etc.) salen del pollo general y figuran en el historial de salidas. Para registros viejos con nombres distintos puede ser aproximado.
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
              <thead><tr><th style={th}>Fecha</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Kg/Caj</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>
                {pagSal.items.map(s => (
                  <tr key={s.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fFecha(s.fecha)}</td>
                    <td style={td}>{s.descripcion || (s.tipo === 'pollo_cajon' ? 'Pollo (cajón)' : 'Pollo')}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.cliente_nombre || ''}{s.tipo === 'pollo_cajon' ? ' · cajón' : ' · x kg'}</div></td>
                    <td style={{ ...td, textAlign: 'right' }}>{s.tipo === 'pollo_cajon' ? `${Number(s.kg) || 0} caj` : fmtKg(s.kg)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(s.total)}</td>
                  </tr>
                ))}
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
