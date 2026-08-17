-- ============================================================
-- 91 — STOCK: tope de 5 enteros + 3 decimales (numeric(8,3))
-- ============================================================
-- PROBLEMA
-- `stock_actual.kg_disponible` era `numeric` sin precisión, así que guardaba
-- el float crudo que venía de la app. Como el stock se calcula sumando y
-- restando venta por venta, un bucket que llegó a cero REAL quedaba con
-- residuo:
--
--   pieza_costillar   -0,000000000000003552713678800501
--   pieza_costeletal  -0,000000000000003552713678800501
--   pieza_pierna      -0,000000000000021316282072803006
--
-- En pantalla se veía "0" (todo se formatea con 2 decimales) pero era < 0:
-- se pintaba en rojo, contaba en el filtro de negativos y disparaba la alerta
-- "Stock NEGATIVO" del dashboard. Ver PR #316.
--
-- SOLUCIÓN
-- numeric(8,3) = 8 dígitos en total, 3 después de la coma → 5 para el entero.
-- Máximo 99.999,999 kg y precisión de 1 gramo (345,340 = 345 kg 340 g).
-- Postgres redondea SOLO en cada escritura, venga de donde venga (la app, las
-- edge functions o una consulta a mano), así que el residuo no vuelve a
-- aparecer aunque un flujo nuevo se olvide de redondear.
--
-- Este ALTER además redondea las filas que ya están guardadas (hoy 15 de 50
-- tienen residuo más allá del gramo).
--
-- OJO: a partir de acá, guardar un valor de 100.000 o más da error
-- "numeric field overflow" en vez de guardarse. Es a propósito — es el tope
-- pedido y sirve de red contra un typo. El bucket más grande hoy es pollo con
-- 960 kg, así que sobra margen.
-- ============================================================

-- Chequeo previo: si esto devuelve alguna fila, NO correr el ALTER todavía
-- (habría que revisar ese bucket antes, porque el ALTER va a fallar).
select tipo, kg_disponible
from stock_actual
where abs(kg_disponible) >= 99999.9995;

alter table stock_actual
  alter column kg_disponible type numeric(8,3);

-- Verificación: todo redondeado al gramo y ningún residuo.
select tipo, kg_disponible
from stock_actual
order by abs(kg_disponible) desc
limit 10;
