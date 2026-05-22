-- ============================================================
-- MIGRACIÓN 15: Ajuste al formato REAL de la balanza Cuora Max
-- ============================================================
-- Verificado el 2026-05-22 con dos tickets reales:
--   Ticket 1: PLU 3 (COSTILLA), 0,365 kg × $19.800 = $7.227
--     Código: 2000003072275 → "2" + "000003" + "07227" + "5"
--   Ticket 2: PLU 2 (JAMON CUADRADO), 1,520 kg × $18.600 = $28.272
--     Código: 2000002282723 → "2" + "000002" + "28272" + "3"
--
-- Formato definitivo:
--   prefijo (1)  +  PLU (6)  +  IMPORTE_PESOS (5)  +  CHECK (1)  = 13
--
-- IMPORTANTE: el importe va en PESOS ENTEROS (sin centavos). Tope $99.999
-- por etiqueta — suficiente porque cada etiqueta corresponde a UN solo
-- producto pesado, no al total de la venta.
-- ============================================================

update config_sistema
set valor = '{
    "prefijo": "2",
    "plu_digitos": 6,
    "tipo": "precio_pesos",
    "campo_digitos": 5,
    "ejemplo": "2 PPPPPP IIIII C - donde PPPPPP es PLU (6 dig) e IIIII es importe en pesos enteros (5 dig)"
  }'::jsonb,
  descripcion = 'Formato real EAN-13 Cuora Max Fabricius — PLU(6) + importe pesos enteros(5). Verificado con tickets reales.',
  updated_at = now()
where clave = 'ean13_formato';

-- Inserción defensiva por si la fila no existe.
insert into config_sistema (clave, valor, descripcion)
values (
  'ean13_formato',
  '{
    "prefijo": "2",
    "plu_digitos": 6,
    "tipo": "precio_pesos",
    "campo_digitos": 5,
    "ejemplo": "2 PPPPPP IIIII C"
  }'::jsonb,
  'Formato real EAN-13 Cuora Max Fabricius — PLU(6) + importe pesos enteros(5)'
)
on conflict (clave) do nothing;
