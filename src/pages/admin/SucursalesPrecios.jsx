// ============================================================
// PRECIOS DE LAS SUCURSALES — comparativo contra la lista de la central
// ============================================================
// Las sucursales respetan la lista POR CONTRATO, no por candado: el sistema
// NO les impide cambiar un precio (decisión de Fabricio, 18/08/2026). Lo que
// sí puede hacer es mostrar acá dónde se despegaron, para que sea una
// conversación y no una sorpresa al ver un ticket.
//
// Un desvío no es necesariamente un incumplimiento: lo más común es que la
// central haya actualizado su lista y la sucursal todavía no la haya cargado
// (las listas son una FOTO, no un espejo — ver supabase/97). Por eso la
// pantalla informa el sentido del desvío y no lo trata como una infracción.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtPrecio } from '../../lib/formatos'
import { SUCURSAL_CENTRAL } from '../../lib/permisos'
import { overlayDeSucursal, desviosDeSucursal, preciosPropiosFaltantes } from '../../lib/preciosSucursal'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

export default function SucursalesPrecios({ productos }) {
  const [sucursales, setSucursales] = useState([])
  const [elegida, setElegida] = useState(null)
  const [desvios, setDesvios] = useState([])
  const [faltantes, setFaltantes] = useState(0)
  const [conPrecio, setConPrecio] = useState(0)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.from('sucursales').select('id, nombre').neq('id', SUCURSAL_CENTRAL).order('id')
      .then(({ data }) => {
        setSucursales(data || [])
        if ((data || []).length > 0) setElegida(data[0].id)
        else setCargando(false)
      })
  }, [])

  useEffect(() => {
    if (!elegida || !productos?.length) return
    let vivo = true
    setCargando(true)
    ;(async () => {
      const [overlay, d] = await Promise.all([
        overlayDeSucursal(elegida),
        desviosDeSucursal(elegida, productos),
      ])
      if (!vivo) return
      setDesvios(d)
      setFaltantes(preciosPropiosFaltantes(productos, overlay))
      setConPrecio(overlay ? Object.keys(overlay).length : 0)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [elegida, productos])

  if (sucursales.length === 0) {
    return <div className="card"><div style={{ color: 'var(--muted)', fontSize: 13 }}>No hay sucursales cargadas todavía.</div></div>
  }

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }
  const td = { padding: '8px 10px', fontSize: 13, borderBottom: '1px solid var(--border)' }

  return (
    <div>
      {sucursales.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {sucursales.map(s => (
            <button key={s.id} onClick={() => setElegida(s.id)}
              style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${elegida === s.id ? 'var(--gold)' : 'var(--border)'}`, background: elegida === s.id ? 'var(--gold)' : 'transparent', color: elegida === s.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
              🏪 {s.nombre}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Con precio propio</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--text)' }}>{conPrecio}</div>
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sin cargar</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: faltantes > 0 ? 'var(--amber)' : 'var(--text)' }}>{faltantes}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>venden al precio de la central</div>
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Distintos a tu lista</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: desvios.length > 0 ? '#ff9b6b' : '#7dff7d' }}>{desvios.length}</div>
        </div>
      </div>

      {cargando ? (
        <div className="card"><div style={{ color: 'var(--muted)', fontSize: 13 }}>Comparando…</div></div>
      ) : desvios.length === 0 ? (
        <div className="card">
          <div style={{ color: '#7dff7d', fontWeight: 600, fontSize: 14 }}>✅ Sin diferencias con tu lista</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
            Todos los precios que cargaron coinciden con los de la central.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">Precios distintos a los tuyos</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Lo más común es que hayas actualizado tu lista y ellos todavía no. El sistema avisa, no bloquea:
            la lista se respeta por contrato.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={th}>Producto</th>
                  <th style={th}>Lista</th>
                  <th style={{ ...th, textAlign: 'right' }}>Tu precio</th>
                  <th style={{ ...th, textAlign: 'right' }}>El de ellos</th>
                  <th style={{ ...th, textAlign: 'right' }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {desvios.map((d, i) => (
                  <tr key={`${d.id}-${d.lista}-${i}`}>
                    <td style={{ ...td, fontWeight: 600 }}>{d.nombre}</td>
                    <td style={{ ...td, color: 'var(--muted)', fontSize: 12 }}>{d.lista}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.central)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.sucursal)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: d.diferencia > 0 ? '#ff9b6b' : '#7dc4ff', fontWeight: 700 }}>
                      {d.diferencia > 0 ? '+' : '−'}{fmt(d.diferencia)}
                      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                        {d.pct > 0 ? '+' : '−'}{Math.abs(d.pct).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
