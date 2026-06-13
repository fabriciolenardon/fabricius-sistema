-- ============================================================
-- MIGRACIÓN 32: Anti-duplicado en Caja Rápida
-- ============================================================
-- La pantalla de Caja (src/pages/admin/Caja.jsx) genera un UUID
-- por cobro y lo manda como `client_id` para garantizar idempotencia:
-- si el cajero hace doble click o si la red falla y reintenta, el
-- segundo intento pega contra esta UNIQUE y devuelve 23505, que el
-- front interpreta como "venta ya registrada".
--
-- Sin esta columna + índice, los inserts del front fallan con
-- "Could not find the 'client_id' column…" y NINGUNA venta se guarda.
-- ============================================================

alter table ventas_minoristas
  add column if not exists client_id text;

-- UNIQUE parcial: sólo aplica cuando hay client_id, así no rompe
-- las ventas históricas (origen='manual') que no traen este campo.
create unique index if not exists ux_ventas_minoristas_client_id
  on ventas_minoristas(client_id)
  where client_id is not null;
