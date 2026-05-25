-- ============================================================
-- MIGRACIÓN 37: Datos de contacto en remitos (telefono + localidad)
-- ============================================================
-- El remito impreso debe mostrar al repartidor:
--   - Cliente
--   - Domicilio (ya estaba)
--   - Localidad (nuevo)
--   - Teléfono (nuevo)
-- Sin estos datos el repartidor tiene que pedirle al admin "che,
-- dónde es este y a qué número llamo".
--
-- Antes el remito guardaba SOLO domicilio. Ahora también persistimos
-- localidad y telefono del cliente al momento de armar el remito
-- (snapshot — no cambia si después actualizás el contacto del cliente).
--
-- Para remitos viejos sin estos datos, la UI hace fallback al
-- cliente actual (cliente.telefono / cliente.localidad).
-- ============================================================

ALTER TABLE remitos
  ADD COLUMN IF NOT EXISTS telefono  TEXT,
  ADD COLUMN IF NOT EXISTS localidad TEXT;

COMMENT ON COLUMN remitos.telefono  IS
'Teléfono del cliente al momento de generar el remito. Si está NULL, la UI de impresión usa el teléfono actual del cliente como fallback.';
COMMENT ON COLUMN remitos.localidad IS
'Localidad del cliente al momento de generar el remito. Fallback al cliente actual si NULL.';

-- ============================================================
-- VERIFICACIÓN: cuántos remitos hay y cuántos tienen contacto.
-- ============================================================
SELECT
  COUNT(*) AS total_remitos,
  COUNT(telefono)  AS con_telefono,
  COUNT(localidad) AS con_localidad,
  COUNT(domicilio) AS con_domicilio
FROM remitos;
