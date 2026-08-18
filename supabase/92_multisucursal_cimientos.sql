-- ============================================================
-- 92 — MULTI-SUCURSAL: cimientos (etapa 1 de 4)
-- ============================================================
-- OBJETIVO
-- Que cada sucursal (arranca Monte Cristo) pueda tener su propia caja,
-- stock, cuenta corriente y cierre dentro del mismo sistema.
--
-- Hoy el sistema es MONO-EMPRESA: de 56 tablas, solo `profiles` sabe de qué
-- sucursal es su fila. Cada venta, cada kilo y cada movimiento de cuenta
-- corriente es implícitamente "de Río Primero".
--
-- ESTA MIGRACIÓN NO CAMBIA NADA EN PANTALLA — a propósito.
-- Solo agrega la dimensión "de quién es esta fila" y asigna TODO lo que ya
-- existe a la central. El sistema tiene que seguir funcionando exactamente
-- igual después de correrla; si algo cambia, algo salió mal y hay que
-- volver atrás con 92_rollback_multisucursal.sql.
--
-- Las etapas que siguen (NO están acá):
--   2) RLS: mi_sucursal() + policies para que la plata no se mezcle.
--   3) Rol `sucursal`, menú recortado y los constraints que faltan (ver
--      "DEUDA DEJADA A PROPÓSITO" al final).
--   4) Puente central→sucursal (opcional): que el remito genere el ingreso.
--
-- Idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================


-- ------------------------------------------------------------
-- 1) LAS SUCURSALES, CON ID EXPLÍCITO
-- ------------------------------------------------------------
-- OJO — TRAMPA IMPORTANTE:
-- La tabla `sucursales` existe desde el schema original pero está VACÍA, y
-- sin embargo el perfil de Roxana (franquicia ALVEAR) ya apunta a
-- `sucursal_id = 2`. No hay FK, así que la referencia quedó colgada.
--
-- Si insertáramos con id automático, la central se llevaría el 1 y Monte
-- Cristo el 2 → el usuario de ALVEAR pasaría a ver los datos de MONTE
-- CRISTO. Por eso los ids van FIJOS y el 2 queda reservado para Alvear,
-- respetando lo que ya está cargado.
--
--   1 = FABRICIUS CENTRAL (Río Primero)
--   2 = ALVEAR           (ya referenciado por el perfil de Roxana)
--   3 = MONTE CRISTO     (la que arranca ahora)
-- ------------------------------------------------------------

INSERT INTO sucursales (id, nombre, direccion, tipo, lista_precios)
VALUES
  (1, 'FABRICIUS CENTRAL', 'Río Primero', 'central',    'min'),
  (2, 'ALVEAR',            NULL,          'franquicia', 'carn'),
  (3, 'MONTE CRISTO',      NULL,          'franquicia', 'carn')
ON CONFLICT (id) DO NOTHING;

-- Dejar la secuencia por encima de los ids fijos, para que un alta futura
-- desde la app no choque contra el 1, 2 o 3.
SELECT setval('sucursales_id_seq', GREATEST((SELECT MAX(id) FROM sucursales), 3));

-- Ahora que las filas existen, la referencia de `profiles` se puede validar.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_sucursal_id_fkey;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);


