-- Pago dividido en remitos mayoristas: permite cobrar una venta en 2-3 formas
-- distintas (ej. parte efectivo + parte transferencia). El desglose se guarda
-- en `pagos` (jsonb) como [{ metodo, monto }, ...]. Cuando hay pago dividido,
-- remitos.cobro = 'mixto'. Para cobros de una sola forma, pagos queda NULL.
ALTER TABLE remitos ADD COLUMN IF NOT EXISTS pagos jsonb;
COMMENT ON COLUMN remitos.pagos IS 'Desglose de pago dividido (cobro=mixto): [{metodo, monto}]. NULL cuando el cobro es una sola forma.';
