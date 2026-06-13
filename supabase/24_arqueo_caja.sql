-- ============================================================
-- MIGRACIÓN 24: Arqueo de caja
-- ============================================================
-- Tabla para guardar el arqueo de fin del día:
--   - fecha y hora del arqueo
--   - conteo físico de billetes/monedas por denominación (JSONB)
--   - total contado físico
--   - efectivo esperado según ventas del día
--   - diferencia (sobrante o faltante)
--   - notas explicativas (ej. "faltó $500 por error de vuelto")
--   - usuario que hizo el arqueo
-- ============================================================

create table if not exists arqueos_caja (
  id              serial primary key,
  fecha           date not null default current_date,
  hora            time not null default current_time,
  billetes        jsonb not null default '{}'::jsonb,
  total_contado   numeric not null default 0,
  efectivo_esperado numeric not null default 0,
  diferencia      numeric not null default 0,
  notas           text,
  cajero          text,
  created_at      timestamptz default now()
);

create index if not exists idx_arqueos_caja_fecha on arqueos_caja(fecha desc);

alter table arqueos_caja enable row level security;
drop policy if exists "arqueos_caja_all" on arqueos_caja;
create policy "arqueos_caja_all" on arqueos_caja for all using (true) with check (true);
