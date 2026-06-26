-- ============================================================
-- 78 · Presupuestos (cotizaciones de carne)
-- ------------------------------------------------------------
-- Cotizaciones que arma el admin cuando alguien pide X mercadería. NO toca
-- stock ni cuenta corriente: es solo un documento (se imprime/manda en PDF).
-- El cliente puede ser un nombre libre (no hace falta que esté cargado) y se
-- elige con qué lista de precios cotizar (mayorista/carnicería/minorista).
-- items: [{nombre, categoria, cantidad, unidad, precio_unitario, subtotal}]
-- Se administran desde Admin → Comercial → Presupuestos.
-- ============================================================
create table if not exists public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  cliente_nombre text not null,
  lista_precios text not null default 'may',          -- may | carn | min
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviado', 'aceptado', 'rechazado')),
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  notas text,
  valido_hasta date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.presupuestos enable row level security;
drop policy if exists presupuestos_admin on public.presupuestos;
create policy presupuestos_admin on public.presupuestos
  for all using (public.is_admin()) with check (public.is_admin());
