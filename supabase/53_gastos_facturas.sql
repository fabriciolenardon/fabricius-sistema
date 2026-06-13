-- 53_gastos_facturas.sql
-- Gastos con factura: adjuntar comprobante (imagen/PDF) + discriminar IVA
-- para presentar en el balance de la SAS. Un gasto es UNO solo: aparece en la
-- pestaña normal y en la pestaña "Con factura" (no se duplica el monto).

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS tiene_factura  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS factura_path   text,    -- ruta en bucket storage 'facturas'
  ADD COLUMN IF NOT EXISTS factura_nombre text,    -- nombre original del archivo
  ADD COLUMN IF NOT EXISTS factura_mime   text,    -- image/jpeg, image/png, application/pdf
  ADD COLUMN IF NOT EXISTS fecha_emision  date,    -- fecha que figura en la factura
  ADD COLUMN IF NOT EXISTS neto    numeric,         -- importe neto (sin IVA)
  ADD COLUMN IF NOT EXISTS iva     numeric,         -- monto de IVA
  ADD COLUMN IF NOT EXISTS iva_pct numeric,         -- alícuota: 21, 10.5, 27, 0
  ADD COLUMN IF NOT EXISTS proveedor   text,        -- razón social del proveedor
  ADD COLUMN IF NOT EXISTS comprobante text;        -- tipo/nro de comprobante (opcional)

CREATE INDEX IF NOT EXISTS idx_gastos_tiene_factura ON gastos (tiene_factura, fecha_emision);
