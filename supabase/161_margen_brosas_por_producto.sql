-- ============================================================
-- 161 — Margen de reventa: brosas costeadas PRODUCTO POR PRODUCTO
-- ============================================================
-- Bug 03/10/2026: Productividad → Franquicias, Monte Cristo, esta semana,
-- daba brosas con ganancia −$1.426/kg cuando todas se venden más caras de lo
-- que se compran (chinchulín $8.000 vs $5.038, hígado $4.800 vs $2.511,
-- riñón $8.000 vs $3.301).
--
-- Causa: el "prom. de compra" era el promedio de TODAS las brosas compradas
-- en la semana — incluidos 24,5 kg de molleja a $26.000/kg que Monte Cristo
-- no compró. Comparar ese promedio contra lo que SÍ le vendimos (hígado,
-- chinchulín, riñón) mezcla productos que no tienen nada que ver
-- (ver feedback "no promediar entre categorías"). Además había 3 compras
-- cargadas a $1 el kg (corazón, lengua, rabo) que tiraban el promedio.
--
-- Ahora: cada salida de brosa se cruza con SU producto (precios.nombre →
-- stock_origen brosa_*) y se le pone el costo de ESE producto:
--   · promedio ponderado de sus compras del período;
--   · si en el período no se compró, el de los últimos 90 días.
-- Se ignoran las compras a menos de $100/kg (cargas en $1 = sin costo real).
-- Las salidas sin costo conocido quedan afuera de la comparación (no se puede
-- decir si ganamos o perdimos con ellas).
-- ============================================================

create or replace function public.margen_brosas_costeado(p_desde date, p_hasta date, p_clientes text[])
returns table (vend_cant numeric, vend_total numeric, comp_cant numeric, comp_total numeric)
language sql stable set search_path = public as $$
  with compras as (
    select e.tipo, e.fecha, e.kg, e.importe
    from entradas_deposito e
    where e.sucursal_id = 1 and coalesce(e.eliminado, false) = false
      and coalesce(e.destino, '') not in ('desposte', 'elaboracion')
      and e.tipo like 'brosa\_%' and coalesce(e.importe, 0) > 0 and coalesce(e.kg, 0) > 0
      and e.importe / e.kg >= 100
      and e.fecha between p_hasta - 90 and p_hasta
  ),
  costo as (
    select t.tipo,
           coalesce(
             (select sum(importe) / nullif(sum(kg), 0) from compras c where c.tipo = t.tipo and c.fecha between p_desde and p_hasta),
             (select sum(importe) / nullif(sum(kg), 0) from compras c where c.tipo = t.tipo)
           ) as costo_kg
    from (select distinct tipo from compras) t
  ),
  ventas as (
    select s.kg, s.total, pr.stock_origen
    from salidas_deposito s
    left join lateral (
      select p.stock_origen from precios p
      where p.sucursal_id is null and upper(trim(p.nombre)) = upper(trim(s.descripcion))
      limit 1
    ) pr on true
    where s.sucursal_id = 1 and s.fecha between p_desde and p_hasta
      and s.cliente_nombre = any (p_clientes)
      and (s.tipo = 'bovino_brosa' or s.tipo like 'brosa\_%')
  )
  select coalesce(sum(v.kg), 0), coalesce(sum(v.total), 0),
         coalesce(sum(v.kg), 0), coalesce(sum(v.kg * c.costo_kg), 0)
  from ventas v join costo c on c.tipo = v.stock_origen
  where c.costo_kg is not null
$$;

-- ── Total de las franquicias ──
create or replace function public.margen_reventa_franquicias(p_desde date, p_hasta date)
returns table (grupo text, unidad text, vend_cant numeric, vend_total numeric, comp_cant numeric, comp_total numeric)
language sql stable as $function$
WITH franquicias AS (
  SELECT nombre FROM clientes WHERE coalesce(es_franquicia, false)
),
v AS (  -- ventas de la CENTRAL a las franquicias en el período
  SELECT s.tipo, s.kg, s.total FROM salidas_deposito s
  WHERE s.sucursal_id = 1 AND s.fecha BETWEEN p_desde AND p_hasta
    AND s.cliente_nombre IN (SELECT nombre FROM franquicias)
),
c AS (  -- compras reales de la central (las internas de desposte no cuentan)
  SELECT e.tipo, e.kg, e.cantidad, e.importe FROM entradas_deposito e
  WHERE e.sucursal_id = 1 AND e.fecha BETWEEN p_desde AND p_hasta
    AND coalesce(e.eliminado, false) = false AND coalesce(e.importe, 0) > 0
    AND coalesce(e.destino, '') NOT IN ('desposte', 'elaboracion')
),
d AS (  -- despostes del período con el precio pagado por el animal de origen
  SELECT dd.tipo_desposte, dd.kg_media_res, dd.kg_neto, dd.piezas,
         coalesce(e.precio_kg, 0) AS precio_kg
  FROM despostes dd JOIN entradas_deposito e ON e.id = dd.entrada_id
  WHERE e.sucursal_id = 1 AND dd.fecha BETWEEN p_desde AND p_hasta
    AND coalesce(e.precio_kg, 0) > 0
)

