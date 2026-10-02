// ============================================================
// /pedir — App de delivery para el público
// ============================================================
// Inicio → catálogo → elegir cantidad → tu pedido → seguimiento.
// Todo en una sola pantalla con `vista`, para que el carrito no se
// pierda entre pasos; además queda guardado en el celular (localStorage)
// por si cierra la pestaña.
//
// Mirar precios es libre; para PEDIR hay que tener cuenta (nombre,
// teléfono, dirección y una clave de 4 números — mig 157). La sesión es
// un token que queda en el celular: la próxima vez entra directo.
//
// El precio que se muestra es APROXIMADO: la carne se pesa al preparar
// el pedido y el local avisa el total exacto por WhatsApp. El servidor
// (delivery_crear_pedido) recalcula todo y vuelve a validar horario,
// mínimo y cupón: lo que valida esta pantalla es sólo para avisar antes.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { parseNumero } from '../../lib/formatos'
import { limpiarNumero } from '../../lib/whatsapp'
import {
  CATEGORIAS_DELIVERY, OPCIONES_KG, labelKg, pesos, fmtCantidad, ESTADOS, TZ,
  cierraA, proximaApertura, textoHorarios, mensajeError, mensajeIngreso, textoCupon, nombreLindo,
} from '../../lib/delivery'
import { C, F, input, btnPrimario, btnSecundario, useModoDelivery, leerLS, guardarLS } from './estilo'

const LS_CARRITO = 'fabricius_delivery_carrito'
const LS_SESION = 'fabricius_delivery_sesion'

const Icono = {
  pin: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>,
  volver: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>,
  mas: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  menos: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>,
  lupa: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  persona: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  info: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.goldText} strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>,
}

