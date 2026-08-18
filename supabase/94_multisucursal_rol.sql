-- ============================================================
-- 94 — MULTI-SUCURSAL: el rol `sucursal` (etapa 3 de 4)
-- ============================================================
-- Hasta acá la base sabe de quién es cada fila (92) y filtra sola (93), pero
-- todavía no existe nadie que sea "de Monte Cristo". Esta migración crea ese
-- usuario y le pone las barandas.
--
-- LA DECISIÓN DE FONDO
-- El personal de una sucursal necesita hacer casi lo mismo que el de la
-- central: vender, despostar, remitar, cargar gastos. Si le inventábamos un
-- rol nuevo desde cero, había que reescribir las 83 policies para nombrarlo.
--
-- En vez de eso: rol propio `sucursal`, y `is_admin()` pasa a incluirlo. Así
-- TODAS las policies existentes siguen valiendo tal cual, y la restrictiva de
-- la 93 lo encierra solo en su sucursal. Es admin, sí — pero admin de LO SUYO.
--
-- EL AGUJERO QUE ESO ABRE, Y CÓMO SE TAPA
-- Al entrar en `is_admin()`, un usuario de Monte Cristo tendría acceso a las
-- tablas que NO están en las 28 de la 93: facturación, ARCA, cheques, el
-- WhatsApp del negocio. Eso es información fiscal de Fabricius SAS y no tiene
-- por qué verla. Se tapa con el mismo patrón de la 93: una restrictiva más,
-- esta vez `mi_sucursal() = 1`.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) EL ROL NUEVO
-- ------------------------------------------------------------
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_rol_check
  CHECK (rol IN ('admin', 'sucursal', 'franquicia', 'cliente_mayorista', 'cajero', 'desposte'));

-- `is_admin()` incluye al personal de sucursal. Ojo: esto NO les da acceso a
-- todo — la restrictiva de la 93 los deja solo con las filas de su sucursal,
-- y el punto 3 les cierra las tablas de la central.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND rol IN ('admin', 'sucursal')
  )
$$;


-- ------------------------------------------------------------
-- 2) QUE SE PUEDA LEER LA LISTA DE SUCURSALES
-- ------------------------------------------------------------
-- `sucursales` tenía RLS activo y CERO policies desde siempre: la app nunca
-- la pudo leer. Ahora hace falta, porque el usuario tiene que saber de qué
-- sucursal es. Son nombres, no hay nada sensible.
--
-- Verificado que no rompe el portal de Roxana: al poder leerse, su perfil
-- pasa a traer "ALVEAR" en vez de "Roxana Mansilla - Alvear", y
-- FranquiciaDashboard busca el cliente por ese texto. Hay UN solo cliente que
-- matchea ALVEAR (ALVEAR CARNICERIA), que es el mismo que encontraba antes.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS sucursales_lectura ON sucursales;
CREATE POLICY sucursales_lectura ON sucursales
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS sucursales_admin ON sucursales;
CREATE POLICY sucursales_admin ON sucursales
  FOR ALL USING (is_admin() AND mi_sucursal() = 1)
  WITH CHECK (is_admin() AND mi_sucursal() = 1);


-- ------------------------------------------------------------
-- 3) LAS TABLAS QUE SON SOLO DE LA CENTRAL
-- ------------------------------------------------------------
-- Facturación, ARCA, balance, cheques, WhatsApp, Iris y los pedidos del
-- portal. Misma técnica que la 93: restrictiva, se combina con AND, no toca
-- ninguna policy existente.
--
-- Los portales van exentos igual que en la 93 — `pedidos` lo usan los
-- clientes mayoristas para pedir, y sus perfiles no tienen sucursal.
--
-- NO se restringen a propósito:
--   precios / etiquetas_plantillas → catálogo compartido, lo necesitan
--   arca_config, arca_ta, plu, wa_procesados → ya tienen CERO policies,
--     o sea que hoy no las lee nadie salvo el service_role
-- ------------------------------------------------------------

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'facturas', 'cuentas_fiscales', 'impuestos_pagados',
    'ejercicios', 'ejercicio_lineas', 'cheques',
    'pedidos', 'pedidos_whatsapp',
    'wa_campanas', 'wa_config', 'wa_contactos', 'wa_mensajes',
    'fabri_memoria', 'contrapartes', 'flujo_deposito',
    'etiquetas_impresas', 'combos_imagenes', 'pagos_proveedores_semanal'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('DROP POLICY IF EXISTS solo_central ON %I', t);
    EXECUTE format($f$
      CREATE POLICY solo_central ON %I
        AS RESTRICTIVE FOR ALL TO public
        USING      (is_cliente_mayorista() OR is_franquicia() OR mi_sucursal() = 1)
        WITH CHECK (is_cliente_mayorista() OR is_franquicia() OR mi_sucursal() = 1)
    $f$, t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 4) QUE LO QUE CARGUEN CAIGA EN SU SUCURSAL