-- MEDIA RES: se compra y se revende tal cual
SELECT 'media_res', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'bovino_mr'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'bovino_mr'), 0)
UNION ALL
-- PIEZAS BOVINAS: compradas directas + las que salen del desposte a piezas
-- (costo = kg de la media × precio pagado; kg = lo que pesaron las piezas)
SELECT 'piezas_bovinas', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo IN ('pieza_entera','bovino_pieza')), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo IN ('pieza_entera','bovino_pieza')), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo LIKE 'pieza\_%'), 0)
       + coalesce((SELECT sum((SELECT sum((pz->>'kg')::numeric) FROM jsonb_array_elements(d.piezas) pz))
                     FROM d WHERE tipo_desposte = 'piezas'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo LIKE 'pieza\_%'), 0)
       + coalesce((SELECT sum(kg_media_res * precio_kg) FROM d WHERE tipo_desposte = 'piezas'), 0)
UNION ALL
-- BOVINO CORTES: el costo sale del desposte a kilo (media pagada / kg netos)
SELECT 'bovino_corte', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'bovino_corte'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'bovino_corte'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'bovino_corte'), 0)
       + coalesce((SELECT sum(kg_neto) FROM d WHERE tipo_desposte IN ('kilo','bovino')), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'bovino_corte'), 0)
       + coalesce((SELECT sum(kg_media_res * precio_kg) FROM d WHERE tipo_desposte IN ('kilo','bovino')), 0)
UNION ALL
-- CERDO: costo = capón pagado / kg VENDIBLES (hueso/grasa/tocino/cuero afuera,
-- misma regla que esMermaDeCerdo en lib/mermas.js)
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
-- CAJONES DE POLLO: se compara por CAJÓN (en las ventas kg = cajones; en las
-- compras la cantidad son los cajones)
SELECT 'pollo_cajon', 'cajón',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'pollo_cajon'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'pollo_cajon'), 0),
       coalesce((SELECT sum(cantidad) FROM c WHERE tipo = 'pollo'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'pollo'), 0)
UNION ALL
-- REBOZADOS: por kg. El cajón GRANGYS es de 5 kg (X5KG en todas las líneas)
SELECT 'rebozados', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'rebozado'), 0)
       + coalesce((SELECT sum(kg) * 5 FROM v WHERE tipo = 'rebozado_cajon'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo IN ('rebozado','rebozado_cajon')), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'rebozado'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'rebozado'), 0)
UNION ALL
-- BROSAS: costo de CADA producto vendido (mig 161), no el promedio de todas
SELECT 'brosas', 'kg', b.vend_cant, b.vend_total, b.comp_cant, b.comp_total
FROM margen_brosas_costeado(p_desde, p_hasta, ARRAY(SELECT nombre FROM franquicias)) b
UNION ALL
-- EMBUTIDOS (el promedio de compra es de los COMPRADOS; los de elaboración
-- propia no tienen costo directo acá)
SELECT 'embutidos', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0)
$function$;

-- ── Una franquicia en particular ──
create or replace function public.margen_reventa_franquicia_cliente(p_desde date, p_hasta date, p_cliente text)
returns table (grupo text, unidad text, vend_cant numeric, vend_total numeric, comp_cant numeric, comp_total numeric)
language sql stable as $function$
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
-- BROSAS: costo de CADA producto vendido (mig 161), no el promedio de todas
SELECT 'brosas', 'kg', b.vend_cant, b.vend_total, b.comp_cant, b.comp_total
FROM margen_brosas_costeado(p_desde, p_hasta,
       ARRAY(SELECT nombre FROM clientes WHERE nombre = p_cliente AND coalesce(es_franquicia, false))) b
UNION ALL
SELECT 'embutidos', 'kg',
       coalesce((SELECT sum(kg) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(total) FROM v WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(kg) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0),
       coalesce((SELECT sum(importe) FROM c WHERE tipo = 'embutido' OR tipo LIKE 'emb\_%'), 0)
$function$;

revoke all on function public.margen_brosas_costeado(date, date, text[]) from public, anon;
grant execute on function public.margen_brosas_costeado(date, date, text[]) to authenticated;
