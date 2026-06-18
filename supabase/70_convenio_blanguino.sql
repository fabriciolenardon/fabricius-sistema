-- =====================================================
-- MIGRACION 70: CONVENIO BLANGUINO (descuento a empleados)
-- =====================================================
-- Convenio con la firma "Blanguino": sus empleados compran en caja con
-- 10% de descuento; después la empresa reintegra parte. Para el control
-- (quién compró, cuánto) guardamos en cada venta el convenio y los datos
-- del empleado (nombre + legajo).
--   - convenio          → 'blanguino' (o null si es venta normal)
--   - convenio_empleado → nombre del empleado
--   - convenio_legajo   → número de legajo
-- El descuento en sí se guarda como hasta ahora en descuento_pct/monto.
-- =====================================================

ALTER TABLE ventas_minoristas
  ADD COLUMN IF NOT EXISTS convenio          text,
  ADD COLUMN IF NOT EXISTS convenio_empleado text,
  ADD COLUMN IF NOT EXISTS convenio_legajo   text;

-- Índice para listar/reportar rápido las ventas de un convenio.
CREATE INDEX IF NOT EXISTS idx_ventas_convenio
  ON ventas_minoristas (convenio)
  WHERE convenio IS NOT NULL;

COMMENT ON COLUMN ventas_minoristas.convenio IS 'Convenio aplicado a la venta (ej: blanguino). NULL = venta normal.';
