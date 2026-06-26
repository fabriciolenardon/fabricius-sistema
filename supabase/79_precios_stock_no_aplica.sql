-- ============================================================
-- 79 · precios.stock_no_aplica — productos que NO descuentan stock a propósito
-- ------------------------------------------------------------
-- Un producto de cerdo/embutido SIN `stock_origen` es "huérfano": se vende pero
-- no descuenta stock (mapearStock devuelve null) → el stock queda inflado. Para
-- distinguir un huérfano de verdad (falta enlazar) de uno que a propósito no
-- descuenta (embutido comprado para reventa: Provoleta, queso, jamón crudo),
-- esta marca dice "no aplica stock". Los huérfanos = stock_origen NULL AND
-- stock_no_aplica = false. NO cambia la lógica de descuento (ambos casos siguen
-- con stock_origen NULL → mapearStock null → no descuentan); la marca solo evita
-- que los de reventa molesten en la alerta para siempre.
-- ============================================================
alter table public.precios
  add column if not exists stock_no_aplica boolean not null default false;

comment on column public.precios.stock_no_aplica is
  'true = producto comprado/reventa que no sale de ningún bucket propio: no descuenta stock y NO se marca como huérfano en las alertas.';