-- ------------------------------------------------------------
-- 2) sucursal_id EN EL NÚCLEO OPERATIVO
-- ------------------------------------------------------------
-- 28 tablas: todo lo que es plata, stock o gente de un negocio puntual.
--
-- Van con NOT NULL DEFAULT 1, y el DEFAULT SE QUEDA por ahora. Es lo que
-- hace que esta migración sea invisible: la app todavía no manda
-- sucursal_id en ningún INSERT, así que sin default fallaría todo.
-- En la etapa 2 el default se reemplaza por un trigger que lo toma de
-- mi_sucursal(); recién ahí deja de ser "todo va a la central por descarte".
--
-- Quedan AFUERA a propósito (son de la central y no se comparten):
--   facturación y fiscal .... facturas, cuentas_fiscales, arca_config,
--                             arca_ta, impuestos_pagados, ejercicios,
--                             ejercicio_lineas, cheques
--   whatsapp / iris ......... wa_*, pedidos_whatsapp, fabri_memoria
--   pedidos del portal ...... pedidos, flujo_deposito
--   catálogo compartido ..... precios, plu, etiquetas_plantillas
--   varios .................. contrapartes, combos_imagenes,
--                             etiquetas_impresas, push_subscriptions,
--                             pagos_proveedores_semanal (modelo viejo)
-- ------------------------------------------------------------

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    -- depósito y stock
    'stock_actual', 'medias_stock', 'piezas_stock', 'cajas_stock',
    'entradas_deposito', 'salidas_deposito', 'despostes',
    'elaboraciones_embutidos', 'stock_snapshots',
    -- caja y ventas
    'ventas_minoristas', 'arqueos_caja',
    -- clientes y comercial
    'clientes', 'movimientos_ctacte', 'remitos', 'presupuestos',
    'ofertas', 'combos_venta',
    -- proveedores
    'proveedores', 'movimientos_proveedores', 'compras_proveedores',
    'pagos_proveedores',
    -- finanzas y personal
    'gastos', 'empleados_sueldos', 'liquidaciones_sueldos', 'conceptos_sueldos',
    -- cierre
    'cierres_semanales', 'meses_operativos',
    -- trazabilidad
    'auditoria_log'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS sucursal_id integer NOT NULL DEFAULT 1', t
    );
    -- FK aparte: ADD COLUMN IF NOT EXISTS no acepta REFERENCES de forma
    -- idempotente, así que la constraint se agrega en un paso propio.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_sucursal_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)',
      t, t || '_sucursal_id_fkey'
    );
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 3) config_sistema: NULL = vale para todas
-- ------------------------------------------------------------
-- Las 5 claves no van todas al mismo lado:
--   caja_config ......... de cada sucursal (su ticket lleva su dirección)
--   merma_conversion .... de cada sucursal (es su rendimiento real)
--   promo_mundial ....... de la central (es un descuento sobre la lista)
--   ean13_formato ....... de la central (va atado al PLU compartido)
--   tope_gastos_socios .. solo central (Fabricio y Ariel)
--
-- Acá SOLO se agrega la columna, con NULL = "vale para todas". Las 5 filas
-- de hoy quedan en NULL, así que todo se sigue leyendo igual.
--
-- La PK sigue siendo `clave` a propósito: cambiarla ahora rompería la app.
-- Ver "DEUDA DEJADA A PROPÓSITO" al final.
-- ------------------------------------------------------------

ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sucursal_id integer;
ALTER TABLE config_sistema DROP CONSTRAINT IF EXISTS config_sistema_sucursal_id_fkey;
ALTER TABLE config_sistema
  ADD CONSTRAINT config_sistema_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);


-- ------------------------------------------------------------
-- 4) EL CANDADO PRINCIPAL: stock_actual
-- ------------------------------------------------------------
-- `stock_actual` tenía UNIQUE (tipo): un solo `bovino_corte` en toda la
-- base. Era el motivo por el que dos sucursales no podían coexistir.
--
-- Es seguro cambiarlo sin tocar código: actualizarStock() hace
-- SELECT → UPDATE/INSERT a mano, no usa upsert con ON CONFLICT (tipo).
-- (Verificado: no hay ningún onConflict sobre stock_actual en el repo.)
-- ------------------------------------------------------------

ALTER TABLE stock_actual DROP CONSTRAINT IF EXISTS stock_actual_tipo_key;
ALTER TABLE stock_actual DROP CONSTRAINT IF EXISTS stock_actual_sucursal_tipo_key;
ALTER TABLE stock_actual
  ADD CONSTRAINT stock_actual_sucursal_tipo_key UNIQUE (sucursal_id, tipo);


-- ------------------------------------------------------------
-- 5) PRECIOS POR SUCURSAL
-- ------------------------------------------------------------
-- Decisión de negocio: el CATÁLOGO es de la central y los PRECIOS los carga
-- cada sucursal a mano (respetan la lista por contrato, sin candados).
--
-- El motivo de partirlo es `precios.stock_origen`: esa columna decide de qué
-- bucket descuenta cada venta. Un precio mal cargado se ve; un stock_origen
-- mal cargado descuenta del bucket equivocado EN SILENCIO — así nacieron los
-- 14 cortes de vaca que descontaban cerdo.
--
-- Solo DOS listas: Minorista y Mayorista. `precio_carniceria` no existe acá
-- porque esa lista es la de la central para venderles A ELLOS.
--
-- Arranca VACÍA: la central sigue leyendo sus precios de `precios`, así que
-- esta migración no le cambia nada. Ver la nota de deuda al final.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS precios_sucursal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id       integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  precio_id         uuid    NOT NULL REFERENCES precios(id)    ON DELETE CASCADE,
  precio_minorista  numeric,
  precio_mayorista  numeric,
  updated_at        timestamptz DEFAULT now(),
  CONSTRAINT precios_sucursal_unico UNIQUE (sucursal_id, precio_id)
);

