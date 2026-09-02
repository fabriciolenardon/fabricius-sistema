import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { compartirListaPrecios } from '../../lib/listasPreciosPdf'

// Mismas categorías de carne que ve el admin en Precios (sin bebidas ni
// almacén) + Insumos, que la central les vende a las franquicias.
const CATEGORIAS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_pieza: '🍖 Piezas',
  bovino_brosa: '🫀 Brosas',
  bovino_caja_pt: '📦 Bovino Caja PT',
  cerdo_corte: '🐷 Cerdo — Cortes',
  cerdo_pieza: '🐷 Cerdo — Piezas',
  embutido: '🌭 Embutidos',
  animalitos: '🐑 Animalitos',
  pollo: '🍗 Pollo x Kilo',
  pollo_cajon: '🍗 Pollo x Cajón',
  rebozado: '🧊 Rebozados',
  rebozado_cajon: '🧊 Rebozado Cajón',
  insumos: '🧰 Insumos',
}
const INSUMO_SUBCAT = { descartables: '📦 Descartables', limpieza: '🧽 Limpieza', carniceria: '🔪 Insumos Carnicería' }
const INSUMO_SUBCAT_ORDEN = { descartables: 0, limpieza: 1, carniceria: 2 }

import { fmtPrecio } from '../../lib/formatos'
const fmt = n => n != null ? fmtPrecio(Number(n) || 0) : '—'

export default function FranquiciaPrecios() {
  const [precios, setPrecios] = useState([])
  const [filtro, setFiltro] = useState('bovino_corte')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('precios').select('*').order('nombre')
    setPrecios(data || [])
    setLoading(false)
  }

  // Solo las categorías visibles del portal entran al PDF
  async function pdfLista(tipo) {
    try {
      const visibles = precios.filter(p => CATEGORIAS[p.categoria])
      const res = await compartirListaPrecios({ tipo, precios: visibles })
      setMsg(res === 'descargado' ? '✅ PDF descargado — arrastralo al chat de WhatsApp' : '✅ Lista compartida')
    } catch (e) {
      setMsg('❌ ' + e.message)
    }
    setTimeout(() => setMsg(null), 5000)
  }

  const productosFiltrados = precios.filter(p => p.categoria === filtro)

  return (
    <div>
      <div className="page-title">LISTA DE PRECIOS</div>
      <div className="page-sub">Precios vigentes — Carnicerías Fabricius</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => pdfLista('mayorista')}
          style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          📄 PDF May/Min → WhatsApp
        </button>
        <button onClick={() => pdfLista('carniceria')}
          style={{ padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          📄 PDF Carnicerías → WhatsApp
        </button>
      </div>
      {msg && <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 14, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600, fontSize: 13 }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(CATEGORIAS).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{filtro === 'insumos' ? '🧰 Insumos para Franquicias' : CATEGORIAS[filtro]}</div>
        {loading ? <p style={{ color: 'var(--muted)' }}>Cargando precios...</p> : (
          filtro === 'insumos' ? (
            // Insumos: una sola lista (lo que la central les cobra a las franquicias)
            <table>
              <thead><tr>
                <th style={{ width: '65%' }}>Insumo</th>
                <th style={{ color: 'var(--gold)' }}>🧰 Lista para Franquicia</th>
              </tr></thead>
              <tbody>
                {(() => {
                  const lista = [...productosFiltrados].sort((a, b) => (INSUMO_SUBCAT_ORDEN[a.subcategoria] ?? 9) - (INSUMO_SUBCAT_ORDEN[b.subcategoria] ?? 9) || a.nombre.localeCompare(b.nombre))
                  const rows = []
                  let lastSub = null
                  lista.forEach(p => {
                    if (p.subcategoria !== lastSub) {
                      lastSub = p.subcategoria
                      rows.push(<tr key={'sub-' + (p.subcategoria || 'x')}><td colSpan={2} style={{ background: 'var(--surface2)', color: 'var(--gold)', fontWeight: 700, fontSize: 12, padding: '6px 10px' }}>{INSUMO_SUBCAT[p.subcategoria] || p.subcategoria}</td></tr>)
                    }
                    rows.push(
                      <tr key={p.id}>
                        <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                        <td style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                      </tr>
                    )
                  })
                  return rows
                })()}
              </tbody>
            </table>
          ) : (
          <table>
            <thead><tr>
              <th style={{ width: '40%' }}>Producto</th>
              <th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th>
              <th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th>
              <th style={{ color: 'var(--green)' }}>🟢 Minorista</th>
            </tr></thead>
            <tbody>
              {productosFiltrados.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                  <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_carniceria)}</td>
                  <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                  <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                </tr>
              ))}
              {productosFiltrados.length === 0 && <tr><td colSpan={4} className="empty">Sin productos en esta categoría</td></tr>}
            </tbody>
          </table>
          )
        )}
      </div>
    </div>
  )
}
