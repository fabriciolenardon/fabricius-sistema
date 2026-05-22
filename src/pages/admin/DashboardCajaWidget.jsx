// ============================================================
// WIDGET DE CAJA RÁPIDA EN EL DASHBOARD
// ============================================================
// Muestra los KPIs principales de ventas minoristas (origen = 'caja')
// del día de hoy, comparados con ayer.
// Incluye: facturado, cantidad de ventas, ticket promedio, kg vendidos,
// top 3 categorías y desglose por forma de pago.
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')

function grupoDeCategoria(cat) {
  if (!cat) return 'Otros'
  if (cat.startsWith('bovino') && cat !== 'bovino_brosa') return 'Bovino'
  if (cat === 'bovino_brosa') return 'Brosas'
  if (cat.startsWith('cerdo')) return 'Cerdo'
  if (cat === 'pollo' || cat === 'pollo_cajon') return 'Pollo'
  if (cat === 'embutido') return 'Embutidos'
  if (cat === 'rebozado' || cat === 'rebozado_cajon') return 'Rebozados'
  if (cat === 'almacen') return 'Almacén'
  if (cat === 'bebidas') return 'Bebidas'
  return 'Otros'
}

function agregar(ventas) {
  let totalPlata = 0, totalKg = 0, items = 0
  const porPago = { efectivo: 0, debito: 0, transferencia: 0 }
  const porGrupo = {}
  for (const v of ventas) {
    totalPlata += Number(v.total) || 0
    porPago.efectivo      += Number(v.efectivo)      || 0
    porPago.debito        += Number(v.debito)        || 0
    porPago.transferencia += Number(v.transferencia) || 0
    const its = Array.isArray(v.items) ? v.items : []
    for (const it of its) {
      const g = grupoDeCategoria(it.categoria)
      if (!porGrupo[g]) porGrupo[g] = 0
      porGrupo[g] += Number(it.importe) || 0
      totalKg += Number(it.kg) || 0
      items += 1
    }
  }
  return {
    totalPlata, totalKg, items, ventas: ventas.length,
    ticketPromedio: ventas.length > 0 ? totalPlata / ventas.length : 0,
    porPago, porGrupo,
  }
}

export default function DashboardCajaWidget() {
  const [hoy, setHoy] = useState([])
  const [ayer, setAyer] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { cargar() }, [])

  // Realtime: suscripción a ventas_minoristas
  useEffect(() => {
    const canal = supabase
      .channel('dashboard-caja-realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ventas_minoristas' },
        payload => {
          const v = payload.new
          if (v?.origen === 'caja') {
            const total = Number(v.total) || 0
            setToast({ texto: `🛎️ Nueva venta: $${Math.round(total).toLocaleString('es-AR')}`, id: Date.now() })
            setTimeout(() => setToast(null), 4500)
          }
          cargar()
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'ventas_minoristas' },
        () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const ahora = new Date()
    const fHoy = ahora.toISOString().split('T')[0]
    const ayerD = new Date(ahora); ayerD.setDate(ayerD.getDate() - 1)
    const fAyer = ayerD.toISOString().split('T')[0]

    const [{ data: vHoy }, { data: vAyer }] = await Promise.all([
      supabase.from('ventas_minoristas').select('*').eq('origen', 'caja').eq('fecha', fHoy),
      supabase.from('ventas_minoristas').select('*').eq('origen', 'caja').eq('fecha', fAyer),
    ])
    setHoy(vHoy || [])
    setAyer(vAyer || [])
    setLoading(false)
  }

  const agHoy  = useMemo(() => agregar(hoy),  [hoy])
  const agAyer = useMemo(() => agregar(ayer), [ayer])

  const deltaFacturado = agAyer.totalPlata > 0
    ? ((agHoy.totalPlata - agAyer.totalPlata) / agAyer.totalPlata * 100)
    : null

  const top3 = useMemo(() =>
    Object.entries(agHoy.porGrupo)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3),
    [agHoy.porGrupo]
  )

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }
  const mini = (label, value, sub, color = 'var(--gold)') => (
    <div style={{ flex: 1, minWidth: 130, padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Bebas Neue',cursive" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ ...card, marginBottom: 20, position: 'relative' }}>
      {/* Toast de nueva venta */}
      {toast && (
        <div key={toast.id} style={{
          position: 'absolute', top: -12, right: 12, zIndex: 50,
          background: 'linear-gradient(135deg, #2d5a2d, #1a3a1a)',
          border: '2px solid #7dff7d', borderRadius: 8,
          padding: '10px 18px', fontWeight: 700, color: '#7dff7d',
          fontSize: 13, boxShadow: '0 4px 12px rgba(125,255,125,0.3)',
          animation: 'slideIn 0.3s ease-out',
        }}>
          {toast.texto}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>💵 Caja Rápida — Hoy <span style={{ fontSize: 9, color: '#7dff7d', marginLeft: 8 }}>● EN VIVO</span></div>
        <button onClick={() => navigate('/admin/caja')}
          style={{ padding: '6px 14px', background: 'transparent', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          📊 Ver historial completo
        </button>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando ventas de hoy...</p>}

      {!loading && agHoy.ventas === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
          Sin ventas registradas hoy. Cuando se haga la primera venta en Caja, aparecen acá.
        </p>
      )}

      {!loading && agHoy.ventas > 0 && (
        <>
          {/* KPIs principales */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            {mini('Facturado hoy', fmt$(agHoy.totalPlata),
              deltaFacturado !== null
                ? `${deltaFacturado >= 0 ? '▲' : '▼'} ${Math.abs(deltaFacturado).toFixed(0)}% vs ayer`
                : 'sin venta ayer',
              'var(--gold)')}
            {mini('Ventas', String(agHoy.ventas), `Ayer: ${agAyer.ventas}`, '#7dff7d')}
            {mini('Ticket promedio', fmt$(agHoy.ticketPromedio))}
            {mini('Kg vendidos', agHoy.totalKg.toFixed(1) + ' kg', `${agHoy.items} items`)}
          </div>

          {/* Desglose forma de pago */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 120, padding: 10, background: 'rgba(125,255,125,0.05)', border: '1px solid #2d5a2d', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>💵 EFECTIVO</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#7dff7d', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(agHoy.porPago.efectivo)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, padding: 10, background: 'rgba(122,157,255,0.05)', border: '1px solid #2d3a5a', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>💳 DÉBITO</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#7a9dff', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(agHoy.porPago.debito)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, padding: 10, background: 'rgba(255,209,122,0.05)', border: '1px solid #6a5a2a', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>🔄 TRANSF.</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ffd17a', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(agHoy.porPago.transferencia)}</div>
            </div>
          </div>

          {/* Top 3 categorías del día */}
          {top3.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Top categorías del día</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {top3.map(([g, plata]) => {
                  const pct = agHoy.totalPlata > 0 ? (plata / agHoy.totalPlata * 100) : 0
                  return (
                    <div key={g} style={{ flex: 1, minWidth: 130, padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{g}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>{fmt$(plata)}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pct.toFixed(0)}% del total</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
