// push.js — activar notificaciones push en este dispositivo (Web Push).
// Pide permiso, se suscribe con la clave pública VAPID y guarda la suscripción
// en Supabase. El backend (api/enviar-push.js) las usa para mandar avisos.
import { supabase } from './supabase'

// Clave PÚBLICA VAPID (no es secreta; la privada vive en el servidor).
const VAPID_PUBLIC = 'BLzle-N3TvKoPfUARVWVqW-VUyVWZsSpo-81XoxdDqfl5xM-djelKdU3zWtSpJus_tu098PkDwt4qh1JAHdkdS0'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function soportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function estadoPush() {
  if (!('Notification' in window)) return 'no-soportado'
  return Notification.permission // 'granted' | 'denied' | 'default'
}

export async function activarNotificaciones(usuario) {
  if (!soportaPush()) return { ok: false, msg: 'Este dispositivo/navegador no soporta notificaciones push. En iPhone, primero agregá la app a la pantalla de inicio.' }
  try {
    const permiso = await Notification.requestPermission()
    if (permiso !== 'granted') return { ok: false, msg: 'No diste permiso para las notificaciones.' }
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
    }
    const json = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      subscription: json,
      rol: usuario?.rol || null,
      nombre: usuario?.nombre || null,
    }, { onConflict: 'endpoint' })
    if (error) return { ok: false, msg: 'Error al guardar la suscripción: ' + error.message }
    return { ok: true, msg: '🔔 ¡Listo! Vas a recibir avisos en este dispositivo.' }
  } catch (e) {
    return { ok: false, msg: 'No se pudo activar: ' + (e?.message || e) }
  }
}
