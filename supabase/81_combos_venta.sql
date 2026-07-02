-- ════════════════════════════════════════════════════════════
-- 81 · Combos de venta (bolsones armados de la Caja)
-- ────────────────────────────────────────────────────────────
-- Combos que la carnicería arma y vende a un precio fijo (ej. Combo
-- SALSA $57.000). En la Caja, un botón por combo agrega al carrito CADA
-- producto que contiene (con su kg) para que el stock se descuente igual
-- que una venta normal, pero el precio del combo se reparte entre esas
-- líneas para que el total dé exacto el precio del combo (NO la suma de
-- los precios sueltos).
--
-- items: [{ producto_id, nombre, kg }]
--   - producto_id  → fila real de `precios` (de ahí salen categoria y
--     stock_origen, así el descuento de stock es exacto — NO se adivina
--     el bucket, ver memoria stock_origen).
--   - nombre       → cache para mostrar si el producto fue borrado.
--   - kg           → cantidad a descontar (ej. 1 pollo entero = 2,3 kg).
--
-- OJO con los descuentos: el precio del combo YA es la oferta, así que en
-- la Caja las líneas de combo se EXCLUYEN de Promo Mundial / Blangino
-- (no se aplica doble descuento).
--
-- Se administran desde Admin → Precios → 🍱 Combos. Esto NO tiene nada que
-- ver con `combos_imagenes` (mig 67/68), que son solo las fotos que Iris
-- manda por WhatsApp.
-- ════════════════════════════════════════════════════════════
create table if not exists public.combos_venta (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  emoji       text,
  precio      numeric not null default 0,
  disponible  boolean not null default true,
  orden       int not null default 0,
  items       jsonb not null default '[]'::jsonb,  -- [{producto_id, nombre, kg}]
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists combos_venta_disponible_idx on public.combos_venta (disponible, orden);

alter table public.combos_venta enable row level security;

-- Admin: control total. Cualquier autenticado (incl. rol cajero): solo
-- lectura — mismo patrón que `precios` (auth_lee_precios), así la Caja
-- puede listar los combos disponibles.
drop policy if exists combos_venta_admin on public.combos_venta;
create policy combos_venta_admin on public.combos_venta for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists combos_venta_read on public.combos_venta;
create policy combos_venta_read on public.combos_venta for select
  using (auth.uid() is not null);
