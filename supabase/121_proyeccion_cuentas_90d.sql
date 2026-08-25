-- ============================================================
-- 121 — PROYECCIÓN A 12 MESES, POR CUENTA FISCAL
-- ============================================================
-- La tarjeta de cada monotributo muestra "📈 PROYECCIÓN A 12 MESES": lo que va
-- a facturar si sigue al ritmo de los últimos 3 meses. De esa proyección sale
-- el aviso de que se va a pasar del tope K (exclusión del monotributo), así
-- que si sale corta, el aviso llega tarde.
--
-- POR QUÉ UN RPC Y NO SUMARLO EN LA PANTALLA
-- Hasta ahora la proyección se calculaba en el cliente sobre el array
-- `facturas`, que se carga SIN paginar. `facturas` tiene ~18.000 filas y
-- Supabase corta en 1.000: al ritmo actual (agosto/2026 emitió ~1.100), esas
-- 1.000 filas más nuevas cubren unas 3 semanas, no los 90 días que la cuenta
-- asume. Se dividía por 3 un total de 3 semanas → la proyección salía muy por
-- debajo de la real y el semáforo del tope avisaba tarde o no avisaba.
-- Mismo motivo por el que ya se calculan en el servidor `facturado_cuentas_12m`
-- y `facturado_cuentas_mes` (migración 120).
--
-- LOS 90 DÍAS SON DÍAS ARGENTINOS
-- El corte se calcula con la fecha de Buenos Aires, no con la del servidor:
-- entre las 21 y las 24 `current_date` en UTC ya está en el día siguiente y la
-- ventana se corría un día.
--
-- FALLBACK A 12 MESES
-- Si en los últimos 90 días la cuenta no emitió NADA (cuenta dormida, o recién
-- dada de alta), proyectar 0 × 12 = 0 escondería el bloque. Por eso el RPC
-- devuelve también el total de los últimos 365 días: la pantalla lo usa como
-- proyección cuando no hubo movimiento en 90 días (misma regla que tenía el
-- cálculo viejo).
--
-- NOTAS DE CRÉDITO
-- Restan, igual que en el tope de 12 meses y en el mes en curso. La proyección
-- se compara contra el tope K, así que tiene que contar la plata igual que él.
-- El cálculo viejo las sumaba en positivo: proyectaba de más en las cuentas
-- con NC.
--
-- Sólo facturas EMITIDAS (`tipo = 'emitida'`): el tope del monotributo mira lo
-- vendido. Y nada con fecha futura: no es ritmo pasado.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.proyeccion_cuentas_90d()
RETURNS TABLE (
  cuenta_id    integer,
  emitido_90d  numeric,
  cant_90d     bigint,
  emitido_365d numeric,
  cant_365d    bigint
)
LANGUAGE sql
STABLE
AS $function$
  WITH rango AS (
    SELECT
      hoy,
      hoy - 90  AS desde_90,
      hoy - 365 AS desde_365
    FROM (
      SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS hoy
    ) t
  ),
  base AS (
    SELECT
      f.cuenta_id,
      f.fecha,
      (CASE
         WHEN f.comprobante_codigo IN (3, 8, 13)
           OR upper(COALESCE(f.tipo_comprobante, '')) LIKE 'NC%'
         THEN -1 ELSE 1
       END) * COALESCE(f.monto_total, 0) AS monto
    FROM facturas f, rango r
    WHERE f.tipo = 'emitida'
      AND f.fecha >= r.desde_365
      AND f.fecha <= r.hoy
  )
  SELECT
    b.cuenta_id,
    COALESCE(sum(b.monto) FILTER (WHERE b.fecha >= r.desde_90), 0) AS emitido_90d,
    count(*)               FILTER (WHERE b.fecha >= r.desde_90)    AS cant_90d,
    COALESCE(sum(b.monto), 0)                                      AS emitido_365d,
    count(*)                                                       AS cant_365d
  FROM base b CROSS JOIN rango r
  GROUP BY b.cuenta_id;
$function$;

-- Sin SECURITY DEFINER a propósito: corre con los permisos del que llama, así
-- la RLS de `facturas` sigue mandando (igual que facturado_cuentas_12m y
-- facturado_cuentas_mes).
GRANT EXECUTE ON FUNCTION public.proyeccion_cuentas_90d() TO authenticated;

-- ============================================================
-- VERIFICACIÓN (opcional) — correr DESPUÉS de crear la función.
-- Muestra, por monotributo, la proyección VIEJA (la que salía en pantalla,
-- calculada sobre las 1.000 facturas más nuevas que traía Supabase) contra la
-- NUEVA (90 días completos), y qué % del tope K da cada una.
-- ============================================================
-- WITH hoy AS (
--   SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS d
-- ),
-- mil AS (  -- lo que realmente le llegaba a la pantalla
--   SELECT * FROM facturas ORDER BY fecha DESC LIMIT 1000
-- )
-- SELECT
--   c.nombre,
--   min(h.d - 90)                                              AS desde_90d,
--   min((SELECT min(fecha) FROM mil))                          AS mas_vieja_de_las_1000,
--   round(COALESCE(sum(m.monto_total) FILTER (
--     WHERE m.tipo = 'emitida' AND m.fecha >= h.d - 90), 0) / 3 * 12)  AS proyeccion_antes,
--   round(min(p.emitido_90d) / 3 * 12)                         AS proyeccion_despues,
--   round(COALESCE(sum(m.monto_total) FILTER (
--     WHERE m.tipo = 'emitida' AND m.fecha >= h.d - 90), 0) / 3 * 12
--     / 126610838.75 * 100, 1)                                 AS pct_tope_antes,
--   round(min(p.emitido_90d) / 3 * 12 / 126610838.75 * 100, 1) AS pct_tope_despues
-- FROM cuentas_fiscales c
-- CROSS JOIN hoy h
-- LEFT JOIN mil m ON m.cuenta_id = c.id
-- LEFT JOIN proyeccion_cuentas_90d() p ON p.cuenta_id = c.id
-- WHERE c.tipo = 'monotributo'
-- GROUP BY c.nombre
-- ORDER BY c.nombre;
