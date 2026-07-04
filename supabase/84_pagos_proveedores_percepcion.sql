-- ============================================================
-- MIGRACION 84: columna percepcion en pagos_proveedores
-- ============================================================
-- El Dashboard Ejecutivo consulta pagos_proveedores(importe,
-- percepcion, fecha) para los egresos del mes. La tabla en
-- produccion se creo antes de que 02_extensions.sql sumara la
-- columna, asi que la consulta devolvia 400 y los pagos a
-- proveedores quedaban en $0 dentro de los egresos.
-- APLICADA el 04/07/2026 via MCP (idempotente, re-correr es safe).
-- ============================================================

alter table pagos_proveedores
  add column if not exists percepcion numeric default 0;
