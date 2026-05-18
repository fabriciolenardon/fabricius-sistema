// ClientePrecios.jsx - Lista de precios para clientes mayoristas
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const CATEGORIAS = {
  bovino_corte: '🥩 Bovinos — Cortes',
  bovino_brosa: '🫀 Brosas',
  bovino_pieza: '🍖 Piezas',
  cerdo_corte: '🐷 Cerdo',
  embutido: '🌭 Embutidos',
  pollo: '🍗 Pollo Cajones',
  rebozado: '🧊 Rebozados',
}

const fmt = n => n != null ? '$' + Math.round(n).toLocaleString('es-AR') : '—'

export default function ClientePrecios() {
  const { profile } = useAuth()
  const [precios, setPrecios] = useState([])
  const [cliente, setCliente] = useState(null)
  const [filtro, setFiltro] = useState('bovino_corte')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.cliente_id) { setLoading(false); return }
    cargar()
  }, [profile?.cliente_id])

  async function cargar() {
    setLoading(true)
    const [{ data: cli }, { data: pr }] = await Promise.all([
      supabase.from('clientes').select('lista_precios').eq('id', profile.cliente_id).maybeSingle(),
      supabase.from('precios').select('*').order('nombre'),
    ])
    setCliente(cli)
    setPrecios(pr || [])
    setLoading(false)
  }

  const listaCliente = cliente?.lista_precios === 'may' ? 'precio_mayorista' : 'precio_carniceria'
  const etiquetaLista = cliente?.lista_precios === 'may' ? '🟡 Mayorista' : '🔴 Carnicería'
  const productosFiltrados = precios.filter(p => p.categoria === filtro)

  return (
    <div>
      <div className="page-title">LISTA DE PRECIOS</div>
      <div className="page-sub">Precios vigentes para tu cuenta — Fabricius Carnicerías</div>

      <div style={{ background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 12, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tu lista de precios:</div>
        <div style={{ background: 'var(--gold)', color: '#000', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>{etiquetaLista}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(CATEGORIAS).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{CATEGORIAS[filtro]}</div>
        {loading ? <p style={{ color: 'var(--muted)' }}>Cargando precios...</p> : (
          <table>
            <thead><tr>
              <th style={{ width: '70%' }}>Producto</th>
              <th style={{ color: 'var(--gold)', textAlign: 'right' }}>{etiquetaLista}</th>
            </tr></thead>
            <tbody>
              {productosFiltrados.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                  <td style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive", fontSize: 20, textAlign: 'right' }}>{fmt(p[listaCliente])}</td>
                </tr>
              ))}
              {productosFiltrados.length === 0 && <tr><td colSpan={2} className="empty">Sin productos en esta categoría</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
