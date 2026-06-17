-- ════════════════════════════════════════════════════════════
-- 65 · Dedup de webhooks de WhatsApp (evita respuestas duplicadas)
-- ────────────────────────────────────────────────────────────
-- Meta REINTENTA el webhook si no recibe el 200 a tiempo (y el
-- procesamiento de Iris —Gemini + envío— puede tardar varios
-- segundos). Sin control, el MISMO mensaje entrante se procesa de
-- nuevo e Iris responde DOS veces al cliente.
-- Guardamos el id (wamid) de cada mensaje ya procesado; el INSERT
-- atómico por PK detecta el reintento y lo descarta.
-- Solo la usa el webhook con service_role (que bypassea RLS); no
-- exponemos policies para anon/auth (igual criterio que arca_config).
-- ════════════════════════════════════════════════════════════
create table if not exists wa_procesados (
  wa_id      text primary key,
  creado_at  timestamptz not null default now()
);

alter table wa_procesados enable row level security;
