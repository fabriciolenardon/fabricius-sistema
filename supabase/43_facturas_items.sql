-- =====================================================
-- MIGRACION 43: DETALLE DE ÍTEMS EN FACTURAS
-- =====================================================
-- Una factura emitida electrónicamente puede detallar los
-- productos que compró el receptor (descripción, cantidad,
-- precio unitario, alícuota IVA). ARCA por WSFEv1 solo recibe
-- los TOTALES (neto/IVA/total) — el detalle es para la factura
-- impresa/PDF y el registro interno.
--
-- `facturas.items` guarda ese detalle como JSONB:
--   [{ descripcion, cantidad, precio_unit, iva_id, neto, iva, total }]
-- =====================================================

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS items JSONB;

COMMENT ON COLUMN facturas.items IS
  'Detalle de productos de la factura (para el PDF/impresión). ARCA solo recibe los totales.';
