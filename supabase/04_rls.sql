-- Row Level Security — Carnicerías Fabricius
-- Ejecutar después de 01, 02 y 03

-- Funciones auxiliares
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and rol = 'admin'
  );
$$;

create or replace function public.is_franquicia()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and rol = 'franquicia'
  );
$$;

create or replace function public.mi_cliente_id()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from profiles p
  join sucursales s on s.id = p.sucursal_id
  join clientes c on c.nombre ilike '%' || s.nombre || '%'
  where p.id = auth.uid()
  limit 1;
$$;

-- Habilitar RLS en todas las tablas
alter table profiles enable row level security;
alter table sucursales enable row level security;
alter table empleados enable row level security;
alter table clientes enable row level security;
alter table proveedores enable row level security;
alter table entradas_deposito enable row level security;
alter table salidas_deposito enable row level security;
alter table movimientos_ctacte enable row level security;
alter table cheques enable row level security;
alter table pagos_proveedores enable row level security;
alter table liquidaciones_sueldos enable row level security;
alter table gastos enable row level security;
alter table cierres_semanales enable row level security;
alter table precios enable row level security;
alter table stock_actual enable row level security;
alter table remitos enable row level security;
alter table ventas_minoristas enable row level security;
alter table despostes enable row level security;
alter table elaboraciones_embutidos enable row level security;
alter table compras_proveedores enable row level security;
alter table pagos_proveedores_semanal enable row level security;
alter table ofertas enable row level security;
alter table plu enable row level security;

-- Limpiar políticas antiguas (nombres de la guía original)
drop policy if exists "admin_all_cierres" on cierres_semanales;
drop policy if exists "admin_all_gastos" on gastos;
drop policy if exists "admin_all_empleados" on empleados;
drop policy if exists "admin_all_entradas" on entradas_deposito;
drop policy if exists "admin_all_salidas" on salidas_deposito;
drop policy if exists "admin_all_cheques" on cheques;
drop policy if exists "admin_all_sueldos" on liquidaciones_sueldos;
drop policy if exists "admin_all_clientes" on clientes;
drop policy if exists "admin_all_pagos" on pagos_proveedores;
drop policy if exists "franq_own_movimientos" on movimientos_ctacte;
drop policy if exists "franq_own_salidas" on salidas_deposito;
drop policy if exists "franq_own_clientes" on clientes;
drop policy if exists "profiles_own" on profiles;
drop policy if exists "Admins full access" on cierres_semanales;
drop policy if exists "Franquicia own ctacte" on movimientos_ctacte;

-- Macro: políticas admin-only por tabla
do $$
declare
  t text;
  tables_admin_only text[] := array[
    'empleados', 'proveedores', 'entradas_deposito', 'salidas_deposito',
    'cheques', 'pagos_proveedores', 'liquidaciones_sueldos', 'gastos',
    'cierres_semanales', 'stock_actual', 'ventas_minoristas', 'despostes',
    'elaboraciones_embutidos', 'compras_proveedores', 'pagos_proveedores_semanal', 'plu'
  ];
begin
  foreach t in array tables_admin_only loop
    execute format('drop policy if exists admin_all_%I on %I', t, t);
    execute format(
      'create policy admin_all_%I on %I for all using (public.is_admin()) with check (public.is_admin())',
      t, t
    );
  end loop;
end $$;

-- PROFILES
drop policy if exists profiles_select on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_select on profiles for select
  using (auth.uid() = id or public.is_admin());
create policy profiles_update on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- SUCURSALES
drop policy if exists sucursales_select on sucursales;
create policy sucursales_select on sucursales for select
  using (
    public.is_admin()
    or id in (select sucursal_id from profiles where id = auth.uid())
  );

-- CLIENTES
drop policy if exists clientes_admin on clientes;
drop policy if exists clientes_franq_select on clientes;
create policy clientes_admin on clientes for all
  using (public.is_admin()) with check (public.is_admin());
create policy clientes_franq_select on clientes for select
  using (public.is_franquicia() and id = public.mi_cliente_id());

-- MOVIMIENTOS CTA CTE
drop policy if exists movimientos_admin on movimientos_ctacte;
drop policy if exists movimientos_franq_select on movimientos_ctacte;
create policy movimientos_admin on movimientos_ctacte for all
  using (public.is_admin()) with check (public.is_admin());
create policy movimientos_franq_select on movimientos_ctacte for select
  using (public.is_franquicia() and cliente_id = public.mi_cliente_id());

-- REMITOS
drop policy if exists remitos_admin on remitos;
drop policy if exists remitos_franq_select on remitos;
create policy remitos_admin on remitos for all
  using (public.is_admin()) with check (public.is_admin());
create policy remitos_franq_select on remitos for select
  using (public.is_franquicia() and cliente_id = public.mi_cliente_id());

-- PRECIOS Y OFERTAS (lectura franquicia)
drop policy if exists precios_admin on precios;
drop policy if exists precios_read on precios;
create policy precios_admin on precios for all
  using (public.is_admin()) with check (public.is_admin());
create policy precios_read on precios for select
  using (public.is_admin() or public.is_franquicia());

drop policy if exists ofertas_admin on ofertas;
drop policy if exists ofertas_read on ofertas;
create policy ofertas_admin on ofertas for all
  using (public.is_admin()) with check (public.is_admin());
create policy ofertas_read on ofertas for select
  using (public.is_admin() or public.is_franquicia());
