-- ============================================================
-- 08_piezas_stock.sql
-- Tabla de seguimiento individual de cada pieza generada por
-- un desposte en piezas. Permite trazabilidad completa:
--   - de qu� media res sali�
--   - cu�ndo entr� al stock
--   - qu� se hizo con ella (convertida a cortes / vendida)
--   - a qui�n se vendi� y a qu� precio
-- ============================================================

CREATE TABLE IF NOT EXISTS piezas_stock (
  id              BIGSERIAL PRIMARY KEY,

  -- Origen: de qu� desposte y de qu� media res sali� la pieza
  desposte_id     BIGINT REFERENCES despostes(id) ON DELETE SET NULL,
  entrada_id     BIGINT REFERENCES entradas_deposito(id) ON DELETE SET NULL,

  -- Datos de la pieza
  tipo_pieza      TEXT NOT NULL,        -- 'Cuarto Pistola', 'Pierna', 'Costillar Completo', etc.
  tipo_stock      TEXT,                  -- categor�a para stock agregado (ej. 'bovino_pieza')
  kg              NUMERIC(10,2) NOT NULL,
  precio_costo_kg NUMERIC(12,2),         -- heredado de la media res de origen
  fecha_ingreso   DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Datos denormalizados de origen (para mostrar r�pido sin joins)
  proveedor_origen     TEXT,
  descripcion_origen   TEXT,              -- ej. "MR ANGUS 142 kg"
  modelo_desposte      TEXT,              -- 'A' / 'B' / 'C'

  -- Estado y ciclo de vida
  estado          TEXT NOT NULL DEFAULT 'disponible',
                  -- 'disponible' | 'convertida_cortes' | 'vendida' | 'anulada'
  destino         TEXT,                   -- 'cortes' | 'franquicia' | 'mayorista' | 'minorista' | 'carniceria'
  cliente_id      BIGINT,                  -- FK opcional (no forzamos en DDL por compat con clientes)
  cliente_nombre  TEXT,
  precio_venta_kg NUMERIC(12,2),
  total_venta     NUMERIC(14,2),
  fecha_salida    DATE,
  notas_salida    TEXT,

  -- Notas y timestamps
  notas       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT piezas_stock_kg_pos CHECK (kg > 0),
  CONSTRAINT piezas_stock_estado_chk CHECK (estado IN ('disponible', 'convertida_cortes', 'vendida', 'anulada'))
);

-- �ndices �tiles para la UI
CREATE INDEX IF NOT EXISTS piezas_stock_estado_idx       ON piezas_stock (estado);
CREATE INDEX IF NOT EXISTS piezas_stock_tipo_pieza_idx   ON piezas_stock (tipo_pieza);
CREATE INDEX IF NOT EXISTS piezas_stock_entrada_id_idx   ON piezas_stock (entrada_id);
CREATE INDEX IF NOT EXISTS piezas_stock_desposte_id_idx  ON piezas_stock (desposte_id);
CREATE INDEX IF NOT EXISTS piezas_stock_fecha_ingreso_idx ON piezas_stock (fecha_ingreso DESC);

-- Trigger para mantener updated_at
CREATE OR REPLACE FUNCTION trg_piezas_stock_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS piezas_stock_set_updated_at ON piezas_stock;
CREATE TRIGGER piezas_stock_set_updated_at
  BEFORE UPDATE ON piezas_stock
  FOR EACH ROW EXECUTE FUNCTION trg_piezas_stock_set_updated_at();

-- RLS: por ahora abierto a usuarios autenticados (alineado con el resto del esquema)
ALTER TABLE piezas_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS piezas_stock_select_authenticated ON piezas_stock;
CREATE POLICY piezas_stock_select_authenticated
  ON piezas_stock FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS piezas_stock_insert_authenticated ON piezas_stock;
CREATE POLICY piezas_stock_insert_authenticated
  ON piezas_stock FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS piezas_stock_update_authenticated ON piezas_stock;
CREATE POLICY piezas_stock_update_authenticated
  ON piezas_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS piezas_stock_delete_authenticated ON piezas_stock;
CREATE POLICY piezas_stock_delete_authenticated
  ON piezas_stock FOR DELETE TO authenticated USING (true);

-- ============================================================
-- Listo. Pod�s verificar con:
--   SELECT count(*) FROM piezas_stock;
-- ============================================================
