-- ============================================================
-- 129 — RPC margen_reventa_franquicia_cliente: el margen de UNA sucursal
-- ============================================================
-- Igual que margen_reventa_franquicias (mig 128) pero con las VENTAS
-- filtradas a una sola franquicia (p_cliente = clientes.nombre exacto,
-- ojo que algunos nombres tienen espacio al final). Fabricio quiere ver
-- el margen POR sucursal, y que cualquier franquicia nueva (es_franquicia)
-- aparezca sola en la pantalla sin tocar código.
--
-- Es una función NUEVA a propósito (no se le agrega un parámetro opcional
-- a la de la 128): un overload con DEFAULT deja dos firmas y PostgREST
-- no sabe a cuál llamar; y además la pantalla ya deployada seguiría
-- funcionando en "Todas" aunque esta migración todavía no esté aplicada.
--
-- El lado COMPRA queda global igual que en la 128: lo que paga la central
-- por la mercadería es el mismo costo sea cual sea la sucursal que compra.
-- Se exige además que p_cliente sea franquicia real (es_franquicia), así
-- nadie saca márgenes de clientes comunes por esta vía.
--
-- SECURITY INVOKER: corre con los permisos del que consulta (manda la RLS).
-- Idempotente (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION margen_reventa_franquicia_cliente(p_desde date, p_hasta date, p_cliente text)
RETURNS TABLE (grupo text, unidad text, vend_cant numeric, vend_total numeric,
               comp_cant numeric, comp_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH v AS (
  SELECT s.tipo, s.kg, s.total FROM salidas_deposito s
  WHERE s.sucursal_id = 1 AND s.fecha BETWEEN p_desde AND p_hasta
    AND s.cliente_nombre = p_cliente
    AND EXISTS (SELECT 1 FROM clientes cl
                WHERE cl.nombre = p_cliente AND coalesce(cl.es_franquicia, false))
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


-- Verificación: Monte Cristo, últimos 30 días.
SELECT grupo, unidad,
       round(vend_cant, 1) AS vendido,
       round(vend_total / nullif(vend_cant, 0)) AS prom_venta,
       round(comp_total / nullif(comp_cant, 0)) AS prom_compra
FROM margen_reventa_franquicia_cliente(
  current_date - 30, current_date,
  (SELECT nombre FROM clientes WHERE coalesce(es_franquicia, false)
   AND nombre ILIKE '%monte cristo%' LIMIT 1));
