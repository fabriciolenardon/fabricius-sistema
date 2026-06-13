-- ============================================================
-- MIGRACIÓN 20: Revertir precio_carniceria en productos con PLU 1-106
-- ============================================================
-- Contexto: la migración 17 cargó precio_carniceria en los productos del
-- PDF (PLU 1-106) cuando ese precio NO debe estar ahí — Fabri gestiona la
-- lista de carnicería desde Despacho, y los productos con PLU son solo los
-- que se venden por balanza (minorista y mayorista).
--
-- Esta migración deja precio_carniceria en NULL para todos los productos
-- con PLU 1-106. Los precios reales de carnicería siguen estando en:
--   - los productos originales del sistema (sin PLU, los "viejos")
--   - la planilla papel / lista oficial de Fabri
--
-- Después de correr esto, los productos con PLU quedan solo con minorista
-- y mayorista, como Fabri quiere.
-- ============================================================

update precios
set precio_carniceria = null,
    updated_at = now()
where codigo_balanza between 1 and 106;

-- Reporte
select
  count(*) as productos_con_plu_total,
  count(*) filter (where precio_carniceria is null) as sin_precio_carniceria_ok,
  count(*) filter (where precio_carniceria is not null) as con_precio_carniceria_quedan
from precios
where codigo_balanza between 1 and 106;
