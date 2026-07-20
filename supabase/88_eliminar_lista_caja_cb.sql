-- ============================================================
-- 88: ELIMINAR LISTA DE PRECIOS "BOVINO CAJA CB"
-- ============================================================
-- Pedido de Fabricio (20/07/2026): la categoría bovino_caja_cb no se
-- usa — 0 cajas CB registradas en cajas_stock en toda la historia,
-- 0 ventas en 2026, sin ofertas/PLU/etiquetas/combos que referencien
-- sus productos. Se eliminan los 9 productos y la categoría desaparece
-- de Precios, del PDF de listas y de los selectores (código).
--
-- Productos eliminados (todos solo con precio mayorista):
--   Costillar Plancha Congelado CB ($14.500) · Cuadrada CB ($17.700)
--   Cuadril CB ($18.100) · Lomo CB ($26.000) · Matambre CB ($16.500)
--   Nalga c/ Tapa CB ($18.880) · Roast Beef CB ($14.110)
--   Tapa de Asado CB ($16.200) · Vacío CB ($19.900)
--
-- La categoría bovino_caja_pt (12 productos) queda como está.
-- Idempotente: re-ejecutar no hace nada.
-- ============================================================

DELETE FROM precios WHERE categoria = 'bovino_caja_cb';