-- ------------------------------------------------------------
-- Hasta ahora la columna tenía DEFAULT 1: todo iba a la central. Para un
-- usuario de Monte Cristo eso sería un error doble — le escribiría a la
-- central y encima la restrictiva de la 93 le rebotaría el INSERT.
--
-- Se reemplaza el DEFAULT por un trigger: si el INSERT no trae sucursal_id,
-- lo completa con la del usuario. El `coalesce(..., 1)` cubre a las edge
-- functions y al service_role, que no tienen usuario y siguen escribiendo en
-- la central como hasta ahora.
--
-- El orden importa: primero el trigger en las 28 tablas, DESPUÉS se saca el
-- DEFAULT. Si se hiciera al revés, entre una cosa y la otra un INSERT fallaría
-- por NOT NULL.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_sucursal_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NULL THEN
    NEW.sucursal_id := coalesce(mi_sucursal(), 1);
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'stock_actual', 'medias_stock', 'piezas_stock', 'cajas_stock',
    'entradas_deposito', 'salidas_deposito', 'despostes',
    'elaboraciones_embutidos', 'stock_snapshots',
    'ventas_minoristas', 'arqueos_caja',
    'clientes', 'movimientos_ctacte', 'remitos', 'presupuestos',
    'ofertas', 'combos_venta',
    'proveedores', 'movimientos_proveedores', 'compras_proveedores',
    'pagos_proveedores',
    'gastos', 'empleados_sueldos', 'liquidaciones_sueldos', 'conceptos_sueldos',
    'cierres_semanales', 'meses_operativos',
    'auditoria_log'
  ];
BEGIN
  -- Primero el trigger…
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_sucursal_id ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_sucursal_id BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION set_sucursal_id()', t);
  END LOOP;
  -- …y recién ahora se suelta el DEFAULT.
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN sucursal_id DROP DEFAULT', t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 5) VERIFICACIÓN
-- ------------------------------------------------------------

SELECT 'rol sucursal permitido' AS control,
       (pg_get_constraintdef(oid) LIKE '%sucursal%')::text AS resultado
  FROM pg_constraint WHERE conname='profiles_rol_check'
UNION ALL
SELECT 'tablas solo-central', count(*)::text FROM pg_policies
  WHERE schemaname='public' AND policyname='solo_central'
UNION ALL
SELECT 'tablas con trigger', count(*)::text FROM pg_trigger
  WHERE tgname='trg_set_sucursal_id' AND NOT tgisinternal
UNION ALL
SELECT 'tablas que aun tienen DEFAULT', count(*)::text FROM information_schema.columns
  WHERE table_schema='public' AND column_name='sucursal_id' AND column_default IS NOT NULL
    AND table_name <> 'profiles'
UNION ALL
SELECT 'policies de sucursales', count(*)::text FROM pg_policies
  WHERE schemaname='public' AND tablename='sucursales';

-- Esperado:
--   rol sucursal permitido ......... true
--   tablas solo-central ............ 18
--   tablas con trigger ............. 28
--   tablas que aun tienen DEFAULT .. 0     ← profiles queda aparte, con DEFAULT 1
--   policies de sucursales ......... 2


-- ============================================================
-- PARA DAR DE ALTA A MONTE CRISTO (a mano, cuando estén listos)
-- ============================================================
-- 1. Authentication → Users → crear el usuario con su mail.
-- 2. Con el uuid que salga de ahí:
--
--      INSERT INTO profiles (id, nombre, rol, sucursal_id)
--      VALUES ('<uuid>', 'Monte Cristo', 'sucursal', 3);
--
-- Desde ese momento todo lo que cargue cae en la sucursal 3, no ve nada de
-- la central, y la central no ve nada suyo.
--
-- QUEDA PENDIENTE (etapa 3b):
--   * Los 3 constraints únicos de la 92 (config_sistema, stock_snapshots,
--     conceptos_sueldos): hay que cambiarlos junto con los upserts del código.
--     Hasta entonces Monte Cristo comparte esas 3 cosas con la central.
--   * Que la sucursal lea sus precios de `precios_sucursal`.
--   * El tipo "embutidos por kg" en Ingresos.
-- ============================================================
