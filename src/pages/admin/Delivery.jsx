// ============================================================
// Delivery — panel del local para los pedidos de /pedir
// ============================================================
// Circuito: llega el pedido (nuevo) → se pesa y se cargan los kilos
// reales → "Mandar el total por WhatsApp" le pasa el total final al
// cliente → (si es transferencia) se confirma el pago → se cobra en la
// CAJA como una venta común (descuenta stock y entra al arqueo) → sale
// con el repartidor → entregado.
//
// El cobro NO se registra acá: el botón "Cobrar en Caja" abre la Caja con
// el carrito ya armado (kilos reales, mismos precios del pedido y la
// línea de envío). Así el stock, la anulación y el arqueo siguen las
// reglas de siempre. La Caja linkea la venta al pedido (venta_id).
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { parseNumero } from '../../lib/formatos'
import { useEsMovil } from '../../lib/useEsMovil'
import {
  ESTADOS, CATEGORIAS_DELIVERY, pesos, fmtCantidad, nombreLindo, TZ,
  URL_DELIVERY, mensajeTotalFinal, mensajeEnCamino, mensajeSinStock, linkSeguimiento, textoHorarios, nombreRenglon,
} from '../../lib/delivery'
import { limpiarNumero } from '../../lib/whatsapp'

const FILTROS = [
  { key: 'activos', label: 'En curso', estados: ['nuevo', 'pesado', 'pagado', 'en_camino'] },
  { key: 'nuevo', label: 'Nuevos', estados: ['nuevo'] },
  { key: 'pesado', label: 'Para cobrar / enviar', estados: ['pesado', 'pagado'] },
  { key: 'en_camino', label: 'En camino', estados: ['en_camino'] },
  { key: 'entregado', label: 'Entregados', estados: ['entregado'] },
  { key: 'cancelado', label: 'Cancelados', estados: ['cancelado'] },
]

const hora = v => v ? new Date(v).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''
const fechaHora = v => v ? new Date(v).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''

// Link (no window.open): abrir WhatsApp después de un `await` lo bloquea el
// celular como popup. Un <a> que toca la persona abre siempre.
const waLink = (telefono, texto) => `https://wa.me/${limpiarNumero(telefono)}?text=${encodeURIComponent(texto)}`

export default function Delivery() {
  const [tab, setTab] = useState('pedidos')
  const [config, setConfig] = useState(null)

  async function cargarConfig() {
    const { data } = await supabase.from('config_sistema').select('valor').eq('clave', 'delivery').maybeSingle()
    setConfig(data?.valor || null)
  }
  useEffect(() => { cargarConfig() }, [])

  async function guardarConfig(cambios) {
    const nuevo = { ...config, ...cambios }
    const { error } = await supabase.from('config_sistema').update({ valor: nuevo, updated_at: new Date().toISOString() }).eq('clave', 'delivery')
    if (error) return error.message
    setConfig(nuevo)
    return null
  }

  return (
    <div style={{ padding: '16px 16px 40px', maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Encabezado config={config} onPausar={() => guardarConfig({ activo: !config?.activo })} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['pedidos', '🛵 Pedidos'], ['clientes', '👥 Clientes'], ['productos', '🥩 Productos publicados'], ['config', '⚙️ Configuración']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={tab === k ? 'btn btn-gold' : 'btn btn-ghost'} style={{ fontSize: 13 }}>{l}</button>
        ))}
      </div>
      {tab === 'pedidos' && <Pedidos config={config} />}
      {tab === 'clientes' && <Clientes config={config} />}
      {tab === 'productos' && <Productos config={config} />}
      {tab === 'config' && config && <Configuracion config={config} onGuardar={guardarConfig} />}
    </div>
  )
}

