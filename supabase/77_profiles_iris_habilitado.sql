-- ============================================================
-- 77 · Flag iris_habilitado en profiles
-- ------------------------------------------------------------
-- Habilita el asistente Iris por perfil (antes solo el CEO por email).
-- El gate en App.jsx: rol='admin' AND (email=CEO OR iris_habilitado).
-- ============================================================
alter table public.profiles add column if not exists iris_habilitado boolean default false;

-- Habilitar Iris a Ariel Garrone (arigarone2023@gmail.com)
update public.profiles set iris_habilitado = true
where id = '27c9d144-6748-4e48-a986-3d11fd06c328';
