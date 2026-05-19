-- ============================================================
-- 09_ofertas_listas.sql
-- Permite que una oferta se aplique selectivamente a una o m�s
-- listas de precios (carnicer�a, mayorista, minorista) en vez
-- de aplicarse siempre a las 3.
-- ============================================================

-- 1) Agregar las 3 columnas (default TRUE para no romper c�digo
--    que asuma que las ofertas aplican a todas las listas).
ALTER TABLE ofertas
  ADD COLUMN IF NOT EXISTS aplica_carniceria BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aplica_mayorista  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aplica_minorista  BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) Constraint: al menos una de las 3 columnas debe estar en TRUE
--    (la app tambi�n lo valida, pero esto protege contra inserts manuales).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ofertas_al_menos_una_lista_chk'
  ) THEN
    ALTER TABLE ofertas
      ADD CONSTRAINT ofertas_al_menos_una_lista_chk
      CHECK (aplica_carniceria OR aplica_mayorista OR aplica_minorista);
  END IF;
END$$;

-- 3) Borrar TODAS las ofertas existentes para arrancar de cero
--    con las nuevas opciones de listas (carnicer�a/mayorista/minorista).
DELETE FROM ofertas;

-- ============================================================
-- Verificar:
--   SELECT id, producto_nombre, activa,
--          aplica_carniceria, aplica_mayorista, aplica_minorista
--     FROM ofertas
--    ORDER BY id DESC LIMIT 20;
-- ============================================================
