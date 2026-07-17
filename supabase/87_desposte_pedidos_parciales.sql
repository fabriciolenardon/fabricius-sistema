-- =============================================================================
-- MIGRACIÓN 87 — PEDIDOS ENTREGADOS POR PARTES (durante la semana)
-- =============================================================================
-- Caso: un pedido se arma y entrega en varias tandas porque no siempre hay
-- todo el stock de una vez. El admin despacha lo que hay (queda 'incompleto'),
-- y el sector desposte tiene que SEGUIR viendo ese pedido para preparar lo que
-- falta a medida que llega más carne.
--
-- La mig 86 solo dejaba al desposte tocar pedidos 'confirmado'/'listo', así que
-- apenas se hacía una entrega parcial el pedido salía de su cola. Acá se suma
-- 'incompleto' para que puedan completarlo.
--
-- Idempotente. Requiere la mig 86.
-- =============================================================================

drop policy if exists "pedidos_desposte_update" on pedidos;
create policy "pedidos_desposte_update" on pedidos
  for update
  using (is_desposte() and estado in ('confirmado', 'listo', 'incompleto'))
  with check (is_desposte() and estado in ('confirmado', 'listo', 'incompleto'));

-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- =============================================================================
