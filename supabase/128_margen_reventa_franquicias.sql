-- ============================================================
-- 128 — RPC margen_reventa_franquicias: cuánto se le gana a las sucursales
-- ============================================================
-- Compara por grupo el promedio de COMPRA (lo que paga la central) contra el
-- promedio de VENTA a las franquicias. Grupos que pidió Fabricio: media res,
-- piezas bovinas, bovino cortes, cerdo (cortes+piezas), cajones de pollo,
-- rebozados, brosas y embutidos.
--
-- CLAVES DEL CÁLCULO:
--   · Franquicias = clientes.es_franquicia (Alvear y Monte Cristo). NO usar
--     tipo='carniceria': ese tipo incluye 13 clientes que no son sucursales.
--   · Compras reales: importe > 0, sin eliminadas, y destino desposte/
--     elaboracion afuera (son movimientos internos, regla de la casa).
--   · BOVINO CORTES y CERDO usan el costo REAL del desposte del período:
--     la plata pagada por el animal ÷ los kg vendibles que salieron. En cerdo
--     los kg vendibles excluyen hueso/grasa/tocino/cuero (la misma regla que
--     esMermaDeCerdo en lib/mermas.js, en su versión regex).
--   · PIEZAS BOVINAS: compras directas de piezas + despostes a piezas.
--   · CAJONES DE POLLO se comparan POR CAJÓN: en las ventas el campo kg
--     guarda cajones, y en las compras `cantidad` son los cajones.
--   · REBOZADOS por kg; el cajón GRANGYS cuenta como 5 kg (X5KG en todas).
--   · EMBUTIDOS: el promedio de compra es de los COMPRADOS; los de
--     elaboración propia no tienen costo directo acá.
--
-- SECURITY INVOKER a propósito: corre con los permisos del que consulta, así
-- la RLS sigue mandando. La pantalla que lo usa es de Dirección (admin).
--
-- El MARGEN GENERAL lo calcula la pantalla ponderado por plata (ganancia ÷
-- venta), nunca promediando los % entre grupos.
-- Idempotente (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION margen_reventa_franquicias(p_desde date, p_hasta date)
RETURNS TABLE (grupo text, unidad text, vend_cant numeric, vend_total numeric,
               comp_cant numeric, comp_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH franquicias AS (
  SELECT nombre FROM clientes WHERE coalesce(es_franquicia, false)
),
v AS (
  SELECT s.tipo, s.kg, s.total FROM salidas_deposito s
  WHERE s.sucursal_id = 1 AND s.fecha BETWEEN p_desde AND p_hasta
    AND s.cliente_nombre IN (SELECT nombre FROM franquicias)
),
c AS (
  SELECT e.tipo, e.kg, e.cantidad, e.importe FROM entradas_deposito e
  WHERE e.sucursal_id = 1 AND e.fecha BETWEEN p_desde AND p_hasta
    AND coalesce(e.eliminado, false) = false AND coalesce(e.importe, 0) > 0
    AND coalesce(e.destino, '') NOT IN ('desposte', 'elaboracion')
),
d AS (
  SELECT dd.tipo_desposte, dd.kg_media_res, dd.kg_neto, dd.piezas,
         coalesce(e.precio_kg, 0) AS precio_kg
  FROM despostes dd JOIN entradas_deposito e ON e.id = dd.entrada_id
  WHERE e.sucursal_id = 1 AND dd.fecha BETWEEN p_desde AND p_hasta
    AND coalesce(e.precio_kg, 0) > 0
)
SELECT 'media_res', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'bovino_mr'), 0)
UNION ALL
SELECT 'piezas_bovinas', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo IN ('pieza_entera','bovino_pieza')), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo IN ('pieza_entera','bovino_pieza')), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo LIKE 'pieza\_%'), 0)
       + coalesce((SELECT sum((SELECT sum((pz->>'kg')::numeric) FROM jsonb_array_elements(d.piezas) pz))
                     FROM d WHERE tipo_desposte = 'piezas'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo LIKE 'pieza\_%'), 0)
       + coalesce((SELECT sum(kg_media_res * precio_kg) FROM d WHERE tipo_desposte = 'piezas'), 0)
UNION ALL
SELECT 'bovino_corte', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'bovino_corte'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'bovino_corte'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'bovino_corte'), 0)
       + coalesce((SELECT sum(kg_neto) FROM d WHERE tipo_desposte IN ('kilo','bovino')), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'bovino_corte'), 0)
       + coalesce((SELECT sum(kg_media_res * precio_kg) FROM d WHERE tipo_desposte IN ('kilo','bovino')), 0)
UNION ALL
SELECT 'cerdo', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo IN ('cerdo_pieza','cerdo_corte')), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo IN ('cerdo_pieza','cerdo_corte')), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo LIKE 'cerdo\_%'), 0)
       + coalesce((SELECT sum((SELECT sum((pz->>'kg')::numeric) FROM jsonb_array_elements(d.piezas) pz
                                WHERE lower(pz->>'nombre') !~ '^(hueso|grasa|tocino|cuero)'))
                     FROM d WHERE tipo_desposte = 'cerdo'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo LIKE 'cerdo\_%'), 0)
       + coalesce((SELECT sum(kg_media_res * precio_kg) FROM d WHERE tipo_desposte = 'cerdo'), 0)
UNION ALL
SELECT 'pollo_cajon', 'cajón',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'pollo_cajon'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'pollo_cajon'), 0),
       coalesce((SELECT sum(cantidad) FROM c WHERE tipo = 'pollo'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'pollo'), 0)
UNION ALL
SELECT 'rebozados', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'rebozado'), 0)
       + coalesce((SELECT sum(kg) * 5 FROM v WHERE tipo = 'rebozado_cajon'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo IN ('rebozado','rebozado_cajon')), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'rebozado'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'rebozado'), 0)
UNION ALL
SELECT 'brosas', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'bovino_brosa' OR tipo LIKE 'brosa\_%'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'bovino_brosa' OR tipo LIKE 'brosa\_%'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'bovino_brosa' OR tipo LIKE 'brosa\_%'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'bovino_brosa' OR tipo LIKE 'brosa\_%'), 0)
UNION ALL
SELECT 'embutidos', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0)
$$;


-- Verificación: últimos 30 días.
SELECT grupo, unidad,
       round(vend_cant, 1) AS vendido,
       round(vend_total / nullif(vend_cant, 0)) AS prom_venta,
       round(comp_total / nullif(comp_cant, 0)) AS prom_compra
FROM margen_reventa_franquicias(current_date - 30, current_date);
