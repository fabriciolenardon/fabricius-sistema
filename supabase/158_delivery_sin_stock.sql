-- ============================================================
-- 158 — Delivery: marcar productos "sin stock" desde el panel
-- ============================================================
-- Pedido de Fabricio: si un corte no hay, que el cliente lo vea en la
-- app como "Sin stock" y NO lo pueda elegir — así no hay que escribirle
-- a cada uno para cambiarlo.
--
-- Distinto de `delivery_oculto` (mig 156): oculto = no se publica nunca;
-- sin stock = se ve en gris y no se puede pedir, hasta que el local lo
-- vuelva a habilitar desde el panel.
-- ============================================================

alter table public.precios add column if not exists delivery_sin_stock boolean not null default false;

-- Cambia la forma de lo que devuelve (agrega sin_stock): hay que recrearla.
drop function if exists public.delivery_productos();
create function public.delivery_productos()
returns table (id uuid, nombre text, categoria text, pesable boolean,
               precio numeric, precio_base numeric, oferta boolean, sin_stock boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (select valor from config_sistema where clave = 'delivery'),
  hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date d)
  select p.id, trim(p.nombre), p.categoria, coalesce(p.pesable, true),
         coalesce(o.precio, p.precio_minorista) as precio,
         p.precio_minorista as precio_base,
         o.precio is not null and o.precio < p.precio_minorista as oferta,
         p.delivery_sin_stock as sin_stock
  from precios p
  cross join cfg
  left join lateral (
    select case
             when coalesce(ofe.descuento_pct, 0) > 0 then round(p.precio_minorista * (1 - ofe.descuento_pct / 100))
             when coalesce(ofe.precio_oferta, 0) > 0 then ofe.precio_oferta
           end as precio
    from ofertas ofe, hoy
    where ofe.precio_id = p.id
      and ofe.activa
      and ofe.aplica_minorista is not false
      and coalesce(ofe.sucursal_id, 1) = 1
      and ofe.fecha_inicio <= hoy.d and ofe.fecha_fin >= hoy.d
    order by ofe.created_at desc
    limit 1
  ) o on true
  where p.sucursal_id is null
    and p.precio_minorista > 0
    and not p.delivery_oculto
    and coalesce(p.vende_por_pieza, false) = false
    and p.categoria in (select jsonb_array_elements_text(cfg.valor->'categorias'))
$$;
revoke all on function public.delivery_productos() from public, anon;
grant execute on function public.delivery_productos() to authenticated;


-- Crear pedido: igual que en la 157 + rechaza lo marcado sin stock (el
-- celular ya no lo deja elegir; esto cubre un carrito armado antes).
create or replace function public.delivery_crear_pedido(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  cfg jsonb;
  v_cli bigint;
  cli record;
  v_dir text := btrim(coalesce(p->>'direccion', ''));
  v_ref text := nullif(btrim(coalesce(p->>'referencias', '')), '');
  v_nota text := nullif(btrim(coalesce(p->>'nota', '')), '');
  v_pago text := coalesce(p->>'forma_pago', '');
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_envio numeric;
  v_minimo numeric;
  v_cupon jsonb;
  v_pct numeric;
  v_desc numeric := 0;
  it jsonb;
  prod record;
  v_cant numeric;
  v_importe numeric;
  v_id bigint;
  v_token uuid;
begin
  select valor into cfg from config_sistema where clave = 'delivery';
  if cfg is null or not delivery_esta_abierto(cfg) then
    raise exception 'CERRADO' using hint = 'Ahora no se están tomando pedidos.';
  end if;
  begin
    v_cli := delivery_cliente_de_token((p->>'token')::uuid);
  exception when others then v_cli := null;
  end;
  if v_cli is null then raise exception 'SESION'; end if;
  select * into cli from clientes_delivery where id = v_cli;
  if v_dir = '' then v_dir := cli.direccion; v_ref := coalesce(v_ref, cli.referencias); end if;
  if length(v_dir) < 4 or length(v_dir) > 200 then raise exception 'DIRECCION'; end if;
  if v_pago not in ('efectivo', 'transferencia') then raise exception 'PAGO'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') < 1
     or jsonb_array_length(p->'items') > 40 then
    raise exception 'ITEMS';
  end if;

  if (select count(*) from pedidos_delivery
      where cliente_id = v_cli and estado in ('nuevo','pesado','pagado','en_camino')) >= 3 then
    raise exception 'DEMASIADOS';
  end if;
  if (select count(*) from pedidos_delivery where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'SATURADO';
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    select * into prod from delivery_productos() dp where dp.id::text = it->>'producto_id';
    if not found then raise exception 'PRODUCTO'; end if;
    if prod.sin_stock then raise exception 'SIN_STOCK'; end if;   -- marcado sin stock en el panel
    v_cant := (it->>'cantidad')::numeric;
    if prod.pesable then
      if v_cant is null or v_cant < 0.1 or v_cant > 20 then raise exception 'CANTIDAD'; end if;
      v_cant := round(v_cant, 3);
    else
      if v_cant is null or v_cant < 1 or v_cant > 50 or v_cant <> trunc(v_cant) then raise exception 'CANTIDAD'; end if;
    end if;
    v_importe := round(v_cant * prod.precio);
    v_subtotal := v_subtotal + v_importe;
    v_items := v_items || jsonb_build_object(
      'producto_id', prod.id, 'nombre', prod.nombre, 'categoria', prod.categoria,
      'pesable', prod.pesable, 'cantidad', v_cant, 'precio', prod.precio,
      'oferta', prod.oferta, 'importe', v_importe,
      'nota', nullif(left(btrim(coalesce(it->>'nota', '')), 200), ''));
  end loop;

  v_envio := coalesce((cfg->>'envio')::numeric, 0);
  v_minimo := coalesce((cfg->>'minimo')::numeric, 0);
  if v_subtotal < v_minimo then raise exception 'MINIMO'; end if;   -- el mínimo es antes del descuento

  v_cupon := delivery_estado_cupon(v_cli);
  if (v_cupon->>'disponible')::boolean then
    v_pct := (v_cupon->>'pct')::numeric;
    v_desc := round(v_subtotal * v_pct / 100);
  end if;

  insert into pedidos_delivery (sucursal_id, cliente_id, cliente_nombre, telefono, direccion, referencias, nota,
                                forma_pago, items, subtotal_aprox, envio, total_aprox,
                                cupon, descuento_pct, descuento_monto)
  values (1, v_cli, cli.nombre, cli.telefono, v_dir, left(v_ref, 200), left(v_nota, 300),
          v_pago, v_items, v_subtotal, v_envio, v_subtotal - v_desc + v_envio,
          v_pct is not null, v_pct, case when v_pct is not null then v_desc end)
  returning id, token into v_id, v_token;

  -- La dirección que usó queda como la de su cuenta.
  update clientes_delivery set direccion = v_dir, referencias = coalesce(left(v_ref, 200), referencias)
   where id = v_cli and direccion is distinct from v_dir;

  return jsonb_build_object('numero', v_id, 'token', v_token);
end $$;
revoke all on function public.delivery_crear_pedido(jsonb) from public;
grant execute on function public.delivery_crear_pedido(jsonb) to anon, authenticated;
