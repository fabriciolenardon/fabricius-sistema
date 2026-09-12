-- ============================================================
-- 151 — Bondiola Fiambre y Panceta Fiambre: stock propio
-- ============================================================
-- Pedido de Fabricio (12/09/2026). Los dos se elaboran como el salame: salen
-- de la pieza de cerdo que se elija, maduran con candado (no suman al stock
-- hasta que se pesa el producto final) y recién ahí entran a su bucket.
--
-- La ELABORACIÓN es solo de la central: la sucursal no ve la solapa de
-- embutidos/salames (ver Deposito.jsx, selector de tipoElaboracion). Por eso
-- acá solo se crea el bucket de la sucursal 1. Si alguna vez la central le
-- despacha fiambre a una boca, el bucket de esa boca nace solo al sumarle
-- (trigger set_sucursal_id + actualizarStock).
--
-- Los dos productos ya existían en la lista de precios (categoría embutido)
-- con stock_origen NULL: se vendían sin descontar nada de ningún lado.
-- Verificado antes de aplicar: nunca se vendió ninguno de los dos por caja,
-- así que engancharlos no deja ningún bucket en negativo retroactivo.
-- ============================================================

-- 1. Los buckets de la central, en 0.
insert into stock_actual (tipo, kg_disponible, sucursal_id)
select v.t, 0, 1
from (values ('emb_bondiola_fiambre'), ('emb_panceta_fiambre')) as v(t)
where not exists (
  select 1 from stock_actual s where s.tipo = v.t and s.sucursal_id = 1
);

-- 2. Enganchar cada producto de la lista a su bucket.
--    Se matchea por nombre porque el id es generado (no se hardcodea), pero
--    el bloque aborta si el nombre no identifica EXACTAMENTE una fila — que
--    es la trampa de matchear por atributos (ver CLAUDE.md).
do $$
declare
  n int;
begin
  update precios set stock_origen = 'emb_bondiola_fiambre', updated_at = now()
  where upper(trim(nombre)) = 'BONDIOLA EMBUTIDO' and categoria = 'embutido';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'BONDIOLA EMBUTIDO: esperaba 1 fila, actualicé %', n;
  end if;

  update precios set stock_origen = 'emb_panceta_fiambre', updated_at = now()
  where upper(trim(nombre)) = 'PANCETA EMBUTIDO' and categoria = 'embutido';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'PANCETA EMBUTIDO: esperaba 1 fila, actualicé %', n;
  end if;
end $$;
