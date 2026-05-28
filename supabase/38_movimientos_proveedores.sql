-- ============================================================
-- MIGRACIÓN 38: Cuenta corriente de proveedores (DEBE/HABER/SALDO)
-- ============================================================
-- Espejo del modelo de clientes (movimientos_ctacte). Reemplaza el
-- modelo de liquidación semanal manual (pagos_proveedores_semanal con
-- saldo_anterior arrastrado a mano) por un libro mayor profesional.
--
-- Lógica de signos (desde NUESTRA perspectiva — lo que le debemos al prov):
--   - COMPRA        → DEBE  (aumenta lo que le debemos al proveedor)
--   - PAGO/ENTREGA  → HABER (reduce lo que le debemos)
--   - SALDO_INICIAL → DEBE si arrancamos debiéndole, HABER si a favor
--   - AJUSTE        → DEBE o HABER según corrija
--
-- saldo (corriente, después de cada movimiento) = Σ debe − Σ haber
--   saldo > 0  → le DEBEMOS al proveedor
--   saldo < 0  → tenemos SALDO A FAVOR (le pagamos de más / adelantado)
--   saldo = 0  → al día
--
-- El saldo corriente del proveedor se replica en proveedores.saldo_adeudado
-- (columna ya existente) para mostrar el saldo en la lista sin recalcular.
-- ============================================================

CREATE TABLE IF NOT EXISTS movimientos_proveedores (
  id              SERIAL PRIMARY KEY,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  proveedor_id    INT REFERENCES proveedores(id) ON DELETE CASCADE,
  proveedor_nombre TEXT,                          -- denormalizado para display
  tipo            TEXT NOT NULL DEFAULT 'compra'
                  CHECK (tipo IN ('compra', 'pago', 'ajuste', 'saldo_inicial')),
  descripcion     TEXT,
  debe            NUMERIC DEFAULT 0,              -- compra / lo que aumenta la deuda
  haber           NUMERIC DEFAULT 0,              -- pago / lo que la reduce
  saldo           NUMERIC DEFAULT 0,              -- saldo corriente tras este movimiento
  -- Trazabilidad
  entrada_id      INT,                            -- link al remito de ingreso (entradas_deposito.id) si aplica
  forma           TEXT,                           -- efectivo / transferencia / cheque (para pagos)
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mov_prov_proveedor ON movimientos_proveedores(proveedor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mov_prov_fecha ON movimientos_proveedores(fecha DESC);

COMMENT ON TABLE movimientos_proveedores IS
'Cuenta corriente de proveedores (libro mayor DEBE/HABER/SALDO). Reemplaza la liquidación semanal manual. Compra=debe, pago/entrega=haber, saldo>0=le debemos, saldo<0=a favor nuestro.';

-- RLS: igual que el resto, la app maneja la lógica de permisos en JS
ALTER TABLE movimientos_proveedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movimientos_proveedores_all ON movimientos_proveedores;
CREATE POLICY movimientos_proveedores_all ON movimientos_proveedores FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
  (SELECT COUNT(*) FROM movimientos_proveedores) AS movimientos_cargados,
  (SELECT COUNT(*) FROM proveedores WHERE activo = true) AS proveedores_activos;
