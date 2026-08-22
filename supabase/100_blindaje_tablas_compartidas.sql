-- ============================================================
-- 100 — BLINDAJE DE LAS TABLAS COMPARTIDAS (cierre del multi-sucursal)
-- ============================================================
-- POR QUÉ
-- Las migraciones 92-95 aislaron las 29 tablas del núcleo: hoy Monte Cristo
-- no ve ni puede escribir una sola venta, gasto, factura o cliente de la
-- central. Eso está probado impersonando su usuario real.
--
-- Pero quedaron afuera las tablas SIN `sucursal_id`, que se gobiernan con
-- `is_admin()` — y en la 94 `is_admin()` pasó a incluir el rol `sucursal`.
-- Consecuencia medida en producción (21/08/2026), entrando como
-- fabriciusmontecristo@gmail.com:
--
--   profiles          → 13 perfiles ajenos escribibles. Cambiándose su propio
--                       sucursal_id a 1 pasa a ver 2560 ventas, 541 gastos y
--                       129 clientes de la central. (Escalada de privilegio.)
--   precios           → 259 filas del catálogo maestro escribibles/borrables.
--                       No es teórico: "Limpieza de duplicados" e "Importar
--                       PLUs CSV" están en su menú y hacen DELETE/UPDATE.
--   config_sistema    → las 5 claves globales. La sucursal ve la pestaña
--                       Ofertas: apretando "Promo Mundial" pone la Caja de la
--                       central a -10%.
--   precios_sucursal  → hoy sólo hay filas de Monte Cristo, pero cuando Alvear
--                       cargue su lista, cada una podría pisar la de la otra.
--
-- Decisión de Fabricio (21/08/2026): **los precios y las mermas los define la
-- central**. Esta migración lo hace cumplir en la base, no en la pantalla.
--
-- CÓMO
-- Mismo patrón que la 93: policies `RESTRICTIVE`, que en Postgres se combinan
-- con AND. Sólo pueden ACHICAR lo permitido, nunca ampliarlo → el riesgo
-- posible es dejar a alguien afuera, jamás filtrar datos de más. No se edita
-- ni se borra ninguna policy existente.
--
-- QUÉ NO CAMBIA
-- - La central (sucursal 1) sigue haciendo exactamente lo mismo que hoy.
-- - Las lecturas no se tocan salvo en `profiles` (ver abajo).
-- - `service_role` (edge functions crear/revocar-acceso-cliente, ARCA,
--   WhatsApp) saltea RLS por definición: sigue funcionando igual.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================


-- ------------------------------------------------------------
-- 0) HELPER: ¿soy la central?
-- ------------------------------------------------------------
-- `mi_sucursal()` devuelve NULL para los portales (cliente_mayorista y
-- franquicia, que no pertenecen a una sucursal). `NULL = 1` da NULL, que para
-- una policy es lo mismo que no pasar — que es justo lo que queremos: un
-- portal no escribe ninguna de estas tablas. El coalesce lo deja explícito.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION es_central()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(mi_sucursal(), 0) = 1
$$;


-- ------------------------------------------------------------
-- 1) profiles — LO MÁS GRAVE: cierra la escalada de privilegio
-- ------------------------------------------------------------
-- Ninguna pantalla de la app escribe `profiles` (verificado en todo src/):
-- el alta y la baja de accesos las hacen las edge functions
-- crear-acceso-cliente / revocar-acceso-cliente con service_role, que no
-- pasan por RLS. Así que bloquear la escritura acá no rompe nada.
--
-- La lectura sí cambia para las sucursales: hoy Monte Cristo ve los 14
-- perfiles (con nombre, rol y a quién corresponden); pasa a ver sólo el suyo,
-- que es lo único que la app le pide (AuthContext.fetchProfile).
-- ------------------------------------------------------------

DROP POLICY IF EXISTS profiles_lectura_acotada ON profiles;
CREATE POLICY profiles_lectura_acotada ON profiles
  AS RESTRICTIVE FOR SELECT TO public
  USING (id = auth.uid() OR es_central());

DROP POLICY IF EXISTS profiles_insert_central ON profiles;
CREATE POLICY profiles_insert_central ON profiles
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central());

DROP POLICY IF EXISTS profiles_update_central ON profiles;
CREATE POLICY profiles_update_central ON profiles
  AS RESTRICTIVE FOR UPDATE TO public
  USING (es_central()) WITH CHECK (es_central());

