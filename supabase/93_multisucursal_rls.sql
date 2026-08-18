-- ============================================================
-- 93 — MULTI-SUCURSAL: aislamiento por RLS (etapa 2 de 4)
-- ============================================================
-- OBJETIVO
-- Que la plata y el stock de un negocio no se mezclen con los del otro,
-- aunque una consulta se olvide de filtrar.
--
-- La 92 dejó `sucursal_id` en las 28 tablas del núcleo, pero hoy el filtro
-- no existe: cualquier consulta trae todo. Si el aislamiento dependiera de
-- acordarse de poner `.eq('sucursal_id', …)` en cada una de las ~40
-- pantallas, un solo olvido mezcla las dos contabilidades — y se descubre
-- semanas después, cuadrando un cierre.
--
-- CÓMO, SIN TOCAR LAS 83 POLICIES QUE YA EXISTEN
-- Postgres tiene dos tipos de policy:
--   PERMISSIVE  (las que hay hoy) → se combinan con OR
--   RESTRICTIVE (las que agrega esta migración) → se combinan con AND
--
-- Entonces agregamos UNA restrictiva por tabla y no editamos ninguna de las
-- existentes. Una restrictiva sólo puede ACHICAR lo que se ve, nunca ampliar:
-- el riesgo posible es dejar a alguien afuera, nunca filtrar datos de más.
-- Y como hoy TODO está en la central y todo el personal queda en la central,
-- no achica nada. Otra vez: esta migración no debería cambiar nada en pantalla.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================


-- ------------------------------------------------------------
-- 1) EL PERSONAL DE LA CENTRAL, A LA CENTRAL
-- ------------------------------------------------------------
-- PELIGRO QUE SE EVITA ACÁ:
-- Los 3 admin, la cajera y desposte tienen hoy `sucursal_id = NULL`. En SQL,
-- `sucursal_id = NULL` no da FALSE, da NULL — que para una policy es lo mismo
-- que no pasar. Si aplicáramos el filtro sin este backfill, **el sistema
-- entero quedaría a oscuras**: ni la caja podría vender.
--
-- Los portales (cliente_mayorista y franquicia) quedan en NULL a propósito:
-- están exentos del filtro, ver el punto 3.
-- ------------------------------------------------------------

UPDATE profiles SET sucursal_id = 1
WHERE sucursal_id IS NULL
  AND rol IN ('admin', 'cajero', 'desposte');

-- Que un perfil nuevo del personal no nazca sin sucursal y se quede afuera.
ALTER TABLE profiles ALTER COLUMN sucursal_id SET DEFAULT 1;


-- ------------------------------------------------------------
-- 2) mi_sucursal()
-- ------------------------------------------------------------
-- Misma forma que los helpers que ya usa el sistema (is_admin, is_cajero…):
-- SECURITY DEFINER para poder leer `profiles` desde adentro de una policy
-- sin pelearse con el RLS de esa misma tabla.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION mi_sucursal()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sucursal_id FROM profiles WHERE id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION mi_sucursal() FROM anon;


-- ------------------------------------------------------------
-- 3) LA POLICY DE AISLAMIENTO, EN LAS 28 TABLAS
-- ------------------------------------------------------------
-- La regla es: cada uno ve las filas de SU sucursal.
--
-- Los portales quedan EXENTOS y no es un descuido:
-- un cliente mayorista o una franquicia no "pertenecen" a una sucursal, son
-- clientes de la que les vende. Su acceso ya está acotado por `mi_cliente_id()`
-- en las policies que existen desde antes — ven su propia cuenta corriente y
-- sus propios remitos, nada más. Si les aplicáramos el filtro por sucursal,
-- Roxana (que figura en Alvear) dejaría de ver su cuenta, que vive en los
-- libros de la central.
--
-- NO hay excepción para el CEO, y también es a propósito: si Fabricio
-- esquivara el filtro, su Dashboard y su Cierre empezarían a sumar los dos
-- negocios el día que Monte Cristo opere — justo lo contrario de "son
-- negocios separados". Para mirar una sucursal se hará un cambio explícito
-- de contexto, no un agujero permanente.
-- ------------------------------------------------------------

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
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('DROP POLICY IF EXISTS sucursal_aislamiento ON %I', t);
    EXECUTE format($f$
      CREATE POLICY sucursal_aislamiento ON %I
        AS RESTRICTIVE FOR ALL TO public
        USING      (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal())
        WITH CHECK (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal())
    $f$, t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ------------------------------------------------------------

SELECT 'personal sin sucursal' AS control, count(*)::text AS resultado
  FROM profiles WHERE sucursal_id IS NULL AND rol IN ('admin','cajero','desposte')
UNION ALL
SELECT 'tablas con la policy', count(*)::text FROM pg_policies
  WHERE schemaname='public' AND policyname='sucursal_aislamiento'
UNION ALL
SELECT 'la policy es restrictiva', string_agg(DISTINCT permissive, ',') FROM pg_policies
  WHERE schemaname='public' AND policyname='sucursal_aislamiento';

-- Esperado:
--   personal sin sucursal ..... 0     ← si no da 0, ABORTAR: quedaría gente afuera
--   tablas con la policy ...... 28
--   la policy es restrictiva .. RESTRICTIVE


-- ============================================================
-- LO QUE ESTA MIGRACIÓN NO HACE (va en la etapa 3)
-- ============================================================
-- * El trigger que completa `sucursal_id` al insertar. Hoy la columna tiene
--   DEFAULT 1 y todo el personal es de la central, así que las altas pasan el
--   WITH CHECK sin problema. Cuando existan usuarios de Monte Cristo, el
--   DEFAULT 1 les va a fallar el chequeo (correcto: no deben escribir en la
--   central) y ahí entra el trigger que lo toma de mi_sucursal().
--
-- * La policy de lectura de `sucursales`. La tabla tiene RLS activo y CERO
--   policies, así que hoy la app no la puede leer. NO se arregla acá porque
--   arreglarlo cambia comportamiento: `AuthContext` empezaría a devolver
--   `profile.sucursales`, y `FranquiciaDashboard` busca el cliente con ese
--   nombre ("ALVEAR") en vez del nombre del perfil ("Roxana Mansilla -
--   Alvear"). Se resuelve junto con el portal, en la etapa 3.
-- ============================================================
