-- ============================================================
-- 149 — Venta de HOY de cada boca franquiciada (franja del panel TV)
-- ============================================================
-- Mismo criterio que la 147: totales agregados por una función security
-- definer, NUNCA abrir las tablas. La 144 hizo eso último y terminó
-- inflando el Cierre con la caja de otra boca.
--
-- Devuelve SOLO las franquicias: la central ya tiene su número grande
-- arriba del panel ("FACTURADO HOY"), repetirlo abajo es ruido.
--
-- Minorista = ventas del mostrador de esa boca.
-- Mayorista = remitos que ESA boca emite a sus propios clientes.
-- Se usan los totales (no solo carne) para que el número sea comparable
-- con el facturado de arriba, que también es total.
--
-- Alvear sale en cero mientras no tenga el sistema; la franja no la
-- muestra hasta que cargue su primera venta.
-- ============================================================
create or replace function public.ejecutivo_bocas_hoy()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Cordoba')::date;
  v_out jsonb;
begin
  if not es_ceo() then
    raise exception 'Solo el dueño puede ver la venta de las bocas';
  end if;

  select jsonb_agg(x order by (x->>'total')::numeric desc)
    into v_out
  from (
    select jsonb_build_object(
      'sucursal_id', s.id,
      'nombre', s.nombre,
      'minorista', round(coalesce(mi.plata, 0), 2),
      'tickets',   coalesce(mi.tickets, 0),
      'mayorista', round(coalesce(ma.plata, 0), 2),
      'remitos',   coalesce(ma.remitos, 0),
      'total',     round(coalesce(mi.plata, 0) + coalesce(ma.plata, 0), 2)
    ) as x
    from sucursales s
    left join lateral (
      select count(*) as tickets, sum(total) as plata
      from ventas_minoristas v
      where v.sucursal_id = s.id and v.fecha = v_hoy and v.origen = 'caja'
    ) mi on true
    left join lateral (
      select count(*) as remitos, sum(r.total) as plata
      from remitos r
      where r.sucursal_id = s.id and r.fecha = v_hoy
        and coalesce(r.eliminado, false) = false
        and coalesce(r.es_cobranza_terceros, false) = false
    ) ma on true
    where s.tipo = 'franquicia'
  ) t;

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

comment on function public.ejecutivo_bocas_hoy() is
  'Venta de hoy (minorista + mayorista) de cada boca franquiciada, para la franja BOCAS del panel TV. security definer con gate es_ceo(): solo agregados.';

revoke all on function public.ejecutivo_bocas_hoy() from public;
grant execute on function public.ejecutivo_bocas_hoy() to authenticated;

-- APLICADA el 10/09/2026.
