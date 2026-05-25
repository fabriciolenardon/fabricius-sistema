-- ============================================================
-- MIGRACIÓN 34: Tracking individual de Cajas Bovinas (CB y PT)
-- ============================================================
-- Hasta ahora las Cajas CB/PT se trackeaban como un total kg en
-- stock_actual.caja_cb / caja_pt, lo cual no permitía saber cuántas
-- cajas hay ni cuánto pesa cada una.
--
-- Esta tabla replica el patrón de `piezas_stock`: cada caja física
-- es una fila con su peso, fecha de ingreso, proveedor de origen y
-- su estado (disponible / vendida). Al vender se elige una caja
-- específica del stock — el sistema ya no trabaja con "kg totales"
-- sino con cajas reales identificables.
--
-- Compatibilidad: stock_actual.caja_cb / caja_pt se sigue actualizando
-- (sum kg de cajas disponibles) para que los displays del dashboard y
-- las alertas existentes sigan funcionando sin cambios.
-- ============================================================

CREATE TABLE IF NOT EXISTS cajas_stock (
  id                  SERIAL PRIMARY KEY,
  tipo_caja           TEXT NOT NULL CHECK (tipo_caja IN ('CB', 'PT')),
  kg                  NUMERIC NOT NULL CHECK (kg > 0),
  fecha_ingreso       DATE NOT NULL DEFAULT CURRENT_DATE,
  proveedor_origen    TEXT,
  descripcion_origen  TEXT,             -- lote, marca, nº de bulto, etc.
  precio_costo_kg     NUMERIC,
  -- entradas_deposito.id es UUID en producción (aunque el schema canónico
  -- dice serial). Usamos UUID sin FK explícita, mismo patrón que la
  -- migración 30_rol_desposte.sql, para evitar el error
  -- "integer and uuid are of incompatible types".
  entrada_id          UUID,
  -- Estado y trazabilidad de salida
  estado              TEXT NOT NULL DEFAULT 'disponible'
                      CHECK (estado IN ('disponible', 'vendida', 'anulada')),
  destino             TEXT,             -- 'MITRE', 'CENTRO', 'mayorista', etc.
  cliente_id          UUID,
  cliente_nombre      TEXT,
  precio_venta_kg     NUMERIC,
  total_venta         NUMERIC,
  fecha_salida        DATE,
  notas_salida        TEXT,
  -- Trazabilidad del registro
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries comunes
CREATE INDEX IF NOT EXISTS idx_cajas_stock_tipo_estado
  ON cajas_stock(tipo_caja, estado);
CREATE INDEX IF NOT EXISTS idx_cajas_stock_fecha
  ON cajas_stock(fecha_ingreso DESC);
CREATE INDEX IF NOT EXISTS idx_cajas_stock_cliente
  ON cajas_stock(cliente_id, fecha_salida DESC);

COMMENT ON TABLE cajas_stock IS
'Tracking individual de cada caja CB/PT. Una fila = una caja física con su peso propio. Reemplaza el conteo agregado de stock_actual.caja_cb / caja_pt para el flujo de venta (que ahora requiere seleccionar una caja específica del stock).';

-- ============================================================
-- RLS: igual que piezas_stock — cualquier rol autenticado puede leer/escribir
-- (la app maneja la lógica de quién puede qué en JS).
-- ============================================================
ALTER TABLE cajas_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cajas_stock_all ON cajas_stock;
CREATE POLICY cajas_stock_all ON cajas_stock FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- VERIFICACIÓN: la tabla debería estar vacía después de la migración.
-- El admin va a empezar a cargar cajas individualmente desde el form
-- de Entradas a partir de ahora. El stock viejo en stock_actual.caja_cb /
-- caja_pt queda como referencia histórica.
-- ============================================================
SELECT
  (SELECT COUNT(*) FROM cajas_stock WHERE tipo_caja = 'CB') AS cajas_cb_individuales,
  (SELECT COUNT(*) FROM cajas_stock WHERE tipo_caja = 'PT') AS cajas_pt_individuales,
  (SELECT kg_disponible FROM stock_actual WHERE tipo = 'caja_cb') AS legacy_kg_cb,
  (SELECT kg_disponible FROM stock_actual WHERE tipo = 'caja_pt') AS legacy_kg_pt;
