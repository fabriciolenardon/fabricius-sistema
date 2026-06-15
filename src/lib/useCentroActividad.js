// ============================================================
// useCentroActividad — feed en vivo + notificaciones espontáneas
// ============================================================
// Junta en un solo lugar la actividad que necesita atención:
//   • Conversaciones de WhatsApp con mensajes sin leer (wa_contactos)
//   • Pedidos MINORISTAS que tomó Iris y esperan confirmación (pedidos_whatsapp 'nuevo')
//   • Pedidos MAYORISTAS pendientes (pedidos 'pendiente')
//
// Cuando entra algo nuevo (mensaje entrante o pedido nuevo) dispara:
//   1) Beep (Web Audio, sin assets) — espejo de useFlujoNotificaciones
//   2) Notificación nativa del navegador (con permiso)
//   3) Un "nuevoSignal" para que el widget se abra/destaque solo
//
// Toda novedad además refresca el feed (re-fetch debounced de las 3 fuentes).
// ============================================================
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'

export const RUTA_ACTIVIDAD = {
  conv: '/admin/whatsapp?tab=conversaciones',
  min: '/admin/whatsapp?tab=pedidos',
  may: '/admin/pedidos',
}

const soloDigitos = s => String(s || '').replace(/\D/g, '')
function fmtTel(wa) {
  const d = soloDigitos(wa)
  const m = d.match(/^54(9)?(\d{10})$/)
  if (m) { const n = m[2]; return `+54${m[1] ? ' 9' : ''} ${n.slice(0, 4)} ${n.slice(4, 6)}-${n.slice(6)}` }
  return d ? '+' + d : '—'
}
const nombreContacto = c => (c?.alias && c.alias.trim())
  || (c?.nombre && c.nombre.trim().length >= 2 && /[a-zA-ZÀ-ÿ]/.test(c.nombre) ? c.nombre.trim() : fmtTel(c?.telefono))

function detalleMay(p) {
  const n = Array.isArray(p?.items) ? p.items.length : 0
  const ent = p?.dia_entrega ? ` · entrega ${p.dia_entrega}` : ''
  return `${n} ${n === 1 ? 'ítem' : 'ítems'}${ent}`
}

export function useCentroActividad() {
  const [feed, setFeed] = useState([])
  const [nuevoSignal, setNuevoSignal] = useState(0)
  const [ultimoNuevo, setUltimoNuevo] = useState(null)   // { tipo, titulo, detalle }
  const audioCtxRef = useRef(null)
  const debRef = useRef(null)

  const recargar = useCallback(async () => {
    const [conv, min, may] = await Promise.all([
      supabase.from('wa_contactos').select('telefono,nombre,alias,ultimo_mensaje,ultimo_at,no_leidos')
        .gt('no_leidos', 0).order('ultimo_at', { ascending: false }).limit(15),
      supabase.from('pedidos_whatsapp').select('id,telefono,nombre_contacto,resumen_pedido,mensaje_cliente,created_at')
        .eq('estado', 'nuevo').order('created_at', { ascending: false }).limit(15),
      supabase.from('pedidos').select('id,cliente_nombre,items,total_estimado,dia_entrega,created_at')
        .eq('estado', 'pendiente').order('created_at', { ascending: false }).limit(15),
    ])
    const items = []
    for (const c of (conv.data || [])) items.push({
      key: 'conv-' + c.telefono, tipo: 'conv', icono: '💬', etiqueta: 'Mensaje sin leer',
      titulo: nombreContacto(c), detalle: c.ultimo_mensaje || 'Mensaje nuevo', hora: c.ultimo_at, ruta: RUTA_ACTIVIDAD.conv,
    })
    for (const p of (min.data || [])) items.push({
      key: 'min-' + p.id, tipo: 'min', icono: '🛒', etiqueta: 'Pedido minorista (Iris)',
      titulo: p.nombre_contacto || fmtTel(p.telefono), detalle: p.resumen_pedido || p.mensaje_cliente || 'Pedido nuevo', hora: p.created_at, ruta: RUTA_ACTIVIDAD.min,
    })
    for (const p of (may.data || [])) items.push({
      key: 'may-' + p.id, tipo: 'may', icono: '📦', etiqueta: 'Pedido mayorista',
      titulo: p.cliente_nombre || 'Cliente', detalle: detalleMay(p), hora: p.created_at, ruta: RUTA_ACTIVIDAD.may,
    })
    items.sort((a, b) => String(b.hora || '').localeCompare(String(a.hora || '')))
    setFeed(items)
  }, [])

  const recargarDeb = useCallback(() => {
    clearTimeout(debRef.current)
    debRef.current = setTimeout(() => recargar(), 350)
  }, [recargar])

  // Permiso de notificaciones del navegador (una sola vez)
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  useEffect(() => { recargar() }, [recargar])

  // Realtime: un solo canal escucha las 3 tablas
  useEffect(() => {
    const novedad = (tipo, titulo, detalle, ruta) => {
      dispararBeep(audioCtxRef)
      dispararNotif(titulo, detalle, ruta)
      setUltimoNuevo({ tipo, titulo, detalle })
      setNuevoSignal(s => s + 1)
      recargarDeb()
    }
    const canal = supabase.channel('centro-actividad')
      // Mensaje entrante de un cliente → notifica (los salientes de Iris/vos no)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_mensajes' }, ({ new: m }) => {
        if (m && m.direccion === 'in') novedad('conv', '💬 Mensaje nuevo de WhatsApp', m.texto || '', RUTA_ACTIVIDAD.conv)
        else recargarDeb()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contactos' }, () => recargarDeb())
      // Iris tomó un pedido minorista (alta nueva; las refinadas son UPDATE)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos_whatsapp' }, ({ new: p }) => {
        if (p && p.estado === 'nuevo') novedad('min', '🛒 Iris tomó un pedido', p.resumen_pedido || p.nombre_contacto || 'Pedido nuevo', RUTA_ACTIVIDAD.min)
        else recargarDeb()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos_whatsapp' }, () => recargarDeb())
      // Nuevo pedido mayorista pendiente
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, ({ new: p }) => {
        if (p && p.estado === 'pendiente') novedad('may', '📦 Nuevo pedido mayorista', p.cliente_nombre || 'Cliente', RUTA_ACTIVIDAD.may)
        else recargarDeb()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, () => recargarDeb())
      .subscribe()
    return () => { clearTimeout(debRef.current); supabase.removeChannel(canal) }
  }, [recargar, recargarDeb])

  return { feed, nuevoSignal, ultimoNuevo }
}

// ── Beep (Web Audio, sin archivos) ──
function dispararBeep(ref) {
  try {
    if (!ref.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ref.current = new AC()
    }
    const ctx = ref.current
    const tono = (freq, delay) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = freq; osc.type = 'sine'
      const t = ctx.currentTime + delay
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.33)
      osc.start(t); osc.stop(t + 0.38)
    }
    tono(880, 0); tono(1320, 0.2)
  } catch (e) { /* el navegador puede bloquear audio sin interacción previa */ }
}

// ── Notificación nativa del SO ──
function dispararNotif(titulo, body, ruta) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const n = new Notification(titulo, { body: String(body || '').slice(0, 120), icon: '/favicon.ico', requireInteraction: false })
    n.onclick = () => { window.focus(); if (ruta && !window.location.href.includes(ruta)) window.location.href = ruta; n.close() }
  } catch (e) { /* requiere HTTPS/permiso */ }
}
