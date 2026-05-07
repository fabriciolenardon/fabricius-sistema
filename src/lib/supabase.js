import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// =============================================
// SCHEMA SQL — Ejecutar en Supabase SQL Editor
// =============================================
/*

-- USUARIOS / PERFILES
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text not null,
  rol text not null check (rol in ('admin', 'franquicia')),
  sucursal_id int references sucursales(id),
  created_at timestamp default now()
);

-- SUCURSALES
create table sucursales (
  id serial primary key,
  nombre text not null,
  direccion text,
  tipo text check (tipo in ('central', 'franquicia')),
  lista_precios text default 'carn',
  created_at timestamp default now()
);

-- EMPLEADOS
create table empleados (
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
  created_at timestamp default now()
);

-- CLIENTES (carnicerías, gastronómicos, mayoristas)
create table clientes (
  id serial primary key,
  nombre text not null,
  tipo text check (tipo in ('carniceria', 'mayorista', 'sucursal')),
  telefono text,
  localidad text,
  cuit text,
  lista_precios text default 'carn',
  notas text,
  saldo numeric default 0,
  created_at timestamp default now()
);

-- PROVEEDORES
create table proveedores (
  id serial primary key,
  nombre text not null,
  telefono text,
  notas text,
  saldo_adeudado numeric default 0,
  created_at timestamp default now()
);

-- ENTRADAS AL DEPOSITO
create table entradas_deposito (
  id serial primary key,
  fecha date not null,
  tipo text not null,
  proveedor_id int references proveedores(id),
  proveedor_nombre text,
  descripcion text,
  kg numeric default 0,
  kg_real numeric default 0,
  merma_pct numeric default 0,
  precio_kg numeric default 0,
  importe numeric default 0,
  destino text,
  cantidad int default 1,
  created_at timestamp default now()
);

-- SALIDAS / DESPACHOS
create table salidas_deposito (
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
  created_at timestamp default now()
);

-- CUENTA CORRIENTE (movimientos)
create table movimientos_ctacte (
  id serial primary key,
  fecha date not null,
  cliente_id int references clientes(id),
  tipo text check (tipo in ('compra', 'pago', 'cheque', 'ajuste')),
  descripcion text,
  debe numeric default 0,
  haber numeric default 0,
  saldo numeric default 0,
  created_at timestamp default now()
);

-- CHEQUES
create table cheques (
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
  created_at timestamp default now()
);

-- PAGOS A PROVEEDORES
create table pagos_proveedores (
  id serial primary key,
  fecha date not null,
  proveedor_id int references proveedores(id),
  proveedor_nombre text,
  importe numeric not null,
  forma text,
  percepcion boolean default false,
  notas text,
  cheque_id int references cheques(id),
  created_at timestamp default now()
);

-- LIQUIDACIONES SUELDOS
create table liquidaciones_sueldos (
  id serial primary key,
  semana_inicio date not null,
  semana_fin date not null,
  empleado_id int references empleados(id),
  empleado_nombre text,
  horas numeric default 0,
  bruto numeric default 0,
  boletas numeric default 0,
  neto numeric default 0,
  created_at timestamp default now()
);

-- GASTOS
create table gastos (
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
  created_at timestamp default now()
);

-- CIERRES SEMANALES
create table cierres_semanales (
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
  created_at timestamp default now()
);

-- PRECIOS (para poder editarlos desde el sistema)
create table precios (
  id serial primary key,
  categoria text not null,
  nombre text not null,
  precio_carn numeric,
  precio_may numeric,
  precio_min numeric,
  ean text,
  activo boolean default true,
  updated_at timestamp default now()
);

-- ROW LEVEL SECURITY
alter table profiles enable row level security;
alter table cierres_semanales enable row level security;
alter table gastos enable row level security;

-- Admins ven todo
create policy "Admins full access" on cierres_semanales
  for all using (
    exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
  );

-- Franquicias solo ven sus propios movimientos
create policy "Franquicia own ctacte" on movimientos_ctacte
  for select using (
    exists (
      select 1 from profiles p
      join sucursales s on s.id = p.sucursal_id
      join clientes c on c.nombre = s.nombre
      where p.id = auth.uid() and c.id = movimientos_ctacte.cliente_id
    )
  );

*/
