// ============================================================
// VENTAS CTA/CTE — antes "Mayorista", antes "Ventas"
// ============================================================
// Esta pantalla unifica el flujo de DESPACHO de mercadería y la consulta de
// REMITOS generados. Reutiliza los mismos componentes SalidaForm y RemitosTab
// que antes vivían dentro de Depósito.
//
// El nombre "Mayorista" quedó chico y confundía: acá se le remita a CUALQUIER
// cliente con cuenta corriente, sea mayorista, minorista o carnicería. Lo que
// define a esta pantalla es el remito y la cuenta, no el tipo de cliente.
//
// La pantalla "Caja" maneja la venta al público que se cobra en el momento.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { SalidaForm, RemitosTab } from './Deposito'
import { supabase } from '../../lib/supabase'
import { fmtPrecio } from '../../lib/formatos'
import { getEtiquetaLista } from '../../lib/listasPrecios'

const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))
const fmtFecha = s => s ? new Date(s + (s.length === 10 ? 'T12:00' : '')).toLocaleDateString('es-AR') : '—'

export default function Ventas() {
  const [tab, setTab] = useState('despacho')
  const [alert, setAlert] = useState(null)
  const [remitoActual, setRemitoActual] = useState(null)

  // Acepta dos formas:
  //   showAlert('texto')                            → alert { msg: 'texto', type: 'success' }
  //   showAlert('texto', 'error')                   → alert { msg: 'texto', type: 'error' }
  //   showAlert({ msg: 'texto', type: 'success' })  → alert tal cual (forma usada por
  //                                                    SalidaForm/EntradaForm extraidos de Deposito)
  //   showAlert(null)                               → cierra alert
  // Antes solo aceptaba (string, type) → cuando SalidaForm pasaba un objeto,
  // `alert.msg` quedaba siendo el objeto entero → React error #31 al renderizar
  // → pantalla negra al confirmar un despacho mayorista.
  function showAlert(input, type = 'success') {
    if (input === null) { setAlert(null); return }
    if (input && typeof input === 'object') {
      setAlert({ msg: input.msg, type: input.type || 'success' })
    } else {
      setAlert({ msg: input, type })
    }
    setTimeout(() => setAlert(null), 4000)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      style={{
        padding: '9px 20px', borderRadius: 8, border: 'none',
        background: tab === id ? 'var(--gold)' : 'var(--surface)',
        color: tab === id ? '#000' : 'var(--muted)',
        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
        fontWeight: 700, fontSize: 13,
      }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">VENTAS CTA/CTE</div>
      <div className="page-sub">Despachos y remitos a clientes con cuenta corriente</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('despacho', '📤 Nuevo despacho')}
        {tabBtn('remitos', '🚚 Remitos')}
      </div>

      {alert && (
        <div style={{
          background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{alert.msg}</div>
      )}

      {tab === 'despacho' && (
        <>
          <SalidaForm
            onSaved={() => {}}
            showAlert={showAlert}
            onRemito={setRemitoActual}
            setTab={setTab}
          />
          <ClienteMayoristaPanel />
        </>
      )}

      {tab === 'remitos' && <RemitosTab remitoActual={remitoActual} />}
    </div>
  )
}

// ============================================================
// ClienteMayoristaPanel
// Buscador de clientes (excluye minoristas) que al seleccionar uno
// muestra su ficha completa: datos, saldo, últimos movimientos y
// últimos remitos. Útil al momento del despacho para confirmar
// datos del cliente sin tener que ir a la pestaña Clientes.
// ============================================================
function ClienteMayoristaPanel() {
  const [clientes, setClientes] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState(null)
  const [movs, setMovs] = useState([])
  const [remitos, setRemitos] = useState([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('clientes')
        .select('id, nombre, nombre_fantasia, tipo, lista_precios, telefono, localidad, domicilio, cuit, saldo, notas, tiene_portal, email_portal')
        .neq('tipo', 'minorista')
        .order('nombre')
      setClientes(data || [])
    })()
  }, [])

  // Filtrado vivo por nombre / fantasía / CUIT / teléfono / localidad
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return clientes.slice(0, 30)
    return clientes.filter(c => {
      const blob = `${c.nombre || ''} ${c.nombre_fantasia || ''} ${c.cuit || ''} ${c.telefono || ''} ${c.localidad || ''}`.toLowerCase()
      return blob.includes(q)
    }).slice(0, 30)
  }, [busqueda, clientes])

  async function seleccionar(c) {
    setSel(c)
    setLoadingDetalle(true)
    const [{ data: m }, { data: r }] = await Promise.all([
      supabase.from('movimientos_ctacte')
        .select('id, fecha, tipo, debe, haber, notas')
        .eq('cliente_id', c.id)
        .order('fecha', { ascending: false })
        .limit(8),
      supabase.from('remitos')
        .select('id, numero, fecha, total, eliminado, created_at')
        .eq('cliente_id', c.id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])
    setMovs(m || [])
    setRemitos(r || [])
    setLoadingDetalle(false)
  }

  return (
    <div className="card" style={{ marginTop: 24, borderColor: 'var(--gold)' }}>
      <div className="card-title">📇 Buscar cliente mayorista</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        Buscá por nombre, fantasía, CUIT, teléfono o localidad. Al seleccionar verás toda su info sin salir de esta pantalla.
      </div>

      <input
        type="text"
        placeholder="🔍 Escribí para buscar… (ej: Mitre, Bertossi, 351...)"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        style={{ width: '100%', marginBottom: 12, fontSize: 14 }}
      />

      {/* Lista de resultados (sólo si hay búsqueda o no hay cliente seleccionado) */}
      {!sel && (
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {!filtrados.length && (
            <div style={{ padding: 14, color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
              {busqueda ? 'Sin resultados.' : 'Sin clientes mayoristas cargados.'}
            </div>
          )}
          {filtrados.map(c => (
            <div key={c.id}
              onClick={() => seleccionar(c)}
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 8, fontSize: 13,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                  {c.nombre}
                  {c.nombre_fantasia && <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>"{c.nombre_fantasia}"</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {c.tipo} · {c.localidad || '—'} {c.telefono ? ` · 📞 ${c.telefono}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div style={{ color: c.saldo > 0 ? 'var(--red-light)' : c.saldo < 0 ? 'var(--green)' : 'var(--muted)', fontWeight: 700 }}>
                  {c.saldo > 0 ? `Debe ${fmt(c.saldo)}` : c.saldo < 0 ? `A favor ${fmt(c.saldo)}` : 'Al día'}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>{getEtiquetaLista(c.lista_precios)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ficha del cliente seleccionado */}
      {sel && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold)' }}>{sel.nombre}</div>
              {sel.nombre_fantasia && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>"{sel.nombre_fantasia}"</div>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setMovs([]); setRemitos([]) }}>
              ✕ Cerrar
            </button>
          </div>

          {/* Datos del cliente */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'CUIT', val: sel.cuit || '—' },
              { label: 'Teléfono', val: sel.telefono || '—' },
              { label: 'Localidad', val: sel.localidad || '—' },
              { label: 'Domicilio', val: sel.domicilio || '—' },
              { label: 'Lista precios', val: getEtiquetaLista(sel.lista_precios) },
              { label: 'Tipo', val: sel.tipo },
            ].map(d => (
              <div key={d.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2, textTransform: 'uppercase' }}>{d.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.val}</div>
              </div>
            ))}
          </div>

          {/* Saldo + portal */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SALDO</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: sel.saldo > 0 ? 'var(--red-light)' : sel.saldo < 0 ? 'var(--green)' : 'var(--muted)' }}>
                {fmt(sel.saldo)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {sel.saldo > 0 ? 'DEBE' : sel.saldo < 0 ? 'A FAVOR' : 'AL DÍA'}
              </div>
            </div>
            <div style={{ background: sel.tiene_portal ? '#1a2a1a' : 'var(--surface2)', border: `1px solid ${sel.tiene_portal ? '#2d5a2d' : 'var(--border)'}`, borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>PORTAL</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: sel.tiene_portal ? 'var(--green)' : 'var(--muted)' }}>
                {sel.tiene_portal ? '✅ Habilitado' : '— Sin portal'}
              </div>
              {sel.tiene_portal && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, wordBreak: 'break-all' }}>
                  {sel.email_portal}
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          {sel.notas && (
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2, textTransform: 'uppercase' }}>📝 Notas</div>
              <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{sel.notas}</div>
            </div>
          )}

          {/* Últimos movimientos cta cte */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--gold)' }}>
                🧾 Últimos movimientos cta. cte.
              </div>
              {loadingDetalle && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Cargando…</div>}
              {!loadingDetalle && !movs.length && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin movimientos cargados.</div>
              )}
              {movs.map(m => (
                <div key={m.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 0', borderBottom: '1px dashed var(--border)', fontSize: 12,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {m.tipo === 'compra' ? '🛒 Compra' : m.tipo === 'pago' ? '💵 Pago' : m.tipo === 'cheque' ? '📑 Cheque' : m.tipo}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtFecha(m.fecha)}{m.notas ? ` · ${m.notas}` : ''}</div>
                  </div>
                  <div style={{ color: m.debe > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700 }}>
                    {m.debe > 0 ? `+${fmt(m.debe)}` : `−${fmt(m.haber)}`}
                  </div>
                </div>
              ))}
            </div>

            {/* Últimos remitos */}
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--gold)' }}>
                🚚 Últimos remitos
              </div>
              {loadingDetalle && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Cargando…</div>}
              {!loadingDetalle && !remitos.length && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin remitos generados.</div>
              )}
              {remitos.map(r => (
                <div key={r.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 0', borderBottom: '1px dashed var(--border)', fontSize: 12,
                  opacity: r.eliminado ? 0.5 : 1,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      Remito N° {String(r.numero).padStart(5, '0')} {r.eliminado && <span style={{ color: 'var(--red-light)', fontSize: 10 }}>(anulado)</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtFecha(r.fecha)}</div>
                  </div>
                  <div style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(r.total)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
