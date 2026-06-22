-- ============================================================
-- 74 · Meses operativos (inicio/cierre manual del mes)
-- ------------------------------------------------------------
-- Como Fabricius cierra por semanas enteras (lun→dom), el mes operativo no
-- coincide con el calendario. Acá se define a mano el rango de cada mes. El
-- "Mensual en vivo" del Dashboard Ejecutivo arranca en fecha_inicio del mes
-- operativo en que cae hoy (fallback al 01 calendario si no hay config).
-- Se cargan/editan desde Cierre → Por Mes → "Meses operativos".
-- ============================================================
create table if not exists public.meses_operativos (
  id uuid primary key default gen_random_uuid(),
  etiqueta text not null,
  mes text,                          -- 'YYYY-MM' para linkear con cierres_semanales.mes
  fecha_inicio date not null,
  fecha_cierre date not null,
  created_at timestamptz default now()
);
alter table public.meses_operativos enable row level security;
drop policy if exists meses_op_admin on public.meses_operativos;
create policy meses_op_admin on public.meses_operativos
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.meses_operativos (etiqueta, mes, fecha_inicio, fecha_cierre)
select * from (values
  ('Junio 2026', '2026-06', '2026-06-01'::date, '2026-06-28'::date),
  ('Julio 2026', '2026-07', '2026-06-29'::date, '2026-08-02'::date)
) v(etiqueta, mes, fecha_inicio, fecha_cierre)
where not exists (select 1 from public.meses_operativos);

alter publication supabase_realtime add table public.meses_operativos;
