-- ============================================================
-- 120 — COMPRAS Y VENTAS DEL MES, POR CUENTA FISCAL
-- ============================================================
-- Pedido de Fabricio (25/08/2026): en Facturación → Cuentas, cada tarjeta de
-- monotributo muestra el tope de los últimos 12 meses. Debajo quiere ver
-- también, del mismo modo, cómo viene el MES ACTUAL: un bloque de ventas
-- (facturas emitidas) y otro de compras (facturas recibidas).
--
-- POR QUÉ UN RPC Y NO SUMARLO EN LA PANTALLA
-- `facturas` tiene ~18.000 filas y sólo AGOSTO/2026 ya trae 1.140. La pantalla
-- carga `facturas` sin paginar, así que Supabase le corta en 1.000: sumar el
-- mes en el cliente subdeclararía la plata en silencio. Mismo motivo por el
-- que ya existía `facturado_cuentas_12m`.
--
-- EL MES ES EL MES ARGENTINO
-- El corte se calcula con la fecha de Buenos Aires, no con la del servidor:
-- entre las 21 y las 24 del último día del mes, `current_date` en UTC ya está
-- en el mes siguiente y el bloque arrancaba en cero.
--
-- COMPARACIÓN CONTRA EL MES ANTERIOR
-- Se compara 01→hoy contra 01→MISMO DÍA del mes anterior. Nunca un mes
-- parcial contra uno completo: con el mes entero, el día 3 siempre parece un
-- derrumbe. Si el mes anterior es más corto (hoy 31, febrero), se recorta al
-- último día que existe.
--
-- NOTAS DE CRÉDITO
-- Restan, igual que en el tope: una NC emitida baja las ventas y una NC
-- recibida baja las compras.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.facturado_cuentas_mes()
RETURNS TABLE (
  cuenta_id    integer,
  ventas       numeric,
  compras      numeric,
  cant_ventas  bigint,
  cant_compras bigint,
  ventas_ant   numeric,
  compras_ant  numeric
)
LANGUAGE sql
STABLE
AS $function$
  WITH rango AS (
    SELECT
      date_trunc('month', hoy)::date                                AS mes_desde,
      hoy                                                            AS mes_hasta,
      (date_trunc('month', hoy) - interval '1 month')::date          AS ant_desde,
      LEAST(
        -- mismo día del mes anterior
        (date_trunc('month', hoy) - interval '1 month')::date
          + (hoy - date_trunc('month', hoy)::date),
        -- …salvo que ese mes sea más corto: ahí, su último día
        date_trunc('month', hoy)::date - 1
      )                                                              AS ant_hasta
    FROM (
      SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS hoy
    ) t
  ),
  base AS (
    SELECT
      f.cuenta_id,
      f.tipo,
      f.fecha,
      (CASE
         WHEN f.comprobante_codigo IN (3, 8, 13)
           OR upper(COALESCE(f.tipo_comprobante, '')) LIKE 'NC%'
         THEN -1 ELSE 1
       END) * COALESCE(f.monto_total, 0) AS monto
    FROM facturas f, rango r
    WHERE f.fecha >= r.ant_desde
      AND f.fecha <= r.mes_hasta
  )
  SELECT
    b.cuenta_id,
    COALESCE(sum(b.monto) FILTER (
      WHERE b.tipo = 'emitida'  AND b.fecha >= r.mes_desde), 0) AS ventas,
    COALESCE(sum(b.monto) FILTER (
      WHERE b.tipo = 'recibida' AND b.fecha >= r.mes_desde), 0) AS compras,
    count(*) FILTER (
      WHERE b.tipo = 'emitida'  AND b.fecha >= r.mes_desde)     AS cant_ventas,
    count(*) FILTER (
      WHERE b.tipo = 'recibida' AND b.fecha >= r.mes_desde)     AS cant_compras,
    COALESCE(sum(b.monto) FILTER (
      WHERE b.tipo = 'emitida'
        AND b.fecha >= r.ant_desde AND b.fecha <= r.ant_hasta), 0) AS ventas_ant,
    COALESCE(sum(b.monto) FILTER (
      WHERE b.tipo = 'recibida'
        AND b.fecha >= r.ant_desde AND b.fecha <= r.ant_hasta), 0) AS compras_ant
  FROM base b CROSS JOIN rango r
  GROUP BY b.cuenta_id;
$function$;

-- Sin SECURITY DEFINER a propósito: corre con los permisos del que llama, así
-- la RLS de `facturas` sigue mandando (igual que facturado_cuentas_12m).
GRANT EXECUTE ON FUNCTION public.facturado_cuentas_mes() TO authenticated;
