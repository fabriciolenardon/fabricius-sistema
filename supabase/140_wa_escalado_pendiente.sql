-- ═══════════════════════════════════════════════════════════════
-- 140 — WhatsApp: marca de "IRIS necesita ayuda" en el contacto
-- ═══════════════════════════════════════════════════════════════
-- Problema (Fabricio 07/09): cuando IRIS no puede resolver algo avisa por
-- WhatsApp al número del dueño y por push, pero "a veces no me manda nada".
-- Las dos vías pueden fallar sin que nadie se entere:
--   · WhatsApp: Meta solo deja mandar texto libre dentro de las 24 h desde el
--     último mensaje QUE ESE NÚMERO le mandó al negocio. Pasadas las 24 h el
--     aviso al dueño rebota (error 131047) y hoy solo queda en el log.
--   · Push: si el navegador revocó la suscripción, se descarta en silencio.
--
-- Solución: además de los dos avisos, la escalada queda MARCADA EN LA BASE.
-- El panel de Conversaciones sube esos chats arriba de todo con un cartel
-- rojo, así el pedido nunca se pierde aunque no llegue ninguna notificación.
-- La marca se limpia sola cuando se abre/responde la conversación.
--
-- ⚠️ YA APLICADA (07/09/2026, vía MCP). Queda como registro.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE wa_contactos
  ADD COLUMN IF NOT EXISTS necesita_respuesta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalado_motivo text,
  ADD COLUMN IF NOT EXISTS escalado_at timestamptz;

COMMENT ON COLUMN wa_contactos.necesita_respuesta IS 'IRIS no pudo resolver algo y le prometió al cliente que el equipo responde. Se limpia al abrir/responder el chat.';
COMMENT ON COLUMN wa_contactos.escalado_motivo IS 'Qué quedó pendiente (ej. "Pidió la lista de precios").';

-- Para levantar rápido los pendientes en el panel.
CREATE INDEX IF NOT EXISTS idx_wa_contactos_pendientes
  ON wa_contactos (escalado_at DESC) WHERE necesita_respuesta;
