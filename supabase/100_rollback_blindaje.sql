-- ============================================================
-- 100 ROLLBACK — deshacer el blindaje de las tablas compartidas
-- ============================================================
-- Vuelve al estado anterior a la 100: las sucursales vuelven a poder escribir
-- `precios`, `config_sistema` y `profiles` (y a ver todos los perfiles).
--
-- Correr SOLO si algo quedó bloqueado que no debía. Antes de correrlo, mirar
-- qué policy está negando: casi siempre alcanza con ajustar una sola en vez de
-- soltar las cuatro tablas.
-- ============================================================

DROP POLICY IF EXISTS profiles_lectura_acotada ON profiles;
DROP POLICY IF EXISTS profiles_insert_central  ON profiles;
DROP POLICY IF EXISTS profiles_update_central  ON profiles;
DROP POLICY IF EXISTS profiles_delete_central  ON profiles;

DROP POLICY IF EXISTS precios_insert_central ON precios;
DROP POLICY IF EXISTS precios_update_central ON precios;
DROP POLICY IF EXISTS precios_delete_central ON precios;

DROP POLICY IF EXISTS config_insert_central ON config_sistema;
DROP POLICY IF EXISTS config_update_central ON config_sistema;
DROP POLICY IF EXISTS config_delete_central ON config_sistema;

DROP POLICY IF EXISTS precios_sucursal_aislamiento ON precios_sucursal;

-- La función queda: no molesta a nadie y la usa el resto de la migración.
-- DROP FUNCTION IF EXISTS es_central();
