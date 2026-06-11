-- ============================================================
-- MIGRACIÓN 57: vínculo exacto compra ↔ entrada de depósito
-- ============================================================
-- Bug 11/06: anular un ingreso marcaba la compra del proveedor
-- buscándola por fecha+proveedor+kg; con cargas duplicadas gemelas
-- (mismo peso, misma fecha, mismo proveedor) anulaba TODAS las
-- coincidencias — al anular las 7 medias duplicadas de PRETTO se
-- anularon también las 7 compras reales.
--
-- Con entrada_id el match es 1 a 1. Las compras viejas sin vínculo
-- usan un fallback que anula UNA sola fila candidata.
-- (Ya aplicada en Supabase vía MCP el 11/06; las 14 compras de
-- PRETTO de ese día quedaron backfilleadas a mano.)

alter table compras_proveedores add column if not exists entrada_id uuid;
create index if not exists idx_compras_prov_entrada on compras_proveedores (entrada_id);
