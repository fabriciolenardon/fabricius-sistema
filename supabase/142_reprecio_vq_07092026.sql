-- ============================================================
-- 142 — REPRECIO DE LAS 8 VAQUILLONAS B-2 DEL 07/09/2026
-- ============================================================
-- Pedido de Fabricio (08/09/2026). Dos patas:
--
-- COMPRA (EMANUEL SARAVIA): las 8 medias VAQUILLONA B-2 que entraron el
--   lunes 07/09 pasan de $10.100/kg a $9.750/kg.
--     MR-479 a MR-486 · 885,20 kg
--     $8.940.520 → $8.630.700   (la deuda con Emanuel baja $309.820)
--
-- VENTA (franquicias): las 3 de esas medias que salieron enteras pasan de
--   $10.700/kg a $10.250/kg.
--     Remito 02144 · ALVEAR       · MR-482 · 114,4 kg
--     Remito 02145 · MONTE CRISTO · MR-483 · 108,4 kg
--     Remito 02166 · MONTE CRISTO · MR-486 · 107,4 kg
--     ALVEAR       −$51.480   ·  MONTE CRISTO −$97.110
--
-- Se concilian TODAS las puntas: entradas_deposito, compras_proveedores,
-- movimientos_proveedores (+ saldo), medias_stock, remitos (items + total),
-- movimientos_ctacte (+ saldo) y clientes.saldo.
-- Los remitos NO tienen factura ARCA emitida ni salida_id, y la semana
-- 07→13/09 todavía no está cerrada: no hay snapshot que rehacer.
-- ============================================================

begin;

-- ══ PARTE A · COMPRA A EMANUEL: 8 VQ a $9.750/kg ═══════════

update entradas_deposito
set precio_kg = 9750,
    importe   = kg * 9750
where fecha = '2026-09-07'
  and descripcion = 'MEDIA RES VAQUILLONA B-2'
  and eliminado = false
  and precio_kg = 10100;

-- Las otras tres puntas de la compra se sincronizan CONTRA la entrada
-- (mismo criterio que la mig 141: la entrada es la fuente de verdad).
update compras_proveedores c
set importe = e.importe, kg = e.kg, fecha = e.fecha
from entradas_deposito e
where c.entrada_id = e.id and e.eliminado = false
  and e.fecha = '2026-09-07' and e.descripcion = 'MEDIA RES VAQUILLONA B-2'
  and (c.importe is distinct from e.importe or c.kg is distinct from e.kg);

update movimientos_proveedores m
set debe = e.importe
from entradas_deposito e
where m.entrada_id = e.id and e.eliminado = false
  and coalesce(m.anulado, false) = false
  and e.fecha = '2026-09-07' and e.descripcion = 'MEDIA RES VAQUILLONA B-2'
  and m.debe is distinct from e.importe;

update medias_stock ms
set precio_costo_kg = e.precio_kg
from entradas_deposito e
where ms.entrada_id = e.id and e.eliminado = false
  and e.fecha = '2026-09-07' and e.descripcion = 'MEDIA RES VAQUILLONA B-2'
  and ms.precio_costo_kg is distinct from e.precio_kg;

-- Saldo corriente del extracto de proveedores (fecha asc, id asc; los
-- anulados no suman) — igual que recalcularSaldo() de ctaProveedores.js.
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
where r.id = m.id and m.saldo is distinct from r.saldo_nuevo;

-- ══ PARTE B · VENTA A LAS FRANQUICIAS: 3 medias a $10.250/kg ═

-- Remito 02144 · ALVEAR CARNICERIA · MR-482 (114,4 kg)
update remitos r
set items = sub.nuevos, total = 1665590
from (
  select r2.id, jsonb_agg(
    case when it->>'media_res_id' = '06a572ec-7334-408c-bad9-4641039cb01b'
         then it || jsonb_build_object('precio', 10250, 'importe', ((it->>'kg')::numeric * 10250)::bigint)
         else it end order by ord) as nuevos
  from remitos r2, lateral jsonb_array_elements(r2.items) with ordinality as t(it, ord)
  where r2.id = '0bb5c6ed-86d1-4604-b0f9-2b4c2453d047'
  group by r2.id
) sub
where r.id = sub.id;

