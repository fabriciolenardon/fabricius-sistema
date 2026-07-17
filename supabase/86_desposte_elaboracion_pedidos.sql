-- =============================================================================
-- MIGRACIÓN 86 — PORTAL DESPOSTE: ELABORACIÓN + PANEL DE PEDIDOS
-- =============================================================================
-- 1) El rol desposte puede elaborar (embutidos/hamburguesas/salames) desde su
--    portal: necesita INSERT/SELECT/UPDATE en elaboraciones_embutidos y el
--    INSERT en entradas_deposito (la entrada informativa destino='elaboracion').
-- 2) Panel de pedidos del sector: el admin carga pedidos, el desposte los ve,
--    carga los kg reales y los marca LISTO. Nuevo estado 'listo' + columnas
--    de trazabilidad (origen del pedido, quién lo preparó y cuándo).
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- Requiere la mig 30 (rol desposte + is_desposte()).
-- =============================================================================


-- 1) ELABORACIONES: el desposte puede registrar y finalizar (salame seco)
-- -----------------------------------------------------------------------------
drop policy if exists "elaboraciones_desposte_read" on elaboraciones_embutidos;
create policy "elaboraciones_desposte_read" on elaboraciones_embutidos
  for select using (is_desposte());

drop policy if exists "elaboraciones_desposte_insert" on elaboraciones_embutidos;
create policy "elaboraciones_desposte_insert" on elaboraciones_embutidos
  for insert with check (is_desposte());

-- UPDATE: necesario para la etapa 2 del salame (cargar kg finales del secado)
drop policy if exists "elaboraciones_desposte_update" on elaboraciones_embutidos;
create policy "elaboraciones_desposte_update" on elaboraciones_embutidos
  for update using (is_desposte()) with check (is_desposte());


-- 2) ENTRADAS_DEPOSITO: INSERT para la entrada informativa de la elaboración
-- -----------------------------------------------------------------------------
-- (la mig 30 ya le dio SELECT y UPDATE; solo faltaba INSERT)
drop policy if exists "entradas_deposito_desposte_insert" on entradas_deposito;
create policy "entradas_deposito_desposte_insert" on entradas_deposito
  for insert with check (is_desposte());


-- 3) PEDIDOS: nuevo estado 'listo' + origen/preparación
-- -----------------------------------------------------------------------------
alter table pedidos drop constraint if exists pedidos_estado_check;
alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'confirmado', 'listo', 'incompleto', 'despachado', 'rechazado', 'cancelado'));

-- 'cliente' = pedido del portal mayorista · 'admin' = cargado por el admin
-- para que lo prepare el sector desposte
alter table pedidos add column if not exists origen text default 'cliente';

-- Quién lo dejó listo y cuándo (operario del sector desposte)
alter table pedidos add column if not exists preparado_por text;
alter table pedidos add column if not exists preparado_en timestamptz;


-- 4) PEDIDOS: acceso del rol desposte
-- -----------------------------------------------------------------------------
-- Lee todos los pedidos (el filtro de qué preparar lo hace la app) y solo
-- puede actualizarlos mientras NO estén despachados/cerrados: carga kg reales
-- (items) y los pasa a 'listo'.
drop policy if exists "pedidos_desposte_read" on pedidos;
create policy "pedidos_desposte_read" on pedidos
  for select using (is_desposte());

drop policy if exists "pedidos_desposte_update" on pedidos;
create policy "pedidos_desposte_update" on pedidos
  for update
  using (is_desposte() and estado in ('confirmado', 'listo'))
  with check (is_desposte() and estado in ('confirmado', 'listo'));


-- =============================================================================
-- FIN DE LA MIGRACIÓN
-- =============================================================================
