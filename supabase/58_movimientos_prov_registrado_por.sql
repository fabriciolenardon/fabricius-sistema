-- ============================================================
-- MIGRACIÓN 58: trazabilidad de autor en la cta cte de proveedores
-- ============================================================
-- El 11/06 aparecieron 3 pagos a PRETTO y nadie pudo decir quién
-- los cargó (la tabla no guardaba autor y la auditoría no cubre
-- ese módulo). Desde ahora cada movimiento (compra/pago/ajuste/
-- saldo inicial) queda firmado con el nombre del usuario logueado.
-- (Ya aplicada en Supabase vía MCP el 11/06.)

alter table movimientos_proveedores add column if not exists registrado_por text;
