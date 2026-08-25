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
import { overlayDeSucursal, desviosDeSucursal, preciosPropiosFaltantes, empujarListaASucursal } from '../../lib/preciosSucursal'
import { productosQueVende } from '../../lib/categoriasPrecios'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

// Lo que esa boca vende DE VERDAD. Los tres contadores, la tabla de desvíos y
// el botón de empujar tienen que mirar exactamente este conjunto: cualquier
// producto que sobre acá aparece como "sin cargar" o "distinto a tu lista"
// sin que haya nada que hacer al respecto.
//
//   · ZZ_          → productos dados de baja
//   · insumos      → los vende la central A ELLA; no los revende
//   · con dueño    → almacén y bebidas son de cada boca (mig 113). Los de la
//                    central ni los ve; mandarle un precio es basura.
const vendibles = (productos) =>
  productosQueVende(productos || [], true)
    .filter(p => !String(p.nombre || '').startsWith('ZZ_') && p.sucursal_id == null)

export default function SucursalesPrecios({ productos }) {
  const [sucursales, setSucursales] = useState([])
  const [elegida, setElegida] = useState(null)
  const [desvios, setDesvios] = useState([])
  const [faltantes, setFaltantes] = useState(0)
  const [conPrecio, setConPrecio] = useState(0)
  const [totalVendible, setTotalVendible] = useState(0)
  const [cargando, setCargando] = useState(true)
  // Empujar la lista: confirmación INLINE (en iOS/PWA los confirm() del
  // navegador se suprimen sin error y la acción se pierde en silencio).
  const [confirmando, setConfirmando] = useState(false)
  const [empujando, setEmpujando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [recarga, setRecarga] = useState(0)

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
      // `vendibles` también acá: si se compara contra el catálogo entero, los
      // insumos y el almacén de la central salen como desvíos que no se pueden
      // arreglar (fue justo lo que pasó: 4 "distintos" que eran bobinas de papel).
      const lista = vendibles(productos)
      const [overlay, d] = await Promise.all([
        overlayDeSucursal(elegida),
        desviosDeSucursal(elegida, lista),
      ])
      if (!vivo) return
      setDesvios(d)
      setFaltantes(preciosPropiosFaltantes(lista, overlay))
      // Sobre `lista` y no sobre el overlay entero: el overlay puede tener
      // filas viejas de productos que ella ya no vende, y contarlas hacía que
      // "con precio propio" superara a lo que realmente hay para cargar.
      setConPrecio(overlay ? lista.filter(p => overlay[p.id]).length : 0)
      setTotalVendible(lista.length)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [elegida, productos, recarga])

  // Manda la lista de la central a la sucursal elegida. `soloFaltantes` crea
  // nada más los que no tienen precio propio (no pisa lo que ya cargaron);
  // sin eso, además actualiza los que difieren — es el botón de después de un
  // aumento.
  async function empujar(soloFaltantes) {
    setEmpujando(true)
    setResultado(null)
    const r = await empujarListaASucursal(elegida, vendibles(productos), { soloFaltantes })
    setEmpujando(false)
    setConfirmando(false)
    if (r.error) { setResultado({ error: true, texto: '❌ No se pudo: ' + r.error.message }); return }
    const partes = []
    if (r.creados) partes.push(`${r.creados} cargado${r.creados === 1 ? '' : 's'} por primera vez`)
    if (r.actualizados) partes.push(`${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}`)
    setResultado({
      error: false,
      texto: partes.length
        ? `✅ Listo: ${partes.join(' y ')}. Ya lo ven en su mostrador.`
        : '✅ No había nada para cambiar: su lista ya es igual a la tuya.',
    })
    setRecarga(n => n + 1)
  }

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
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>de {totalVendible} que te compran</div>
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

      {/* MANDARLES LA LISTA — los precios los define la central, así que en vez
          de que los carguen a mano producto por producto, se los empuja. */}
      <div className="card" style={{ marginBottom: 20, borderColor: 'var(--gold)' }}>
        <div className="card-title">📤 Mandarles tu lista de precios</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          Copia tus precios <strong>minorista y mayorista</strong> a{' '}
          <strong style={{ color: 'var(--text)' }}>{sucursales.find(s => s.id === elegida)?.nombre || 'la sucursal'}</strong>.
          La lista de <strong>carnicería no se manda</strong>: esa es con la que vos les vendés a ellos.
          No se tocan los productos ni el PLU — sólo el precio de venta.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost" disabled={empujando || cargando || faltantes === 0}
            onClick={() => empujar(true)}
            title="Crea sólo los que todavía no tienen precio propio. No pisa nada de lo que ya cargaron.">
            {empujando ? '⏳ Mandando…' : `➕ Cargar sólo los que faltan (${faltantes})`}
          </button>
          <button className="btn btn-gold" disabled={empujando || cargando}
            onClick={() => { setConfirmando(true); setResultado(null) }}>
            📤 Actualizar TODOS con mi lista
          </button>
        </div>

        {confirmando && (
          <div style={{ marginTop: 14, background: '#3a2a1a', border: '1px solid var(--amber)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>
              ¿Pisar los precios de {sucursales.find(s => s.id === elegida)?.nombre}?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10 }}>
              Van a quedar con TU lista: {faltantes > 0 && <>se cargan los <strong>{faltantes}</strong> que les faltan</>}
              {faltantes > 0 && desvios.length > 0 && ' y '}
              {desvios.length > 0 && <>se corrigen los <strong>{desvios.length}</strong> que hoy difieren</>}
              {faltantes === 0 && desvios.length === 0 && <>hoy ya coinciden, no cambiaría nada</>}.
              <br />Los ven al instante en su Caja (se actualiza sola).
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-gold" disabled={empujando} onClick={() => empujar(false)}>
                {empujando ? '⏳ Mandando…' : '✅ Sí, mandar mi lista'}
              </button>
              <button className="btn btn-ghost" disabled={empujando} onClick={() => setConfirmando(false)}>Cancelar</button>
            </div>
          </div>
        )}

        {resultado && (
          <div style={{
            marginTop: 12, borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600,
            background: resultado.error ? '#3a1a1a' : '#1a2a1a',
            border: `1px solid ${resultado.error ? '#5a2a2a' : '#2d5a2d'}`,
            color: resultado.error ? '#ff6b6b' : '#7dff7d',
          }}>
            {resultado.texto}
          </div>
        )}
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
