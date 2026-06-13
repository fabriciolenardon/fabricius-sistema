-- ═══════════════════════════════════════════════════════════
-- TABLA DE GASTOS — Carnicerías Fabricius
-- Pegar esto en Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  monto NUMERIC NOT NULL,
  categoria TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  sucursal TEXT,
  creado_por TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índice para acelerar búsquedas por fecha
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha DESC);

-- Índice para búsquedas por categoría
CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos(categoria);
