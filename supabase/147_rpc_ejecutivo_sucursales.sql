-- ============================================================
-- 147 — Totales por boca para el Ejecutivo, sin abrir las tablas
-- ============================================================
-- Reemplaza a la 144 (revertida por la 146). Aquella abría
-- ventas_minoristas/remitos/meses_operativos al CEO y eso infló en silencio
-- el Cierre, el Dashboard, Reportes, Caja, Iris y todo lo que confiaba en
-- que la RLS filtraba por ellos.
--
-- Acá el acceso va por una sola función `security definer` que devuelve
-- TOTALES YA SUMADOS. No se puede sacar de ella una venta, un ticket ni un
-- remito: solo cuánto vendió cada boca. Las policies quedan intactas, así
-- que ninguna otra pantalla cambia de comportamiento.
--
-- La llama solo el CEO (mismo criterio que <SoloCEO> en App.jsx). Si la
-- llamara cualquier otro, corta con excepción.
--
-- CRITERIOS (los definió Fabricio, ver el componente):
--   · Cada boca se mide con SU propio mes operativo. Se emparejan por
--     meses_operativos.mes ('2026-09'); septiembre de la central va
--     31/08→04/10 y el de Monte Cristo 01/09→05/10.
--   · Solo CARNE: almacén y bebidas no suman ni en plata ni en kilos. En
--     esos rubros el campo kg guarda UNIDADES, así que una gaseosa sumaba
--     "1 kg" y rompía el $/kg.
--   · La venta de la central va SIN lo que le vende a las franquicias: eso
--     no es venta a la calle, y se volvería a contar cuando la boca revende.
--   · Los cajones se abren por kg_por_unidad (un cajón de pechuga son 20 kg).
--   · Las ventas marcan el rubro en `categoria` y los remitos en `tipo`.
-- ============================================================

-- Kilos de un item, con el cajón abierto. Inmutable: solo mira su argumento.
create or replace function public.item_kg(i jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when i->>'unidad' = 'u' and coalesce((i->>'kg_por_unidad')::numeric, 0) > 0
      then coalesce((i->>'kg')::numeric, 0) * (i->>'kg_por_unidad')::numeric
    else coalesce((i->>'kg')::numeric, 0)
  end
$$;

-- ¿Este item es carne? Almacén, bebidas e insumos quedan afuera.
create or replace function public.item_es_carne(i jsonb)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(i->>'categoria', i->>'tipo', ''))
         not in ('almacen','bebidas','insumo','insumos')
$$;

