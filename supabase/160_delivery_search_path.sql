-- ============================================================
-- 160 — Delivery: search_path fijo en las funciones auxiliares
-- ============================================================
-- El advisor de seguridad de Supabase marcó las dos funciones nuevas de la
-- 159 (normalizar teléfono y su trigger) sin search_path fijo. Se fija
-- también en delivery_esta_abierto por prolijidad. No cambia el resultado.
-- ============================================================
alter function public.delivery_normalizar_tel(text) set search_path = public;
alter function public.clientes_delivery_tel_normalizado() set search_path = public;
alter function public.delivery_esta_abierto(jsonb) set search_path = public;
