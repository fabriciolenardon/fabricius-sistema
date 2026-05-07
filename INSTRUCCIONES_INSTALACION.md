# 🥩 CARNICERIAS FABRICIUS — GUÍA DE INSTALACIÓN
## Sistema de Gestión Web — Paso a paso

---

## LO QUE VAS A NECESITAR
- Una computadora con internet
- 30 minutos de tu tiempo
- Todo es GRATIS hasta cierto volumen

---

## PASO 1 — Instalar Node.js en tu computadora

1. Entrá a https://nodejs.org
2. Descargá la versión "LTS" (la recomendada)
3. Instalala como cualquier programa
4. Para verificar: abrí el símbolo del sistema (CMD en Windows) y escribí:
   ```
   node --version
   ```
   Tiene que aparecer algo como: v20.0.0

---

## PASO 2 — Crear cuenta en Supabase (base de datos GRATIS)

1. Entrá a https://supabase.com
2. Hacé clic en "Start your project" → "Sign up"
3. Registrate con tu email (ej: fabricio@fabricius.com.ar)
4. Una vez adentro, hacé clic en "New project"
5. Completá:
   - Organization: Carnicerias Fabricius
   - Name: fabricius-sistema
   - Database Password: anotá esta contraseña en un lugar seguro
   - Region: South America (São Paulo)
6. Esperá 2 minutos que se crea el proyecto

---

## PASO 3 — Crear las tablas en Supabase

1. En tu proyecto Supabase, hacé clic en "SQL Editor" (menú izquierdo)
2. Hacé clic en "New query"
3. Copiá y pegá TODO el siguiente código SQL y hacé clic en "Run":

```sql
-- SUCURSALES
create table sucursales (
  id serial primary key,
  nombre text not null,
  direccion text,
  tipo text check (tipo in ('central', 'franquicia')),
  lista_precios text default 'carn',
  created_at timestamp default now()
);

-- PERFILES DE USUARIO
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  nombre text not null,
  rol text not null check (rol in ('admin', 'franquicia')),
  sucursal_id int references sucursales(id),
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

-- CLIENTES
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

-- CUENTA CORRIENTE
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
  proveedor_nombre text,
  importe numeric not null,
  forma text,
  percepcion boolean default false,
  notas text,
  created_at timestamp default now()
);

-- SUELDOS
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

-- DATOS INICIALES: Sucursales
insert into sucursales (nombre, direccion, tipo) values
  ('Central Mitre 670', 'Mitre 670, Río Primero, Córdoba', 'central'),
  ('Fabricius Carnicería — Alvear esq. Jujuy', 'Alvear esq. Jujuy, Río Primero, Córdoba', 'franquicia'),
  ('Fabricius Suc. Monte Cristo', 'Máximo Astudillo 44, Monte Cristo, Córdoba', 'franquicia');

-- DATOS INICIALES: Clientes (sucursales)
insert into clientes (nombre, tipo, localidad, lista_precios) values
  ('Fabricius Carnicería — Alvear esq. Jujuy', 'sucursal', 'Río Primero', 'carn'),
  ('Fabricius Suc. Monte Cristo', 'sucursal', 'Monte Cristo', 'carn');

-- DATOS INICIALES: Empleados
insert into empleados (apellido, nombre, modalidad, valor_hora, fijo_semanal, comision_pct, puesto, activo) values
  ('FRONTERA', 'GERMAN GABRIEL', 'hora', 6000, 0, 0, 'carnicero', true),
  ('ARNAUDO', 'ELIAS COLO', 'hora', 5500, 0, 0, 'carnicero', true),
  ('PAEZ', 'LUCIANO', 'hora', 5000, 0, 0, 'carnicero', true),
  ('SCIENZA', 'CAMILA', 'hora', 5000, 0, 0, 'carnicero', true),
  ('FRONTERA', 'GIULIANA', 'mixto', 6000, 30100, 0, 'administrativo', true),
  ('MANSILLA', 'PRISCILA', 'hora', 5000, 0, 0, 'carnicero', true),
  ('GARRONE', 'MAGALI', 'comision', 0, 0, 10, 'administrativo', true);

-- Habilitar RLS
alter table profiles enable row level security;
alter table cierres_semanales enable row level security;
alter table gastos enable row level security;
alter table empleados enable row level security;
alter table entradas_deposito enable row level security;
alter table salidas_deposito enable row level security;
alter table movimientos_ctacte enable row level security;
alter table cheques enable row level security;
alter table liquidaciones_sueldos enable row level security;
alter table clientes enable row level security;
alter table pagos_proveedores enable row level security;

-- Políticas: admins ven todo
create policy "admin_all_cierres" on cierres_semanales for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_gastos" on gastos for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_empleados" on empleados for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_entradas" on entradas_deposito for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_salidas" on salidas_deposito for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_cheques" on cheques for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_sueldos" on liquidaciones_sueldos for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_clientes" on clientes for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "admin_all_pagos" on pagos_proveedores for all using (
  exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);

-- Franquicias: solo ven sus movimientos
create policy "franq_own_movimientos" on movimientos_ctacte for select using (
  exists (select 1 from profiles p join sucursales s on s.id = p.sucursal_id join clientes c on c.nombre ilike '%' || s.nombre || '%' where p.id = auth.uid() and c.id = movimientos_ctacte.cliente_id)
);
create policy "franq_own_salidas" on salidas_deposito for select using (
  exists (select 1 from profiles p join sucursales s on s.id = p.sucursal_id where p.id = auth.uid() and salidas_deposito.cliente_nombre ilike '%' || s.nombre || '%')
);
create policy "franq_own_clientes" on clientes for select using (
  exists (select 1 from profiles p join sucursales s on s.id = p.sucursal_id where p.id = auth.uid() and clientes.nombre ilike '%' || s.nombre || '%')
  or exists (select 1 from profiles where id = auth.uid() and rol = 'admin')
);
create policy "profiles_own" on profiles for all using (auth.uid() = id);
```