create or replace function public.ejecutivo_sucursales(p_mes text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_mes    text;
  v_meses  jsonb;
  v_bocas  jsonb;
  v_franq  jsonb;
  v_hoy    date := (now() at time zone 'America/Argentina/Cordoba')::date;
begin
  -- Solo el dueño. La pantalla ya está cerrada con <SoloCEO>, esto hace que
  -- la base diga lo mismo y no dependa de que el front se acuerde.
  if not es_ceo() then
    raise exception 'Solo el dueño puede ver el resumen de las bocas';
  end if;

  -- Meses disponibles: la UNIÓN de los de todas las bocas. Hay meses que
  -- tiene una sola (Monte Cristo abrió octubre y la central todavía no).
  -- La etiqueta que se muestra es la de la central cuando existe.
  select jsonb_agg(x order by x->>'mes' desc)
    into v_meses
  from (
    select jsonb_build_object(
             'mes', mes,
             'etiqueta', coalesce(
               max(etiqueta) filter (where sucursal_id = 1),
               min(etiqueta))
           ) as x
    from meses_operativos
    group by mes
  ) t;

  -- El mes pedido, o el que se está VIVIENDO (no el más nuevo de la lista:
  -- un mes futuro ya abierto dejaba la pantalla vacía).
  v_mes := coalesce(
    p_mes,
    (select mes from meses_operativos
      where v_hoy between fecha_inicio and fecha_cierre
      order by sucursal_id = 1 desc limit 1),
    (select mes from meses_operativos
      where fecha_inicio <= v_hoy order by fecha_inicio desc limit 1)
  );

  -- ── Rango de cada boca para ese mes ──────────────────────────────────
  -- Si una boca no abrió ese mes, se le presta el de la central (o el de
  -- cualquiera que lo tenga) y la fila lo avisa con propio = false.
  with rangos as (
    select s.id as sucursal_id, s.nombre, s.tipo, s.direccion,
           coalesce(p.fecha_inicio, a.fecha_inicio) as desde,
           coalesce(p.fecha_cierre, a.fecha_cierre) as hasta,
           (p.id is not null) as propio
    from sucursales s
    left join meses_operativos p on p.sucursal_id = s.id and p.mes = v_mes
    left join lateral (
      select fecha_inicio, fecha_cierre from meses_operativos
      where mes = v_mes order by sucursal_id = 1 desc limit 1
    ) a on true
  ),
  mostrador as (
    select r.sucursal_id,
           count(distinct v.id) as tickets,
           coalesce(sum(item_kg(i)) filter (where item_es_carne(i)), 0) as kg,
           coalesce(sum((i->>'importe')::numeric) filter (where item_es_carne(i)), 0) as plata
    from rangos r
    join ventas_minoristas v
      on v.sucursal_id = r.sucursal_id
     and v.fecha between r.desde and r.hasta
     and v.origen = 'caja'
    cross join lateral jsonb_array_elements(v.items) i
    group by r.sucursal_id
  ),
  mayorista as (
    -- Sin los remitos a franquicias: eso es mercadería que sale para adentro
    -- del grupo, no venta a la calle.
    select r.sucursal_id,
           count(distinct re.id) as remitos,
           coalesce(sum(item_kg(i)) filter (where item_es_carne(i)), 0) as kg,
           coalesce(sum((i->>'importe')::numeric) filter (where item_es_carne(i)), 0) as plata
    from rangos r
    join remitos re
      on re.sucursal_id = r.sucursal_id
     and re.fecha between r.desde and r.hasta
     and coalesce(re.eliminado, false) = false
     and coalesce(re.es_cobranza_terceros, false) = false
    left join clientes c on c.id = re.cliente_id
    cross join lateral jsonb_array_elements(re.items) i
    where coalesce(c.es_franquicia, false) = false
    group by r.sucursal_id
  )
  select jsonb_agg(jsonb_build_object(
           'sucursal_id', r.sucursal_id,
           'nombre', r.nombre,
           'tipo', r.tipo,
           'direccion', r.direccion,
           'desde', r.desde,
           'hasta', r.hasta,
           'propio', r.propio,
           'tickets', coalesce(mo.tickets, 0),
           'mostrador', round(coalesce(mo.plata, 0), 2),
           'kg_mostrador', round(coalesce(mo.kg, 0), 2),
           'remitos', coalesce(ma.remitos, 0),
           'mayorista', round(coalesce(ma.plata, 0), 2),
           'kg_mayorista', round(coalesce(ma.kg, 0), 2)
         ) order by coalesce(mo.plata,0) + coalesce(ma.plata,0) desc)
    into v_bocas
  from rangos r
  left join mostrador mo on mo.sucursal_id = r.sucursal_id
  left join mayorista ma on ma.sucursal_id = r.sucursal_id;

  -- ── Lo que las franquicias le compran a la central ───────────────────
  -- Con el mes de la CENTRAL, que es la que emite esos remitos, y también
  -- el acumulado de siempre ("cuánto lleva comprado").
  with rc as (
    select fecha_inicio as desde, fecha_cierre as hasta
    from meses_operativos where mes = v_mes and sucursal_id = 1
    union all
    select fecha_inicio, fecha_cierre from meses_operativos
    where mes = v_mes order by 1 limit 1
  ),
  rango_central as (select desde, hasta from rc limit 1),
  detalle as (
    select c.id, c.nombre, re.id as remito_id, re.fecha,
           item_kg(i) as kg,
           (i->>'importe')::numeric as importe
    from remitos re
    join clientes c on c.id = re.cliente_id
    cross join lateral jsonb_array_elements(re.items) i
    where c.es_franquicia = true
      and coalesce(re.eliminado, false) = false
      and coalesce(re.es_cobranza_terceros, false) = false
      and item_es_carne(i)
  )
  select jsonb_agg(x order by (x->>'plata')::numeric desc, (x->>'hist_plata')::numeric desc)
    into v_franq
  from (
    select jsonb_build_object(
      'id', d.id,
      'nombre', d.nombre,
      'remitos', count(distinct d.remito_id) filter (where d.fecha between rg.desde and rg.hasta),
      'kilos',   round(coalesce(sum(d.kg)      filter (where d.fecha between rg.desde and rg.hasta), 0), 2),
      'plata',   round(coalesce(sum(d.importe) filter (where d.fecha between rg.desde and rg.hasta), 0), 2),
      'hist_remitos', count(distinct d.remito_id),
      'hist_kilos',   round(coalesce(sum(d.kg), 0), 2),
      'hist_plata',   round(coalesce(sum(d.importe), 0), 2)
    ) as x
    from detalle d cross join rango_central rg
    group by d.id, d.nombre
  ) t;

  return jsonb_build_object(
    'mes', v_mes,
    'meses', coalesce(v_meses, '[]'::jsonb),
    'bocas', coalesce(v_bocas, '[]'::jsonb),
    'franquicias', coalesce(v_franq, '[]'::jsonb)
  );
end;
$$;

comment on function public.ejecutivo_sucursales(text) is
  'Totales por boca para Dirección → Ejecutivo → Sucursales. security definer con gate es_ceo(): devuelve solo agregados, nunca filas. Reemplaza a la migración 144, que abría las tablas y terminó inflando el Cierre con la caja de otra boca.';

revoke all on function public.ejecutivo_sucursales(text) from public;
grant execute on function public.ejecutivo_sucursales(text) to authenticated;