function Encabezado({ config, onPausar }) {
  const [copiado, setCopiado] = useState(false)
  const link = URL_DELIVERY
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { /* el link queda a la vista */ }
  }
  return (
    <div className="card" style={{ marginBottom: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', letterSpacing: 1 }}>🛵 Delivery minorista</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {config ? `${config.localidad} · sale de ${config.sale_de} · envío ${pesos(config.envio)} · mínimo ${pesos(config.minimo)}` : 'Cargando…'}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'IBM Plex Mono', monospace", userSelect: 'all' }}>{link}</span>
        <button onClick={copiar} className="btn btn-ghost" style={{ fontSize: 12 }}>{copiado ? '✓ Copiado' : '🔗 Copiar link para clientes'}</button>
        {config && (
          <button onClick={onPausar} className="btn" style={{
            fontSize: 12, fontWeight: 700,
            background: config.activo ? 'rgba(39,174,96,.15)' : 'rgba(192,57,43,.15)',
            color: config.activo ? 'var(--green)' : 'var(--red-light)',
            border: `1px solid ${config.activo ? 'var(--green)' : 'var(--red)'}`,
          }}>
            {config.activo ? '● Recibiendo pedidos (en horario) · Pausar' : '⏸ Pausado · Reanudar'}
          </button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── PEDIDOS ─────────────────────────
function Pedidos({ config }) {
  const esMovil = useEsMovil(900)
  const [filtro, setFiltro] = useState('activos')
  const [pedidos, setPedidos] = useState([])
  const [selId, setSelId] = useState(null)
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    // En curso: todos. Terminados: sólo los de los últimos 7 días (la lista
    // no crece para siempre; el historial completo queda en la tabla).
    const desde = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('pedidos_delivery').select('*')
      .or(`estado.in.(nuevo,pesado,pagado,en_camino),created_at.gte."${desde}"`)
      .order('created_at', { ascending: false }).limit(300)
    setPedidos(data || [])
    setCargando(false)
  }
  useEffect(() => {
    cargar()
    // Recontar con SELECT en cada cambio (payload.old sólo trae la PK).
    const canal = supabase.channel('delivery-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_delivery' }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  const def = FILTROS.find(f => f.key === filtro)
  const lista = pedidos.filter(p => def.estados.includes(p.estado))
  const conteo = k => pedidos.filter(p => FILTROS.find(f => f.key === k).estados.includes(p.estado)).length
  const sel = pedidos.find(p => p.id === selId) || null

  const listaJsx = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTROS.map(f => (
          <button key={f.key} onClick={() => setFiltro(f.key)} className={filtro === f.key ? 'btn btn-gold' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '7px 12px' }}>
            {f.label} · {conteo(f.key)}
          </button>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 0, padding: 0, overflow: 'hidden' }}>
        {cargando && <div style={{ padding: 18, color: 'var(--muted)' }}>Cargando…</div>}
        {!cargando && lista.length === 0 && (
          <div style={{ padding: 18, color: 'var(--muted)', fontSize: 14 }}>
            {filtro === 'activos' ? 'No hay pedidos en curso. Los nuevos aparecen acá solos, sin recargar.' : 'No hay pedidos en esta lista.'}
          </div>
        )}
        {lista.map(p => {
          return (
            <button key={p.id} onClick={() => setSelId(p.id)} style={{
              display: 'grid', gridTemplateColumns: esMovil ? '1fr auto' : '70px 1.2fr 1.6fr 70px 120px 130px', gap: 10, alignItems: 'center',
              width: '100%', padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer',
              background: p.id === selId ? 'var(--surface3)' : 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13,
            }}>
              {esMovil ? (
                <>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <b>N° {p.id} · {p.cliente_nombre}</b>
                    <span style={{ color: 'var(--text2)', fontSize: 12 }}>{p.direccion} · {hora(p.created_at)}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <Chip estado={p.estado} />
                    <span style={{ fontSize: 12 }}>{pesos(p.total_final ?? p.total_aprox)}</span>
                  </span>
                </>
              ) : (
                <>
                  <b>N° {p.id}</b>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cliente_nombre}</span>
                  <span style={{ color: 'var(--text2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.direccion}</span>
                  <span style={{ color: 'var(--text2)' }}>{hora(p.created_at)}</span>
                  <span>{p.total_final != null ? pesos(p.total_final) : `≈ ${pesos(p.total_aprox)}`}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip estado={p.estado} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.forma_pago === 'transferencia' ? 'Transf.' : 'Efectivo'}</span>
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )

  if (esMovil && sel) {
    return <Detalle key={sel.id} pedido={sel} config={config} onVolver={() => setSelId(null)} />
  }
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexDirection: esMovil ? 'column' : 'row' }}>
      {listaJsx}
      {!esMovil && (
        <div style={{ width: 430, flexShrink: 0 }}>
          {sel ? <Detalle key={sel.id} pedido={sel} config={config} />
            : <div className="card" style={{ marginBottom: 0, color: 'var(--muted)', fontSize: 14 }}>Elegí un pedido de la lista para pesarlo y avanzarlo.</div>}
        </div>
      )}
    </div>
  )
}

function Chip({ estado }) {
  const e = ESTADOS[estado] || { label: estado, color: '#6b7280' }
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: e.color, color: '#fff', whiteSpace: 'nowrap' }}>{e.label}</span>
}

function Detalle({ pedido: p, config, onVolver }) {
  const navigate = useNavigate()
  // Los renglones se editan acá (pesos, "no hay", cambio por otro producto)
  // y se guardan todos juntos con "Guardar pesos".
  const [items, setItems] = useState(() => Array.isArray(p.items) ? p.items : [])
  // Kilos reales tipeados (texto crudo: type=text + parseNumero, la coma no se pierde)
  const [kgTxt, setKgTxt] = useState(() => items.map(i => i.pesable ? (i.kg_real != null ? String(i.kg_real).replace('.', ',') : '') : String(i.cantidad)))
  const [cambiando, setCambiando] = useState(null)   // índice del renglón que se está reemplazando
  const [catalogo, setCatalogo] = useState(null)
  const [busca, setBusca] = useState('')

  async function abrirCambio(idx) {
    setCambiando(cambiando === idx ? null : idx)
    setBusca('')
    if (!catalogo) {
      const { data } = await supabase.rpc('delivery_productos')
      setCatalogo(data || [])
    }
  }
  // Que el resto de los clientes ya no lo pueda pedir (mig 158).
  async function marcarSinStockApp(it) {
    const { error } = await supabase.from('precios').update({ delivery_sin_stock: true }).eq('id', it.producto_id)
    setMsg(error ? { tipo: 'error', texto: `No se pudo: ${error.message}` }
      : { tipo: 'ok', texto: `${nombreLindo(it.nombre)} quedó SIN STOCK en la app. Se vuelve a habilitar en Productos publicados.` })
  }
  function alternarSinStock(idx) {
    setItems(xs => xs.map((x, j) => j === idx ? { ...x, sin_stock: !x.sin_stock } : x))
    setMsg(null)
  }
  function reemplazar(idx, prod) {
    setItems(xs => xs.map((x, j) => {
      if (j !== idx) return x
      const cantidad = prod.pesable === x.pesable ? Number(x.cantidad) : 1
      return {
        producto_id: prod.id, nombre: prod.nombre, categoria: prod.categoria, pesable: prod.pesable,
        cantidad, precio: Number(prod.precio), oferta: prod.oferta, importe: Math.round(cantidad * Number(prod.precio)),
        nota: x.nota || null, reemplaza: x.reemplaza || x.nombre,
      }
    }))
    setKgTxt(v => v.map((t, j) => j === idx ? (prod.pesable ? '' : '1') : t))
    setCambiando(null)
    setMsg(null)
  }
  const [editando, setEditando] = useState(p.estado === 'nuevo')
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')

  const calc = items.map((it, idx) => {
    if (it.sin_stock) return { ...it, kg_real: it.pesable ? 0 : null, importe_real: 0 }
    const kg = it.pesable ? parseNumero(kgTxt[idx]) : Number(it.cantidad)
    return { ...it, kg_real: it.pesable ? kg : null, importe_real: Math.round(kg * Number(it.precio)) }
  })
  const faltanPesos = calc.some(i => !i.sin_stock && i.pesable && !(i.kg_real > 0))
  const todoSinStock = calc.length > 0 && calc.every(i => i.sin_stock)
  const subtotalFinal = calc.reduce((s, i) => s + i.importe_real, 0)
  const envio = Number(p.envio) || 0
  // Cupón (mig 157): el % se fijó al crear el pedido; el monto se recalcula
  // sobre la carne PESADA. El envío no tiene descuento.
  const pctCupon = p.cupon ? Number(p.descuento_pct) || 0 : 0
  const descuentoFinal = Math.round(subtotalFinal * pctCupon / 100)
  const totalFinal = subtotalFinal - descuentoFinal + envio
  const esTransf = p.forma_pago === 'transferencia'
  const terminado = ['entregado', 'cancelado'].includes(p.estado)

  async function actualizar(cambios, ok) {
    setGuardando(true)
    const { error } = await supabase.from('pedidos_delivery')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', p.id)
    setGuardando(false)
    if (error) { setMsg({ tipo: 'error', texto: `No se pudo guardar: ${error.message}` }); return false }
    if (ok) setMsg({ tipo: 'ok', texto: ok })
    return true
  }

  async function guardarPesos() {
    if (todoSinStock) { setMsg({ tipo: 'error', texto: 'No queda ningún producto: si no hay nada, cancelá el pedido.' }); return }
    if (faltanPesos) { setMsg({ tipo: 'error', texto: 'Cargá el peso real de cada producto (o marcalo "No hay").' }); return }
    const raro = calc.find(i => i.pesable && (i.kg_real > Number(i.cantidad) * 2 + 0.5 || i.kg_real > 25))
    if (raro && !msg?.confirmarRaro) {
      setMsg({ tipo: 'error', texto: `Ojo: ${nombreLindo(raro.nombre)} pidió ${fmtCantidad(raro.cantidad, true)} y cargaste ${fmtCantidad(raro.kg_real, true)}. Si está bien, tocá de nuevo "Guardar".`, confirmarRaro: true })
      return
    }
    const ok = await actualizar({
      items: calc, subtotal_final: subtotalFinal, total_final: totalFinal,
      descuento_monto: p.cupon ? descuentoFinal : null,
      estado: p.estado === 'nuevo' ? 'pesado' : p.estado,
      pesado_at: p.pesado_at || new Date().toISOString(),
    }, 'Pesos guardados. Ahora mandale el total al cliente por WhatsApp 👇')
    if (ok) setEditando(false)
  }

  function cobrarEnCaja() {
    navigate('/admin/caja', { state: { deliveryId: p.id } })
  }

  async function cancelar() {
    if (!motivo.trim()) { setMsg({ tipo: 'error', texto: 'Escribí el motivo (lo ve el cliente).' }); return }
    const ok = await actualizar({ estado: 'cancelado', cancelado_at: new Date().toISOString(), motivo_cancelacion: motivo.trim() }, 'Pedido cancelado.')
    if (ok) setCancelando(false)
  }

  const puedeCobrar = !p.venta_id && ['pesado', 'pagado', 'en_camino', 'entregado'].includes(p.estado)
  const puedeSalir = (p.estado === 'pesado' && !esTransf) || p.estado === 'pagado'

  return (
    <div className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {onVolver && <button onClick={onVolver} className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12 }}>← Volver a la lista</button>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Pedido N° {p.id} · {fechaHora(p.created_at)} · {esTransf ? 'Transferencia' : 'Efectivo al recibir'}</span>
          <b style={{ fontSize: 18 }}>{p.cliente_nombre}{p.cupon && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#000', background: 'var(--gold)', borderRadius: 8, padding: '2px 7px', verticalAlign: 'middle' }}>🎁 CUPÓN {Number(p.descuento_pct)}%</span>}</b>
          <span style={{ fontSize: 14 }}>📍 {p.direccion}{p.referencias ? ` — ${p.referencias}` : ''}</span>
          <a href={`https://wa.me/${limpiarNumero(p.telefono)}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--green)', textDecoration: 'none', fontWeight: 600 }}>💬 {p.telefono}</a>
        </div>
        <Chip estado={p.estado} />
      </div>

      {p.estado === 'pesado' && esTransf && (
        <div style={{ padding: '10px 12px', borderRadius: 8, fontSize: 13, background: p.transferencia_avisada_at ? 'rgba(39,174,96,.12)' : 'rgba(230,126,34,.12)', color: p.transferencia_avisada_at ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
          {p.transferencia_avisada_at
            ? `El cliente avisó que transfirió (${hora(p.transferencia_avisada_at)}). Revisá que haya entrado a ${config?.alias || 'la cuenta'} y confirmá el pago.`
            : `Esperando la transferencia de ${pesos(p.total_final)} a ${config?.alias || 'la cuenta'}.`}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1fr 0.9fr', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
        <span>Producto</span><span>Pidió</span><span>Pesado</span><span style={{ textAlign: 'right' }}>Importe</span>
      </div>
      {calc.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 6, borderBottom: '1px dashed var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1fr 0.9fr', gap: 8, alignItems: 'center', fontSize: 13, opacity: it.sin_stock ? 0.55 : 1 }}>
          <span style={{ minWidth: 0, textDecoration: it.sin_stock ? 'line-through' : 'none' }}>
            {nombreRenglon(it)}{it.oferta && <span style={{ color: 'var(--red-light)', fontSize: 10, fontWeight: 700 }}> OFERTA</span>}
            {it.nota && <span style={{ display: 'block', fontSize: 11, color: 'var(--amber)' }}>«{it.nota}»</span>}
          </span>
          <span style={{ color: 'var(--text2)' }}>{fmtCantidad(it.cantidad, it.pesable)}</span>
          {it.sin_stock ? (
            <span style={{ color: 'var(--red-light)', fontWeight: 700, fontSize: 12 }}>No hay</span>
          ) : it.pesable && editando && !terminado ? (
            <input type="text" inputMode="decimal" value={kgTxt[idx]} placeholder="kg"
              onChange={e => { const v = [...kgTxt]; v[idx] = e.target.value; setKgTxt(v); setMsg(null) }}
              aria-label={`Kilos pesados de ${it.nombre}`} style={{ padding: '7px 8px', fontSize: 14 }} />
          ) : (
            <span>{it.pesable ? (it.kg_real > 0 ? fmtCantidad(it.kg_real, true) : '—') : fmtCantidad(it.cantidad, false)}</span>
          )}
          <span style={{ textAlign: 'right' }}>{it.sin_stock || (it.pesable && !(it.kg_real > 0)) ? '—' : pesos(it.importe_real)}</span>
        </div>
        {editando && !terminado && !p.venta_id && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => alternarSinStock(idx)} className="btn btn-ghost btn-sm" style={{ color: it.sin_stock ? 'var(--green)' : 'var(--red-light)' }}>
              {it.sin_stock ? '↩ Sí hay' : '✕ No hay'}
            </button>
            <button onClick={() => abrirCambio(idx)} className="btn btn-ghost btn-sm">⇄ Cambiar por otro</button>
            {it.sin_stock && it.producto_id && (
              <button onClick={() => marcarSinStockApp(it)} className="btn btn-ghost btn-sm" title="Que los próximos clientes no lo puedan pedir">🚫 Sin stock en la app</button>
            )}
            <a href={waLink(p.telefono, mensajeSinStock(p, it))} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', color: 'var(--green)' }}>
              💬 Preguntarle
            </a>
          </div>
        )}
        {cambiando === idx && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px solid var(--border2)', borderRadius: 8 }}>
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar el producto que lo reemplaza" style={{ padding: '7px 9px', fontSize: 13 }} />
            {!catalogo && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Cargando productos…</span>}
            {catalogo && (
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {catalogo
                  .filter(c => c.id !== it.producto_id && (!busca.trim() || c.nombre.toLowerCase().includes(busca.trim().toLowerCase())))
                  .slice(0, 40)
                  .map(c => (
                    <button key={c.id} onClick={() => reemplazar(idx, c)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 6px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13, textAlign: 'left', fontFamily: 'inherit' }}>
                      <span>{nombreLindo(c.nombre)}</span>
                      <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>{pesos(c.precio)}{c.pesable ? '/kg' : ' c/u'}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        <Linea l="Carne" v={faltanPesos ? `≈ ${pesos(p.subtotal_aprox)} (pedido)` : pesos(subtotalFinal)} />
        {!faltanPesos && subtotalFinal < Number(config?.minimo || 0) && (
          <span style={{ fontSize: 11, color: 'var(--amber)' }}>Quedó abajo de la compra mínima ({pesos(config.minimo)}) por lo que no había. Igual se puede enviar.</span>
        )}
        {pctCupon > 0 && <Linea l={`🎁 Cupón ${pctCupon}% (carne)`} v={`-${pesos(faltanPesos ? p.descuento_monto : descuentoFinal)}`} />}
        <Linea l="Envío" v={pesos(envio)} />
        <Linea l={faltanPesos ? 'Total aproximado' : 'Total final'} v={faltanPesos ? `≈ ${pesos(p.total_aprox)}` : pesos(totalFinal)} fuerte />
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.tipo === 'error' ? 'var(--red-light)' : 'var(--green)' }}>{msg.texto}</div>}

      {!terminado && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {editando && !p.venta_id && (
            <button disabled={guardando} onClick={guardarPesos} className="btn btn-gold" style={{ padding: 12, fontWeight: 700 }}>
              {guardando ? 'Guardando…' : p.estado === 'nuevo' ? '⚖️ Guardar pesos' : '⚖️ Guardar pesos corregidos'}
            </button>
          )}
          {!editando && !p.venta_id && ['pesado', 'pagado'].includes(p.estado) && (
            <button onClick={() => setEditando(true)} className="btn btn-ghost" style={{ fontSize: 12 }}>✏️ Corregir pesos</button>
          )}
          {!editando && p.total_final != null && (
            <a href={waLink(p.telefono, mensajeTotalFinal(p, config))} target="_blank" rel="noreferrer"
              className={p.estado === 'pesado' ? 'btn btn-green' : 'btn btn-ghost'} style={{ fontSize: p.estado === 'pesado' ? 14 : 12, textDecoration: 'none', padding: p.estado === 'pesado' ? 11 : undefined }}>
              💬 {p.estado === 'pesado' ? 'Mandar el total por WhatsApp' : 'Reenviar total por WhatsApp'}
            </a>
          )}
          {p.estado === 'pesado' && esTransf && (
            <button disabled={guardando} onClick={() => actualizar({ estado: 'pagado', pagado_at: new Date().toISOString() }, 'Pago confirmado.')} className="btn btn-gold" style={{ padding: 11 }}>
              ✅ Confirmar que entró la transferencia
            </button>
          )}
          {puedeCobrar && (
            <button onClick={cobrarEnCaja} className="btn btn-gold" style={{ padding: 11, background: 'var(--gold)', color: '#000' }}>
              💵 Cobrar en Caja ({pesos(p.total_final)})
            </button>
          )}
          {p.venta_id && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Cobrado en Caja</div>}
          {puedeSalir && (
            <button disabled={guardando || !p.venta_id} onClick={() => actualizar({ estado: 'en_camino', en_camino_at: new Date().toISOString() }, 'Marcado en camino.')}
              className="btn btn-ghost" style={{ padding: 11, opacity: p.venta_id ? 1 : 0.5 }}
              title={p.venta_id ? '' : 'Primero cobralo en la Caja'}>
              🛵 Salió con el repartidor{!p.venta_id ? ' (cobralo en Caja primero)' : ''}
            </button>
          )}
          {p.estado === 'en_camino' && (
            <a href={waLink(p.telefono, mensajeEnCamino(p))} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ fontSize: 12, textDecoration: 'none' }}>
              💬 Avisarle al cliente que salió
            </a>
          )}
          {p.estado === 'en_camino' && (
            <button disabled={guardando} onClick={() => actualizar({ estado: 'entregado', entregado_at: new Date().toISOString() }, '¡Entregado!')} className="btn btn-gold" style={{ padding: 11 }}>
              📦 Entregado
            </button>
          )}
          {!p.venta_id && !cancelando && (
            <button onClick={() => setCancelando(true)} className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red-light)' }}>Cancelar pedido</button>
          )}
          {cancelando && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, border: '1px solid var(--red)' }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>¿Por qué se cancela? (lo ve el cliente)</span>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: no tenemos vacío hoy" maxLength={200} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={cancelar} disabled={guardando} className="btn" style={{ background: 'var(--red)', color: '#fff', flex: 1 }}>Sí, cancelar</button>
                <button onClick={() => setCancelando(false)} className="btn btn-ghost" style={{ flex: 1 }}>No</button>
              </div>
            </div>
          )}
        </div>
      )}
      <a href={linkSeguimiento(p.token)} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--muted)' }}>Ver lo que ve el cliente ↗</a>
    </div>
  )
}

function Linea({ l, v, fuerte }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: fuerte ? 800 : 400, fontSize: fuerte ? 15 : 13 }}><span>{l}</span><span>{v}</span></div>
}

// ───────────────────────── CLIENTES ─────────────────────────
// Cuentas del delivery (mig 157) con lo que compró cada una. "Comprado"
// cuenta sólo pedidos ENTREGADOS, con su total final (lo que pagó).
function Clientes({ config }) {
  const [clientes, setClientes] = useState([])
  const [pedidos, setPedidos] = useState([])
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    const [{ data: cs }, { data: ps }] = await Promise.all([
      // Columnas explícitas: el hash de la clave no es legible ni para el panel.
      supabase.from('clientes_delivery').select('id, telefono, nombre, direccion, referencias, notas, created_at, ultimo_ingreso, bloqueado_hasta').order('nombre'),
      fetchAllRows(() => supabase.from('pedidos_delivery').select('id, cliente_id, estado, total_final, total_aprox, created_at, cupon, descuento_monto').not('cliente_id', 'is', null)),
    ])
    setClientes(cs || [])
    setPedidos(ps || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const cada = Number(config?.cupon_cada) || 0
  const pct = Number(config?.cupon_pct) || 0
  const filas = clientes.map(c => {
    const suyos = pedidos.filter(p => p.cliente_id === c.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const entregados = suyos.filter(p => p.estado === 'entregado')
    const comprado = entregados.reduce((s, p) => s + (Number(p.total_final) || 0), 0)
    const usados = suyos.filter(p => p.cupon && p.estado !== 'cancelado').length
    const cuponDisponible = cada > 0 && pct > 0 && Math.floor(entregados.length / cada) > usados
    return {
      ...c, suyos, entregados: entregados.length, comprado,
      promedio: entregados.length ? comprado / entregados.length : 0,
      ultimo: suyos[0]?.created_at || null,
      cupones: usados, cuponDisponible,
      faltan: cada > 0 ? cada - (entregados.length % cada) : null,
    }
  }).sort((a, b) => b.comprado - a.comprado)

  const t = q.trim().toLowerCase()
  const visibles = filas.filter(c => !t || c.nombre.toLowerCase().includes(t) || c.telefono.includes(t.replace(/\D/g, '') || '@'))
  const totalComprado = filas.reduce((s, c) => s + c.comprado, 0)
  const totalEntregados = filas.reduce((s, c) => s + c.entregados, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Resumen titulo="Clientes con cuenta" valor={filas.length} />
        <Resumen titulo="Pedidos entregados" valor={totalEntregados} />
        <Resumen titulo="Total comprado" valor={pesos(totalComprado)} />
        <Resumen titulo="Ticket promedio" valor={totalEntregados ? pesos(totalComprado / totalEntregados) : '—'} />
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o teléfono" style={{ maxWidth: 360 }} />
      <div className="card" style={{ marginBottom: 0, padding: 0, overflowX: 'auto' }}>
        {cargando && <div style={{ padding: 16, color: 'var(--muted)' }}>Cargando…</div>}
        {!cargando && visibles.length === 0 && <div style={{ padding: 16, color: 'var(--muted)', fontSize: 14 }}>Todavía no hay clientes con cuenta. Aparecen acá apenas se registran en la app.</div>}
        {visibles.map(c => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setAbierto(abierto === c.id ? null : c.id)} style={{
              display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 90px 120px 110px 110px minmax(130px, 1fr)', gap: 10, alignItems: 'center', minWidth: 760,
              width: '100%', padding: '11px 14px', border: 0, background: abierto === c.id ? 'var(--surface3)' : 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <b>{c.nombre}</b><span style={{ color: 'var(--text2)', fontSize: 12 }}>{c.telefono}</span>
              </span>
              <span><b>{c.entregados}</b> <span style={{ color: 'var(--muted)', fontSize: 11 }}>pedidos</span></span>
              <span>{pesos(c.comprado)}</span>
              <span style={{ color: 'var(--text2)' }}>{c.entregados ? `prom. ${pesos(c.promedio)}` : '—'}</span>
              <span style={{ color: 'var(--text2)' }}>{c.ultimo ? fechaHora(c.ultimo).split(',')[0] : '—'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.cuponDisponible ? 'var(--gold)' : 'var(--muted)' }}>
                {c.cuponDisponible ? `🎁 Tiene cupón ${pct}%` : c.faltan != null && pct > 0 ? `Le faltan ${c.faltan} para el cupón` : ''}
              </span>
            </button>
            {abierto === c.id && <FichaCliente cliente={c} onCambio={cargar} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Resumen({ titulo, valor }) {
  return (
    <div className="card" style={{ marginBottom: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>{titulo}</span>
      <b style={{ fontSize: 20, fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{valor}</b>
    </div>
  )
}

function FichaCliente({ cliente: c, onCambio }) {
  const [pin, setPin] = useState('')
  const [notas, setNotas] = useState(c.notas || '')
  const [msg, setMsg] = useState(null)

  async function resetear() {
    if (!/^\d{4}$/.test(pin)) { setMsg({ error: true, t: 'La clave nueva tiene que ser de 4 números.' }); return }
    const { error } = await supabase.rpc('delivery_resetear_pin', { p_cliente: c.id, p_pin: pin })
    if (error) { setMsg({ error: true, t: `No se pudo: ${error.message}` }); return }
    setPin('')
    setMsg({ t: `Listo. Pasale la clave nueva a ${c.nombre.split(' ')[0]} por WhatsApp; puede cambiarla escribiéndonos.` })
    onCambio()
  }
  async function guardarNotas() {
    const { error } = await supabase.from('clientes_delivery').update({ notas: notas.trim() || null }).eq('id', c.id)
    setMsg(error ? { error: true, t: `No se pudo: ${error.message}` } : { t: 'Notas guardadas.' })
  }

  return (
    <div style={{ padding: '4px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
      <div style={{ color: 'var(--text2)' }}>
        📍 {c.direccion}{c.referencias ? ` — ${c.referencias}` : ''} · cliente desde {fechaHora(c.created_at).split(',')[0]}
        {' · '}<a href={`https://wa.me/${limpiarNumero(c.telefono)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green)', fontWeight: 600 }}>💬 WhatsApp</a>
        {c.bloqueado_hasta && new Date(c.bloqueado_hasta) > new Date() && <span style={{ color: 'var(--red-light)', fontWeight: 700 }}> · 🔒 bloqueado por claves mal puestas</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontSize: 12, color: 'var(--text2)' }}>Historial</b>
        {c.suyos.length === 0 && <span style={{ color: 'var(--muted)' }}>Sin pedidos todavía.</span>}
        {c.suyos.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 60 }}>N° {p.id}</span>
            <span style={{ width: 110, color: 'var(--text2)' }}>{fechaHora(p.created_at)}</span>
            <Chip estado={p.estado} />
            <span>{p.total_final != null ? pesos(p.total_final) : `≈ ${pesos(p.total_aprox)}`}</span>
            {p.cupon && <span style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700 }}>🎁 cupón</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
          Se olvidó la clave → clave nueva
          <input type="text" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 números" style={{ width: 140 }} />
        </label>
        <button onClick={resetear} className="btn btn-ghost">🔑 Resetear clave</button>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
        Notas internas (no las ve el cliente)
        <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} maxLength={500} placeholder="Ej: el timbre no anda, llamar al llegar" />
      </label>
      <button onClick={guardarNotas} className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>Guardar notas</button>
      {msg && <span style={{ fontWeight: 600, color: msg.error ? 'var(--red-light)' : 'var(--green)' }}>{msg.t}</span>}
    </div>
  )
}

// ───────────────────────── PRODUCTOS ─────────────────────────
function Productos({ config }) {
  const [productos, setProductos] = useState([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const cats = config?.categorias || CATEGORIAS_DELIVERY.map(c => c.key)

  async function cargar() {
    const { data } = await supabase.from('precios')
      .select('id, nombre, categoria, precio_minorista, pesable, vende_por_pieza, delivery_oculto, delivery_sin_stock')
      .is('sucursal_id', null).in('categoria', cats).gt('precio_minorista', 0).order('nombre')
    setProductos((data || []).filter(p => !p.vende_por_pieza))
  }
  useEffect(() => { if (config) cargar() }, [config])

  async function alternar(p) {
    const { error } = await supabase.from('precios').update({ delivery_oculto: !p.delivery_oculto }).eq('id', p.id)
    if (error) { setMsg(`No se pudo cambiar: ${error.message}`); return }
    setProductos(ps => ps.map(x => x.id === p.id ? { ...x, delivery_oculto: !x.delivery_oculto } : x))
  }

  async function alternarStock(p) {
    const { error } = await supabase.from('precios').update({ delivery_sin_stock: !p.delivery_sin_stock }).eq('id', p.id)
    if (error) { setMsg(`No se pudo cambiar: ${error.message}`); return }
    setProductos(ps => ps.map(x => x.id === p.id ? { ...x, delivery_sin_stock: !x.delivery_sin_stock } : x))
  }

  const t = q.trim().toLowerCase()
  const visibles = productos.filter(p => !t || p.nombre.toLowerCase().includes(t))
  const publicados = productos.filter(p => !p.delivery_oculto).length
  const agotados = productos.filter(p => !p.delivery_oculto && p.delivery_sin_stock)
  return (
    <div className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
        Se publican con el <b>precio minorista</b> de la lista y las ofertas vigentes de la central. Apagá los que no querés que aparezcan en el delivery.
        <br /><b style={{ color: 'var(--text)' }}>{publicados}</b> de {productos.length} publicados.
        {' '}<b style={{ color: 'var(--text)' }}>Sin stock</b> = el cliente lo ve en gris y no lo puede pedir, hasta que lo vuelvas a habilitar.
      </div>
      {agotados.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <b style={{ color: 'var(--red-light)' }}>Sin stock ahora ({agotados.length}):</b>
          {agotados.map(p => (
            <button key={p.id} onClick={() => alternarStock(p)} className="btn btn-ghost btn-sm" title="Volver a habilitar">{nombreLindo(p.nombre)} ✓ hay</button>
          ))}
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto" style={{ maxWidth: 360 }} />
      {msg && <div style={{ color: 'var(--red-light)', fontSize: 13 }}>{msg}</div>}
      {CATEGORIAS_DELIVERY.filter(c => cats.includes(c.key)).map(c => {
        const ps = visibles.filter(p => p.categoria === c.key)
        if (!ps.length) return null
        return (
          <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 }}>{c.label}</div>
            {ps.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={!p.delivery_oculto} onChange={() => alternar(p)} />
                <span style={{ flex: 1, opacity: p.delivery_oculto ? 0.5 : 1 }}>{nombreLindo(p.nombre)}</span>
                <span style={{ color: 'var(--text2)' }}>{pesos(p.precio_minorista)}{p.pesable === false ? ' c/u' : ' /kg'}</span>
                {!p.delivery_oculto && (
                  <button onClick={e => { e.preventDefault(); alternarStock(p) }} className="btn btn-sm" style={{
                    minWidth: 92, fontWeight: 700,
                    background: p.delivery_sin_stock ? 'var(--red)' : 'transparent', color: p.delivery_sin_stock ? '#fff' : 'var(--text2)',
                    border: `1px solid ${p.delivery_sin_stock ? 'var(--red)' : 'var(--border2)'}`,
                  }}>{p.delivery_sin_stock ? 'SIN STOCK' : 'Hay'}</button>
                )}
              </label>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────── CONFIGURACIÓN ─────────────────────────
const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']]

function Configuracion({ config, onGuardar }) {
  const [f, setF] = useState(() => ({
    envio: String(config.envio ?? ''), minimo: String(config.minimo ?? ''),
    alias: config.alias || '', whatsapp: config.whatsapp || '',
    cupon_cada: String(config.cupon_cada ?? 5), cupon_pct: String(config.cupon_pct ?? 10),
    horarios: (config.horarios || []).map(h => ({ ...h })),
  }))
  const [msg, setMsg] = useState(null)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setMsg(null) }
  const setTurno = (i, k, v) => set('horarios', f.horarios.map((h, j) => j === i ? { ...h, [k]: v } : h))
  const toggleDia = (i, d) => setTurno(i, 'dias', f.horarios[i].dias.includes(d) ? f.horarios[i].dias.filter(x => x !== d) : [...f.horarios[i].dias, d].sort())

  async function guardar() {
    const envio = Math.round(parseNumero(f.envio))
    const minimo = Math.round(parseNumero(f.minimo))
    if (envio < 0 || minimo < 0) { setMsg({ error: true, t: 'Revisá el envío y el mínimo.' }); return }
    if (!f.alias.trim()) { setMsg({ error: true, t: 'Falta el alias para las transferencias.' }); return }
    if (f.horarios.some(h => !h.desde || !h.hasta || h.desde >= h.hasta || !h.dias.length)) {
      setMsg({ error: true, t: 'Cada turno necesita días y un horario de inicio anterior al de cierre.' }); return
    }
    const cupon_cada = Math.round(parseNumero(f.cupon_cada))
    const cupon_pct = parseNumero(f.cupon_pct)
    if (cupon_cada < 0 || cupon_pct < 0 || cupon_pct > 50) { setMsg({ error: true, t: 'Revisá el cupón: el descuento va de 0 a 50%.' }); return }
    const err = await onGuardar({ envio, minimo, alias: f.alias.trim(), whatsapp: f.whatsapp.replace(/[^\d+ ]/g, '').trim(), horarios: f.horarios, cupon_cada, cupon_pct })
    setMsg(err ? { error: true, t: `No se pudo guardar: ${err}` } : { t: 'Guardado. La app de los clientes ya usa estos datos.' })
  }

  const campo = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }
  return (
    <div className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={campo}>Costo del envío ($)<input type="text" inputMode="numeric" value={f.envio} onChange={e => set('envio', e.target.value)} /></label>
        <label style={campo}>Compra mínima ($)<input type="text" inputMode="numeric" value={f.minimo} onChange={e => set('minimo', e.target.value)} /></label>
        <label style={campo}>Alias para transferencias<input value={f.alias} onChange={e => set('alias', e.target.value)} /></label>
        <label style={campo}>WhatsApp del local (comprobantes)
          <input type="tel" value={f.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="Ej: 3574 412345" />
          <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>Vacío = el cliente no ve el botón para mandar el comprobante.</span>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={campo}>🎁 Cupón cada… (pedidos entregados)<input type="text" inputMode="numeric" value={f.cupon_cada} onChange={e => set('cupon_cada', e.target.value)} /></label>
        <label style={campo}>…de este % en la carne<input type="text" inputMode="decimal" value={f.cupon_pct} onChange={e => set('cupon_pct', e.target.value)} /></label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: -8 }}>Con 0 en cualquiera de los dos no se dan cupones. El envío nunca tiene descuento.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>Horarios de toma de pedidos (hora de Argentina)</div>
        {f.horarios.map((h, i) => (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {DIAS.map(([d, l]) => (
                <button key={d} onClick={() => toggleDia(i, d)} className={h.dias.includes(d) ? 'btn btn-gold' : 'btn btn-ghost'} style={{ fontSize: 11, padding: '5px 8px' }}>{l}</button>
              ))}
            </div>
            <input type="time" value={h.desde} onChange={e => setTurno(i, 'desde', e.target.value)} style={{ width: 120 }} aria-label="Desde" />
            <span style={{ color: 'var(--text2)' }}>a</span>
            <input type="time" value={h.hasta} onChange={e => setTurno(i, 'hasta', e.target.value)} style={{ width: 120 }} aria-label="Hasta" />
            <button onClick={() => set('horarios', f.horarios.filter((_, j) => j !== i))} className="btn btn-ghost" style={{ fontSize: 11, color: 'var(--red-light)' }}>Quitar</button>
          </div>
        ))}
        <button onClick={() => set('horarios', [...f.horarios, { dias: [1, 2, 3, 4, 5, 6], desde: '09:00', hasta: '12:00' }])} className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 12 }}>+ Agregar turno</button>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Hoy: {textoHorarios({ horarios: f.horarios }).map(t => `${t.dias} ${t.turnos}`).join(' · ') || 'sin turnos'}
        </div>
      </div>
      {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.error ? 'var(--red-light)' : 'var(--green)' }}>{msg.t}</div>}
      <button onClick={guardar} className="btn btn-gold" style={{ alignSelf: 'flex-start' }}>Guardar</button>
    </div>
  )
}
