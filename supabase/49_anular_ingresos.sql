-- Anulación (soft-delete) de ingresos de depósito. Antes el borrado de una
-- entrada hacía un DELETE físico: desaparecía sin rastro y dejaba piezas
-- huérfanas en piezas_stock. Ahora la entrada se marca anulada (eliminado +
-- por quién/cuándo), se revierte el stock, se anulan sus piezas individuales
-- (estado='anulada' + anulada_por/en) y se anula el movimiento de cuenta
-- corriente del proveedor (que queda visible marcado anulado, sin sumar deuda).
ALTER TABLE entradas_deposito ADD COLUMN IF NOT EXISTS eliminado boolean DEFAULT false;
ALTER TABLE entradas_deposito ADD COLUMN IF NOT EXISTS eliminado_por text;
ALTER TABLE entradas_deposito ADD COLUMN IF NOT EXISTS eliminado_en timestamptz;

ALTER TABLE piezas_stock ADD COLUMN IF NOT EXISTS anulada_por text;
ALTER TABLE piezas_stock ADD COLUMN IF NOT EXISTS anulada_en timestamptz;

ALTER TABLE movimientos_proveedores ADD COLUMN IF NOT EXISTS anulado boolean DEFAULT false;
ALTER TABLE movimientos_proveedores ADD COLUMN IF NOT EXISTS anulado_por text;
ALTER TABLE movimientos_proveedores ADD COLUMN IF NOT EXISTS anulado_en timestamptz;

-- compras_proveedores: la compra anulada queda visible en "Buscar remitos de
-- ingreso" marcada anulada (no se borra) y deja de sumar a los totales.
ALTER TABLE compras_proveedores ADD COLUMN IF NOT EXISTS anulado boolean DEFAULT false;
ALTER TABLE compras_proveedores ADD COLUMN IF NOT EXISTS anulado_por text;
ALTER TABLE compras_proveedores ADD COLUMN IF NOT EXISTS anulado_en timestamptz;