export default function Pedir() {
  useModoDelivery()
  const navigate = useNavigate()
  const [cat, setCat] = useState(null)          // { config, abierto, productos }
  const [errorCarga, setErrorCarga] = useState(false)
  const [vista, setVista] = useState('inicio')  // inicio | catalogo | pedido | ingreso | cuenta
  const [despuesIngreso, setDespuesIngreso] = useState('inicio')
  const [carrito, setCarrito] = useState(() => leerLS(LS_CARRITO, []))
  const [hoja, setHoja] = useState(null)        // producto abierto en la hoja de cantidad
  const [token, setToken] = useState(() => leerLS(LS_SESION, null))
  const [cuenta, setCuenta] = useState(null)    // datos + cupón + pedidos

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

  async function cargarCuenta(tk = token) {
    if (!tk) { setCuenta(null); return }
    const { data, error } = await supabase.rpc('delivery_mi_cuenta', { p_token: tk })
    if (error) {
      // Sesión vencida o reseteada por el local: a ingresar de nuevo.
      if (String(error.message).includes('SESION')) { guardarLS(LS_SESION, null); setToken(null); setCuenta(null) }
      return
    }
    setCuenta(data)
  }
  useEffect(() => { cargarCuenta() }, [token])

  function entrar(r) {
    guardarLS(LS_SESION, r.token)
    setToken(r.token)
    setVista(despuesIngreso)
  }
  async function salir() {
    if (token) await supabase.rpc('delivery_salir', { p_token: token })
    guardarLS(LS_SESION, null)
    setToken(null)
    setCuenta(null)
    setVista('inicio')
  }
  function irAIngresar(despues) {
    setDespuesIngreso(despues)
    setVista('ingreso')
  }

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
  // "Repetir" un pedido anterior: lo que sigue publicado, con las cantidades pedidas.
  function repetir(pedido) {
    const nuevos = (pedido.items || [])
      .filter(i => !i.sin_stock && porId.has(i.producto_id))
      .map(i => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), nota: i.nota || '' }))
    setCarrito(nuevos)
    setVista('pedido')
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
        <Inicio config={config} abierto={abierto} cuenta={cuenta}
          onVer={() => setVista('catalogo')}
          onIngresar={() => irAIngresar('inicio')}
          onCuenta={() => setVista('cuenta')}
          onSeguir={t => navigate(`/pedir/seguimiento/${t}`)} />
      )}
      {vista === 'catalogo' && (
        <Catalogo productos={cat.productos} config={config} abierto={abierto}
          lineas={lineas} subtotal={subtotal}
          onVolver={() => setVista('inicio')} onAbrir={setHoja} onPedido={() => setVista('pedido')} />
      )}
      {vista === 'pedido' && (
        <TuPedido config={config} abierto={abierto} lineas={lineas} subtotal={subtotal} cuenta={cuenta} token={token}
          onVolver={() => setVista('catalogo')} onEditar={l => setHoja(l.producto)}
          onIngresar={() => irAIngresar('pedido')}
          onSesionVencida={() => { guardarLS(LS_SESION, null); setToken(null); setCuenta(null) }}
          onCreado={(r) => {
            setCarrito([])
            cargarCuenta()
            navigate(`/pedir/seguimiento/${r.token}`)
          }} />
      )}
      {vista === 'ingreso' && (
        <Ingreso config={config} onVolver={() => setVista(despuesIngreso === 'pedido' ? 'pedido' : 'inicio')} onEntrar={entrar} />
      )}
      {vista === 'cuenta' && cuenta && (
        <MiCuenta cuenta={cuenta} token={token} porId={porId}
          onVolver={() => setVista('inicio')} onSalir={salir} onRepetir={repetir}
          onActualizada={setCuenta}
          onSeguir={t => navigate(`/pedir/seguimiento/${t}`)} />
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

function Inicio({ config, abierto, cuenta, onVer, onIngresar, onCuenta, onSeguir }) {
  const hasta = cierraA(config)
  const proxima = proximaApertura(config)
  const horarios = textoHorarios(config)
  const enCurso = (cuenta?.pedidos || []).find(p => ['nuevo', 'pesado', 'pagado', 'en_camino'].includes(p.estado))
  const cupon = textoCupon(cuenta?.cupon)
  return (
    <>
      <Cabecera />
      <div style={{ padding: '24px 24px 28px', display: 'flex', flexDirection: 'column', gap: 18, flexGrow: 1 }}>
        {cuenta ? (
          <button onClick={onCuenta} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: `1px solid ${C.line}`, background: '#FFFFFF', color: C.ink, fontFamily: F.body, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            {Icono.persona}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
              <b style={{ fontSize: 15 }}>Hola, {cuenta.nombre.split(' ')[0]}</b>
              <span style={{ fontSize: 13, color: cuenta.cupon?.disponible ? C.verde : C.muted, fontWeight: cuenta.cupon?.disponible ? 700 : 400 }}>{cupon || 'Mis pedidos y mis datos'}</span>
            </span>
            <span style={{ fontSize: 13, color: C.goldText, fontWeight: 700 }}>Mi cuenta</span>
          </button>
        ) : (
          <button onClick={onIngresar} style={{ ...btnSecundario, minHeight: 46 }}>Ingresar o crear mi cuenta</button>
        )}
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

        {enCurso && (
          <button onClick={() => onSeguir(enCurso.token)} style={{ ...btnSecundario }}>
            Ver mi pedido N° {enCurso.numero} · {ESTADOS[enCurso.estado]?.label}
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

function TuPedido({ config, abierto, lineas, subtotal, cuenta, token, onVolver, onEditar, onIngresar, onSesionVencida, onCreado }) {
  const [direccion, setDireccion] = useState(cuenta?.direccion || '')
  const [referencias, setReferencias] = useState(cuenta?.referencias || '')
  const [pago, setPago] = useState('efectivo')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  // Si la cuenta llega después de abrir esta pantalla, completar la dirección.
  useEffect(() => {
    if (cuenta && !direccion) { setDireccion(cuenta.direccion || ''); setReferencias(cuenta.referencias || '') }
  }, [cuenta])

  const envio = Number(config.envio || 0)
  const minimo = Number(config.minimo || 0)
  const falta = Math.max(0, minimo - subtotal)
  const cupon = cuenta?.cupon?.disponible ? cuenta.cupon : null
  const descuento = cupon ? Math.round(subtotal * Number(cupon.pct) / 100) : 0

  async function confirmar() {
    if (enviando || !lineas.length || falta > 0 || !abierto || !cuenta) return
    setEnviando(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('delivery_crear_pedido', {
      p: {
        token, direccion, referencias, forma_pago: pago,
        items: lineas.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad, nota: l.nota })),
      },
    })
    if (err || !data?.token) {
      if (String(err?.message).includes('SESION')) onSesionVencida()
      setError(mensajeError(err, config))
      setEnviando(false)
      return
    }
    onCreado(data)
  }

  const motivo = !lineas.length ? 'Tu pedido está vacío'
    : falta > 0 ? `Te faltan ${pesos(falta)} para la compra mínima`
    : !abierto ? `Ahora no tomamos pedidos${proximaApertura(config) ? ` · volvemos ${proximaApertura(config)}` : ''}`
    : direccion.trim().length < 4 ? 'Escribí la dirección'
    : null

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
          {descuento > 0 && <Fila label={`🎁 Tu descuento (${cupon.pct}%)`} valor={`-${pesos(descuento)}`} verde />}
          <Fila label="Envío a domicilio" valor={pesos(envio)} gris />
          <Fila label="Total aproximado" valor={`≈ ${pesos(subtotal - descuento + envio)}`} fuerte />
          <div style={{ paddingTop: 6, fontSize: 13, color: falta > 0 ? C.rojo : C.verde, fontWeight: 600 }}>
            {falta > 0 ? `Te faltan ${pesos(falta)} para la compra mínima de ${pesos(minimo)}` : `Supera la compra mínima de ${pesos(minimo)}`}
          </div>
        </div>

        {!cuenta ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 14, background: C.soft }}>
            <b style={{ fontSize: 16 }}>Para pedir, ingresá con tu cuenta</b>
            <span style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>Es con tu teléfono y una clave de 4 números. La primera vez tarda un minuto y después entrás directo.</span>
            <button onClick={onIngresar} style={btnPrimario}>Ingresar o crear mi cuenta</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, color: C.muted }}>A nombre de <b style={{ color: C.ink }}>{cuenta.nombre}</b> · {cuenta.telefono}</div>
            <Campo label={`Dirección en ${config.localidad}`}>
              <input value={direccion} onChange={e => setDireccion(e.target.value)} autoComplete="street-address" placeholder="Calle y número" maxLength={200} style={input} />
            </Campo>
            <Campo label="Referencias" ayuda="Opcional: piso, color de la casa, entre qué calles">
              <input value={referencias} onChange={e => setReferencias(e.target.value)} maxLength={200} style={input} />
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
          </>
        )}
      </div>
    </>
  )
}