---

## PASO 4 — Crear los usuarios en Supabase

1. En Supabase, andá a "Authentication" → "Users"
2. Hacé clic en "Add user" para cada uno:

| Nombre | Email | Contraseña | Rol |
|--------|-------|-----------|-----|
| Fabricio Lenardon | fabricio@fabricius.com.ar | (elegí una contraseña segura) | admin |
| Ariel Garrone | ariel@fabricius.com.ar | (contraseña) | admin |
| Giuliana Frontera | giuliana@fabricius.com.ar | (contraseña) | admin |
| Sucursal Alvear | alvear@fabricius.com.ar | (contraseña) | franquicia |
| Sucursal Monte Cristo | montecRisto@fabricius.com.ar | (contraseña) | franquicia |

3. Después de crear cada usuario, ejecutá en SQL Editor (cambiando los valores):

```sql
-- Ejecutar para CADA usuario admin (cambiar el email y nombre)
insert into profiles (id, nombre, rol)
select id, 'Fabricio Lenardon', 'admin'
from auth.users where email = 'fabricio@fabricius.com.ar';

insert into profiles (id, nombre, rol)
select id, 'Ariel Garrone', 'admin'
from auth.users where email = 'ariel@fabricius.com.ar';

insert into profiles (id, nombre, rol)
select id, 'Giuliana Frontera', 'admin'
from auth.users where email = 'giuliana@fabricius.com.ar';

-- Para las sucursales (vinculadas a su sucursal)
insert into profiles (id, nombre, rol, sucursal_id)
select id, 'Fabricius Alvear', 'franquicia', 2
from auth.users where email = 'alvear@fabricius.com.ar';

insert into profiles (id, nombre, rol, sucursal_id)
select id, 'Fabricius Monte Cristo', 'franquicia', 3
from auth.users where email = 'montecRisto@fabricius.com.ar';
```

---

## PASO 5 — Obtener las claves de Supabase

1. En Supabase, andá a "Settings" → "API"
2. Copiá:
   - **Project URL**: algo como https://abcdefgh.supabase.co
   - **anon public key**: una clave larga que empieza con "eyJ..."

---

## PASO 6 — Configurar el proyecto en tu computadora

1. Descomprimí la carpeta `fabricius-app` que te pasó Claude
2. Abrí esa carpeta
3. Creá un archivo llamado `.env` (con el punto adelante) y escribí:

```
VITE_SUPABASE_URL=https://TU_URL.supabase.co
VITE_SUPABASE_ANON_KEY=tu_clave_anon_aqui
```

(Reemplazá con los datos del Paso 5)

---

## PASO 7 — Instalar dependencias y probar localmente

Abrí el símbolo del sistema (CMD) dentro de la carpeta `fabricius-app` y ejecutá:

```bash
npm install
npm run dev
```

Abrí el navegador en http://localhost:5173

¡Deberías ver el sistema funcionando! Probá iniciar sesión con algún usuario.

---

## PASO 8 — Subir a internet (deploy en Vercel)

1. Creá una cuenta en https://github.com (gratis)
2. Creá un repositorio nuevo llamado "fabricius-sistema"
3. Subí todos los archivos de la carpeta `fabricius-app` al repositorio

4. Creá una cuenta en https://vercel.com (gratis)
5. Hacé clic en "Add new project"
6. Conectá tu cuenta de GitHub y seleccioná "fabricius-sistema"
7. En "Environment Variables" agregá:
   - VITE_SUPABASE_URL = tu URL de Supabase
   - VITE_SUPABASE_ANON_KEY = tu clave anon
8. Hacé clic en "Deploy"

En 2 minutos Vercel te va a dar una URL como:
**https://fabricius-sistema.vercel.app**

¡Esa es tu app online! Cualquiera puede entrar desde esa URL.

---

## PASO 9 — Dominio propio (opcional)

Si querés que sea **https://sistema.fabricius.com.ar** o similar:

1. Comprá un dominio en NIC Argentina (https://nic.ar) o en Namecheap
2. En Vercel → tu proyecto → "Domains" → agregá tu dominio
3. Vercel te explica cómo apuntar el DNS

---

## ACCESOS FINALES

| Usuario | Email | Qué puede hacer |
|---------|-------|----------------|
| Fabricio | fabricio@fabricius.com.ar | TODO |
| Ariel | ariel@fabricius.com.ar | TODO |
| Giuliana | giuliana@fabricius.com.ar | TODO |
| Sucursal Alvear | alvear@fabricius.com.ar | Solo su cta. cte. y remitos |
| Monte Cristo | montecRisto@fabricius.com.ar | Solo su cta. cte. y remitos |

---

## ¿PROBLEMAS?

Si algo no funciona, los errores más comunes son:
- **"Invalid API key"**: Revisá que las claves en el .env sean correctas
- **"Row level security"**: Verificá que los profiles estén creados en el SQL
- **Página en blanco**: Revisá la consola del navegador (F12) y buscá el error

---

## SOPORTE

Este sistema fue construido específicamente para Carnicerias Fabricius.
Cualquier duda o ajuste: seguí trabajando con Claude en claude.ai

Versión 1.0 — Mayo 2026
