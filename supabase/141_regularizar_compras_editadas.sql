-- ============================================================
-- 141 — REGULARIZAR LAS COMPRAS QUE QUEDARON DESINCRONIZADAS
--       AL EDITAR UN INGRESO DEL DEPÓSITO
-- ============================================================
-- Una compra vive en 3 tablas paralelas:
--   entradas_deposito      (stock)
--   compras_proveedores    (dashboard "comprado esta semana")
--   movimientos_proveedores(cuenta corriente: a quién le debo)
-- y, si es media res o pieza, además en su ficha individual
-- (medias_stock.precio_costo_kg / piezas_stock.precio_costo_kg).
--
-- Hasta el fix de esta misma PR, editar un ingreso actualizaba SOLO
-- entradas_deposito. Las otras tres se quedaban con el número VIEJO.
--
-- Caso que lo destapó (07/09/2026): la media MR-486 se cargó a $101/kg,
-- se corrigió a $10.100 desde Ingresos, y quedó:
--   entrada  $1.084.740  ✅   ficha de la media   $101/kg   ❌
--   compra   $10.847,40  ❌   cta cte de EMANUEL  $10.847,40 ❌
-- → casi $1.074.000 de deuda subdeclarada en una sola línea.
--
-- La entrada es la fuente de verdad (es lo único que se puede editar
-- desde la app), así que este script la replica en las otras tablas.
-- Es IDEMPOTENTE: correrlo dos veces no cambia nada la segunda.
-- ============================================================

begin;

-- ── 1) compras_proveedores ← entradas_deposito ──────────────
update compras_proveedores c
set importe = e.importe,
    kg      = e.kg,
    fecha   = e.fecha
from entradas_deposito e
where c.entrada_id = e.id
  and e.eliminado = false
  and (c.importe is distinct from e.importe
    or c.kg      is distinct from e.kg
    or c.fecha   is distinct from e.fecha);

-- ── 2) movimientos_proveedores (cta cte) ← entradas_deposito ─
-- Solo los movimientos VIGENTES (los anulados quedan como están:
-- no suman al saldo y son historial).
update movimientos_proveedores m
set debe  = e.importe,
    fecha = e.fecha
from entradas_deposito e
where m.entrada_id = e.id
  and e.eliminado = false
  and coalesce(m.anulado, false) = false
  and e.importe > 0
  and (m.debe is distinct from e.importe or m.fecha is distinct from e.fecha);

-- ── 3) Saldo corriente del extracto (columna acumulada) ──────
-- Mismo criterio que recalcularSaldo() en src/lib/ctaProveedores.js:
-- orden fecha asc + id asc, los anulados no suman.
with recalculado as (
  select id,
         sum(case when coalesce(anulado, false) then 0
                  else coalesce(debe, 0) - coalesce(haber, 0) end)
           over (partition by proveedor_id order by fecha, id
                 rows between unbounded preceding and current row) as saldo_nuevo
  from movimientos_proveedores
  where proveedor_id is not null
)
update movimientos_proveedores m
set saldo = r.saldo_nuevo
from recalculado r
where r.id = m.id
  and m.saldo is distinct from r.saldo_nuevo;

-- ── 4) Ficha individual de la media res (MR-XXX) ─────────────
-- El costo/kg de la media es el que después costea los cortes al
-- despostar, así que un $101 acá ensucia el margen de toda la semana.
update medias_stock ms
set precio_costo_kg = e.precio_kg
from entradas_deposito e
where ms.entrada_id = e.id
  and e.eliminado = false
  and e.precio_kg > 0
  and ms.precio_costo_kg is distinct from e.precio_kg;

-- ── 5) Ficha individual de las piezas compradas directas ─────
update piezas_stock ps
set precio_costo_kg = e.precio_kg
from entradas_deposito e
where ps.entrada_id = e.id
  and e.eliminado = false
  and e.precio_kg > 0
  and ps.precio_costo_kg is distinct from e.precio_kg;

commit;

-- ── VERIFICACIÓN (debe devolver 0 filas) ────────────────────
-- select e.fecha, e.proveedor_nombre, e.descripcion, e.importe,
--        c.importe as compra, m.debe as cta_cte
-- from entradas_deposito e
-- left join compras_proveedores c on c.entrada_id = e.id
-- left join movimientos_proveedores m
--        on m.entrada_id = e.id and coalesce(m.anulado,false) = false
-- where e.eliminado = false and e.importe > 0
--   and (abs(coalesce(c.importe, e.importe) - e.importe) > 1
--     or abs(coalesce(m.debe,   e.importe) - e.importe) > 1);
