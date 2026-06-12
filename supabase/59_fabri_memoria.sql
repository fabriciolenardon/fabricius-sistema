-- ============================================================
-- MIGRACIÓN 59: memoria permanente de F.A.B.R.I.
-- ============================================================
-- El asistente guarda acá lo que aprende en las charlas (preferencias
-- de trato, datos del negocio que no están en el sistema, correcciones)
-- vía la tool "recordar", y lo relee en cada conversación (se inyecta
-- al system prompt). "olvidar" desactiva (no borra).
-- (Ya aplicada en Supabase vía MCP el 11/06.)

create table if not exists fabri_memoria (
  id serial primary key,
  usuario text,                  -- a quién aplica (null = general del negocio)
  tipo text default 'dato',      -- preferencia | dato
  contenido text not null,
  activa boolean not null default true,
  created_at timestamptz default now()
);
alter table fabri_memoria enable row level security;
drop policy if exists fabri_memoria_all on fabri_memoria;
create policy fabri_memoria_all on fabri_memoria for all using (true) with check (true);
