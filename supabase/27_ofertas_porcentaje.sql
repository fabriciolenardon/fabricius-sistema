-- =====================================================
-- MIGRACION 27: OFERTAS por porcentaje (además de precio fijo)
-- =====================================================
-- Permite cargar ofertas semanales como % de descuento o como
-- precio fijo nuevo. La Caja resuelve el precio final usando
-- lo que esté cargado (descuento_pct tiene prioridad si ambos
-- existen, pero en el formulario se elige uno u otro).
--
-- Cambios:
--   1) precio_oferta deja de ser NOT NULL (puede quedar NULL si
--      la oferta se cargó como % puro).
--   2) Se agrega descuento_pct NUMERIC(5,2) (0-100).
--   3) Check: al menos uno de los dos campos debe estar.
-- =====================================================

-- 1) Hacer precio_oferta nullable (idempotente con DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ofertas'
      AND column_name = 'precio_oferta'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE ofertas ALTER COLUMN precio_oferta DROP NOT NULL;
  END IF;
END$$;

-- 2) Agregar columna descuento_pct
ALTER TABLE ofertas
  ADD COLUMN IF NOT EXISTS descuento_pct NUMERIC(5,2);

COMMENT ON COLUMN ofertas.descuento_pct IS '% de descuento sobre precio normal de la lista (0-100). Alternativo a precio_oferta.';

-- 3) Constraint: al menos uno de los dos debe estar (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ofertas_precio_o_pct_chk'
  ) THEN
    ALTER TABLE ofertas
      ADD CONSTRAINT ofertas_precio_o_pct_chk
      CHECK (precio_oferta IS NOT NULL OR descuento_pct IS NOT NULL);
  END IF;
END$$;

-- 4) Constraint: si hay porcentaje, que esté en rango razonable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ofertas_descuento_pct_rango_chk'
  ) THEN
    ALTER TABLE ofertas
      ADD CONSTRAINT ofertas_descuento_pct_rango_chk
      CHECK (descuento_pct IS NULL OR (descuento_pct > 0 AND descuento_pct < 100));
  END IF;
END$$;

-- =====================================================
-- Verificar:
--   SELECT id, producto_nombre, precio_oferta, descuento_pct,
--          aplica_minorista, aplica_mayorista, activa
--     FROM ofertas
--    ORDER BY id DESC LIMIT 20;
-- =====================================================
