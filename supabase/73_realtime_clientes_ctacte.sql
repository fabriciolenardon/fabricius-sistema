-- ============================================================
-- 73 · Realtime para clientes + movimientos_ctacte
-- ------------------------------------------------------------
-- El Dashboard Ejecutivo (widget de ganancia en vivo) necesita reaccionar al
-- instante cuando entra una venta mayorista o un COBRO de cliente, que cambian
-- el saldo de la cuenta corriente (lo que nos deben). Estas tablas no estaban
-- en la publicación de realtime, así que el saldo solo se refrescaba cada 2 min.
--
-- Solo habilita las notificaciones de cambio; NO modifica ningún dato ni saldo.
-- ============================================================
alter publication supabase_realtime add table public.clientes;
alter publication supabase_realtime add table public.movimientos_ctacte;
