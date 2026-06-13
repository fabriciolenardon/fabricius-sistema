-- =====================================================
-- MIGRACION 26: ARQUEO con débito/QR y transferencia
-- =====================================================
-- Agrega columnas a arqueos_caja para registrar lo que
-- el admin confirma manualmente desde el banco / Mercado Pago,
-- y la diferencia contra lo registrado en el sistema.
-- =====================================================

ALTER TABLE arqueos_caja
  ADD COLUMN IF NOT EXISTS debito_esperado          NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debito_real              NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debito_diferencia        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferencia_esperada   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferencia_real       NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transferencia_diferencia NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN arqueos_caja.debito_esperado IS 'Total débito/QR según ventas del sistema';
COMMENT ON COLUMN arqueos_caja.debito_real IS 'Total débito/QR confirmado manualmente desde banco/MP';
COMMENT ON COLUMN arqueos_caja.transferencia_esperada IS 'Total transferencias según ventas del sistema';
COMMENT ON COLUMN arqueos_caja.transferencia_real IS 'Total transferencias confirmado manualmente desde banco/MP';
