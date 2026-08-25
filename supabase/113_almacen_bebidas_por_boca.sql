-- ============================================================
-- 113 — ALMACÉN Y BEBIDAS: LA LISTA ES DE CADA BOCA
-- ============================================================
-- Decisión de Fabricio (25/08/2026): la mercadería de almacén y las bebidas
-- las compra y las vende cada sucursal por su cuenta — la central no las
-- maneja ni se las provee. Pamela agrega, edita y borra los suyos; Monte
-- Cristo arranca esas dos listas VACÍAS. La central conserva las suyas
-- intactas.
--
-- POR QUÉ NO ALCANZABA CON BORRAR SUS PRECIOS
-- `precios_sucursal` sólo guarda el PRECIO. Si a Monte Cristo se le borraban
-- esas filas, el producto seguía apareciendo — con el precio de la central,
-- porque el overlay cae al catálogo cuando no hay fila propia. Para que la
-- lista quede vacía de verdad, el producto tiene que tener DUEÑO.
--
-- CÓMO
-- `precios.sucursal_id`:
--   NULL   → catálogo compartido. Lo define la central y lo ven todas las
--            bocas (la carne, los embutidos, los insumos: todo lo de hoy).
--   número → producto propio de esa boca. Sólo lo ve y lo toca ella.
--
-- Es la misma forma que ya tienen `ofertas` y `precios_sucursal`: una
-- columna de pertenencia + policies, sin tabla nueva ni duplicar el catálogo.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) LA COLUMNA DE PERTENENCIA
-- ------------------------------------------------------------
ALTER TABLE precios ADD COLUMN IF NOT EXISTS sucursal_id int NULL;

COMMENT ON COLUMN precios.sucursal_id IS
  'NULL = catálogo compartido (lo define la central). Un número = producto propio de esa boca (almacén y bebidas).';

CREATE INDEX IF NOT EXISTS precios_sucursal_idx ON precios (sucursal_id);

-- Lo que hay hoy de almacén y bebidas es de la central.
UPDATE precios SET sucursal_id = 1
WHERE categoria IN ('almacen', 'bebidas') AND sucursal_id IS NULL;


-- ------------------------------------------------------------
-- 2) LECTURA — cada boca ve lo compartido y lo suyo
-- ------------------------------------------------------------
-- RESTRICTIVE: sólo puede achicar lo que ya se ve, nunca ampliarlo.
--
-- Los PORTALES (cliente mayorista y franquicia) tienen `mi_sucursal()` NULL,
-- así que les queda sólo lo compartido — que es justo lo que corresponde:
-- un cliente nunca vio almacén ni bebidas, y la franquicia le compra insumos
-- a la central (los insumos siguen compartidos, no cambian).
DROP POLICY IF EXISTS precios_lectura_por_boca ON precios;
CREATE POLICY precios_lectura_por_boca ON precios
  AS RESTRICTIVE FOR SELECT TO public
  USING (sucursal_id IS NULL OR sucursal_id = mi_sucursal());


-- ------------------------------------------------------------
-- 3) ESCRITURA — la central todo; la sucursal SOLO lo suyo de esas dos
-- ------------------------------------------------------------
-- Reemplazan a las de la mig 100, que eran `es_central()` a secas. Son
-- RESTRICTIVE (se combinan con AND), así que agregar una permissive al lado
-- no habría servido de nada: hay que reescribirlas.
--
-- La condición de la sucursal pide LAS DOS COSAS a la vez — que la fila sea
-- suya Y que la categoría sea almacén o bebidas. Con eso no puede:
--   · tocar un producto del catálogo compartido (sucursal_id IS NULL)
--   · tocar el de otra boca
--   · crear un corte de carne o un embutido
--   · sacarle el dueño a una fila suya, ni moverla de categoría (el WITH
--     CHECK del UPDATE se evalúa sobre la fila NUEVA)
CREATE OR REPLACE FUNCTION precio_es_de_mi_boca(p_sucursal int, p_categoria text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_sucursal IS NOT NULL
     AND p_sucursal = mi_sucursal()
     AND p_categoria IN ('almacen', 'bebidas')
$$;

DROP POLICY IF EXISTS precios_insert_central ON precios;
CREATE POLICY precios_insert_central ON precios
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central() OR precio_es_de_mi_boca(sucursal_id, categoria));

DROP POLICY IF EXISTS precios_update_central ON precios;
CREATE POLICY precios_update_central ON precios
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (es_central() OR precio_es_de_mi_boca(sucursal_id, categoria))
  WITH CHECK (es_central() OR precio_es_de_mi_boca(sucursal_id, categoria));

DROP POLICY IF EXISTS precios_delete_central ON precios;
CREATE POLICY precios_delete_central ON precios
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central() OR precio_es_de_mi_boca(sucursal_id, categoria));


-- ------------------------------------------------------------
-- 4) LIMPIAR LOS PRECIOS QUE MONTE CRISTO TENÍA DE ESOS PRODUCTOS
-- ------------------------------------------------------------
-- Quedaron de la siembra inicial (mig 97, que copió la lista entera de la
-- central). Ahora esos productos ya no son suyos ni los ve, así que la fila
-- de precio es basura que sólo confunde a quien mire la tabla.
DELETE FROM precios_sucursal ps
USING precios p
WHERE ps.precio_id = p.id
  AND p.categoria IN ('almacen', 'bebidas')
  AND ps.sucursal_id <> 1;


-- ------------------------------------------------------------
-- 5) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'almacen+bebidas de la central' AS control, count(*)::text AS resultado
  FROM precios WHERE categoria IN ('almacen','bebidas') AND sucursal_id = 1
UNION ALL
SELECT 'almacen+bebidas sin dueño (debe ser 0)', count(*)::text
  FROM precios WHERE categoria IN ('almacen','bebidas') AND sucursal_id IS NULL
UNION ALL
SELECT 'catalogo compartido (el resto)', count(*)::text
  FROM precios WHERE sucursal_id IS NULL
UNION ALL
SELECT 'precios_sucursal huerfanos (debe ser 0)', count(*)::text
  FROM precios_sucursal ps JOIN precios p ON p.id = ps.precio_id
  WHERE p.categoria IN ('almacen','bebidas') AND ps.sucursal_id <> 1;
