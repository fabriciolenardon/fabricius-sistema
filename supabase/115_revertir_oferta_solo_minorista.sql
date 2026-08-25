-- ============================================================
-- 115 — REVERTIR EL "SOLO MINORISTA" DE LA MIG 114
-- ============================================================
-- Fue una lectura equivocada del pedido de Fabricio. Cada boca elige a qué
-- listas aplica su oferta — minorista, mayorista o las dos.
--
-- Lo que él pedía era otra cosa: poder tomar una oferta que YA existe en la
-- central y habilitarla en Monte Cristo, eligiendo cuáles. Eso no se
-- resuelve en la base: el modelo ya lo permite (una fila por boca unidas por
-- `grupo_id`, mig 103) y lo que faltaba era el botón. Va en Precios →
-- Ofertas: los chips de "Dónde corre" ahora se tocan para sumar o sacar una
-- boca sobre una oferta ya cargada.
--
-- No hay datos que reparar: cuando corrió la 114 no existía ninguna oferta de
-- sucursal, así que su UPDATE no tocó ninguna fila.
--
-- Idempotente.
-- ============================================================

DROP TRIGGER IF EXISTS trg_zz_oferta_solo_minorista ON ofertas;
DROP FUNCTION IF EXISTS oferta_solo_minorista_en_sucursal();


-- Verificación: no debe quedar el trigger, y las ofertas conservan sus listas.
SELECT 'trigger solo_minorista (debe ser 0)' AS control, count(*)::text AS resultado
  FROM pg_trigger WHERE tgname = 'trg_zz_oferta_solo_minorista' AND NOT tgisinternal
UNION ALL
SELECT 'ofertas vigentes con mayorista', count(*)::text
  FROM ofertas WHERE activa AND fecha_fin >= current_date AND aplica_mayorista;
