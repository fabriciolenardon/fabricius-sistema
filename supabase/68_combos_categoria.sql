-- ════════════════════════════════════════════════════════════
-- 68 · Categoría en las imágenes promocionales (combos + ofertas)
-- ────────────────────────────────────────────────────────────
-- Reusamos combos_imagenes para todas las placas que Iris manda por
-- WhatsApp, distinguidas por categoría:
--   'combo'      → bolsones/combos armados
--   'oferta_may' → placa de ofertas mayoristas de la semana
--   'oferta_min' → placa de ofertas semanales (minorista)
-- Las fotos existentes quedan como 'combo' (default).
-- ════════════════════════════════════════════════════════════
alter table combos_imagenes
  add column if not exists categoria text not null default 'combo';

create index if not exists combos_imagenes_categoria_idx on combos_imagenes (categoria);
