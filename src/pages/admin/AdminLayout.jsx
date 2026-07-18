import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useFlujoNotificaciones, usePedidosListosNotif } from '../../lib/useFlujoNotificaciones'
import { fechaHoyARG, horaHoyARG, diaSemanaARG } from '../../lib/fechas'
import { fmtPrecio, fmtKg } from '../../lib/formatos'
import { rutaRestringida } from '../../lib/restricciones'
import BuscadorGlobal from '../../components/BuscadorGlobal'
import CentroActividad from '../../components/CentroActividad'
import LogoFabricius from '../../components/LogoFabricius'
import UserDropdown from '../../components/UserDropdown'
import CambiarPasswordModal from '../../components/CambiarPasswordModal'
import BotonAvisos from '../../components/BotonAvisos'
import RecordatorioPagos from '../../components/RecordatorioPagos'
import PanelDividido from '../../components/PanelDividido'

// ¿Este AdminLayout corre ADENTRO del panel dividido (iframe)? Si es así, se
// muestra SOLO el módulo, sin header/menú/widgets (el chrome lo pone el panel).
const ES_PANEL = typeof window !== 'undefined' && window.self !== window.top

// 🕐 Reloj vivo del header: hora 24 h + día y fecha, SIEMPRE con reloj
// argentino (lib/fechas) — no confía en la zona horaria de la máquina.
function RelojHeader() {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const f = fechaHoyARG(ahora) // YYYY-MM-DD
  return (
    <div title="Hora de Argentina" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15, whiteSpace: 'nowrap', userSelect: 'none' }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums', letterSpacing: 0.5 }}>
        {horaHoyARG(ahora).slice(0, 5)}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'capitalize' }}>
        {diaSemanaARG(ahora).slice(0, 3)} {f.slice(8, 10)}/{f.slice(5, 7)}/{f.slice(0, 4)}
      </span>
    </div>
  )
}

// Entrada extra solo-CEO para el menú del celular: el Modo TV (F.A.B.R.I.) no
// es una ruta aparte de navItems, así que se agrega a mano para el CEO.
const NAV_MOVIL_TV = { to: '/admin/ejecutivo?tv=1', icon: '📺', label: 'Modo TV (F.A.B.R.I.)' }

const navItems = [
  { to: '/admin/dashboard',   icon: '📊', label: 'Dashboard' },
  { to: '/admin/ejecutivo',   icon: '⚡', label: 'Ejecutivo' },
  { to: '/admin/caja',        icon: '💵', label: 'Caja' },
  { to: '/admin/ventas', icon: '📋', label: 'Mayorista' },
  { to: '/admin/deposito',    icon: '🏭', label: 'Depósito' },
  { to: '/admin/precios',     icon: '💲', label: 'Precios' },
  { to: '/admin/presupuestos', icon: '📋', label: 'Presupuestos' },
  { to: '/admin/etiquetas',   icon: '🏷️', label: 'Etiquetas' },
  { to: '/admin/clientes',    icon: '👥', label: 'Clientes' },
  { to: '/admin/pedidos',     icon: '📥', label: 'Pedidos Mayoristas' },
  { to: '/admin/whatsapp', icon: '💬', label: 'WhatsApp' },
  { to: '/admin/proveedores', icon: '🏭', label: 'Proveedores' },
  { to: '/admin/cheques',     icon: '📄', label: 'Cheques' },
  { to: '/admin/sueldos',     icon: '💰', label: 'Sueldos' },
  { to: '/admin/gastos',      icon: '💸', label: 'Gastos' },
  { to: '/admin/facturacion', icon: '📑', label: 'Facturación' },
  { to: '/admin/cierre',      icon: '📋', label: 'Cierre' },
  { to: '/admin/productividad', icon: '📶', label: 'Productividad' },
  { to: '/admin/auditoria',   icon: '🔍', label: 'Auditoría' },
]

