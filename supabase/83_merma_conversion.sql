-- ============================================================
-- MIGRACIÓN 83: Merma por producto (conversión a cortes)
-- ============================================================
-- % de merma asociado a cada PIEZA individual y a cada tipo de
-- MEDIA RES, para que al convertir a cortes el número aparezca
-- solo (enlazado a la pieza) y no se convierta apurado sin verlo.
-- Editable desde Depósito → Desposte; se guarda acá.
--
-- Vive en config_sistema (clave 'merma_conversion'). Estructura:
--   {
--     "piezas": { "<tipo_pieza>": <pct>, ... },
--     "media_res": [ { "id", "label", "merma": <pct> }, ... ]
--   }
-- Los % son enteros (porcentaje), no fracciones.
-- ============================================================

insert into config_sistema (clave, valor, descripcion)
values (
  'merma_conversion',
  '{
    "piezas": {
      "Pierna": 29,
      "Cortito": 27,
      "Costeletal con Lomo": 6,
      "Costillar Completo": 12,
      "Cuarto Pistola": 25,
      "Parrillero": 25,
      "Paleta": 25
    },
    "media_res": [
      { "id": "novillito", "label": "Novillito (Nt)", "merma": 22 },
      { "id": "vaca_vaquillona", "label": "Vaca/Vaquillona (VQ)", "merma": 28 }
    ]
  }'::jsonb,
  'Merma por producto al convertir a cortes: % por pieza individual y por tipo de media res. Editable desde Depósito → Desposte.'
)
on conflict (clave) do nothing;
