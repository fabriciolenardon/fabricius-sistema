-- ============================================================
-- MIGRACIÓN 60: vínculo salidas_deposito → remito
-- ============================================================
-- Bug 13/06 (Andrea Angaramo): un remito mayorista se tikeó x1000
-- ($31.941.000 en vez de $31.941), se anuló y se recargó corregido.
-- Pero eliminarRemito() NO borraba la salida_deposito que el remito
-- había creado (no existía vínculo) → la salida quedaba viva e inflaba
-- el Dashboard Ejecutivo (mayorista del mes, canales, podio de clientes).
--
-- Solución: remito_id en salidas_deposito. Los despachos lo cargan al
-- crear el remito; al anularlo, sus salidas se borran por ese id.
-- (Ya aplicada en Supabase vía MCP el 13/06; las salidas huérfanas de
-- remitos ya anulados se limpiaron a mano.)

alter table salidas_deposito add column if not exists remito_id uuid;
create index if not exists idx_salidas_remito on salidas_deposito (remito_id);
