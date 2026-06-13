-- =============================================================================
-- MIGRACIÓN 05 — PORTAL DE CLIENTES MAYORISTAS
-- =============================================================================
-- Esta migración habilita un portal de solo-lectura para clientes mayoristas
-- seleccionados por el admin. Cada cliente con portal puede ver SU saldo, SUS
-- remitos, SU cuenta corriente y la lista de precios que le corresponda.
--
-- IMPORTANTE: correrla una sola vez en el SQL Editor del dashboard de Supabase.
-- Es idempotente — se puede correr varias veces sin romper nada.
-- =============================================================================


-- 1) AMPLIAR LA RESTRICCIÓN DE ROLES EN PROFILES PARA INCLUIR cliente_mayorista
-- -----------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_rol_check;
alter table profiles add constraint profiles_rol_check
  check (rol in ('admin', 'franquicia', 'cliente_mayorista'));


-- 2) VINCULAR PROFILES A CLIENTES (un perfil de tipo cliente_mayorista sabe a qué cliente representa)
-- -----------------------------------------------------------------------------
alter table profiles add column if not exists cliente_id int references clientes(id) on delete set null;
create index if not exists idx_profiles_cliente_id on profiles(cliente_id);


-- 3) AGREGAR FLAGS DE PORTAL A LA TABLA CLIENTES
-- -----------------------------------------------------------------------------
alter table clientes add column if not exists tiene_portal boolean not null default false;
alter table clientes add column if not exists email_portal text;


-- 4) HABILITAR ROW LEVEL SECURITY EN LAS TABLAS QUE EL CLIENTE PUEDE LEER
-- -----------------------------------------------------------------------------
alter table clientes enable row level security;
alter table remitos enable row level security;
alter table movimientos_ctacte enable row level security;
alter table precios enable row level security;


-- 5) POLÍTICAS — CADA POLÍTICA SE LIMPIA Y RECREA PARA QUE SEA IDEMPOTENTE
-- -----------------------------------------------------------------------------

-- ===== CLIENTES =====
-- Admin: acceso total. Cliente mayorista: solo SU propia fila.
drop policy if exists "admin_all_clientes" on clientes;
create policy "admin_all_clientes" on clientes for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'));

drop policy if exists "cliente_lee_su_cliente" on clientes;
create policy "cliente_lee_su_cliente" on clientes for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.rol = 'cliente_mayorista'
        and profiles.cliente_id = clientes.id
    )
  );

-- ===== REMITOS =====
drop policy if exists "admin_all_remitos" on remitos;
create policy "admin_all_remitos" on remitos for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'));

drop policy if exists "cliente_lee_sus_remitos" on remitos;
create policy "cliente_lee_sus_remitos" on remitos for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.rol = 'cliente_mayorista'
        and profiles.cliente_id = remitos.cliente_id
    )
  );

-- ===== MOVIMIENTOS CTACTE =====
drop policy if exists "admin_all_movimientos" on movimientos_ctacte;
create policy "admin_all_movimientos" on movimientos_ctacte for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'));

drop policy if exists "cliente_lee_sus_movimientos" on movimientos_ctacte;
create policy "cliente_lee_sus_movimientos" on movimientos_ctacte for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.rol = 'cliente_mayorista'
        and profiles.cliente_id = movimientos_ctacte.cliente_id
    )
  );

-- ===== PRECIOS =====
-- Todos los autenticados pueden leer precios (el filtrado por lista lo hace el frontend).
-- Solo admin puede modificar.
drop policy if exists "admin_all_precios" on precios;
create policy "admin_all_precios" on precios for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.rol = 'admin'));

drop policy if exists "auth_lee_precios" on precios;
create policy "auth_lee_precios" on precios for select
  using (auth.uid() is not null);


-- 6) POLÍTICAS DE PROFILES (cada uno ve solo su propio perfil; admin ve todos)
-- -----------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists "admin_all_profiles" on profiles;
create policy "admin_all_profiles" on profiles for all
  using (exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'admin'))
  with check (exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'admin'));

drop policy if exists "user_lee_su_profile" on profiles;
create policy "user_lee_su_profile" on profiles for select
  using (id = auth.uid());


-- 7) ÍNDICES ÚTILES
-- -----------------------------------------------------------------------------
create index if not exists idx_clientes_email_portal on clientes(email_portal) where email_portal is not null;
create index if not exists idx_remitos_cliente_id on remitos(cliente_id);
create index if not exists idx_movimientos_cliente_id on movimientos_ctacte(cliente_id);


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- =============================================================================
-- Después de correr esto, las Edge Functions crear-acceso-cliente y
-- revocar-acceso-cliente podrán crear/revocar usuarios mayoristas.
-- =============================================================================
