-- =============================================================================
-- MIGRACIÓN 07 — ESTADOS EXTENDIDOS DE PEDIDOS + ENLACE CON REMITOS
-- =============================================================================
-- Agrega los estados 'incompleto' y 'despachado' al flujo de pedidos,
-- más columnas para trackear items pendientes y remitos enlazados manualmente.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =============================================================================


-- 1) AMPLIAR EL CHECK DEL ESTADO PARA INCLUIR 'incompleto' Y 'despachado'
-- -----------------------------------------------------------------------------
alter table pedidos drop constraint if exists pedidos_estado_check;
alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'confirmado', 'incompleto', 'despachado', 'rechazado', 'cancelado'));


-- 2) NUEVAS COLUMNAS
-- -----------------------------------------------------------------------------
-- Items que quedaron pendientes en un despacho parcial.
-- Estructura: [{ producto_id, nombre, kg_pendiente, precio_unitario, subtotal_pendiente }]
alter table pedidos add column if not exists items_pendientes jsonb default '[]'::jsonb;

-- Remitos enlazados manualmente al pedido (cuando despachamos físicamente).
-- Estructura: [{ remito_id, numero, fecha, total, tipo: 'parcial'|'completo'|'final' }]
alter table pedidos add column if not exists remitos_enlazados jsonb default '[]'::jsonb;

-- Quién marcó como despachado y cuándo
alter table pedidos add column if not exists despachado_por text;
alter table pedidos add column if not exists despachado_en timestamptz;


-- 3) ACTUALIZAR POLÍTICA RLS DE UPDATE DEL CLIENTE
-- -----------------------------------------------------------------------------
-- El cliente todavía solo puede cancelar (no puede mover el pedido a 'despachado' por ej)
-- La política existente ya cubre esto pero la recreamos para asegurar consistencia
drop policy if exists "cliente_cancela_su_pedido" on pedidos;
create policy "cliente_cancela_su_pedido" on pedidos for update
  using (
    is_cliente_mayorista()
    and cliente_id = mi_cliente_id()
    and estado = 'pendiente'
  )
  with check (
    is_cliente_mayorista()
    and cliente_id = mi_cliente_id()
    and estado in ('pendiente', 'cancelado')
  );


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- =============================================================================
