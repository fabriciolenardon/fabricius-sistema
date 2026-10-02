-- ============================================================
-- 159 — Delivery: un mismo celular = una sola cuenta
-- ============================================================
-- Bug 02/10/2026: Fabricio quedó dos veces como cliente, una con
-- "543575400406" y otra con "3575400406". La cuenta comparaba los
-- dígitos tal cual, así que el mismo número escrito con 54, +54 9, 0 o
-- 15 contaba como otro.
--
-- Ahora todo teléfono se guarda y se busca en su forma NACIONAL de 10
-- dígitos (característica + número, sin 0 ni 15): 3575400406.
--   +54 9 3575 400406 · 543575400406 · 03575 15 400406 · 3575-15-400406
--   → 3575400406
-- ============================================================

create or replace function public.delivery_normalizar_tel(p text)
returns text language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  pos int;
begin
  if d like '00%' then d := substr(d, 3); end if;                      -- 0054…
  if d like '54%' and length(d) >= 12 then d := substr(d, 3); end if;  -- código de país
  if d like '9%' and length(d) = 11 then d := substr(d, 2); end if;    -- el 9 de celular
  if d like '0%' then d := substr(d, 2); end if;                       -- 0 de larga distancia
  -- El 15 después de la característica (de 4, 3 o 2 dígitos): 12 → 10 dígitos.
  if length(d) = 12 then
    foreach pos in array array[4, 3, 2] loop
      if substr(d, pos + 1, 2) = '15' then
        d := left(d, pos) || substr(d, pos + 3);
        exit;
      end if;
    end loop;
  end if;
  return d;
end $$;

-- Las dos cuentas de Fabricio (ninguna con pedidos): queda la última, la
-- que creó al reinstalar el ícono.
delete from public.clientes_delivery
 where id = 1 and telefono = '543575400406'
   and not exists (select 1 from public.pedidos_delivery where cliente_id = 1);

update public.clientes_delivery
   set telefono = delivery_normalizar_tel(telefono)
 where telefono <> delivery_normalizar_tel(telefono);

-- Registro e ingreso: mismas funciones que la 157, con el teléfono normalizado.
create or replace function public.delivery_registrar(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_nombre text := btrim(coalesce(p->>'nombre', ''));
  v_tel text := delivery_normalizar_tel(p->>'telefono');
  v_dir text := btrim(coalesce(p->>'direccion', ''));
  v_ref text := nullif(btrim(coalesce(p->>'referencias', '')), '');
  v_pin text := coalesce(p->>'pin', '');
  v_id bigint;
  v_token uuid;
begin
  if length(v_nombre) < 3 or length(v_nombre) > 80 then raise exception 'NOMBRE'; end if;
  if length(v_tel) < 8 or length(v_tel) > 15 then raise exception 'TELEFONO'; end if;
  if length(v_dir) < 4 or length(v_dir) > 200 then raise exception 'DIRECCION'; end if;
  if v_pin !~ '^\d{4}$' then raise exception 'PIN'; end if;
  if exists (select 1 from clientes_delivery where telefono = v_tel) then raise exception 'YA_EXISTE'; end if;
  if (select count(*) from clientes_delivery where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'SATURADO';
  end if;

  insert into clientes_delivery (telefono, nombre, direccion, referencias, pin_hash, ultimo_ingreso)
  values (v_tel, v_nombre, v_dir, left(v_ref, 200), crypt(v_pin, gen_salt('bf')), now())
  returning id into v_id;
  insert into sesiones_delivery (cliente_id) values (v_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'cliente', delivery_datos_cliente(v_id));
end $$;

create or replace function public.delivery_ingresar(p_telefono text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_tel text := delivery_normalizar_tel(p_telefono);
  c record;
  v_token uuid;
begin
  -- Los errores de ingreso VUELVEN como {"error": ...} en vez de RAISE: un
  -- RAISE deshace la llamada entera, contador de intentos incluido.
  select * into c from clientes_delivery where telefono = v_tel;
  if not found then return jsonb_build_object('error', 'NO_EXISTE'); end if;
  if c.bloqueado_hasta is not null and c.bloqueado_hasta > now() then
    return jsonb_build_object('error', 'BLOQUEADO');
  end if;
  if c.pin_hash <> crypt(coalesce(p_pin, ''), c.pin_hash) then
    update clientes_delivery
       set intentos_fallidos = case when intentos_fallidos + 1 >= 5 then 0 else intentos_fallidos + 1 end,
           bloqueado_hasta  = case when intentos_fallidos + 1 >= 5 then now() + interval '15 minutes' else bloqueado_hasta end
     where id = c.id;
    return jsonb_build_object('error', 'CLAVE');
  end if;
  update clientes_delivery set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_ingreso = now() where id = c.id;
  insert into sesiones_delivery (cliente_id) values (c.id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'cliente', delivery_datos_cliente(c.id));
end $$;

-- Red de seguridad: aunque algo escriba directo en la tabla, se guarda normalizado.
create or replace function public.clientes_delivery_tel_normalizado()
returns trigger language plpgsql as $$
begin
  new.telefono := delivery_normalizar_tel(new.telefono);
  return new;
end $$;
drop trigger if exists clientes_delivery_tel on public.clientes_delivery;
create trigger clientes_delivery_tel before insert or update of telefono on public.clientes_delivery
  for each row execute function public.clientes_delivery_tel_normalizado();

revoke all on function public.delivery_registrar(jsonb) from public;
revoke all on function public.delivery_ingresar(text, text) from public;
grant execute on function public.delivery_registrar(jsonb) to anon, authenticated;
grant execute on function public.delivery_ingresar(text, text) to anon, authenticated;
