-- =============================================================================
-- MIGRACIÓN 06 — PEDIDOS ONLINE DE CLIENTES MAYORISTAS
-- =============================================================================
-- Habilita que los clientes con portal puedan armar pedidos desde su portal,
-- guardados acá como conversación de chat + items + día/horario.
--
-- IMPORTANTE: confirmar un pedido NO modifica stock ni crea remitos.
-- Los remitos se siguen emitiendo manualmente desde la pestaña Despachos.
-- =============================================================================


-- 1) TABLA PEDIDOS
-- -----------------------------------------------------------------------------
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  cliente_nombre text,                            -- denormalizado para no joinear todo el tiempo
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmado', 'rechazado', 'cancelado')),
  dia_entrega date,                               -- día solicitado por el cliente
  horario_entrega text,                           -- "mañana" | "tarde" | "HH:MM" o libre
  items jsonb not null default '[]'::jsonb,       -- [{producto_id, nombre, categoria, kg, precio_unitario, subtotal}]
  mensajes_chat jsonb not null default '[]'::jsonb, -- [{timestamp, autor: 'bot'|'cliente'|'admin', texto}]
  total_estimado numeric default 0,
  notas_cliente text,
  notas_admin text,
  editado_por_admin boolean default false,        -- si vos modificaste items antes de confirmar
  confirmado_por text,                            -- nombre del admin
  confirmado_en timestamptz,
  rechazado_motivo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger para mantener updated_at al día
create or replace function pedidos_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pedidos_updated_at on pedidos;
create trigger pedidos_updated_at before update on pedidos
  for each row execute function pedidos_set_updated_at();


-- 2) ÍNDICES
-- -----------------------------------------------------------------------------
create index if not exists idx_pedidos_cliente_id on pedidos(cliente_id);
create index if not exists idx_pedidos_estado on pedidos(estado);
create index if not exists idx_pedidos_created_at on pedidos(created_at desc);


-- 3) ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table pedidos enable row level security;

-- Admin: acceso total
drop policy if exists "admin_all_pedidos" on pedidos;
create policy "admin_all_pedidos" on pedidos for all
  using (is_admin()) with check (is_admin());

-- Cliente: SELECT solo sus propios pedidos
drop policy if exists "cliente_lee_sus_pedidos" on pedidos;
create policy "cliente_lee_sus_pedidos" on pedidos for select
  using (is_cliente_mayorista() and cliente_id = mi_cliente_id());

-- Cliente: INSERT solo para SU propio cliente_id, y siempre con estado='pendiente'
drop policy if exists "cliente_crea_su_pedido" on pedidos;
create policy "cliente_crea_su_pedido" on pedidos for insert
  with check (
    is_cliente_mayorista()
    and cliente_id = mi_cliente_id()
    and estado = 'pendiente'
  );

-- Cliente: UPDATE solo de SUS pedidos en estado pendiente (para cancelar antes de confirmar)
-- y solo puede setear estado a 'cancelado'
drop policy if exists "cliente_cancela_su_pedido" on pedidos;
create policy "cliente_cancela_su_pedido" on pedidos for update
  using (
    is_cliente_mayorista()
    and cliente_id = mi_cliente_id()
    and estado = 'pendiente'
  )
  with check (
    is_cliente_mayorista()
    and cliente_id = mi_cliente_id()
    and estado in ('pendiente', 'cancelado')
  );


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- =============================================================================
