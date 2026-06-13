-- 55_cheques_emitidos.sql
-- Cheques EMITIDOS PROPIOS: cheques que Fabricius entrega a proveedores/terceros.
-- Cuando llega la fecha de pago hay que "levantar" el cheque (tener los fondos
-- en la cuenta). El botón "Imputar" marca que el gasto quedó cubierto.
--
--   origen  = 'recibido' (los de siempre, de clientes) | 'emitido' (propios)
--   estado  = 'pendiente' | 'imputado'  (solo aplica a emitidos)
--   Para emitidos: fecha_recepcion = fecha de emisión, proveedor_nombre =
--   beneficiario, cliente_id/destino quedan NULL.

ALTER TABLE cheques
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'recibido',
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS fecha_imputado date;

DO $$ BEGIN
  ALTER TABLE cheques ADD CONSTRAINT cheques_origen_check CHECK (origen IN ('recibido', 'emitido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cheques ADD CONSTRAINT cheques_estado_check CHECK (estado IN ('pendiente', 'imputado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cheques_emitidos ON cheques (origen, estado, fecha_pago);
