-- ════════════════════════════════════════════════════════════
-- 66 · Historial de campañas de WhatsApp
-- ────────────────────────────────────────────────────────────
-- Cada campaña enviada (oferta de la semana por plantilla aprobada)
-- queda registrada: a cuántos se mandó, cuántos llegaron/fallaron y
-- el detalle de errores. Las pruebas a un solo número NO se guardan.
-- El envío lo hace el webhook/endpoint con service_role; el panel
-- (admin) lee el historial vía RLS.
-- ════════════════════════════════════════════════════════════
create table if not exists wa_campanas (
  id          uuid primary key default gen_random_uuid(),
  plantilla   text not null,
  oferta      text,
  total       int  not null default 0,
  enviados    int  not null default 0,
  fallidos    int  not null default 0,
  detalle     jsonb,
  creado_por  uuid,
  creado_at   timestamptz not null default now()
);

alter table wa_campanas enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'wa_campanas' and policyname = 'wa_campanas_admin_all') then
    create policy wa_campanas_admin_all on wa_campanas for all using (is_admin()) with check (is_admin());
  end if;
end $$;