// ── Ingresar / crear cuenta ──
function Ingreso({ config, onVolver, onEntrar }) {
  const [modo, setModo] = useState('ingresar')   // ingresar | crear
  const [f, setF] = useState({ nombre: '', telefono: '', direccion: '', referencias: '', pin: '', pin2: '' })
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setError(null) }
  const soloDigitos = v => v.replace(/\D/g, '').slice(0, 4)

  async function enviar() {
    if (enviando) return
    const tel = f.telefono.replace(/\D/g, '')
    if (tel.length < 8) { setError('Escribí tu número de WhatsApp con la característica (ej. 3574 …).'); return }
    if (!/^\d{4}$/.test(f.pin)) { setError('La clave tiene que ser de 4 números.'); return }
    if (modo === 'crear') {
      if (f.nombre.trim().length < 3) { setError('Escribí tu nombre y apellido.'); return }
      if (f.direccion.trim().length < 4) { setError('Escribí tu dirección.'); return }
      if (f.pin !== f.pin2) { setError('Las dos claves no coinciden.'); return }
    }
    setEnviando(true)
    const r = modo === 'crear'
      ? await supabase.rpc('delivery_registrar', { p: { nombre: f.nombre, telefono: f.telefono, direccion: f.direccion, referencias: f.referencias, pin: f.pin } })
      : await supabase.rpc('delivery_ingresar', { p_telefono: f.telefono, p_pin: f.pin })
    setEnviando(false)
    if (r.error) { setError(mensajeError(r.error, config)); return }
    if (r.data?.error) {
      setError(mensajeIngreso(r.data.error))
      if (r.data.error === 'NO_EXISTE') setModo('crear')
      return
    }
    onEntrar(r.data)
  }

  const wa = limpiarNumero(config.whatsapp)
  const olvide = encodeURIComponent(`Hola! Me olvidé la clave del delivery de Fabricius. Mi teléfono es ${f.telefono || '…'}`)

  return (
    <>
      <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onVolver} aria-label="Volver" style={btnIcono}>{Icono.volver}</button>
        <h1 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 22 }}>{modo === 'crear' ? 'Crear mi cuenta' : 'Ingresar'}</h1>
      </div>
      <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <Opcion activa={modo === 'ingresar'} onClick={() => { setModo('ingresar'); setError(null) }}>Ya tengo cuenta</Opcion>
          <Opcion activa={modo === 'crear'} onClick={() => { setModo('crear'); setError(null) }}>Soy nuevo</Opcion>
        </div>
        {modo === 'crear' && (
          <Campo label="Nombre y apellido">
            <input value={f.nombre} onChange={e => set('nombre', e.target.value)} autoComplete="name" maxLength={80} style={input} />
          </Campo>
        )}
        <Campo label="Tu WhatsApp" ayuda={modo === 'crear' ? 'Por acá te avisamos el total y cuando sale el pedido' : null}>
          <input type="tel" inputMode="tel" value={f.telefono} onChange={e => set('telefono', e.target.value)} autoComplete="tel" placeholder="3574 …" maxLength={20} style={input} />
        </Campo>
        {modo === 'crear' && (
          <>
            <Campo label={`Dirección en ${config.localidad}`}>
              <input value={f.direccion} onChange={e => set('direccion', e.target.value)} autoComplete="street-address" placeholder="Calle y número" maxLength={200} style={input} />
            </Campo>
            <Campo label="Referencias" ayuda="Opcional: piso, color de la casa, entre qué calles">
              <input value={f.referencias} onChange={e => set('referencias', e.target.value)} maxLength={200} style={input} />
            </Campo>
          </>
        )}
        <Campo label={modo === 'crear' ? 'Elegí una clave de 4 números' : 'Tu clave'}>
          <input type="password" inputMode="numeric" autoComplete={modo === 'crear' ? 'new-password' : 'current-password'} value={f.pin}
            onChange={e => set('pin', soloDigitos(e.target.value))} placeholder="••••" style={{ ...input, letterSpacing: 8, fontSize: 20 }} />
        </Campo>
        {modo === 'crear' && (
          <Campo label="Repetí la clave">
            <input type="password" inputMode="numeric" autoComplete="new-password" value={f.pin2}
              onChange={e => set('pin2', soloDigitos(e.target.value))} placeholder="••••" style={{ ...input, letterSpacing: 8, fontSize: 20 }} />
          </Campo>
        )}

        {error && <div role="alert" style={{ padding: '12px 14px', borderRadius: 12, background: '#FDECEA', color: C.rojo, fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{error}</div>}

        <button onClick={enviar} disabled={enviando} style={{ ...btnPrimario, opacity: enviando ? 0.5 : 1 }}>
          {enviando ? 'Un momento…' : modo === 'crear' ? 'Crear mi cuenta' : 'Ingresar'}
        </button>
        {modo === 'ingresar' && wa && (
          <a href={`https://wa.me/${wa}?text=${olvide}`} target="_blank" rel="noreferrer" style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: C.goldText }}>
            Me olvidé la clave
          </a>
        )}
      </div>
    </>
  )
}

