-- ============================================================
-- 82 · Conceptos extra de sueldos: aguinaldo (SAC) y vacaciones
-- ------------------------------------------------------------
-- Extras que se pagan además de la liquidación semanal y que viven dentro de un
-- MES del historial de Sueldos (misma key que agrupa el historial: el `mes` del
-- mes operativo, ej. '2026-06', o el mes calendario como fallback).
--
--   • aguinaldo  → 50% del bruto del mes de referencia (Junio / Diciembre).
--   • vacaciones → criterio Empleados de Comercio (CCT 130/75):
--                  sueldo mensual / 25 × días corridos. Días por antigüedad:
--                  14 (hasta 5 años), 21 (5-10), 28 (10-20), 35 (+20).
--
-- El monto se autocalcula en el front pero queda editable; acá solo se guarda
-- el valor final. `unique (mes, empleado_id, tipo)` para poder hacer upsert.
-- ============================================================
create table if not exists public.conceptos_sueldos (
  id uuid primary key default gen_random_uuid(),
  mes text not null,                       -- 'YYYY-MM' (misma key que el historial)
  empleado_id integer references public.empleados_sueldos(id),
  empleado_nombre text not null,
  tipo text not null check (tipo in ('aguinaldo', 'vacaciones')),
  monto numeric not null default 0,
  dias integer,                            -- solo vacaciones: días corridos
  detalle text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (mes, empleado_id, tipo)
);

alter table public.conceptos_sueldos enable row level security;
drop policy if exists conceptos_sueldos_admin on public.conceptos_sueldos;
create policy conceptos_sueldos_admin on public.conceptos_sueldos
  for all using (public.is_admin()) with check (public.is_admin());

alter publication supabase_realtime add table public.conceptos_sueldos;