ALTER TABLE precios_sucursal ENABLE ROW LEVEL SECURITY;

-- Mismas policies que `precios`, que es la tabla hermana: los admin escriben
-- y cualquier usuario logueado lee (la Caja y los portales necesitan el
-- precio para vender y para mostrar la lista).
--
-- NO usar `TO authenticated USING (true)`: dejaría a los portales de cliente
-- y franquicia escribiendo precios. En la etapa 2 estas dos policies se
-- reemplazan por el filtro real por sucursal.
DROP POLICY IF EXISTS precios_sucursal_admin ON precios_sucursal;
CREATE POLICY precios_sucursal_admin ON precios_sucursal
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS precios_sucursal_lectura ON precios_sucursal;
CREATE POLICY precios_sucursal_lectura ON precios_sucursal
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ------------------------------------------------------------
-- 6) VERIFICACIÓN — correr esto DESPUÉS y mirar el resultado
-- ------------------------------------------------------------
-- Las 3 sucursales, 28 tablas con sucursal_id, todo en la central (1),
-- y el UNIQUE de stock_actual ya sobre (sucursal_id, tipo).
-- ------------------------------------------------------------

SELECT 'sucursales'            AS control, string_agg(id || '=' || nombre, ' · ' ORDER BY id) AS resultado FROM sucursales
UNION ALL
SELECT 'tablas con sucursal_id', count(*)::text FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'sucursal_id'
UNION ALL
SELECT 'stock fuera de central', count(*)::text FROM stock_actual WHERE sucursal_id <> 1
UNION ALL
SELECT 'ventas fuera de central', count(*)::text FROM ventas_minoristas WHERE sucursal_id <> 1
UNION ALL
SELECT 'ctacte fuera de central', count(*)::text FROM movimientos_ctacte WHERE sucursal_id <> 1
UNION ALL
SELECT 'unique de stock_actual', pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'stock_actual_sucursal_tipo_key'
UNION ALL
SELECT 'perfil de Roxana apunta a', s.nombre FROM profiles p
  JOIN sucursales s ON s.id = p.sucursal_id WHERE p.sucursal_id IS NOT NULL;

-- Esperado:
--   sucursales .................. 1=FABRICIUS CENTRAL · 2=ALVEAR · 3=MONTE CRISTO
--   tablas con sucursal_id ...... 31  (28 del núcleo + profiles + config_sistema + precios_sucursal)
--   *fuera de central ........... 0, 0, 0
--   unique de stock_actual ...... UNIQUE (sucursal_id, tipo)
--   perfil de Roxana apunta a ... ALVEAR   ← si dice MONTE CRISTO, ABORTAR


-- ============================================================
-- DEUDA DEJADA A PROPÓSITO (va en la etapa 3, con su cambio de código)
-- ============================================================
-- Hay 3 constraints únicos que todavía NO incluyen sucursal_id. No se tocan
-- acá porque el código hace upsert con ON CONFLICT sobre ellos: cambiar la
-- constraint sin deployar el código al mismo tiempo rompe producción. Los
-- dos cambios tienen que viajar juntos.
--
--   config_sistema      PK (clave)
--     → PK (clave, sucursal_id) con UNIQUE NULLS NOT DISTINCT
--     código: 4 upserts con onConflict:'clave'
--             (categoriasPrecios.js, Deposito.jsx, Precios.jsx, Gastos.jsx)
--             y todos los .eq('clave',X).maybeSingle() — maybeSingle() TIRA
--             ERROR si hay 2 filas, así que hay que filtrar por sucursal.
--
--   stock_snapshots     UNIQUE (fecha)
--     → UNIQUE (sucursal_id, fecha)
--     código: controlSemanal.js onConflict:'fecha'
--
--   conceptos_sueldos   UNIQUE (mes, empleado_id, tipo)
--     → UNIQUE (sucursal_id, mes, empleado_id, tipo)
--     código: Sueldos.jsx, 2 upserts con onConflict:'mes,empleado_id,tipo'
--
-- Mientras tanto no molestan: Monte Cristo todavía no opera, así que sigue
-- habiendo una sola fila de cada cosa.
--
-- Otra deuda: la central sigue leyendo sus precios de `precios.precio_*` y
-- las sucursales los leerán de `precios_sucursal`. Son dos caminos para lo
-- mismo. Unificar (mover también los precios de la central a
-- precios_sucursal) es más prolijo, pero es un cambio de comportamiento para
-- la central y no corresponde a esta etapa.
-- ============================================================
