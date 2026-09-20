// ============================================================
// badgesNav — los contadores del menú, compartidos hacia adentro
// ============================================================
// Los pendientes (flujo depósito, pedidos, WhatsApp) los cuenta AdminLayout
// una sola vez: sus hooks abren canales de Realtime y, el del flujo, además
// hace sonar el beep y dispara la notificación del sistema. Si una pantalla
// de adentro volviera a llamar al hook, se suscribiría de nuevo al mismo
// canal y cada desposte sonaría dos veces. Por eso el número viaja por
// contexto y las pantallas sólo lo leen.
// (window.__flujosPendientes existe para el menú mobile, pero no re-renderiza.)
// ============================================================
import { createContext, useContext } from 'react'

export const BadgesNavCtx = createContext({ deposito: 0, pedidos: 0, whatsapp: 0 })

export function useBadgesNav() {
  return useContext(BadgesNavCtx)
}
