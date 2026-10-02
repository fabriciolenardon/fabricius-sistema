// ============================================================
// /pedir — App de delivery para el público (sin usuario)
// ============================================================
// Inicio → catálogo → elegir cantidad → tu pedido → seguimiento.
// Todo en una sola pantalla con `vista`, para que el carrito no se
// pierda entre pasos; además queda guardado en el celular (localStorage)
// por si cierra la pestaña.
//
// El precio que se muestra es APROXIMADO: la carne se pesa al preparar
// el pedido y el local avisa el total exacto por WhatsApp. El servidor
// (delivery_crear_pedido) recalcula todo y vuelve a validar horario y
// mínimo: lo que valida esta pantalla es sólo para avisar antes.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { parseNumero } from '../../lib/formatos'
import {
  CATEGORIAS_DELIVERY, OPCIONES_KG, labelKg, pesos, fmtCantidad,
  cierraA, proximaApertura, textoHorarios, mensajeError, nombreLindo,
} from '../../lib/delivery'
import { C, F, input, btnPrimario, btnSecundario, useModoDelivery, leerLS, guardarLS } from './estilo'

const LS_CARRITO = 'fabricius_delivery_carrito'
const LS_DATOS = 'fabricius_delivery_datos'
export const LS_PEDIDOS = 'fabricius_delivery_pedidos'

const Icono = {
  pin: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>,
  volver: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>,
  mas: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  menos: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>,
  lupa: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  reloj: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  info: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.goldText} strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>,
}

export default function Pedir() {
  useModoDelivery()
  const navigate = useNavigate()
  const [cat, setCat] = useState(null)          // { config, abierto, productos }
  const [errorCarga, setErrorCarga] = useState(false)
  const [vista, setVista] = useState('inicio')  // inicio | catalogo | pedido
  const [carrito, setCarrito] = useState(() => leerLS(LS_CARRITO, []))
  const [hoja, setHoja] = useState(null)        // producto abierto en la hoja de cantidad
  const [pedidosPrevios] = useState(() => leerLS(LS_PEDIDOS, []))

  async function cargar() {
    const { data, error } = await supabase.rpc('delivery_catalogo')
    if (error || !data) { setErrorCarga(true); return }
    setErrorCarga(false)
    setCat(data)
  }
  // El "abierto/cerrado" cambia con la hora: refrescar cada minuto.
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { guardarLS(LS_CARRITO, carrito) }, [carrito])
  useEffect(() => { window.scrollTo(0, 0) }, [vista])

  const config = cat?.config
  const porId = useMemo(() => new Map((cat?.productos || []).map(p => [p.id, p])), [cat])
  // Un producto que se despublicó mientras estaba en el carrito se cae solo.
  const lineas = useMemo(() => carrito
    .map(l => ({ ...l, producto: porId.get(l.producto_id) }))
    .filter(l => l.producto)
    .map(l => ({ ...l, importe: Math.round(l.cantidad * Number(l.producto.precio)) })), [carrito, porId])
  const subtotal = lineas.reduce((s, l) => s + l.importe, 0)

  function ponerEnCarrito(producto_id, cantidad, nota) {
    setCarrito(c => {
      const sin = c.filter(l => l.producto_id !== producto_id)
      return cantidad > 0 ? [...sin, { producto_id, cantidad, nota: nota || '' }] : sin
    })
  }

  if (!cat) {
    return (
      <Pantalla>
        <Cabecera />
        <div style={{ padding: 24, color: C.muted, fontSize: 15 }}>
          {errorCarga
            ? <>No pudimos cargar los productos. Revisá tu conexión. <button onClick={cargar} style={{ ...btnSecundario, marginTop: 16 }}>Reintentar</button></>
            : 'Cargando…'}
        </div>
      </Pantalla>
    )
  }

  const abierto = !!cat.abierto
  return (
    <Pantalla>
      {vista === 'inicio' && (
        <Inicio config={config} abierto={abierto} pedidosPrevios={pedidosPrevios}
          onVer={() => setVista('catalogo')}
          onSeguir={t => navigate(`/pedir/seguimiento/${t}`)} />
      )}
      {vista === 'catalogo' && (
        <Catalogo productos={cat.productos} config={config} abierto={abierto}
          lineas={lineas} subtotal={subtotal}
          onVolver={() => setVista('inicio')} onAbrir={setHoja} onPedido={() => setVista('pedido')} />
      )}
      {vista === 'pedido' && (
        <TuPedido config={config} abierto={abierto} lineas={lineas} subtotal={subtotal}
          onVolver={() => setVista('catalogo')} onEditar={l => setHoja(l.producto)}
          onCreado={(r) => {
            setCarrito([])
            guardarLS(LS_PEDIDOS, [{ token: r.token, numero: r.numero, fecha: new Date().toISOString() }, ...leerLS(LS_PEDIDOS, [])].slice(0, 10))
            navigate(`/pedir/seguimiento/${r.token}`)
          }} />
      )}
      {hoja && (
        <HojaCantidad producto={hoja} enCarrito={carrito.find(l => l.producto_id === hoja.id)}
          onCerrar={() => setHoja(null)}
          onGuardar={(cant, nota) => { ponerEnCarrito(hoja.id, cant, nota); setHoja(null) }} />
      )}
    </Pantalla>
  )
}

