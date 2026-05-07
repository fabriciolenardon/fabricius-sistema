// Precios.jsx
export default function Precios() {
  const categorias = { bovino_corte: '🥩 Bovinos — Cortes', bovino_brosa: '🫀 Brosas', bovino_pieza: '🍖 Piezas', cerdo_corte: '🐷 Cerdo', embutido: '🌭 Embutidos', pollo: '🍗 Pollo Cajones', rebozado: '🧊 Rebozados' }
  const listaPrecios = {
    bovino_corte: [
      { nombre: 'Cuadril / Nalga / Peceto', carn: 17955, may: 18720, min: 20800 },
      { nombre: 'Vacío', carn: 16150, may: 17500, min: 19500 },
      { nombre: 'Costilla', carn: 16625, may: 17820, min: 19800 },
      { nombre: 'Colita de Cuadril', carn: 17100, may: 17670, min: 19620 },
      { nombre: 'Tapa de Nalga', carn: 14630, may: 15210, min: 16900 },
      { nombre: 'Tapa de Asado', carn: 16150, may: 17010, min: 18900 },
      { nombre: 'Matambre', carn: 17100, may: 18900, min: 21000 },
      { nombre: 'Aguja Especial', carn: 13245, may: 14130, min: 15700 },
      { nombre: 'Hamburguesa Bovina', carn: 14535, may: 15750, min: 17500 },
      { nombre: 'Osobuco', carn: 8550, may: 9810, min: 10900 },
      { nombre: 'Lomito', carn: null, may: 20700, min: 23000 },
    ],
    bovino_brosa: [
      { nombre: 'Chinchulin', carn: 7500, may: 8550, min: 9500 },
      { nombre: 'Molleja Surtida', carn: 27500, may: 28500, min: 30000 },
      { nombre: 'Mondongo', carn: 8500, may: 9500, min: 10500 },
      { nombre: 'Lengua', carn: 10000, may: 11000, min: 11500 },
      { nombre: 'Hígado', carn: 4200, may: 4700, min: 5200 },
      { nombre: 'Rabo', carn: 6800, may: 6800, min: 7500 },
    ],
    bovino_pieza: [
      { nombre: 'Media Res Premium (Novillito/Vaquillona)', carn: 10300, may: 10300, min: null },
      { nombre: 'Pierna', carn: 12400, may: 13400, min: null },
      { nombre: 'Parrillero', carn: 15900, may: 16400, min: null },
      { nombre: 'Cortito', carn: 9400, may: 9700, min: null },
    ],
    cerdo_corte: [
      { nombre: 'Bondiola x kg', carn: 7500, may: 8460, min: 9400 },
      { nombre: 'Matambre x kg', carn: 10500, may: 11250, min: 12500 },
      { nombre: 'Chorizo Parrillero', carn: 7300, may: 7500, min: 8800 },
      { nombre: 'Morcilla', carn: 5500, may: 6000, min: 7000 },
      { nombre: 'Salchicha Parrillera', carn: 8000, may: 8500, min: 9400 },
    ],
    embutido: [
      { nombre: 'Salame Casero Envasado', carn: 27000, may: 28000, min: 30000 },
      { nombre: 'Bondiola Curada', carn: 25000, may: 26100, min: 29000 },
    ],
    pollo: [
      { nombre: 'Cajón Pollo INDA x 20kg', carn: 76000, may: 81000, min: null },
      { nombre: 'Cajón Pata Muslo A x 20kg', carn: 71000, may: 76000, min: null },
      { nombre: 'Cajón Pechuga c/ Hueso x 20kg', carn: 90000, may: 95000, min: null },
      { nombre: 'Cajón Suprema A x 20kg', carn: 155000, may: 160000, min: null },
    ],
    rebozado: [
      { nombre: 'Bocaditos Muzzarella INDACOR x 5kg', carn: 54900, may: 59900, min: 12000 },
      { nombre: 'Nuggets de Pollo INDACOR x 5kg', carn: 42500, may: 47500, min: 9500 },
      { nombre: 'Filet de Merluza x 7kg', carn: 70400, may: 75400, min: 12500 },
    ],
  }
  const fmt = n => n != null ? '$' + Math.round(n).toLocaleString('es-AR') : '—'
  const [filtro, setFiltro] = useState('bovino_corte')
  const { useState } = require('react')
  return (
    <div>
      <div className="page-title">LISTA DE PRECIOS</div>
      <div className="page-sub">Carnicerías · Mayorista · Minorista — precios vigentes</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(categorias).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: filtro === id ? 'var(--gold)' : 'transparent', color: filtro === id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{categorias[filtro]}</div>
        <table>
          <thead><tr><th style={{ width: '50%' }}>Producto</th><th style={{ color: 'var(--red-light)' }}>🔴 Carnicería</th><th style={{ color: 'var(--amber)' }}>🟡 Mayorista</th><th style={{ color: 'var(--green)' }}>🟢 Minorista</th></tr></thead>
          <tbody>
            {(listaPrecios[filtro] || []).map((p, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                <td style={{ color: 'var(--red-light)', fontFamily: "'Bebas Neue', cursive", fontSize: 18 }}>{fmt(p.carn)}</td>
                <td style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue', cursive", fontSize: 18 }}>{fmt(p.may)}</td>
                <td style={{ color: 'var(--green)', fontFamily: "'Bebas Neue', cursive", fontSize: 18 }}>{fmt(p.min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
