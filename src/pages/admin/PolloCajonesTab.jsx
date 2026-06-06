// ============================================================
// POLLO POR CAJONES — stock en vivo + historial de entradas/salidas
// ============================================================
// El pollo se compra y vende por cajón, pero el stock se lleva en KG en
// el bucket genérico `stock_actual.tipo='pollo'` (cada cajón descuenta
// cajones × kg_por_cajón). Esta pestaña muestra:
//   - Stock en vivo (kg disponibles de pollo) — refleja TODO (caja, remito, etc.)
//   - Historial de ENTRADAS (compras de pollo, entradas_deposito tipo='pollo')
//   - Historial de SALIDAS (ventas por cajón/kg, salidas_deposito pollo/pollo_cajon)
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { fmtPrecio, fmtKg } from '../../lib/formatos'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))
// fecha DATE 'YYYY-MM-DD' → 'DD/MM/YYYY' (sin depender de TZ del navegador)
const fFecha = f => {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(String(f))) return f || '—'
  const [y, m, d] = String(f).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export default function PolloCajonesTab() {
  const [stockKg, setStockKg] = useState(0)
  const [entradas, setEntradas] = useState([])
  const [salidas, setSalidas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: stk }, { data: ent }, { data: sal }] = await Promise.all([
      supabase.from('stock_actual').select('kg_disponible').eq('tipo', 'pollo').maybeSingle(),
      supabase.from('entradas_deposito').select('*').eq('tipo', 'pollo')
        .order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('salidas_deposito').select('*').in('tipo', ['pollo', 'pollo_cajon'])
        .order('fecha', { ascending: false }).order('id', { ascending: false }),
    ])
    setStockKg(Number(stk?.kg_disponible) || 0)
    setEntradas(ent || [])
    setSalidas(sal || [])
    setLoading(false)
  }

  const totEntradas = useMemo(() => ({
    kg: entradas.reduce((s, e) => s + (Number(e.kg) || 0), 0),
    importe: entradas.reduce((s, e) => s + (Number(e.importe) || 0), 0),
  }), [entradas])
  const totSalidas = useMemo(() => ({
    kg: salidas.reduce((s, e) => s + (Number(e.kg) || 0), 0),
    total: salidas.reduce((s, e) => s + (Number(e.total) || 0), 0),
  }), [salidas])

  const pagEnt = usePaginacion(entradas, 20)
  const pagSal = usePaginacion(salidas, 20)

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
  const th = { textAlign: 'left', padding: '8px 8px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }
  const td = { padding: '7px 8px', fontSize: 12, borderTop: '1px solid var(--border)' }

  if (loading) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>

  return (
    <div>
      {/* Stock en vivo */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ ...card, flex: 1, minWidth: 220, borderColor: 'var(--gold)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>🍗 STOCK EN VIVO — POLLO</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--gold)' }}>{fmtKg(stockKg)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>kg disponibles · se vende por cajón</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>📥 ENTRADAS (TOTAL)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#7dff7d' }}>{fmtKg(totEntradas.kg)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{entradas.length} compras · {fmt$(totEntradas.importe)}</div>
        </div>
        <div style={{ ...card, flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>📤 SALIDAS (TOTAL)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#ff8b8b' }}>{fmtKg(totSalidas.kg)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{salidas.length} salidas · {fmt$(totSalidas.total)}</div>
        </div>
      </div>

      {/* Historial de entradas */}
      <div style={{ ...card, padding: 0, marginBottom: 16 }}>
        <div style={{ padding: '12px 14px', fontWeight: 700, fontSize: 13 }}>📥 Historial de entradas (compras de pollo)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640 }}>
            <thead><tr><th style={th}>Fecha</th><th style={th}>Proveedor</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Kg</th><th style={{ ...th, textAlign: 'right' }}>Precio/kg</th><th style={{ ...th, textAlign: 'right' }}>Importe</th></tr></thead>
            <tbody>
              {pagEnt.items.map(e => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fFecha(e.fecha)}</td>
                  <td style={td}>{e.proveedor_nombre || '—'}</td>
                  <td style={td}>{e.descripcion || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtKg(e.kg)}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{fmt$(e.precio_kg)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(e.importe)}</td>
                </tr>
              ))}
              {entradas.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Sin entradas de pollo.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '0 14px 12px' }}><Paginador {...pagEnt.controles} label="entradas" /></div>
      </div>

      {/* Historial de salidas */}
      <div style={{ ...card, padding: 0 }}>
        <div style={{ padding: '12px 14px', fontWeight: 700, fontSize: 13 }}>📤 Historial de salidas (ventas de pollo por cajón / kg)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640 }}>
            <thead><tr><th style={th}>Fecha</th><th style={th}>Cliente</th><th style={th}>Descripción</th><th style={{ ...th, textAlign: 'right' }}>Kg</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {pagSal.items.map(s => (
                <tr key={s.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fFecha(s.fecha)}</td>
                  <td style={td}>{s.cliente_nombre || '—'}</td>
                  <td style={td}>{s.descripcion || (s.tipo === 'pollo_cajon' ? 'Pollo (cajón)' : 'Pollo')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtKg(s.kg)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt$(s.total)}</td>
                </tr>
              ))}
              {salidas.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Sin salidas de pollo.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '0 14px 12px' }}><Paginador {...pagSal.controles} label="salidas" /></div>
      </div>
    </div>
  )
}
