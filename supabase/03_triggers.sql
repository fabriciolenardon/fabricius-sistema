-- Triggers y funciones de negocio

-- Recalcular saldo de cliente desde movimientos_ctacte
create or replace function public.recalcular_saldo_cliente(p_cliente_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
begin
  if p_cliente_id is null then
    return;
  end if;
  select coalesce(sum(debe), 0) - coalesce(sum(haber), 0)
  into v_saldo
  from movimientos_ctacte
  where cliente_id = p_cliente_id;

  update clientes set saldo = coalesce(v_saldo, 0) where id = p_cliente_id;
end;
$$;

create or replace function public.trg_movimientos_ctacte_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid int;
begin
  cid := coalesce(new.cliente_id, old.cliente_id);
  perform public.recalcular_saldo_cliente(cid);
  return coalesce(new, old);
end;
$$;

drop trigger if exists movimientos_ctacte_saldo on movimientos_ctacte;
create trigger movimientos_ctacte_saldo
  after insert or update or delete on movimientos_ctacte
  for each row execute function public.trg_movimientos_ctacte_saldo();

-- Actualizar saldo en fila del movimiento (compatibilidad con UI que muestra saldo por línea)
create or replace function public.trg_movimientos_ctacte_saldo_fila()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cliente_id is not null then
    select saldo into new.saldo from clientes where id = new.cliente_id;
  end if;
  return new;
end;
$$;

drop trigger if exists movimientos_ctacte_saldo_fila on movimientos_ctacte;
create trigger movimientos_ctacte_saldo_fila
  before insert or update on movimientos_ctacte
  for each row execute function public.trg_movimientos_ctacte_saldo_fila();

-- Realtime: habilitar tabla remitos en Supabase Dashboard > Database > Replication