-- Remito 02145 · MONTE CRISTO CARNICERIA · MR-483 (108,4 kg)
update remitos r
set items = sub.nuevos, total = 2128000.4
from (
  select r2.id, jsonb_agg(
    case when it->>'media_res_id' = 'f53f3dd0-6b66-4c36-aeab-6aa3d6cadf71'
         then it || jsonb_build_object('precio', 10250, 'importe', ((it->>'kg')::numeric * 10250)::bigint)
         else it end order by ord) as nuevos
  from remitos r2, lateral jsonb_array_elements(r2.items) with ordinality as t(it, ord)
  where r2.id = '4a6bbd43-0311-4221-844c-1f970c425f5f'
  group by r2.id
) sub
where r.id = sub.id;

-- Remito 02166 · MONTE CRISTO CARNICERIA · MR-486 (107,4 kg)
update remitos r
set items = sub.nuevos, total = 1100850
from (
  select r2.id, jsonb_agg(
    case when it->>'media_res_id' = '8891c4a4-f1d8-475b-9f35-c6a15f8304ea'
         then it || jsonb_build_object('precio', 10250, 'importe', ((it->>'kg')::numeric * 10250)::bigint)
         else it end order by ord) as nuevos
  from remitos r2, lateral jsonb_array_elements(r2.items) with ordinality as t(it, ord)
  where r2.id = '32949977-4f6b-46ba-9f8e-f84874dadcae'
  group by r2.id
) sub
where r.id = sub.id;

-- Cuenta corriente de las franquicias: el DEBE del remito sigue al total.
update movimientos_ctacte m
set debe = r.total
from remitos r
where m.remito_id = r.id
  and r.id in ('0bb5c6ed-86d1-4604-b0f9-2b4c2453d047',
               '4a6bbd43-0311-4221-844c-1f970c425f5f',
               '32949977-4f6b-46ba-9f8e-f84874dadcae')
  and m.debe is distinct from r.total;

-- Saldo corriente del extracto de clientes (fecha asc, created_at asc) —
-- igual que recomputarSaldoCliente() de ctaCorriente.js.
with recalculado as (
  select id,
         sum(coalesce(debe, 0) - coalesce(haber, 0))
           over (partition by cliente_id order by fecha, created_at, id
                 rows between unbounded preceding and current row) as saldo_nuevo
  from movimientos_ctacte
  where cliente_id in ('da8afe23-42dc-4021-90cf-7653e2c0fb48',
                       '716e69a6-c1ec-41fd-83f2-ad9de51d9f04')
)
update movimientos_ctacte m
set saldo = r.saldo_nuevo
from recalculado r
where r.id = m.id and m.saldo is distinct from r.saldo_nuevo;

-- Y el saldo cacheado en la ficha del cliente = Σdebe − Σhaber.
update clientes c
set saldo = t.total
from (
  select cliente_id, sum(coalesce(debe, 0) - coalesce(haber, 0)) as total
  from movimientos_ctacte
  where cliente_id in ('da8afe23-42dc-4021-90cf-7653e2c0fb48',
                       '716e69a6-c1ec-41fd-83f2-ad9de51d9f04')
  group by cliente_id
) t
where c.id = t.cliente_id;

commit;

-- ── AÑADIDO · el desposte a kilo de MR-479 ──────────────────
-- MR-479 se despostó "a kilo" el 07/09 y el desposte congela el costo del
-- kilo neto (precio_kg / (1 - merma)) dentro de despostes.piezas. Con el
-- precio viejo daba $13.968/kg; con $9.750 de costo y 27,69% de merma da
-- $13.484/kg. Es el número que Reportes usa para costear "Bovino cortes
-- por kilo", así que también hay que bajarlo.
update despostes d
set piezas = (
  select jsonb_agg(
    case when p ? 'precio_costo_kg'
         then p || jsonb_build_object('precio_costo_kg', round(9750 / (1 - d.merma_pct/100)))
         else p end order by ord)
  from jsonb_array_elements(d.piezas) with ordinality as t(p, ord)
)
where d.entrada_id = '922d398c-cf0c-47fb-8d6d-a807ab41376a';
