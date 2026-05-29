-- ============================================================
-- MIGRACIÓN 39: nombre del admin que aprobó/rechazó el flujo
-- ============================================================
-- flujo_deposito ya guarda aprobado_por (uuid del admin) pero no su
-- nombre. Para mostrar en el sector desposte "Aprobada por Fabricio"
-- sin tener que joinear contra profiles (que el rol desposte no puede
-- leer por RLS), guardamos el nombre como snapshot al aprobar/rechazar.
-- ============================================================

ALTER TABLE flujo_deposito
  ADD COLUMN IF NOT EXISTS aprobado_por_nombre TEXT;

COMMENT ON COLUMN flujo_deposito.aprobado_por_nombre IS
'Nombre del admin que aprobó/rechazó el flujo (snapshot). Para mostrar en el sector desposte sin joinear profiles.';

-- Verificación
SELECT COUNT(*) AS flujos, COUNT(aprobado_por_nombre) AS con_nombre_admin
FROM flujo_deposito;
