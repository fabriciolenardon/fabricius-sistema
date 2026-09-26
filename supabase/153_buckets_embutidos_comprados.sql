-- ============================================================
-- 153 — Bucket propio para 5 embutidos que no tenían
-- ============================================================
-- Pedido de Fabricio (26/09/2026). Hasta hoy estos cinco no descontaban
-- stock: cuatro estaban marcados "no descuenta (comprado/reventa)" y el
-- salame envasado compartía bucket con el salame común sin envasar, así que
-- vender uno bajaba el stock del otro.
--
--   JAMON CRUDO          → emb_jamon_crudo
--   QUESO DE CERDO       → emb_queso_cerdo
--   ARROLLADO DE CERDO   → emb_arrollado_cerdo
--   CHORIZO CUNE         → emb_chorizo_cune
--   SALAME ENVASADO      → emb_salame_envasado   (antes emb_salame_comun)
--
-- Los buckets arrancan en 0 kg en las dos bocas. Las filas se crean acá y no
-- al primer movimiento a propósito: el selector de Precios ("de qué stock
-- sale") y el de Ingresos del depósito ("¿qué embutido ingresa?") leen los
-- tipos EXISTENTES de stock_actual, así que sin la fila el bucket no se puede
-- ni elegir ni cargar.
--
-- POR DÓNDE ENTRAN LOS KILOS (si no, es un bucket que sólo se debita y se va a
-- negativo, como pasó con 'cerdo_corte' y 'bovino_pieza'):
--   - los cuatro comprados: Depósito › Ingresos, tipo Embutido, eligiendo el
--     producto en "¿Qué embutido ingresa?" — ya aparecen ahí solos al tener
--     stock_origen emb_*;
--   - el salame envasado: no se compra, sale de envasar el común. Hasta que
--     exista un paso de "envasar", se pasa de un bucket al otro con Ajuste de
--     stock. La elaboración de salames sigue acreditando al común (que es lo
--     correcto: se elabora y recién después se envasa).
--
-- Idempotente.
-- ============================================================

-- 1) Las filas de stock, en 0, para cada boca que ya tenga embutidos propios.
insert into public.stock_actual (tipo, kg_disponible, sucursal_id)
select b.tipo, 0, s.sucursal_id
  from (values ('emb_jamon_crudo'), ('emb_queso_cerdo'), ('emb_arrollado_cerdo'),
               ('emb_chorizo_cune'), ('emb_salame_envasado')) as b(tipo)
  cross join (select distinct sucursal_id from public.stock_actual where tipo like 'emb_%') as s
on conflict (sucursal_id, tipo) do nothing;

-- 2) Enlazar cada producto con su bucket. Los cuatro comprados dejan de estar
--    marcados "no descuenta".
update public.precios set stock_origen='emb_jamon_crudo',     stock_no_aplica=false, updated_at=now() where sucursal_id is null and trim(nombre)='JAMON CRUDO';
update public.precios set stock_origen='emb_queso_cerdo',     stock_no_aplica=false, updated_at=now() where sucursal_id is null and trim(nombre)='QUESO DE CERDO';
update public.precios set stock_origen='emb_arrollado_cerdo', stock_no_aplica=false, updated_at=now() where sucursal_id is null and trim(nombre)='ARROLLADO DE CERDO';
update public.precios set stock_origen='emb_chorizo_cune',    stock_no_aplica=false, updated_at=now() where sucursal_id is null and trim(nombre)='CHORIZO CUNE';
update public.precios set stock_origen='emb_salame_envasado', stock_no_aplica=false, updated_at=now() where sucursal_id is null and trim(nombre)='SALAME ENVASADO';

-- Verificación: los 5 con su bucket propio, ninguno repetido.
SELECT trim(nombre) AS producto, stock_origen AS bucket
  FROM public.precios
 WHERE sucursal_id IS NULL
   AND trim(nombre) IN ('JAMON CRUDO','QUESO DE CERDO','ARROLLADO DE CERDO','CHORIZO CUNE','SALAME ENVASADO')
 ORDER BY 1;
