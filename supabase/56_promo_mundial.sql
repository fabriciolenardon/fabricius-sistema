-- ============================================================
-- MIGRACIÓN 56: Promo Mundial (descuento % en Caja)
-- ============================================================
-- Promo por partido de la Selección Argentina: -X% sobre el total
-- de la Caja Rápida cuando el pago es 100% efectivo y/o transferencia.
-- Mientras la promo está activa, la Caja pausa las ofertas para no
-- acumular doble descuento.
--
-- El toggle vive en config_sistema (clave 'promo_mundial') y se
-- administra desde Precios → Ofertas. La Caja lo lee por realtime.
-- ============================================================

-- 1) VENTAS_MINORISTAS: registrar el descuento aplicado en cada venta.
--    total queda con el monto efectivamente cobrado (ya descontado);
--    descuento_monto guarda la diferencia contra la suma de items para
--    auditoría y reportes.
alter table ventas_minoristas add column if not exists descuento_pct numeric;
alter table ventas_minoristas add column if not exists descuento_monto numeric;

-- 2) Config default: promo apagada, 10%
insert into config_sistema (clave, valor, descripcion)
values (
  'promo_mundial',
  '{"activa": false, "descuento_pct": 10}'::jsonb,
  'Promo Mundial: % de descuento en Caja para pagos 100% efectivo/transferencia. Pausa las ofertas mientras está activa.'
)
on conflict (clave) do nothing;
