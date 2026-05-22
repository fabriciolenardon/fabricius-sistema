-- ============================================================
-- MIGRACIÓN 13: Balanza Cuora Max → cambio a PESO embebido
-- ============================================================
-- Motivo: el formato anterior (importe en centavos, 6 dígitos) topea en
-- $9.999,99 — insuficiente con los precios actuales de carnicería
-- (1 kg de cualquier corte supera los $10.000).
--
-- Nuevo formato:
--   2 + PLU(5) + GRAMOS(6) + check(1) = 13 dígitos
--   Tope de peso: 999.999 g = 999,99 kg (más que suficiente)
--
-- El sistema (Caja.jsx) toma los gramos embebidos y calcula el importe
-- multiplicando por precio_minorista. Esto desacopla la balanza de los
-- cambios de precio: si suben los precios, no hay que reconfigurar la balanza.
-- ============================================================

update config_sistema
set valor = '{
    "prefijo": "2",
    "plu_digitos": 5,
    "tipo": "peso",
    "campo_digitos": 6,
    "ejemplo": "2 PPPPP GGGGGG C - donde PPPPP es PLU y GGGGGG es peso en gramos"
  }'::jsonb,
  descripcion = 'Formato EAN-13 Cuora Max — peso embebido en gramos (6 dígitos = hasta 999,99 kg)',
  updated_at = now()
where clave = 'ean13_formato';

-- Si por alguna razón la fila no existía (ej. instalación nueva sin migración 12),
-- la creamos directamente con el formato peso.
insert into config_sistema (clave, valor, descripcion)
values (
  'ean13_formato',
  '{
    "prefijo": "2",
    "plu_digitos": 5,
    "tipo": "peso",
    "campo_digitos": 6,
    "ejemplo": "2 PPPPP GGGGGG C - donde PPPPP es PLU y GGGGGG es peso en gramos"
  }'::jsonb,
  'Formato EAN-13 Cuora Max — peso embebido en gramos (6 dígitos = hasta 999,99 kg)'
)
on conflict (clave) do nothing;