function Pantalla({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: F.body }}>
      <div style={{ maxWidth: 520, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}

function Cabecera({ chico }) {
  return (
    <div style={{ background: C.ink, color: '#FFFFFF', padding: chico ? '20px 20px 18px' : '44px 24px 28px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: chico ? 24 : 34, letterSpacing: '0.04em', color: C.gold }}>FABRICIUS</div>
      <div style={{ fontSize: 15, color: '#E9E2D8' }}>Carnicería · Delivery a tu casa</div>
    </div>
  )
}

function Inicio({ config, abierto, pedidosPrevios, onVer, onSeguir }) {
  const hasta = cierraA(config)
  const proxima = proximaApertura(config)
  const horarios = textoHorarios(config)
  const ultimo = pedidosPrevios[0]
  return (
    <>
      <Cabecera />
      <div style={{ padding: '24px 24px 28px', display: 'flex', flexDirection: 'column', gap: 18, flexGrow: 1 }}>
        <h1 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 25, lineHeight: 1.2, textWrap: 'balance' }}>
          Te lo llevamos a tu casa en {config.localidad || 'Río Primero'}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, background: C.soft }}>
          {Icono.pin}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Sale de {config.sale_de}</span>
            <span style={{ fontSize: 13, color: C.muted }}>Entregamos solo dentro de {config.localidad}</span>
          </div>
        </div>

        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {abierto ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: C.verde }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2E7D4F' }} />
              Tomando pedidos ahora{hasta ? ` · hasta las ${hasta.replace(/^0/, '')}` : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: C.ink }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#9CA3AF' }} />
              {config.activo ? `Ahora no tomamos pedidos${proxima ? ` · volvemos ${proxima}` : ''}` : 'El delivery está pausado por hoy'}
            </div>
          )}
          {horarios.map((h, i) => (
            <div key={i} style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{h.dias}<br />{h.turnos}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <Dato titulo="Envío" valor={pesos(config.envio)} />
          <Dato titulo="Compra mínima" valor={pesos(config.minimo)} />
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: '#3D3632' }}>
          Pagás en <b>efectivo</b> cuando te llega, o por <b>transferencia</b> antes del envío.
        </div>

        {ultimo && (
          <button onClick={() => onSeguir(ultimo.token)} style={{ ...btnSecundario }}>
            Ver mi pedido N° {ultimo.numero}
          </button>
        )}
        <div style={{ flexGrow: 1 }} />
        <button onClick={onVer} style={btnPrimario}>{abierto ? 'Ver productos' : 'Ver precios'}</button>
      </div>
    </>
  )
}

function Dato({ titulo, valor }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 13, color: C.muted }}>{titulo}</span>
      <b style={{ fontSize: 18 }}>{valor}</b>
    </div>
  )
}