DROP POLICY IF EXISTS profiles_delete_central ON profiles;
CREATE POLICY profiles_delete_central ON profiles
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central());


-- ------------------------------------------------------------
-- 2) precios — el catálogo maestro es de la central
-- ------------------------------------------------------------
-- `precios` NO es una lista de precios: es el maestro de productos, con
-- `stock_origen`, PLU, pesable, kg_por_unidad. Un `stock_origen` mal cargado
-- descuenta del bucket equivocado EN SILENCIO (así nació el bug de los 14
-- cortes de vaca). Y un DELETE se lleva puesto el producto para las dos bocas.
--
-- La sucursal SIGUE LEYENDO todo el catálogo (lo necesita para vender) y
-- sigue escribiendo sus precios en `precios_sucursal`. Lo que ya no puede es
-- tocar el maestro.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS precios_insert_central ON precios;
CREATE POLICY precios_insert_central ON precios
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central());

DROP POLICY IF EXISTS precios_update_central ON precios;
CREATE POLICY precios_update_central ON precios
  AS RESTRICTIVE FOR UPDATE TO public
  USING (es_central()) WITH CHECK (es_central());

DROP POLICY IF EXISTS precios_delete_central ON precios;
CREATE POLICY precios_delete_central ON precios
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central());


-- ------------------------------------------------------------
-- 3) config_sistema — las 5 claves son globales, las define la central
-- ------------------------------------------------------------
-- Claves de hoy: promo_mundial, categorias_precios, merma_conversion,
-- tope_gastos_socios, caja_config. Ninguna es "de la sucursal": la promo es
-- del mostrador de Río Primero, las categorías son del catálogo compartido y
-- **las mermas las calcula la central** (decisión del 21/08/2026).
--
-- Todos siguen LEYENDO (la Caja necesita la promo, el Depósito la merma).
-- ------------------------------------------------------------

DROP POLICY IF EXISTS config_insert_central ON config_sistema;
CREATE POLICY config_insert_central ON config_sistema
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central());

DROP POLICY IF EXISTS config_update_central ON config_sistema;
CREATE POLICY config_update_central ON config_sistema
  AS RESTRICTIVE FOR UPDATE TO public
  USING (es_central()) WITH CHECK (es_central());

DROP POLICY IF EXISTS config_delete_central ON config_sistema;
CREATE POLICY config_delete_central ON config_sistema
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central());


-- ------------------------------------------------------------
-- 4) precios_sucursal — cada boca la suya; la central, todas
-- ------------------------------------------------------------
-- La central necesita las tres: siembra la lista de una boca nueva (mig 97) y
-- define el override de `stock_origen` por sucursal (mig 99, milanesas).
-- Una sucursal ve y toca sólo su fila.
--
-- Hoy esto no cambia nada (las 245 filas son de Monte Cristo). Importa el día
-- que Alvear cargue la suya, que es justamente lo que viene.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS precios_sucursal_aislamiento ON precios_sucursal;
CREATE POLICY precios_sucursal_aislamiento ON precios_sucursal
  AS RESTRICTIVE FOR ALL TO public
  USING      (es_central() OR sucursal_id = mi_sucursal())
  WITH CHECK (es_central() OR sucursal_id = mi_sucursal());


-- ============================================================
-- VERIFICACIÓN (correr aparte, NO pegar junto con lo de arriba)
-- ============================================================
-- Impersonando a Monte Cristo, todos los contadores tienen que dar 0.
-- Va dentro de una transacción con ROLLBACK: no escribe nada.
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"76336959-024c-4ea8-83ab-135de8cdfd3a","role":"authenticated"}';
-- with
--   a as (update precios          set precio_minorista = precio_minorista where true returning 1),
--   b as (update config_sistema   set valor = valor                       where true returning 1),
--   c as (update profiles         set sucursal_id = sucursal_id where id <> auth.uid() returning 1)
-- select (select count(*) from a) precios_central,   -- esperado 0
--        (select count(*) from b) config_global,     -- esperado 0
--        (select count(*) from c) perfiles_ajenos,   -- esperado 0
--        (select count(*) from profiles) perfiles_visibles,        -- esperado 1
--        (select count(*) from precios) catalogo_lectura,          -- esperado 259 (sigue leyendo)
--        (select count(*) from precios_sucursal) su_lista;         -- esperado 245
-- rollback;
--
-- Y la central (fabriciolenardon@gmail.com) tiene que seguir viendo/escribiendo
-- todo igual que antes.
-- ============================================================
