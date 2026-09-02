// ClientePrecios.jsx - Lista de precios para clientes mayoristas
// Dos variantes según clientes.lista_precios:
//  - may/min (clientes comunes): columnas MAYORISTA + MINORISTA y PDF May/Min.
//    La lista carnicería (reventa) NO se muestra.
//  - carn (carnicerías clientas, no franquicias): SOLO la Lista para
//    Carnicerías + Insumos para Carnicerías, y el PDF de Carnicerías.
//    No ven mayorista/minorista: manejan sus precios de venta de forma
//    independiente (no somos nosotros quienes se los ponemos).
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { compartirListaPrecios } from '../../lib/listasPreciosPdf'

const CATEGORIAS = {
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_brosa: '🫀 Brosas',
  bovino_pieza: '🍖 Piezas',
  cerdo_corte: '🐷 Cerdo — Cortes',
  cerdo_pieza: '🐷 Cerdo — Piezas',
  embutido: '🌭 Embutidos',
  animalitos: '🐑 Animalitos',
  pollo: '🍗 Pollo x Kilo',
  pollo_cajon: '🍗 Pollo x Cajón',
  rebozado: '🧊 Rebozados',
}
const INSUMO_SUBCAT = { descartables: '📦 Descartables', limpieza: '🧽 Limpieza', carniceria: '🔪 Insumos Carnicería' }
const INSUMO_SUBCAT_ORDEN = { descartables: 0, limpieza: 1, carniceria: 2 }

import { fmtPrecio } from '../../lib/formatos'
import { getLista } from '../../lib/listasPrecios'
const fmt = n => n != null ? fmtPrecio(Number(n) || 0) : '—'

export default function ClientePrecios() {
  const { profile } = useAuth()
  const [precios, setPrecios] = useState([])
  const [cliente, setCliente] = useState(null)
  const [filtro, setFiltro] = useState('bovino_corte')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!profile?.cliente_id) { setLoading(false); return }
    cargar()
  }, [profile?.cliente_id])

  async function cargar() {
    setLoading(true)
    const [{ data: cli }, { data: pr }] = await Promise.all([
      supabase.from('clientes').select('nombre, lista_precios').eq('id', profile.cliente_id).maybeSingle(),
      supabase.from('precios').select('*').order('nombre'),
    ])
    setCliente(cli)
    setPrecios(pr || [])
    setLoading(false)
  }

  const L = getLista(cliente?.lista_precios)
  const esCarniceria = L.codigo === 'carn'
  // ALVEAR y MONTE CRISTO son franquicias (mismo criterio de nombre que el
  // Dashboard Ejecutivo); el resto de la lista carn son carnicerías clientas.
  // Misma lista de precios, distinta etiqueta de cara al cliente.
  const esFranquicia = /ALVEAR|MONTE\s*CRISTO/i.test(cliente?.nombre || '')
  const nombreLista = esFranquicia ? 'Lista para Franquicia' : 'Lista para Carnicerías'
  // Las carnicerías clientas y franquicias ven además la pestaña de insumos
  const categorias = esCarniceria ? { ...CATEGORIAS, insumos: '🧰 Insumos' } : CATEGORIAS
  const etiquetaBadge = esCarniceria ? `🔴 ${nombreLista}` : L.labelEmoji

  // Exportar/compartir el PDF de SU lista: carnicerías → PDF Carnicerías;
  // el resto → PDF May/Min. Nunca la lista que no les corresponde.
  async function pdfLista() {
    try {
      const visibles = precios.filter(p => CATEGORIAS[p.categoria])
      const res = await compartirListaPrecios({ tipo: esCarniceria ? 'carniceria' : 'mayorista', precios: visibles })
      setMsg(res === 'descargado' ? '✅ PDF descargado — podés arrastrarlo al chat de WhatsApp' : '✅ Lista compartida')
    } catch (e) {
      setMsg('❌ ' + e.message)
    }
    setTimeout(() => setMsg(null), 5000)
  }

  const productosFiltrados = precios.filter(p => p.categoria === filtro)

  return (
    <div>
      <div className="page-title">LISTA DE PRECIOS</div>
      <div className="page-sub">Precios vigentes para tu cuenta — Fabricius Carnicerías</div>

      <div style={{ background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 12, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tu lista de precios:</div>
        <div style={{ background: 'var(--gold)', color: '#000', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>{etiquetaBadge}</div>
        <button onClick={pdfLista}
          style={{ marginLeft: 'auto', padding: '8px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          {esCarniceria ? '📄 PDF Lista Carnicerías → WhatsApp' : '📄 PDF May/Min → WhatsApp'}
        </button>
      </div>
      {msg && <div style={{ background: msg.includes('❌') ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.includes('❌') ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 14, color: msg.includes('❌') ? '#ff6b6b' : '#7dff7d', fontWeight: 600, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(categorias).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{filtro === 'insumos' ? `🧰 Insumos para ${esFranquicia ? 'Franquicias' : 'Carnicerías'}` : categorias[filtro]}</div>
        {loading ? <p style={{ color: 'var(--muted)' }}>Cargando precios...</p> : (
          esCarniceria && filtro === 'insumos' ? (
            <table>
              <thead><tr>
                <th style={{ width: '65%' }}>Insumo</th>
                <th style={{ color: 'var(--gold)' }}>🧰 {nombreLista}</th>
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
          ) : esCarniceria ? (
            <table>
              <thead><tr>
                <th style={{ width: '70%' }}>Producto</th>
                <th style={{ color: 'var(--red-light)', textAlign: 'right' }}>🔴 {nombreLista}</th>
              </tr></thead>
              <tbody>
                {productosFiltrados.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                    <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue',cursive", fontSize: 20, textAlign: 'right' }}>{fmt(p.precio_carniceria)}</td>
                  </tr>
                ))}
                {productosFiltrados.length === 0 && <tr><td colSpan={2} className="empty">Sin productos en esta categoría</td></tr>}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr>
                <th style={{ width: '40%' }}>Producto</th>
                <th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th>
                <th style={{ color: 'var(--green)' }}>🟢 Minorista</th>
              </tr></thead>
              <tbody>
                {productosFiltrados.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                    <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_mayorista)}</td>
                    <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{fmt(p.precio_minorista)}</td>
                  </tr>
                ))}
                {productosFiltrados.length === 0 && <tr><td colSpan={3} className="empty">Sin productos en esta categoría</td></tr>}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
