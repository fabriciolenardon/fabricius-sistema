-- Carnicerías Fabricius — Esquema base
-- Ejecutar en Supabase SQL Editor (proyecto nuevo o migración inicial)

-- SUCURSALES
create table if not exists sucursales (
  id serial primary key,
  nombre text not null,
  direccion text,
  tipo text check (tipo in ('central', 'franquicia')),
  lista_precios text default 'carn',
  created_at timestamptz default now()
);

-- PERFILES DE USUARIO
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text not null,
  rol text not null check (rol in ('admin', 'franquicia')),
  sucursal_id int references sucursales(id),
  created_at timestamptz default now()
);

-- EMPLEADOS
create table if not exists empleados (
  id serial primary key,
  apellido text not null,
  nombre text not null,
  dni text,
  nacimiento date,
  telefono text,
  sangre text,
  direccion text,
  emergencia text,
  ingreso date,
  puesto text,
  modalidad text check (modalidad in ('hora', 'comision', 'mixto')),
  valor_hora numeric default 0,
  fijo_semanal numeric default 0,
  comision_pct numeric default 0,
  cbu text,
  notas text,
  activo boolean default true,
  created_at timestamptz default now()
);

-- CLIENTES
create table if not exists clientes (
  id serial primary key,
  nombre text not null,
  tipo text check (tipo in ('carniceria', 'mayorista', 'sucursal')),
  telefono text,
  localidad text,
  cuit text,
  lista_precios text default 'carn',
  notas text,
  saldo numeric default 0,
  created_at timestamptz default now()
);

-- PROVEEDORES
create table if not exists proveedores (
  id serial primary key,
  nombre text not null,
  telefono text,
  notas text,
  saldo_adeudado numeric default 0,
  created_at timestamptz default now()
);

-- ENTRADAS AL DEPÓSITO
create table if not exists entradas_deposito (
  id serial primary key,
  fecha date not null,
  tipo text not null,
  proveedor_nombre text,
  descripcion text,
  kg numeric default 0,
  kg_real numeric default 0,
  merma_pct numeric default 0,
  precio_kg numeric default 0,
  importe numeric default 0,
  destino text,
  cantidad int default 1,
  created_at timestamptz default now()
);

-- SALIDAS / DESPACHOS
create table if not exists salidas_deposito (
  id serial primary key,
  fecha date not null,
  cliente_id int references clientes(id),
  cliente_nombre text,
  tipo text,
  descripcion text,
  kg numeric default 0,
  precio_kg numeric default 0,
  total numeric default 0,
  lista text,
  cobro text,
  notas text,
  created_at timestamptz default now()
);

-- CUENTA CORRIENTE
create table if not exists movimientos_ctacte (
  id serial primary key,
  fecha date not null,
  cliente_id int references clientes(id),
  tipo text check (tipo in ('compra', 'pago', 'cheque', 'ajuste')),
  descripcion text,
  debe numeric default 0,
  haber numeric default 0,
  saldo numeric default 0,
  created_at timestamptz default now()
);

-- CHEQUES
create table if not exists cheques (
  id serial primary key,
  fecha_recepcion date not null,
  fecha_pago date,
  tipo text check (tipo in ('fisico', 'echeq')),
  numero text not null,
  banco text,
  cliente_id int references clientes(id),
  cliente_nombre text,
  monto numeric not null,
  destino text check (destino in ('ctacte', 'endoso')),
  proveedor_nombre text,
  notas text,
  created_at timestamptz default now()
);

-- PAGOS A PROVEEDORES (legacy)
create table if not exists pagos_proveedores (
  id serial primary key,
  fecha date not null,
  proveedor_nombre text,
  importe numeric not null,
  forma text,
  percepcion boolean default false,
  notas text,
  created_at timestamptz default now()
);

-- SUELDOS
create table if not exists liquidaciones_sueldos (
  id serial primary key,
  semana_inicio date not null,
  semana_fin date not null,
  empleado_id int references empleados(id),
  empleado_nombre text,
  horas numeric default 0,
  bruto numeric default 0,
  boletas numeric default 0,
  neto numeric default 0,
  created_at timestamptz default now()
);

-- GASTOS
create table if not exists gastos (
  id serial primary key,
  fecha date not null,
  tipo text check (tipo in ('variable', 'fijo', 'socio', 'ingreso')),
  categoria text,
  descripcion text not null,
  monto numeric not null,
  forma text,
  socio text,
  origen_ingreso text,
  notas text,
  created_at timestamptz default now()
);

-- CIERRES SEMANALES
create table if not exists cierres_semanales (
  id serial primary key,
  semana_inicio date not null,
  semana_fin date not null,
  mes text,
  ventas numeric default 0,
  compras numeric default 0,
  gastos numeric default 0,
  sueldos numeric default 0,
  ganancia numeric default 0,
  ingresos jsonb,
  kg_carne numeric default 0,
  kg_pollo numeric default 0,
  kg_cerdo numeric default 0,
  kg_merma numeric default 0,
  created_at timestamptz default now()
);

-- Datos iniciales (solo si no existen)
insert into sucursales (nombre, direccion, tipo)
select * from (values
  ('Central Mitre 670', 'Mitre 670, Río Primero, Córdoba', 'central'),
  ('Fabricius Carnicería — Alvear esq. Jujuy', 'Alvear esq. Jujuy, Río Primero, Córdoba', 'franquicia'),
  ('Fabricius Suc. Monte Cristo', 'Máximo Astudillo 44, Monte Cristo, Córdoba', 'franquicia')
) as v(nombre, direccion, tipo)
where not exists (select 1 from sucursales limit 1);