// Desktop: los módulos agrupados en 4 menús desplegables (más prolijo que 17
// botones en una fila con scroll). El badge de cada item "sube" al menú padre.
const NAV_GRUPOS = [
  { label: 'Operación', icon: '🛒', items: [
    { to: '/admin/caja',      icon: '💵', label: 'Caja' },
    { to: '/admin/ventas',    icon: '📋', label: 'Mayorista' },
    { to: '/admin/deposito',  icon: '🏭', label: 'Depósito' },
    { to: '/admin/pedidos',   icon: '📥', label: 'Pedidos Mayoristas' },
    { to: '/admin/whatsapp',  icon: '💬', label: 'WhatsApp' },
  ] },
  { label: 'Comercial', icon: '🏷️', items: [
    { to: '/admin/precios',      icon: '💲', label: 'Precios' },
    { to: '/admin/presupuestos', icon: '📋', label: 'Presupuestos' },
    { to: '/admin/etiquetas',    icon: '🏷️', label: 'Etiquetas' },
    { to: '/admin/clientes',     icon: '👥', label: 'Clientes' },
  ] },
  { label: 'Finanzas', icon: '💰', items: [
    { to: '/admin/proveedores', icon: '🏭', label: 'Proveedores' },
    { to: '/admin/cheques',     icon: '📄', label: 'Cheques' },
    { to: '/admin/sueldos',     icon: '💰', label: 'Sueldos' },
    { to: '/admin/gastos',      icon: '💸', label: 'Gastos' },
    { to: '/admin/facturacion', icon: '📑', label: 'Facturación' },
  ] },
  { label: 'Dirección', icon: '📈', items: [
    { to: '/admin/ejecutivo', icon: '⚡', label: 'Ejecutivo', ceoOnly: true },
    { to: '/admin/dashboard', icon: '📊', label: 'Dashboard' },
    { to: '/admin/cierre',    icon: '📋', label: 'Cierre' },
    { to: '/admin/productividad', icon: '📶', label: 'Productividad' },
    { to: '/admin/auditoria', icon: '🔍', label: 'Auditoría' },
  ] },
]

