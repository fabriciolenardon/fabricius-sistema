-- Alias interno editable por el admin para cada contacto de WhatsApp.
-- Tiene prioridad sobre el nombre de perfil de WhatsApp (que a veces es basura,
-- ej "…") al mostrar en Conversaciones. El webhook NUNCA lo escribe (solo toca
-- `nombre`), así que un alias puesto a mano queda fijo.
alter table public.wa_contactos add column if not exists alias text;
