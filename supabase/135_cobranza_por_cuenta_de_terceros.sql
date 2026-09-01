-- ============================================================
-- 135 — COBRANZA POR CUENTA DE TERCEROS (boletas de la franquicia)
-- ============================================================
-- Fabricio (01/09/2026). El circuito real:
--   1. Alvear le vende a SUS clientes (Carlos García, Shell, Cuisero…).
--   2. Fabricius le cobra a esos clientes: se carga un remito con un item
--      MANUAL "BOLETA CENTRO" (sin mercadería, para no descontar stock) que
--      suma a la cuenta corriente del cliente.
--   3. A Alvear se le descuenta ese total de lo que nos debe, con un pago
--      "BOLETAS MAYORISTAS" — así no hay traspaso de plata al pedo.
--
-- LA CUENTA CORRIENTE ESTÁ BIEN: la deuda simplemente se transfiere de
-- Alvear al cliente final; el total por cobrar de la central no cambia.
--
-- EL PROBLEMA ERA EL P&L. Ese remito contaba como VENTA nuestra y, al no
-- tener mercadería, no tenía costo: entraba como ganancia pura. Pero la
-- mercadería YA se había vendido (y facturado con su margen) cuando se la
-- vendimos a Alvear. O sea, doble conteo. Lo mismo del otro lado: el pago
-- "BOLETAS MAYORISTAS" se contaba como efectivo cobrado, cuando no entró un
-- peso de Alvear — la plata entra después, cuando paga el cliente final.
--
-- LA SOLUCIÓN: dos marcas nuevas, independientes de `cobro` y `tipo`.
--   · remitos.es_cobranza_terceros  → sigue generando cta cte, NO es venta.
--   · movimientos_ctacte.es_compensacion → baja la deuda, NO es cobranza.
-- Se eligieron banderas nuevas y no `cobro='interno'` porque ese valor
-- apaga la creación del movimiento de cta cte (Deposito.jsx ~5082), que es
-- justamente lo único que hay que conservar.
--
-- BACKFILL: SOLO AGOSTO/2026 y SOLO lo inequívoco — remitos donde TODOS los
-- items son manuales y TODOS dicen exactamente "BOLETA CENTRO"/"BOLETAS
-- CENTRO". Los ítems manuales se usan para muchas cosas más (ALQUILER,
-- bolsas, cloro, saldos iniciales) y hay remitos con mercadería REAL cuya
-- descripción también menciona "CENTRO" (VACIO CENTRO 8.365KG, LOMOS
-- CENTRO, BOLETA CENTRO NALGAS): esos NO se tocan, quedan como venta.
--   → 41 remitos, $6.795.080 · 5 pagos, $8.233.022
--
-- Los cierres YA GUARDADOS no cambian solos (son snapshots inmutables):
-- hay que recalcularlos desde la pantalla de Cierre para que tomen esto.
--
-- ⚠️ YA APLICADA: se corrió en la base el 01/09/2026. Idempotente.
-- ============================================================

-- 1) Las dos banderas. Aditivas y con DEFAULT: nada existente se altera.
ALTER TABLE remitos
  ADD COLUMN IF NOT EXISTS es_cobranza_terceros boolean NOT NULL DEFAULT false;

ALTER TABLE movimientos_ctacte
  ADD COLUMN IF NOT EXISTS es_compensacion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN remitos.es_cobranza_terceros IS
  'Cobranza por cuenta de un tercero (boletas de la franquicia): genera cuenta corriente pero NO cuenta como venta nuestra.';
COMMENT ON COLUMN movimientos_ctacte.es_compensacion IS
  'Compensación contra la deuda (no entró plata): baja el saldo pero NO cuenta como cobranza.';

-- 2) Backfill agosto/2026 — remitos passthrough (criterio estricto).
UPDATE remitos r SET es_cobranza_terceros = true
WHERE coalesce(r.eliminado,false) = false
  AND r.sucursal_id = 1
  AND r.fecha BETWEEN '2026-08-01' AND '2026-08-31'
  AND jsonb_typeof(r.items) = 'array'
  AND jsonb_array_length(r.items) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r.items) i
    WHERE (i->>'manual')::boolean IS NOT TRUE
       OR upper(trim(i->>'descripcion')) NOT IN ('BOLETA CENTRO', 'BOLETAS CENTRO')
  );

-- 3) Backfill agosto/2026 — pagos "BOLETAS MAYORISTAS" de las franquicias.
--    Solo se toca esta bandera: debe/haber/saldo quedan intactos.
UPDATE movimientos_ctacte m SET es_compensacion = true
FROM clientes c
WHERE c.id = m.cliente_id
  AND coalesce(c.es_franquicia, false)
  AND m.tipo = 'pago'
  AND upper(m.descripcion) LIKE '%BOLETAS MAYORISTAS%'
  AND m.fecha BETWEEN '2026-08-01' AND '2026-08-31';


-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'remitos marcados' AS control, count(*)::text AS cant, sum(total)::text AS total
  FROM remitos WHERE es_cobranza_terceros
UNION ALL
SELECT 'pagos marcados', count(*)::text, sum(haber)::text
  FROM movimientos_ctacte WHERE es_compensacion;
-- Esperado agosto: 41 remitos / $6.795.080 · 5 pagos / $8.233.022
