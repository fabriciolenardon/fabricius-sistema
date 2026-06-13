-- 54_gastos_solo_balance.sql
-- Facturas "solo para balance": comprobantes a nombre de Fabricius SAS que
-- paga un tercero (ej: la luz de la franquicia Alvear la paga Roxana Mansilla,
-- que alquila la franquicia). Se cargan con su factura adjunta para presentar
-- en el balance de la SAS, pero NO suman a los gastos propios:
--   - excluidas de los totales de la pestaña Gastos
--   - excluidas de Reportes, Dashboard Ejecutivo y cierre semanal automático
--   - SÍ aparecen en la pestaña "Con factura" y en el PDF mensual

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS solo_balance boolean NOT NULL DEFAULT false;