// ── Mi cuenta: cupón, pedidos anteriores y mis datos ──
function MiCuenta({ cuenta, token, porId, onVolver, onSalir, onRepetir, onActualizada, onSeguir }) {
  const [editando, setEditando] = useState(false)
  const [f, setF] = useState({ nombre: cuenta.nombre, direccion: cuenta.direccion, referencias: cuenta.referencias || '' })
  const [msg, setMsg] = useState(null)
  const cupon = textoCupon(cuenta.cupon)
  const fecha = v => new Date(v).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' })

  async function guardar() {
    const { data, error } = await supabase.rpc('delivery_actualizar_datos', { p_token: token, p: f })
    if (error) { setMsg({ error: true, t: mensajeError(error) }); return }
    onActualizada({ ...cuenta, ...data })
    setEditando(false)
    setMsg({ t: 'Datos guardados.' })
  }

  return (
    <>
      <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onVolver} aria-label="Volver" style={btnIcono}>{Icono.volver}</button>
        <h1 style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 22, flexGrow: 1 }}>Mi cuenta</h1>
        <button onClick={onSalir} style={{ border: 0, background: 'transparent', color: C.muted, fontFamily: F.body, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 10 }}>Salir</button>
      </div>
      <div style={{ padding: '16px 20px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {cupon && (
          <div style={{ padding: '14px 16px', borderRadius: 14, background: cuenta.cupon.disponible ? '#E8F5EC' : C.aviso, color: cuenta.cupon.disponible ? C.verde : C.avisoInk, fontWeight: 700, fontSize: 15, lineHeight: 1.45 }}>
            {cupon}
            {!cuenta.cupon.disponible && (
              <div style={{ marginTop: 10, height: 8, borderRadius: 4, background: '#FFFFFF', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(((cuenta.cupon.cada - cuenta.cupon.faltan) / cuenta.cupon.cada) * 100)}%`, background: C.gold }} />
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: F.display, fontSize: 19 }}>Mis pedidos</h2>
          {cuenta.pedidos.length === 0 && <span style={{ color: C.muted, fontSize: 14 }}>Todavía no hiciste ningún pedido.</span>}
          {cuenta.pedidos.map(p => {
            const vivos = (p.items || []).filter(i => !i.sin_stock && porId.has(i.producto_id)).length
            return (
              <div key={p.numero} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <b style={{ fontSize: 15 }}>N° {p.numero} · {fecha(p.created_at)}</b>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ESTADOS[p.estado]?.color || C.muted }}>{ESTADOS[p.estado]?.label}</span>
                </div>
                <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>
                  {(p.items || []).filter(i => !i.sin_stock).map(i => nombreLindo(i.nombre)).join(', ')}
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <b>{p.final ? '' : '≈ '}{pesos(p.total)}{p.cupon ? ' 🎁' : ''}</b>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => onSeguir(p.token)} style={{ ...btnSecundario, width: 'auto', minHeight: 38, padding: '0 12px', fontSize: 13 }}>Ver</button>
                    {vivos > 0 && <button onClick={() => onRepetir(p)} style={{ ...btnPrimario, width: 'auto', minHeight: 38, padding: '0 12px', fontSize: 13 }}>Repetir</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: F.display, fontSize: 19 }}>Mis datos</h2>
          {editando ? (
            <>
              <Campo label="Nombre y apellido"><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} maxLength={80} style={input} /></Campo>
              <Campo label="Dirección"><input value={f.direccion} onChange={e => setF({ ...f, direccion: e.target.value })} maxLength={200} style={input} /></Campo>
              <Campo label="Referencias"><input value={f.referencias} onChange={e => setF({ ...f, referencias: e.target.value })} maxLength={200} style={input} /></Campo>
              <button onClick={guardar} style={btnPrimario}>Guardar</button>
            </>
          ) : (
            <div style={{ fontSize: 15, lineHeight: 1.6 }}>
              <b>{cuenta.nombre}</b><br />
              <span style={{ color: C.muted }}>{cuenta.telefono}</span><br />
              {cuenta.direccion}{cuenta.referencias ? ` — ${cuenta.referencias}` : ''}
              <div><button onClick={() => setEditando(true)} style={{ border: 0, background: 'transparent', color: C.goldText, fontWeight: 700, fontFamily: F.body, fontSize: 14, padding: '8px 0', cursor: 'pointer' }}>Cambiar mis datos</button></div>
            </div>
          )}
          {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg.error ? C.rojo : C.verde }}>{msg.t}</span>}
          <span style={{ fontSize: 12, color: C.muted }}>El teléfono no se puede cambiar: es tu usuario. Para cambiarlo, escribinos.</span>
        </div>
      </div>
    </>
  )
}

function Fila({ label, valor, gris, fuerte, verde }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: fuerte ? '6px 0 0' : '10px 0 2px', fontSize: fuerte ? 18 : 15, fontWeight: fuerte || verde ? 800 : 400, color: verde ? C.verde : gris ? C.muted : C.ink }}>
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
