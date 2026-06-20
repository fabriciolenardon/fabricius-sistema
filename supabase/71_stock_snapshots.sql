-- =====================================================
-- MIGRACION 71: SNAPSHOT DE STOCK AL CIERRE DE SEMANA
-- =====================================================
-- Guarda una "foto" del stock al cerrar cada semana (domingo), para que el
-- Control Semanal pueda mostrar el stock que quedó en semanas PASADAS
-- (stock_actual solo tiene el valor en vivo de HOY).
-- Una fila por fecha de cierre.
-- =====================================================

CREATE TABLE IF NOT EXISTS stock_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL UNIQUE,          -- fecha de cierre (domingo)
  stock       JSONB NOT NULL,                -- [{ tipo, kg }]
  creado_por  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_snapshots_admin ON stock_snapshots;
CREATE POLICY stock_snapshots_admin ON stock_snapshots
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE stock_snapshots IS 'Foto del stock_actual al cierre de cada semana (para el Control Semanal histórico).';
