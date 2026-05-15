-- Extensiones de esquema usadas por la app (idempotente)

-- Columnas extra en tablas base
alter table clientes add column if not exists nombre_fantasia text;
alter table clientes add column if not exists domicilio text;

alter table proveedores add column if not exists activo boolean default true;

alter table entradas_deposito add column if not exists despostada boolean default false;
alter table entradas_deposito add column if not exists reservada boolean default false;
alter table entradas_deposito add column if not exists desposte_id int;

alter table movimientos_ctacte add column if not exists remito_id int;

-- PRECIOS
create table if not exists precios (
  id serial primary key,
  categoria text not null,
  nombre text not null,
  precio_carniceria numeric,
  precio_mayorista numeric,
  precio_minorista numeric,
  precio_carn numeric,
  precio_may numeric,
  precio_min numeric,
  ean text,
  activo boolean default true,
  updated_at timestamptz default now()
);

-- STOCK ACTUAL
create table if not exists stock_actual (
  id serial primary key,
  tipo text not null unique,
  kg_disponible numeric default 0,
  updated_at timestamptz default now()
);

-- REMITOS
create table if not exists remitos (
  id serial primary key,
  numero serial,
  fecha date not null default current_date,
  cliente_id int references clientes(id),
  cliente_nombre text,
  domicilio text,
  items jsonb default '[]'::jsonb,
  total numeric default 0,
  cobro text,
  notas text,
  eliminado boolean default false,
  eliminado_por text,
  eliminado_en timestamptz,
  created_at timestamptz default now()
);

-- FK remito en movimientos (después de crear remitos)
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'movimientos_ctacte_remito_id_fkey'
  ) then
    alter table movimientos_ctacte
      add constraint movimientos_ctacte_remito_id_fkey
      foreign key (remito_id) references remitos(id) on delete set null;
  end if;
end $$;

-- VENTAS MINORISTAS
create table if not exists ventas_minoristas (
  id serial primary key,
  fecha date not null,
  turno text,
  items jsonb default '[]'::jsonb,
  total numeric default 0,
  efectivo numeric default 0,
  debito numeric default 0,
  transferencia numeric default 0,
  notas text,
  created_at timestamptz default now()
);

-- DESPOSTES
create table if not exists despostes (
  id serial primary key,
  fecha date not null,
  entrada_id int references entradas_deposito(id) on delete set null,
  modelo text,
  tipo_desposte text,
  tipo_animal text,
  kg_media_res numeric default 0,
  merma_pct numeric default 0,
  kg_neto numeric default 0,
  piezas jsonb default '[]'::jsonb,
  notas text,
  created_at timestamptz default now()
);

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'entradas_deposito_desposte_id_fkey'
  ) then
    alter table entradas_deposito
      add constraint entradas_deposito_desposte_id_fkey
      foreign key (desposte_id) references despostes(id) on delete set null;
  end if;
end $$;

-- ELABORACIONES EMBUTIDOS
create table if not exists elaboraciones_embutidos (
  id serial primary key,
  fecha date not null,
  tipo text,
  tipo_embutido text,
  piezas_usadas jsonb default '[]'::jsonb,
  kg_carne_cerdo numeric default 0,
  kg_carne_bovina numeric default 0,
  kg_queso numeric default 0,
  kg_elaborado numeric default 0,
  pct_aumento numeric default 0,
  kg_final numeric default 0,
  maduracion_completa boolean default true,
  fecha_fin_maduracion date,
  notas text,
  created_at timestamptz default now()
);

-- COMPRAS Y PAGOS PROVEEDORES (módulo depósito)
create table if not exists compras_proveedores (
  id serial primary key,
  fecha date not null,
  semana_inicio date,
  semana_fin date,
  proveedor_nombre text,
  producto text,
  kg numeric default 0,
  importe numeric default 0,
  created_at timestamptz default now()
);

create table if not exists pagos_proveedores_semanal (
  id serial primary key,
  fecha date not null,
  semana_inicio date,
  semana_fin date,
  proveedor_nombre text,
  importe_compra numeric default 0,
  percepcion numeric default 0,
  saldo_anterior numeric default 0,
  entrega numeric default 0,
  saldo_adeudado numeric default 0,
  notas text,
  created_at timestamptz default now()
);

-- OFERTAS
create table if not exists ofertas (
  id serial primary key,
  precio_id int references precios(id) on delete cascade,
  producto_nombre text,
  precio_original_carniceria numeric,
  precio_original_mayorista numeric,
  precio_original_minorista numeric,
  precio_oferta numeric not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  activa boolean default true,
  notas text,
  created_at timestamptz default now()
);

-- PLU (balanza)
create table if not exists plu (
  id uuid primary key default gen_random_uuid(),
  codigo text,
  nombre text,
  precio numeric,
  categoria text,
  precio_id int references precios(id) on delete set null,
  created_at timestamptz default now()
);

-- Stock inicial sugerido (tipos usados en Dashboard / Depósito)
insert into stock_actual (tipo, kg_disponible)
select v.tipo, 0 from (values
  ('bovino_mr'), ('bovino_pieza'), ('bovino_corte'), ('bovino_brosa'),
  ('cerdo'), ('cerdo_pierna'), ('cerdo_carre'), ('cerdo_pechito'),
  ('cerdo_matambre'), ('cerdo_paleta'), ('cerdo_parrillero'),
  ('cerdo_bondiola'), ('cerdo_tocino'), ('cerdo_cuero'), ('cerdo_cabeza'),
  ('pollo'), ('embutido'), ('rebozado'),
  ('pieza_pierna'), ('pieza_cuarto_pistola'), ('pieza_costillar'),
  ('pieza_cortito'), ('pieza_carre'), ('pieza_paleta'), ('pieza_parrillero'),
  ('caja_cb'), ('caja_pt')
) as v(tipo)
on conflict (tipo) do nothing;
