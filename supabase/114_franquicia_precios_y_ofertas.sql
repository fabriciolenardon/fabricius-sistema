-- ============================================================
-- 114 — LA FRANQUICIA NO TOCA PRECIOS, Y SUS OFERTAS SON MINORISTAS
-- ============================================================
-- Cuatro cosas que pidió Fabricio el 25/08/2026, con Monte Cristo ya
-- instalado y funcionando.
--
-- ⚠️ EL PUNTO 3 REVIERTE UNA DECISIÓN ANTERIOR. El 18/08 se había resuelto
-- que la lista se respeta POR CONTRATO y no por candado — el sistema
-- avisaba de los desvíos pero no los impedía. Ahora es candado.
-- ============================================================


-- ------------------------------------------------------------
-- 1) EL PRODUCTO DE ALMACÉN QUE QUEDÓ SIN DUEÑO
-- ------------------------------------------------------------
-- "QUESO HOLANDA X KG" se creó hoy, después de la mig 113, y entró con
-- `sucursal_id` NULL. Al no tener dueño lo ve todo el mundo, y a Monte
-- Cristo le aparecía como "te falta cargar 1 de 153 precios" — un producto
-- de almacén de la central que ella no vende ni tiene por qué precia.
UPDATE precios SET sucursal_id = 1
WHERE categoria IN ('almacen', 'bebidas') AND sucursal_id IS NULL;

DELETE FROM precios_sucursal ps
USING precios p
WHERE ps.precio_id = p.id
  AND p.categoria IN ('almacen', 'bebidas')
  AND ps.sucursal_id <> 1;


-- ------------------------------------------------------------
-- 2) QUE NO VUELVA A PASAR
-- ------------------------------------------------------------
-- La 113 le puso dueño a los que YA existían, pero nada obligaba a los
-- nuevos. Cada almacén/bebida que se cargue desde ahora nace con el dueño
-- de quien la crea. En la base y no en la pantalla, así vale para
-- cualquier alta: Precios, un import, o lo que venga.
CREATE OR REPLACE FUNCTION precio_dueno_por_categoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NULL AND NEW.categoria IN ('almacen', 'bebidas') THEN
    NEW.sucursal_id := coalesce(mi_sucursal(), 1);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_precio_dueno ON precios;
CREATE TRIGGER trg_zz_precio_dueno
  BEFORE INSERT ON precios
  FOR EACH ROW EXECUTE FUNCTION precio_dueno_por_categoria();


-- ------------------------------------------------------------
-- 3) LOS PRECIOS DE LA LISTA LOS MANEJA LA CENTRAL
-- ------------------------------------------------------------
-- `precios_sucursal` es la lista de la boca sobre el catálogo compartido.
-- Hasta hoy la sucursal la escribía; pasa a escribirla sólo la central.
--
-- Se parte en DOS policies por comando, igual que en `ofertas` (mig 103):
-- con una sola `FOR ALL` que pida es_central(), la sucursal dejaría de VER
-- sus propios precios — y los necesita para vender.
--
-- Esto NO le saca el almacén y las bebidas: esos son productos suyos, con
-- su precio adentro de `precios` (mig 113), y los sigue manejando entera.
DROP POLICY IF EXISTS precios_sucursal_aislamiento ON precios_sucursal;

CREATE POLICY precios_sucursal_aislamiento ON precios_sucursal
  AS RESTRICTIVE FOR SELECT TO public
  USING (es_central() OR sucursal_id = mi_sucursal());

DROP POLICY IF EXISTS precios_sucursal_escribe_central ON precios_sucursal;
CREATE POLICY precios_sucursal_escribe_central ON precios_sucursal
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (es_central());

DROP POLICY IF EXISTS precios_sucursal_edita_central ON precios_sucursal;
CREATE POLICY precios_sucursal_edita_central ON precios_sucursal
  AS RESTRICTIVE FOR UPDATE TO public
  USING (es_central()) WITH CHECK (es_central());

DROP POLICY IF EXISTS precios_sucursal_borra_central ON precios_sucursal;
CREATE POLICY precios_sucursal_borra_central ON precios_sucursal
  AS RESTRICTIVE FOR DELETE TO public
  USING (es_central());


-- ------------------------------------------------------------
-- 4) EN UNA SUCURSAL, LAS OFERTAS SON SÓLO MINORISTAS
-- ------------------------------------------------------------
-- Una franquicia vende al mostrador: la lista mayorista y la de carnicerías
-- son de la central, que le vende A ELLA. Una oferta sobre esas listas en su
-- boca no significa nada.
--
-- Se fuerza en la base y no sólo en el formulario porque las ofertas también
-- las crea la CENTRAL eligiendo bocas (mig 103): tildar "mayorista" y
-- mandarla a Monte Cristo tenía que quedar sin efecto igual.
--
-- `aplica_minorista` NO se toca: si la desmarca a propósito, la oferta no
-- aplica en ningún lado y es su decisión.
CREATE OR REPLACE FUNCTION oferta_solo_minorista_en_sucursal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(NEW.sucursal_id, 1) <> 1 THEN
    NEW.aplica_carniceria := false;
    NEW.aplica_mayorista  := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_oferta_solo_minorista ON ofertas;
CREATE TRIGGER trg_zz_oferta_solo_minorista
  BEFORE INSERT OR UPDATE ON ofertas
  FOR EACH ROW EXECUTE FUNCTION oferta_solo_minorista_en_sucursal();

-- Las que ya estaban cargadas para una sucursal.
UPDATE ofertas SET aplica_carniceria = false, aplica_mayorista = false
WHERE coalesce(sucursal_id, 1) <> 1
  AND (aplica_carniceria IS DISTINCT FROM false OR aplica_mayorista IS DISTINCT FROM false);


-- ------------------------------------------------------------
-- 5) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'almacen/bebidas sin dueño (debe ser 0)' AS control, count(*)::text AS resultado
  FROM precios WHERE categoria IN ('almacen','bebidas') AND sucursal_id IS NULL
UNION ALL
SELECT 'productos que Monte Cristo compra', count(*)::text
  FROM precios p WHERE p.sucursal_id IS NULL AND p.categoria <> 'insumos' AND p.nombre NOT LIKE 'ZZ\_%'
UNION ALL
SELECT 'de esos, con precio propio cargado', count(*)::text
  FROM precios p JOIN precios_sucursal ps ON ps.precio_id = p.id AND ps.sucursal_id = 3
  WHERE p.sucursal_id IS NULL AND p.categoria <> 'insumos' AND p.nombre NOT LIKE 'ZZ\_%'
UNION ALL
SELECT 'ofertas de sucursal con mayorista/carniceria (debe ser 0)', count(*)::text
  FROM ofertas WHERE coalesce(sucursal_id,1) <> 1 AND (aplica_carniceria OR aplica_mayorista);
