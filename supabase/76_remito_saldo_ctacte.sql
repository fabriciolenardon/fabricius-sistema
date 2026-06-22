-- ============================================================
-- 76 · Snapshot del saldo de cta cte en el remito
-- ------------------------------------------------------------
-- Guarda el saldo de cuenta corriente del cliente AL MOMENTO de emitir el
-- remito (copia de solo lectura; NO afecta el ledger ni recalcula nada). Se
-- imprime en el remito. Los remitos viejos quedan en NULL y al imprimir caen
-- al saldo en vivo del cliente.
-- ============================================================
alter table public.remitos add column if not exists saldo_cta_cte numeric;
