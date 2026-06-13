-- ============================================================
-- MIGRACIÓN 25: Rol "cajero"
-- ============================================================
-- Agrega 'cajero' como rol válido en profiles.
-- Los cajeros solo ven la pantalla de Caja Rápida (Vender, Historial, Arqueo).
-- No tienen acceso al resto del panel admin (Dashboard, Depósito, Precios, etc.)
--
-- Para crear un usuario cajero:
--   1) Crear el usuario en Supabase Auth (dashboard o api)
--   2) Insertar el profile manualmente:
--      insert into profiles (id, nombre, rol)
--      values ('<uuid-del-user>', 'María (cajera)', 'cajero');
-- ============================================================

-- Reemplazar la check constraint para incluir 'cajero'
alter table profiles
  drop constraint if exists profiles_rol_check;

alter table profiles
  add constraint profiles_rol_check
  check (rol in ('admin', 'franquicia', 'cliente_mayorista', 'cajero'));
