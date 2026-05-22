-- ============================================================
-- MIGRACIÓN 12: Caja + Balanza Cuora Max
-- ============================================================
-- Agrega soporte para ventas con lector de código de barras
-- e impresión de etiquetas autoadhesivas.
-- ============================================================

-- 1) PRECIOS: agregar código PLU de balanza + flag pesable
alter table precios add column if not exists codigo_balanza int;
alter table precios add column if not exists pesable boolean default true;
alter table precios add column if not exists descripcion_etiqueta text;
alter table precios add column if not exists dias_vencimiento int default 3;

-- Índice para búsqueda rápida por código de balanza
create unique index if not exists idx_precios_codigo_balanza
  on precios(codigo_balanza)
  where codigo_balanza is not null;

-- 2) VENTAS_MINORISTAS: marcar origen (manual vs caja)
alter table ventas_minoristas add column if not exists origen text default 'manual';
-- valores: 'manual' (registro manual al final del turno) | 'caja' (caja rápida con lector)
alter table ventas_minoristas add column if not exists cajero text;
alter table ventas_minoristas add column if not exists hora time;

-- 3) CONFIGURACIÓN GLOBAL del sistema (formato EAN-13, etc.)
create table if not exists config_sistema (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  updated_at timestamptz default now()
);

-- Configuración default del formato EAN-13 Cuora Max
-- Formato por defecto: 2 + PLU(4) + peso_gramos(5) + check(1) = peso embebido
insert into config_sistema (clave, valor, descripcion)
values
  ('ean13_formato', '{
    "prefijo": "2",
    "plu_digitos": 5,
    "tipo": "precio",
    "campo_digitos": 6,
    "ejemplo": "2 PPPPP IIIIII C - donde PPPPP es PLU e IIIIII es importe en centavos"
  }'::jsonb,
  'Formato del código EAN-13 que imprime la balanza Cuora Max (precio embebido)')
on conflict (clave) do nothing;

insert into config_sistema (clave, valor, descripcion)
values
  ('caja_config', '{
    "ticket_pie": "Gracias por su compra - Fabricius Carnicerías",
    "vuelto_auto": true,
    "imprimir_ticket": false
  }'::jsonb,
  'Configuración de la caja minorista')
on conflict (clave) do nothing;

-- 4) PLANTILLAS DE ETIQUETAS
create table if not exists etiquetas_plantillas (
  id serial primary key,
  nombre text not null,
  ancho_mm int default 60,
  alto_mm int default 40,
  config jsonb not null default '{}'::jsonb,
  -- config tiene: { mostrar_codigo, mostrar_descripcion, mostrar_fecha_elab,
  --   mostrar_fecha_venc, mostrar_nombre, mostrar_precio, mostrar_peso,
  --   tamano_fuente, etc. }
  activa boolean default true,
  created_at timestamptz default now()
);

-- Plantilla por defecto
insert into etiquetas_plantillas (nombre, ancho_mm, alto_mm, config)
values (
  'Estándar',
  60, 40,
  '{
    "mostrar_codigo": true,
    "mostrar_descripcion": true,
    "mostrar_fecha_elab": true,
    "mostrar_fecha_venc": true,
    "mostrar_nombre": true,
    "tipo_codigo": "EAN13",
    "tamano_nombre": 12,
    "tamano_descripcion": 9
  }'::jsonb
)
on conflict do nothing;

-- 5) HISTORIAL DE ETIQUETAS IMPRESAS (opcional, para trazabilidad)
-- NOTA: producto_id es uuid porque precios.id es uuid en producción.
create table if not exists etiquetas_impresas (
  id serial primary key,
  producto_id uuid references precios(id) on delete set null,
  codigo text,
  descripcion text,
  fecha_elaboracion date,
  fecha_vencimiento date,
  lote text,
  cantidad int default 1,
  impreso_por text,
  created_at timestamptz default now()
);

-- 6) RLS
alter table config_sistema enable row level security;
alter table etiquetas_plantillas enable row level security;
alter table etiquetas_impresas enable row level security;

drop policy if exists "config_sistema_all" on config_sistema;
create policy "config_sistema_all" on config_sistema
  for all using (true) with check (true);

drop policy if exists "etiquetas_plantillas_all" on etiquetas_plantillas;
create policy "etiquetas_plantillas_all" on etiquetas_plantillas
  for all using (true) with check (true);

drop policy if exists "etiquetas_impresas_all" on etiquetas_impresas;
create policy "etiquetas_impresas_all" on etiquetas_impresas
  for all using (true) with check (true);