function useNotificaciones() {
  const [notifs, setNotifs] = useState([])
  useEffect(() => {
    async function cargar() {
      const hoy = new Date()
      const en15 = new Date(); en15.setDate(hoy.getDate() + 15)
      // fechaHoyARG (no toISOString): después de las 21hs ARG las alertas
      // de cheques quedaban con la ventana corrida un día.
      const hoyStr = fechaHoyARG(hoy)
      const en15Str = fechaHoyARG(en15)
      const haceUnAno = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate())

      const [{ data: cheques }, { data: chequesEmitidos }, { data: clientes }, { data: cierres }, { data: stockData }, { data: cuentasFiscales }, { data: facturasRecientes }, { data: impuestosRecientes }, { data: productosStock }] = await Promise.all([
        supabase.from('cheques').select('*').neq('origen', 'emitido').gte('fecha_pago', hoyStr).lte('fecha_pago', en15Str),
        // Cheques propios pendientes de imputar que se debitan en ≤7 días (o ya vencieron)
        supabase.from('cheques').select('*').eq('origen', 'emitido').neq('estado', 'imputado').lte('fecha_pago', fechaHoyARG(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 7))),
        supabase.from('clientes').select('*').gt('saldo', 0).order('saldo', { ascending: false }),
        supabase.from('cierres_semanales').select('*').order('semana_inicio', { ascending: false }).limit(1),
        supabase.from('stock_actual').select('*'),
        supabase.from('cuentas_fiscales').select('*').eq('activa', true).then(r => r).catch(() => ({ data: null })),
        supabase.from('facturas').select('cuenta_id, monto_total, fecha').eq('tipo', 'emitida').gte('fecha', fechaHoyARG(haceUnAno)).then(r => r).catch(() => ({ data: null })),
        supabase.from('impuestos_pagados').select('cuenta_id, concepto, periodo_anio, periodo_mes').then(r => r).catch(() => ({ data: null })),
        // Productos "huérfanos": cerdo/embutido sin stock_origen y sin marca "no descuenta"
        supabase.from('precios').select('nombre, categoria, stock_origen, stock_no_aplica').in('categoria', ['cerdo_corte', 'cerdo_pieza', 'embutido']).then(r => r).catch(() => ({ data: null })),
      ])

      const nuevas = []

      if (cheques?.length > 0) {
        cheques.forEach(ch => {
          const dias = Math.ceil((new Date(ch.fecha_pago + 'T12:00') - hoy) / (1000 * 60 * 60 * 24))
          nuevas.push({ tipo: 'warning', icono: '📄', titulo: `Cheque #${ch.numero} vence en ${dias} día${dias !== 1 ? 's' : ''}`, sub: `${ch.cliente_nombre} — ${fmtPrecio(ch.monto)}`, link: '/admin/cheques' })
        })
      }

      // ── Cheques propios (emitidos): avisar para levantarlos a tiempo ──
      if (chequesEmitidos?.length > 0) {
        chequesEmitidos.forEach(ch => {
          const dias = Math.ceil((new Date(ch.fecha_pago + 'T12:00') - hoy) / (1000 * 60 * 60 * 24))
          if (dias <= 0) {
            nuevas.push({ tipo: 'danger', icono: '📤', titulo: `Cheque propio #${ch.numero} ${dias === 0 ? 'se debita HOY' : 'VENCIDO sin imputar'}`, sub: `${ch.proveedor_nombre || 'sin beneficiario'} — ${fmtPrecio(ch.monto)} — imputalo si ya lo cubriste`, link: '/admin/cheques' })
          } else {
            nuevas.push({ tipo: 'warning', icono: '📤', titulo: `Cheque propio #${ch.numero} se debita en ${dias} día${dias !== 1 ? 's' : ''}`, sub: `${ch.proveedor_nombre || 'sin beneficiario'} — ${fmtPrecio(ch.monto)}`, link: '/admin/cheques' })
          }
        })
      }

      if (clientes?.length > 0) {
        clientes.slice(0, 3).forEach(c => {
          if (c.saldo > 100000) nuevas.push({ tipo: 'danger', icono: '💳', titulo: `${c.nombre} debe ${fmtPrecio(c.saldo)}`, sub: 'Saldo pendiente', link: '/admin/clientes' })
        })
      }

      if (cierres?.length > 0) {
        const diasSinCierre = Math.floor((hoy - new Date(cierres[0].semana_fin + 'T12:00')) / (1000 * 60 * 60 * 24))
        if (diasSinCierre > 8) nuevas.push({ tipo: 'info', icono: '📋', titulo: `Hace ${diasSinCierre} días sin cierre`, sub: 'Registrá el cierre de la semana', link: '/admin/cierre' })
      }

      // ── Avisos de Facturación ──
      if (cuentasFiscales && facturasRecientes) {
        const mesActual = hoy.getMonth() + 1
        const anioActual = hoy.getFullYear()
        const diaActual = hoy.getDate()
        cuentasFiscales.forEach(cf => {
          if (cf.tipo !== 'monotributo') return
          // Tope absoluto cat K = $108.357.084 (vigente 2026)
          const TOPE_K = 108357084.05
          const facturado = (facturasRecientes || []).filter(f => f.cuenta_id === cf.id).reduce((s, f) => s + (Number(f.monto_total) || 0), 0)
          const pct = (facturado / TOPE_K) * 100
          if (pct >= 95) {
            nuevas.push({ tipo: 'danger', icono: '🚨', titulo: `${cf.nombre} al ${pct.toFixed(0)}% del tope mono`, sub: 'Riesgo crítico de exclusión', link: '/admin/facturacion' })
          } else if (pct >= 85) {
            nuevas.push({ tipo: 'warning', icono: '📑', titulo: `${cf.nombre} al ${pct.toFixed(0)}% del tope mono`, sub: 'Atención al cierre del año móvil', link: '/admin/facturacion' })
          }
          // Cuota del mes
          const yaPago = (impuestosRecientes || []).some(p => p.cuenta_id === cf.id && p.concepto === 'monotributo' && p.periodo_anio === anioActual && p.periodo_mes === mesActual)
          if (!yaPago) {
            if (diaActual > 20) {
              nuevas.push({ tipo: 'danger', icono: '📘', titulo: `Cuota Mono ${cf.nombre} VENCIDA`, sub: `Período ${String(mesActual).padStart(2, '0')}/${anioActual}`, link: '/admin/facturacion' })
            } else if (diaActual >= 15) {
              nuevas.push({ tipo: 'warning', icono: '📘', titulo: `Cuota Mono ${cf.nombre} vence pronto`, sub: `Día 20 — quedan ${20 - diaActual} días`, link: '/admin/facturacion' })
            }
          }
        })
      }

      if (stockData) {
        const s = {}
        stockData.forEach(r => s[r.tipo] = r.kg_disponible)
        if ((s.bovino_mr || 0) < 100) nuevas.push({ tipo: 'danger', icono: '📦', titulo: `Stock bovino bajo: ${fmtKg(s.bovino_mr || 0)}`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
        if ((s.pollo || 0) < 100) nuevas.push({ tipo: 'warning', icono: '📦', titulo: `Stock pollo bajo: ${fmtKg(s.pollo || 0)}`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
        if ((s.cerdo || 0) < 50) nuevas.push({ tipo: 'warning', icono: '📦', titulo: `Stock cerdo bajo: ${fmtKg(s.cerdo || 0)}`, sub: 'Pedí más mercadería', link: '/admin/deposito' })
      }

      // ── Productos huérfanos: cerdo/embutido sin stock asignado (se venden pero
      // no descuentan stock). Recordatorio para enlazarlos en Precios. ──
      const orfanos = (productosStock || []).filter(p => !p.stock_origen && !p.stock_no_aplica)
      if (orfanos.length > 0) {
        nuevas.push({
          tipo: 'warning', icono: '📦',
          titulo: `${orfanos.length} producto${orfanos.length === 1 ? '' : 's'} sin stock asignado`,
          sub: `Se vende${orfanos.length === 1 ? '' : 'n'} pero no descuenta${orfanos.length === 1 ? '' : 'n'} stock — enlazalos en Precios`,
          link: '/admin/precios',
        })
      }

      setNotifs(nuevas)
    }
    cargar()
  }, [])
  return notifs
}

function usePedidosPendientes() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    async function cargar() {
      const { count: c } = await supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
      setCount(c || 0)
    }
    cargar()
    const canal = supabase.channel('pedidos-count-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])
  return count
}

// Pedidos entrantes de WhatsApp (que tomó Iris) todavía sin ver.
function usePedidosWaNuevos() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    async function cargar() {
      const { count: c } = await supabase.from('pedidos_whatsapp').select('id', { count: 'exact', head: true }).eq('estado', 'nuevo')
      setCount(c || 0)
    }
    cargar()
    const canal = supabase.channel('pedidos-wa-count-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_whatsapp' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])
  return count
}

