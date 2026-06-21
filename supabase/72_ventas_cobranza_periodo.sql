-- ============================================================
-- 72 · RPC ventas_cobranza_periodo(desde, hasta)
-- ------------------------------------------------------------
-- Devuelve { vendido, cobrado, por_cobrar } de un período:
--   vendido    = caja minorista + mayorista (salidas no internas) emitido en [desde,hasta]
--   por_cobrar = ventas a crédito del período aún no cobradas, criterio FIFO por cliente
--                (los pagos del cliente cancelan PRIMERO la deuda anterior a `desde`;
--                 el resto recién baja el crédito del período → no mezcla deuda vieja)
--   cobrado    = vendido - por_cobrar
--
-- Se hace server-side para (a) no toparse con el límite de 1000 filas de PostgREST
-- y (b) calcular el FIFO sobre todo el historial de cuenta corriente del cliente.
-- ============================================================
create or replace function public.ventas_cobranza_periodo(p_desde date, p_hasta date)
returns table(vendido numeric, cobrado numeric, por_cobrar numeric)
language sql
stable
security definer
set search_path = public
as $$
  with caja as (
    select coalesce(sum(total),0) as v
    from ventas_minoristas
    where origen = 'caja' and fecha between p_desde and p_hasta
  ),
  may as (
    select coalesce(sum(total),0) as v
    from salidas_deposito
    where cobro is distinct from 'interno' and fecha between p_desde and p_hasta
  ),
  mov as (
    select cliente_id,
      sum(case when fecha < p_desde then coalesce(debe,0) - coalesce(haber,0) else 0 end) as saldo_ini,
      sum(case when fecha between p_desde and p_hasta then coalesce(debe,0) else 0 end) as credito,
      sum(case when fecha between p_desde and p_hasta then coalesce(haber,0) else 0 end) as pagos
    from movimientos_ctacte
    group by cliente_id
  ),
  pc as (
    select coalesce(sum(credito - greatest(0, least(credito, pagos - greatest(saldo_ini,0)))),0) as por_cobrar
    from mov
  )
  select (c.v + m.v) as vendido,
         (c.v + m.v) - pc.por_cobrar as cobrado,
         pc.por_cobrar as por_cobrar
  from caja c, may m, pc;
$$;

revoke all on function public.ventas_cobranza_periodo(date, date) from anon, public;
grant execute on function public.ventas_cobranza_periodo(date, date) to authenticated;
