-- ============================================================
-- MIGRACIÓN 23: Stock de almacén y bebidas
-- ============================================================
-- Agrega los tipos 'almacen' y 'bebidas' a la tabla stock_actual.
-- A partir de ahora la Caja descontará de esos stocks cuando se venda
-- un producto de esas categorías, y desde Depósito > Entradas se pueden
-- registrar ingresos.
--
-- NOTA: la columna se llama `kg_disponible` por compatibilidad histórica,
-- pero para almacén y bebidas representa CANTIDAD DE UNIDADES disponibles.
-- ============================================================

insert into stock_actual (tipo, kg_disponible)
values
  ('almacen', 0),
  ('bebidas', 0)
on conflict (tipo) do nothing;

-- Verificación: los dos tipos nuevos deberían aparecer
select tipo, kg_disponible
from stock_actual
where tipo in ('almacen', 'bebidas');