// Conversaciones de WhatsApp con mensajes sin leer.
function useWaNoLeidos() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    async function cargar() {
      const { count: c } = await supabase.from('wa_contactos').select('telefono', { count: 'exact', head: true }).gt('no_leidos', 0)
      setCount(c || 0)
    }
    cargar()
    const canal = supabase.channel('wa-noleidos-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contactos' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])
  return count
}

function CampanaNotificaciones({ notifs }) {
  const [abierto, setAbierto] = useState(false)
  const navigate = useNavigate()
  const ref = useRef()

  useEffect(() => {
    function cerrar(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [])

  const colores = { warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(!abierto)}
        style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, minHeight: 36 }}>
        <span style={{ fontSize: 16 }}>🔔</span>
        {notifs.length > 0 && (
          <div style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {notifs.length}
          </div>
        )}
      </button>
      {abierto && (
        <div style={{ position: 'fixed', top: 58, right: 8, width: 'min(340px, calc(100vw - 16px))', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 Notificaciones</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{notifs.length} alertas</span>
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>✅ Sin alertas</div>
          ) : (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {notifs.map((n, i) => (
                <div key={i} onClick={() => { navigate(n.link); setAbierto(false) }}
                  style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: colores[n.tipo] + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{n.icono}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: colores[n.tipo], marginBottom: 2 }}>{n.titulo}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{n.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// MENÚ MOBILE CON HAMBURGUESA
function MenuMobile({ onClose }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut, user } = useAuth()
  const [modalPwd, setModalPwd] = useState(false)

  async function handleLogout() {
    await signOut()
    navigate('/login')
    onClose()
  }

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, backdropFilter: 'blur(2px)' }} />
      {/* Drawer */}
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, background: 'var(--surface)', zIndex: 301, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 24px rgba(0,0,0,0.5)' }}>
        {/* Header del menú */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)', letterSpacing: 2 }}>🥩 FABRICIUS</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        {/* Perfil */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#000', flexShrink: 0 }}>
            {profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{profile?.nombre}</div>
            <div style={{ fontSize: 11, color: user?.email === 'fabriciolenardon@gmail.com' ? 'var(--gold)' : 'var(--muted)', fontWeight: user?.email === 'fabriciolenardon@gmail.com' ? 700 : 400, letterSpacing: user?.email === 'fabriciolenardon@gmail.com' ? 1 : 0 }}>{user?.email === 'fabriciolenardon@gmail.com' ? '👑 CEO' : 'Administrador'}</div>
          </div>
        </div>

        {/* Nav items — TODOS los módulos en el celular (igual que en la compu).
            El Ejecutivo y el Modo TV son solo para el CEO; el resto lo ven todos
            los admin. Antes el CEO tenía un menú recortado, ahora ve todo. */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {(user?.email === 'fabriciolenardon@gmail.com'
            ? [...navItems, NAV_MOVIL_TV]
            : navItems.filter(it => it.to !== '/admin/ejecutivo' && !rutaRestringida(user?.email, it.to))
          ).map(item => {
            const isActive = location.pathname === item.to
            return (
              <NavLink key={item.to} to={item.to} onClick={onClose}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, marginBottom: 4, fontSize: 14, fontWeight: 600, textDecoration: 'none', background: isActive ? 'var(--gold)' : 'transparent', color: isActive ? '#000' : 'var(--text2)', transition: 'all 0.15s' }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.to === '/admin/deposito' && (window.__flujosPendientes > 0) && (
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{window.__flujosPendientes}</span>
                )}
                {item.to === '/admin/pedidos' && (((window.__pedidosPendientes || 0) + (window.__pedidosListos || 0)) > 0) && (
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{(window.__pedidosPendientes || 0) + (window.__pedidosListos || 0)}</span>
                )}
                {item.to === '/admin/whatsapp' && (((window.__pedidosWaNuevos || 0) + (window.__waNoLeidos || 0)) > 0) && (
                  <span style={{ background: 'var(--green)', color: '#000', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{(window.__pedidosWaNuevos || 0) + (window.__waNoLeidos || 0)}</span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Acciones de cuenta */}
        <div style={{ padding: '14px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => setModalPwd(true)} style={{ width: '100%', padding: '12px', background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            🔑 Cambiar contraseña
          </button>
          <button onClick={handleLogout} style={{ width: '100%', padding: '12px', background: '#3a1a1a', color: 'var(--red-light)', border: '1px solid #5a2a2a', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            🚪 Cerrar sesión
          </button>
        </div>
      </div>
      {modalPwd && <CambiarPasswordModal onClose={() => setModalPwd(false)} />}
    </>
  )
}

// NAV DESKTOP — 4 menús desplegables por categoría. Se abren/cierran con CLICK
// (el hover daba problemas: al cruzar el huequito hacia el menú se cerraba, y el
//  click lo volvía a minimizar). Se cierra al clickear afuera o al cambiar de ruta.
function NavDesktop({ userEmail, badges }) {
  const location = useLocation()
  const [openGroup, setOpenGroup] = useState(null)
  const navRef = useRef(null)

  // Cerrar al clickear fuera de la barra
  useEffect(() => {
    function cerrar(e) { if (navRef.current && !navRef.current.contains(e.target)) setOpenGroup(null) }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [])
  // Cerrar al navegar a otra pantalla
  useEffect(() => { setOpenGroup(null) }, [location.pathname])

  const badgeFor = (to) => {
    if (to === '/admin/pedidos')  return badges.pedidos
    if (to === '/admin/whatsapp') return badges.whatsapp
    if (to === '/admin/deposito') return badges.deposito
    return 0
  }
  const esCeo = userEmail === 'fabriciolenardon@gmail.com'
  const grupos = NAV_GRUPOS.map(g => ({
    ...g,
    items: g.items.filter(it => (!it.ceoOnly || esCeo) && !rutaRestringida(userEmail, it.to)),
  }))

  return (
    <nav ref={navRef} style={{ display: 'flex', gap: 4, flex: 1, alignItems: 'center' }}>
      {grupos.map((g, gi) => {
        const activo   = g.items.some(it => location.pathname.startsWith(it.to))
        const abierto  = openGroup === gi
        const grpBadge = g.items.reduce((s, it) => s + badgeFor(it.to), 0)
        return (
          <div key={g.label} style={{ position: 'relative' }}>
            <button onClick={() => setOpenGroup(abierto ? null : gi)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
                border: '1px solid ' + (activo ? 'rgba(212,175,55,0.45)' : 'transparent'),
                background: activo ? 'rgba(212,175,55,0.12)' : (abierto ? 'var(--surface2)' : 'transparent'),
                color: activo ? 'var(--gold)' : 'var(--text2)', transition: 'all 0.15s',
              }}>
              <span style={{ fontSize: 15 }}>{g.icon}</span>
              {g.label}
              <span style={{ fontSize: 9, opacity: 0.55, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
              {grpBadge > 0 && (
                <span style={{ background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 17, height: 17, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{grpBadge}</span>
              )}
            </button>
            {abierto && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, minWidth: 224, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.55)', padding: 6, zIndex: 250 }}>
                {g.items.map(it => {
                  const itemBadge = badgeFor(it.to)
                  const itActivo = location.pathname.startsWith(it.to)
                  return (
                    <NavLink key={it.to} to={it.to} onClick={() => setOpenGroup(null)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                        whiteSpace: 'nowrap', transition: 'background 0.12s',
                        background: itActivo ? 'var(--gold)' : 'transparent',
                        color: itActivo ? '#000' : 'var(--text2)',
                      }}
                      onMouseOver={e => { if (!itActivo) e.currentTarget.style.background = 'var(--surface2)' }}
                      onMouseOut={e => { if (!itActivo) e.currentTarget.style.background = 'transparent' }}>
                      <span style={{ fontSize: 16 }}>{it.icon}</span>
                      <span style={{ flex: 1 }}>{it.label}</span>
                      {itemBadge > 0 && (
                        <span style={{ background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{itemBadge}</span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export default function AdminLayout() {
  const { user } = useAuth()
  const notifs = useNotificaciones()
  const pedidosPendientes = usePedidosPendientes()
  const pedidosWaNuevos = usePedidosWaNuevos()
  const waNoLeidos = useWaNoLeidos()
  const { pendientes: flujosPendientes } = useFlujoNotificaciones()
  const { listos: pedidosListos } = usePedidosListosNotif()
  // Exponer en window para que el sidebar mobile pueda mostrar los badges
  // (el sidebar mobile es un componente separado que no recibe estos valores como props)
  useEffect(() => { window.__flujosPendientes = flujosPendientes }, [flujosPendientes])
  useEffect(() => { window.__pedidosPendientes = pedidosPendientes }, [pedidosPendientes])
  useEffect(() => { window.__pedidosListos = pedidosListos }, [pedidosListos])
  useEffect(() => { window.__pedidosWaNuevos = pedidosWaNuevos }, [pedidosWaNuevos])
  useEffect(() => { window.__waNoLeidos = waNoLeidos }, [waNoLeidos])
  // Exponer el email del usuario actual para que el menú mobile pueda
  // filtrar las opciones CEO-only (Ejecutivo, Reportes). Antes esto estaba
  // referenciado pero nunca seteado → en mobile esos links nunca aparecían.
  useEffect(() => { window.__ceoEmail = user?.email || null }, [user?.email])
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900)

  // Panel dividido (solo escritorio): módulo secundario a la derecha.
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [panelRuta, setPanelRuta] = useState(() => {
    try { const r = localStorage.getItem('panel_ruta'); return navItems.some(it => it.to === r) ? r : '/admin/dashboard' }
    catch { return '/admin/dashboard' }
  })
  const [panelNonce, setPanelNonce] = useState(0)
  useEffect(() => { try { localStorage.setItem('panel_ruta', panelRuta) } catch {} }, [panelRuta])
  // Permite abrir la pantalla dividida en un módulo puntual desde cualquier
  // pantalla (ej. botón "Remitar" en Pedidos → abre Mayorista con el remito precargado).
  // El nonce fuerza a recargar el iframe aunque ya esté ese módulo abierto (para
  // que vuelva a leer el prefill del pedido).
  useEffect(() => {
    window.__abrirPanelEn = (ruta) => {
      // En celular no hay pantalla dividida: navegamos a la ruta (el prefill lo
      // toma esa pantalla al montar).
      if (window.innerWidth < 900) { if (ruta) window.location.href = ruta; return }
      if (ruta) setPanelRuta(ruta)
      setPanelNonce(n => n + 1)
      setPanelAbierto(true)
    }
    return () => { try { delete window.__abrirPanelEn } catch {} }
  }, [])
  const [panelAncho, setPanelAncho] = useState(() => {
    const n = Number(localStorage.getItem('panel_ancho'))
    return n >= 25 && n <= 65 ? n : 44
  })

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Adentro del panel (iframe): solo el contenido del módulo, sin chrome.
  if (ES_PANEL) {
    return (
      <main style={{ minHeight: '100vh' }}>
        <div style={{ padding: '16px 14px' }} className="fade-in">
          <Outlet />
        </div>
      </main>
    )
  }

  // Módulos que se pueden abrir en el panel (mismos filtros que el menú).
  const itemsPanel = navItems.filter(it =>
    (it.to !== '/admin/ejecutivo' || user?.email === 'fabriciolenardon@gmail.com')
    && !rutaRestringida(user?.email, it.to)
  )

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* HEADER */}
      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, background: 'rgba(10,10,8,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', zIndex: 200, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>

        {/* MOBILE: Hamburguesa + Logo */}
        {isMobile ? (
          <>
            <button onClick={() => setMenuAbierto(true)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 36 }}>
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: 'var(--gold)', borderRadius: 2 }} />
            </button>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <LogoFabricius size="small" />
            </div>
            <RelojHeader />
            <BotonAvisos />
            <CampanaNotificaciones notifs={notifs} />
          </>
        ) : (
          /* DESKTOP: Nav completo */
          <>
            <div style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
              <LogoFabricius size="small" />
            </div>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <NavDesktop
              userEmail={user?.email}
              badges={{ pedidos: pedidosPendientes + pedidosListos, whatsapp: pedidosWaNuevos + waNoLeidos, deposito: flujosPendientes }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
              <RelojHeader />
              <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
              <button
                title={panelAbierto ? 'Cerrar pantalla dividida' : 'Pantalla dividida: trabajá en dos módulos a la vez'}
                onClick={() => setPanelAbierto(v => !v)}
                style={{
                  background: panelAbierto ? 'rgba(212,175,55,0.15)' : 'var(--surface)',
                  border: '1px solid ' + (panelAbierto ? 'rgba(212,175,55,0.5)' : 'var(--border)'),
                  borderRadius: 8, padding: '6px 10px', cursor: 'pointer', minHeight: 36,
                  fontSize: 15, color: panelAbierto ? 'var(--gold)' : 'var(--text2)',
                  display: 'flex', alignItems: 'center',
                }}>
                ⧉
              </button>
              <BotonAvisos />
              <CampanaNotificaciones notifs={notifs} />
              <UserDropdown />
            </div>
          </>
        )}
      </header>

      {/* MENÚ MOBILE DRAWER */}
      {menuAbierto && <MenuMobile onClose={() => setMenuAbierto(false)} />}

      {/* Widget de actividad en vivo (conversaciones + pedidos) con notificaciones */}
      <CentroActividad />

      {/* Recordatorio JUE/VIE/SÁB/DOM para que el CEO cargue los pagos a proveedores */}
      {user?.email === 'fabriciolenardon@gmail.com' && <RecordatorioPagos />}

      {/* PANEL DIVIDIDO (solo escritorio) */}
      {panelAbierto && !isMobile && (
        <PanelDividido
          items={itemsPanel}
          ruta={panelRuta}
          onRutaChange={setPanelRuta}
          nonce={panelNonce}
          ancho={panelAncho}
          setAncho={setPanelAncho}
          onCerrar={() => setPanelAbierto(false)}
        />
      )}

      {/* CONTENIDO */}
      <main style={{ paddingTop: 56, minHeight: '100vh', marginRight: panelAbierto && !isMobile ? `${panelAncho}vw` : 0 }}>
        <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }} className="fade-in">
          <Outlet />
      <BuscadorGlobal />
        </div>
      </main>

    </div>
  )
}