function Catalogo({ productos, config, abierto, lineas, subtotal, onVolver, onAbrir, onPedido }) {
  const cats = CATEGORIAS_DELIVERY.filter(c => productos.some(p => p.categoria === c.key))
  const hayOfertas = productos.some(p => p.oferta)
  const [catSel, setCatSel] = useState(hayOfertas ? 'ofertas' : cats[0]?.key)
  const [q, setQ] = useState('')
  const enCarrito = new Set(lineas.map(l => l.producto_id))

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t) return productos.filter(p => p.nombre.toLowerCase().includes(t))
    if (catSel === 'ofertas') return productos.filter(p => p.oferta)
    return productos.filter(p => p.categoria === catSel)
  }, [productos, catSel, q])

  const falta = Math.max(0, Number(config.minimo || 0) - subtotal)
  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: C.bg, padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onVolver} aria-label="Volver" style={btnIcono}>{Icono.volver}</button>
          <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 21, letterSpacing: '0.04em', flexGrow: 1 }}>FABRICIUS</div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 17, background: C.soft, fontWeight: 600, fontSize: 13 }}>
            {config.localidad}
          </span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 14px', borderRadius: 12, background: C.soft }}>
          {Icono.lupa}
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar un corte" aria-label="Buscar un corte"
            style={{ border: 0, background: 'transparent', color: C.ink, fontFamily: F.body, fontSize: 16, outline: 'none', flexGrow: 1, padding: 0, width: '100%' }} />
        </label>
        {!q && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {hayOfertas && <Pastilla activa={catSel === 'ofertas'} onClick={() => setCatSel('ofertas')}>Ofertas</Pastilla>}
            {cats.map(c => <Pastilla key={c.key} activa={catSel === c.key} onClick={() => setCatSel(c.key)}>{c.label}</Pastilla>)}
          </div>
        )}
      </div>

      {!abierto && (
        <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 12, background: C.aviso, color: C.avisoInk, fontSize: 14, lineHeight: 1.45 }}>
          Ahora no estamos tomando pedidos{proximaApertura(config) ? `. Volvemos ${proximaApertura(config)}` : ''}. Podés armar tu pedido y mandarlo cuando abramos.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 16px 120px' }}>
        {lista.length === 0 && <div style={{ padding: '28px 0', color: C.muted, fontSize: 15 }}>No encontramos productos{q ? ` con "${q}"` : ''}.</div>}
        {lista.map(p => (
          <button key={p.id} onClick={() => onAbrir(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', border: 0, borderBottom: '1px solid #EFEAE2', background: 'transparent', color: C.ink, textAlign: 'left', cursor: 'pointer', fontFamily: F.body, width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{nombreLindo(p.nombre)}</span>
              <span style={{ fontSize: 14, color: C.muted }}>
                {p.oferta && <span style={{ textDecoration: 'line-through', marginRight: 6 }}>{pesos(p.precio_base)}</span>}
                <span style={{ color: p.oferta ? C.rojo : C.muted, fontWeight: p.oferta ? 700 : 400 }}>{pesos(p.precio)}</span>
                {p.pesable ? ' / kg' : ' c/u'}
                {p.oferta && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: C.rojo }}>OFERTA</span>}
              </span>
            </div>
            <span aria-hidden="true" style={{
              width: 44, height: 44, borderRadius: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${C.ink}`, background: enCarrito.has(p.id) ? C.ink : '#FFFFFF', color: enCarrito.has(p.id) ? '#FFFFFF' : C.ink,
              fontWeight: 800, fontSize: 13,
            }}>
              {enCarrito.has(p.id) ? '✓' : Icono.mas}
            </span>
          </button>
        ))}
      </div>

      {lineas.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '0 16px calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
          <button onClick={onPedido} style={{ ...btnPrimario, maxWidth: 488, justifyContent: 'space-between', padding: '0 20px', minHeight: 62, boxShadow: '0 8px 24px rgba(27,23,20,.25)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
              <span style={{ fontSize: 13, color: '#E9E2D8', fontWeight: 600 }}>
                {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'} · {falta > 0 ? `te faltan ${pesos(falta)} para el mínimo` : 'mínimo cumplido ✓'}
              </span>
              <span style={{ fontSize: 17 }}>≈ {pesos(subtotal)}</span>
            </span>
            <span style={{ color: C.gold }}>Ver pedido</span>
          </button>
        </div>
      )}
    </>
  )
}

const btnIcono = {
  width: 44, height: 44, borderRadius: 22, border: 0, background: 'transparent', color: C.ink,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
}

function Pastilla({ activa, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      height: 36, padding: '0 16px', borderRadius: 18, flexShrink: 0, cursor: 'pointer', fontFamily: F.body, fontSize: 14,
      border: activa ? 0 : `1px solid ${C.line}`, background: activa ? C.ink : '#FFFFFF', color: activa ? '#FFFFFF' : C.ink, fontWeight: activa ? 700 : 600,
    }}>{children}</button>
  )
}


function HojaCantidad({ producto, enCarrito, onCerrar, onGuardar }) {
  const pesable = producto.pesable
  const inicial = enCarrito?.cantidad ?? (pesable ? 1 : 1)
  const [cant, setCant] = useState(inicial)
  const [otra, setOtra] = useState(pesable && !OPCIONES_KG.includes(inicial) ? String(inicial).replace('.', ',') : '')
  const [usaOtra, setUsaOtra] = useState(pesable && !OPCIONES_KG.includes(inicial))
  const [nota, setNota] = useState(enCarrito?.nota || '')

  const cantidad = pesable && usaOtra ? parseNumero(otra) : cant
  const valida = pesable ? cantidad >= 0.1 && cantidad <= 20 : cantidad >= 1 && cantidad <= 50
  const importe = Math.round((valida ? cantidad : 0) * Number(producto.precio))

  return (
    <div role="dialog" aria-modal="true" aria-label={nombreLindo(producto.nombre)} onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(27,23,20,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, background: '#FFFFFF', borderRadius: '20px 20px 0 0', padding: '22px 22px calc(22px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '92vh', overflowY: 'auto', fontFamily: F.body, color: C.ink }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1 }}>
            <h2 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 24 }}>{nombreLindo(producto.nombre)}</h2>
            <span style={{ fontSize: 16, color: C.muted }}>
              {producto.oferta && <span style={{ textDecoration: 'line-through', marginRight: 6 }}>{pesos(producto.precio_base)}</span>}
              <span style={{ color: producto.oferta ? C.rojo : C.muted, fontWeight: producto.oferta ? 700 : 400 }}>{pesos(producto.precio)}</span>
              {pesable ? ' por kg' : ' cada uno'}
            </span>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ ...btnIcono, fontSize: 26, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>¿Cuánto querés?</span>
          {pesable ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                {OPCIONES_KG.map(kg => (
                  <Opcion key={kg} activa={!usaOtra && cant === kg} onClick={() => { setUsaOtra(false); setCant(kg) }}>{labelKg(kg)}</Opcion>
                ))}
                <Opcion activa={usaOtra} onClick={() => setUsaOtra(true)}>Otra</Opcion>
              </div>
              {usaOtra && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
                  <input type="text" inputMode="decimal" autoFocus value={otra} onChange={e => setOtra(e.target.value)}
                    placeholder="Ej: 2,5" aria-label="Kilos" style={{ ...input, width: 140 }} />
                  kg
                </label>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={() => setCant(c => Math.max(1, c - 1))} aria-label="Uno menos" style={{ ...btnIcono, border: `1px solid ${C.ink}` }}>{Icono.menos}</button>
              <span style={{ fontSize: 22, fontWeight: 800, minWidth: 40, textAlign: 'center' }}>{cant}</span>
              <button onClick={() => setCant(c => Math.min(50, c + 1))} aria-label="Uno más" style={{ ...btnIcono, border: `1px solid ${C.ink}` }}>{Icono.mas}</button>
            </div>
          )}
        </div>

        {pesable && (
          <div style={{ display: 'flex', gap: 10, padding: 14, borderRadius: 12, background: C.aviso, fontSize: 14, lineHeight: 1.5, color: C.avisoInk }}>
            {Icono.info}
            <span><b>El precio es aproximado.</b> La carne se pesa cuando preparamos tu pedido y te avisamos el total exacto antes de enviarlo.</span>
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontWeight: 700, fontSize: 15 }}>
          Indicaciones para el carnicero <span style={{ fontWeight: 400, fontSize: 13, color: C.muted, marginTop: -4 }}>Opcional</span>
          <textarea value={nota} onChange={e => setNota(e.target.value)} maxLength={200} rows={2}
            placeholder="Ej: en una sola pieza, sin grasa, cortado fino"
            style={{ ...input, height: 'auto', padding: 12, resize: 'none', fontWeight: 400 }} />
        </label>

        <button disabled={!valida} onClick={() => onGuardar(Math.round(cantidad * 1000) / 1000, nota.trim())}
          style={{ ...btnPrimario, opacity: valida ? 1 : 0.5 }}>
          {valida
            ? `${enCarrito ? 'Actualizar' : 'Agregar'} · ≈ ${pesos(importe)}`
            : pesable ? 'Elegí entre 0,1 y 20 kg' : 'Elegí la cantidad'}
        </button>
        {enCarrito && (
          <button onClick={() => onGuardar(0)} style={{ ...btnSecundario, borderColor: C.rojo, color: C.rojo }}>Sacar del pedido</button>
        )}
      </div>
    </div>
  )
}

function Opcion({ activa, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      height: 46, borderRadius: 12, cursor: 'pointer', fontFamily: F.body, fontSize: 14, padding: 0,
      border: activa ? 0 : `1px solid ${C.line}`, background: activa ? C.ink : '#FFFFFF', color: activa ? '#FFFFFF' : C.ink, fontWeight: activa ? 700 : 600,
    }}>{children}</button>
  )
}

function TuPedido({ config, abierto, lineas, subtotal, onVolver, onEditar, onCreado }) {
  const [datos, setDatos] = useState(() => leerLS(LS_DATOS, { nombre: '', telefono: '', direccion: '', referencias: '' }))
  const [pago, setPago] = useState('efectivo')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setDatos(d => ({ ...d, [k]: v }))

  const envio = Number(config.envio || 0)
  const minimo = Number(config.minimo || 0)
  const falta = Math.max(0, minimo - subtotal)
  const tel = datos.telefono.replace(/\D/g, '')
  const faltaDato = !datos.nombre.trim() ? 'Escribí tu nombre'
    : tel.length < 8 ? 'Escribí tu WhatsApp'
    : datos.direccion.trim().length < 4 ? 'Escribí la dirección'
    : null

  async function confirmar() {
    if (enviando || !lineas.length || falta > 0 || faltaDato || !abierto) return
    setEnviando(true)
    setError(null)
    guardarLS(LS_DATOS, datos)
    const { data, error: err } = await supabase.rpc('delivery_crear_pedido', {
      p: {
        nombre: datos.nombre, telefono: datos.telefono, direccion: datos.direccion, referencias: datos.referencias,
        forma_pago: pago,
        items: lineas.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad, nota: l.nota })),
      },
    })
    if (err || !data?.token) {
      setError(mensajeError(err, config))
      setEnviando(false)
      return
    }
    onCreado(data)
  }

  const motivo = !lineas.length ? 'Tu pedido está vacío'
    : falta > 0 ? `Te faltan ${pesos(falta)} para la compra mínima`
    : !abierto ? `Ahora no tomamos pedidos${proximaApertura(config) ? ` · volvemos ${proximaApertura(config)}` : ''}`
    : faltaDato

  return (
    <>
      <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onVolver} aria-label="Volver" style={btnIcono}>{Icono.volver}</button>
        <h1 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 22 }}>Tu pedido</h1>
      </div>
      <div style={{ padding: '14px 20px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {lineas.map(l => (
            <button key={l.producto_id} onClick={() => onEditar(l)}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', border: 0, borderBottom: '1px solid #EFEAE2', background: 'transparent', color: C.ink, fontFamily: F.body, fontSize: 15, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
              <span style={{ minWidth: 0 }}>
                <b>{nombreLindo(l.producto.nombre)}</b> <span style={{ color: C.muted }}>· {fmtCantidad(l.cantidad, l.producto.pesable)}</span>
                {l.nota && <span style={{ display: 'block', fontSize: 13, color: C.muted, marginTop: 2 }}>«{l.nota}»</span>}
                <span style={{ display: 'block', fontSize: 12, color: C.goldText, marginTop: 2, fontWeight: 600 }}>Tocá para cambiar</span>
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>≈ {pesos(l.importe)}</span>
            </button>
          ))}
          <Fila label="Envío a domicilio" valor={pesos(envio)} gris />
          <Fila label="Total aproximado" valor={`≈ ${pesos(subtotal + envio)}`} fuerte />
          <div style={{ paddingTop: 6, fontSize: 13, color: falta > 0 ? C.rojo : C.verde, fontWeight: 600 }}>
            {falta > 0 ? `Te faltan ${pesos(falta)} para la compra mínima de ${pesos(minimo)}` : `Supera la compra mínima de ${pesos(minimo)}`}
          </div>
        </div>

        <Campo label="Tu nombre">
          <input value={datos.nombre} onChange={e => set('nombre', e.target.value)} autoComplete="name" maxLength={80} style={input} />
        </Campo>
        <Campo label="WhatsApp" ayuda="Por acá te avisamos el total y cuando sale el pedido">
          <input type="tel" inputMode="tel" value={datos.telefono} onChange={e => set('telefono', e.target.value)} autoComplete="tel" placeholder="3574 …" maxLength={20} style={input} />
        </Campo>
        <Campo label={`Dirección en ${config.localidad}`}>
          <input value={datos.direccion} onChange={e => set('direccion', e.target.value)} autoComplete="street-address" placeholder="Calle y número" maxLength={200} style={input} />
        </Campo>
        <Campo label="Referencias" ayuda="Opcional: piso, color de la casa, entre qué calles">
          <input value={datos.referencias} onChange={e => set('referencias', e.target.value)} maxLength={200} style={input} />
        </Campo>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>¿Cómo pagás?</span>
          <OpcionPago activa={pago === 'efectivo'} onClick={() => setPago('efectivo')} titulo="Efectivo al recibir" detalle="Le pagás al repartidor" />
          <OpcionPago activa={pago === 'transferencia'} onClick={() => setPago('transferencia')} titulo="Transferencia" detalle="Te pasamos el total pesado y transferís antes del envío" />
        </div>

        {error && <div role="alert" style={{ padding: '12px 14px', borderRadius: 12, background: '#FDECEA', color: C.rojo, fontSize: 14, fontWeight: 600 }}>{error}</div>}

        <button onClick={confirmar} disabled={!!motivo || enviando} style={{ ...btnPrimario, opacity: motivo || enviando ? 0.5 : 1 }}>
          {enviando ? 'Mandando…' : motivo || 'Confirmar pedido'}
        </button>
      </div>
    </>
  )
}

function Fila({ label, valor, gris, fuerte }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: fuerte ? '6px 0 0' : '10px 0 2px', fontSize: fuerte ? 18 : 15, fontWeight: fuerte ? 800 : 400, color: gris ? C.muted : C.ink }}>
      <span>{label}</span><span>{valor}</span>
    </div>
  )
}

function Campo({ label, ayuda, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 700, fontSize: 14 }}>
      {label}
      {children}
      {ayuda && <span style={{ fontWeight: 400, fontSize: 12, color: C.muted }}>{ayuda}</span>}
    </label>
  )
}

function OpcionPago({ activa, onClick, titulo, detalle }) {
  return (
    <button onClick={onClick} aria-pressed={activa} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
      border: activa ? `2px solid ${C.ink}` : `1px solid ${C.line}`, background: activa ? C.soft : '#FFFFFF', color: C.ink, fontFamily: F.body, width: '100%',
    }}>
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, flexShrink: 0, border: `2px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {activa && <span style={{ width: 10, height: 10, borderRadius: 5, background: C.ink }} />}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 15 }}>
        <b>{titulo}</b><span style={{ fontSize: 13, color: C.muted }}>{detalle}</span>
      </span>
    </button>
  )
}
