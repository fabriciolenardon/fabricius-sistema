-- ============================================================
-- 150 — Ingresar una media res en UNA sola operación
-- ============================================================
-- El 11/09/2026 el stock de bovino_mr quedó 175,20 kg abajo: dos entradas
-- se crearon y su fila en medias_stock nunca llegó a existir. El front
-- hacía los tres pasos sueltos (insert entrada → sumar stock → insert
-- media) y además se tragaba el error de la media con un console.warn.
-- Si el proceso se corta en el medio queda la entrada con el stock sumado
-- y sin media, y la invariante (bucket = suma de medias disponibles) se
-- rompe sin avisar a nadie.
--
-- Una función PL/pgSQL corre entera dentro de UNA transacción: o quedan
-- las tres cosas, o no queda ninguna. Ya no puede quedar a mitad de camino.
--
-- NO es security definer a propósito: corre con los permisos del que llama,
-- así que la RLS y el trigger de sucursal siguen mandando igual que antes.
--
-- Probado antes de conectarla:
--   · alta normal → entrada + stock + MR-XXX, todo OK
--   · alta con kg nulo (falla el insert de la media, que es NOT NULL) →
--     se revierte TODO: cero entradas huérfanas y el bucket intacto.
--     Ese es exactamente el caso que descuadró el stock.
-- ============================================================
create or replace function public.ingresar_media_res(
  p_fecha         date,
  p_proveedor     text,
  p_kg            numeric,
  p_kg_real       numeric,
  p_precio_kg     numeric,
  p_importe       numeric,
  p_descripcion   text,
  p_merma_tipo_id text default null,
  p_merma_pct     numeric default null,
  p_destino       text default 'DEPOSITO',
  p_cantidad      integer default 1
)
returns jsonb
language plpgsql
as $$
declare
  v_entrada_id uuid;
  v_suc        integer;
  v_kg_media   numeric;
  v_codigos    text[];
  i            integer;
  v_cod        text;
begin
  if coalesce(p_cantidad, 1) < 1 then
    raise exception 'La cantidad tiene que ser 1 o mas';
  end if;

  -- 1) La entrada. El trigger set_sucursal_id le pone la boca del usuario.
  insert into entradas_deposito (
    fecha, tipo, proveedor_nombre, kg, kg_real, precio_kg, importe,
    descripcion, merma_tipo_id, merma_pct, destino, cantidad, eliminado, despostada
  ) values (
    p_fecha, 'bovino_mr', p_proveedor, p_kg, p_kg_real, p_precio_kg, p_importe,
    p_descripcion, p_merma_tipo_id, p_merma_pct, coalesce(p_destino,'DEPOSITO'),
    coalesce(p_cantidad,1), false, false
  )
  returning id, sucursal_id into v_entrada_id, v_suc;

  -- 2) El bucket. Si la fila no existe todavía, se crea.
  insert into stock_actual (tipo, kg_disponible, sucursal_id)
  values ('bovino_mr', round(coalesce(p_kg_real,0), 3), v_suc)
  on conflict (tipo, sucursal_id) do update
    set kg_disponible = round(coalesce(stock_actual.kg_disponible,0) + coalesce(p_kg_real,0), 3);

  -- 3) La media (o varias, si la carga agrupa). El código MR-XXX lo genera
  --    la propia columna a partir del id.
  v_kg_media := coalesce(p_kg_real,0) / coalesce(p_cantidad,1);
  v_codigos := array[]::text[];
  for i in 1..coalesce(p_cantidad,1) loop
    insert into medias_stock (
      entrada_id, kg, proveedor_origen, fecha_ingreso, precio_costo_kg,
      descripcion, estado, merma_tipo_id
    ) values (
      -- entrada_id es UNIQUE: solo la primera lo lleva.
      case when i = 1 then v_entrada_id else null end,
      v_kg_media, p_proveedor, p_fecha, p_precio_kg,
      p_descripcion, 'disponible', p_merma_tipo_id
    )
    returning codigo into v_cod;
    v_codigos := v_codigos || v_cod;
  end loop;

  return jsonb_build_object(
    'entrada_id', v_entrada_id,
    'codigos', to_jsonb(v_codigos),
    'sucursal_id', v_suc
  );
end;
$$;

comment on function public.ingresar_media_res is
  'Ingresa una media res de forma ATOMICA: entrada + stock + medias_stock en una sola transaccion. Antes eran tres pasos sueltos desde el front y si se cortaba en el medio el stock quedaba descuadrado (11/09/2026: -175,20 kg). No es security definer: respeta la RLS del que llama.';

grant execute on function public.ingresar_media_res to authenticated;

-- APLICADA el 11/09/2026.
--
-- Control de la invariante (tiene que dar 0):
--   select (select kg_disponible from stock_actual where tipo='bovino_mr' and sucursal_id=1)
--        - (select sum(kg) from medias_stock where estado='disponible' and sucursal_id=1);
