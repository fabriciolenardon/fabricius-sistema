-- ============================================================
-- 75 · RPC margen_historico() — acumulado de TODA la historia
-- ------------------------------------------------------------
-- Ventas totales (mayorista emitido + minorista de arqueo) − compras − gastos/sueldos,
-- sin filtro de fecha. Server-side para no toparse con el límite de 1000 filas.
-- NOTA: por ahora el widget "Margen histórico" del Ejecutivo NO usa este RPC
-- (usa la versión anclada a la semana pasada, a pedido de Fabricio). Queda
-- disponible por si más adelante se quiere el acumulado total.
-- ============================================================
create or replace function public.margen_historico()
returns table(mayorista numeric, minorista numeric, compras numeric, gastos numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select coalesce(sum(total),0) from salidas_deposito where cobro is distinct from 'interno'),
    (select coalesce(sum(coalesce(total_contado,0) + coalesce(debito_real,0) + coalesce(transferencia_real,0)),0) from arqueos_caja),
    (select coalesce(sum(importe),0) from compras_proveedores where not coalesce(anulado,false)),
    (select coalesce(sum(monto),0) from gastos where coalesce(solo_balance,false) = false and tipo in ('fijo','variable','socio'))
      + (select coalesce(sum(neto),0) from liquidaciones_sueldos)
$$;

revoke all on function public.margen_historico() from anon, public;
grant execute on function public.margen_historico() to authenticated;
