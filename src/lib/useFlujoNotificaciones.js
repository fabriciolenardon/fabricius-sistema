// ============================================================
// useFlujoNotificaciones — Hook para alertas push del Flujo Depósito
// ============================================================
// Suscribe Supabase Realtime a la tabla flujo_deposito y cuando
// entra un nuevo registro con estado="pendiente" dispara:
//   1) Notificación nativa del browser (con permiso del usuario)
//   2) Beep sonoro generado con Web Audio (sin assets externos)
//   3) Contador de pendientes que se puede mostrar en UI
// ============================================================
import { useEffect, useState, useRef } from 'react'
import { supabase } from './supabase'

export function useFlujoNotificaciones({ enabled = true } = {}) {
  const [pendientes, setPendientes] = useState(0)
  const [ultimo, setUltimo] = useState(null)
  const audioCtxRef = useRef(null)
  const permisoPedido = useRef(false)

  // Pedir permiso para notificaciones del browser (una sola vez)
  useEffect(() => {
    if (!enabled) return
    if (typeof Notification === 'undefined') return
    if (permisoPedido.current) return
    permisoPedido.current = true
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [enabled])

  // Cargar contador inicial de pendientes
  useEffect(() => {
    if (!enabled) return
    let cancelado = false
    async function cargar() {
      const { count } = await supabase
        .from('flujo_deposito')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      if (!cancelado) setPendientes(count || 0)
    }
    cargar()
    return () => { cancelado = true }
  }, [enabled])

  // Suscribirse a Realtime: INSERT y UPDATE
  useEffect(() => {
    if (!enabled) return
    const canal = supabase.channel('flujo-deposito-push')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'flujo_deposito' },
        payload => {
          const nuevo = payload.new
          if (!nuevo) return
          if (nuevo.estado !== 'pendiente') return
          setPendientes(p => p + 1)
          setUltimo(nuevo)
          dispararBeep(audioCtxRef)
          dispararNotificacionBrowser(nuevo)
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'flujo_deposito' },
        payload => {
          const antes = payload.old
          const despues = payload.new
          if (!despues) return
          // Si cambió de pendiente a aprobado/rechazado, decrementar
          if (antes?.estado === 'pendiente' && despues.estado !== 'pendiente') {
            setPendientes(p => Math.max(0, p - 1))
          }
          if (antes?.estado !== 'pendiente' && despues.estado === 'pendiente') {
            setPendientes(p => p + 1)
          }
        })
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [enabled])

  return { pendientes, ultimo }
}

// Genera un beep corto sin necesidad de archivos de audio
function dispararBeep(ref) {
  try {
    if (!ref.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ref.current = new AC()
    }
    const ctx = ref.current
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880     // La5
    osc.type = 'sine'
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
    // Segundo beep más agudo, después del primero
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator()
        const gain2 = ctx.createGain()
        osc2.connect(gain2)
        gain2.connect(ctx.destination)
        osc2.frequency.value = 1320  // Mi6
        osc2.type = 'sine'
        gain2.gain.setValueAtTime(0, ctx.currentTime)
        gain2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02)
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
        osc2.start(ctx.currentTime)
        osc2.stop(ctx.currentTime + 0.4)
      } catch (e) {}
    }, 200)
  } catch (e) {
    // Silencioso: el browser puede bloquear AudioContext sin interacción del usuario
  }
}

// Notificación nativa del navegador (la del SO)
function dispararNotificacionBrowser(flujo) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    const labels = {
      media_res_piezas:     '🥩 En piezas',
      media_res_kilo:       '⚖️ Venta por kilo',
      media_res_mayorista:  '📦 Mayorista entera',
      media_res_minorista:  '🏪 Minorista entera',
    }
    const tipo = labels[flujo.tipo] || flujo.tipo
    const kg = (Number(flujo.kg_media_res) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const empleado = flujo.empleado_nombre || 'Sector desposte'
    const n = new Notification('🔔 Nuevo desposte para aprobar', {
      body: `${tipo}${flujo.modelo ? ` (Modelo ${flujo.modelo})` : ''}\n${kg} kg · por ${empleado}`,
      tag: `flujo-deposito-${flujo.id}`,
      icon: '/favicon.ico',
      requireInteraction: false,
    })
    n.onclick = () => {
      window.focus()
      // Redirigir al panel admin de Flujo Depósito
      if (window.location.pathname !== '/admin/deposito') {
        window.location.href = '/admin/deposito'
      }
      n.close()
    }
  } catch (e) {
    // Algunos browsers requieren HTTPS o permisos específicos
  }
}
