-- ============================================================
-- 90: BLOQUEO MANUAL DE CUENTA CORRIENTE POR CLIENTE
-- ============================================================
-- El bloqueo de cta cte lo decide FABRICIO, no el sistema: el flag
-- vive en la ficha del cliente. El sistema solo SUGIERE bloquear
-- cuando detecta saldo vencido > 15 días (anuncio en Clientes con
-- confirmación) y Fabricio puede marcar/desmarcar a cualquier
-- cliente según su criterio. El despacho (Depósito) y el portal
-- obedecen únicamente este flag.
-- Idempotente: se puede correr más de una vez.
-- ============================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bloqueo_ctacte boolean NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bloqueo_motivo text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bloqueo_fecha timestamptz;

-- Config de crédito por cliente (editable desde la ficha):
--   ctacte_libre      = true → cuenta libre: sin control de vencimiento,
--                       nunca aparece en las sugerencias de bloqueo.
--   ctacte_dias_plazo = plazo propio en días (NULL = estándar, 15 días).
--                       Permite dar más o menos plazo a clientes puntuales.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ctacte_libre boolean NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ctacte_dias_plazo integer;
