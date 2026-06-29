-- Marca de FRANQUICIA + nombre del TITULAR (dueño) en la ficha del cliente.
-- Antes las franquicias estaban hardcodeadas en un módulo aparte (Franquicias.jsx
-- + array FRANQUICIAS) y el dueño se escribía a mano en código. Ahora se unifica
-- todo dentro de Clientes: una franquicia es un cliente tipo 'carniceria' con
-- es_franquicia=true; el titular se edita desde la ficha. NO toca saldos ni cta cte.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS es_franquicia boolean NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS titular text;

-- Marcar las dos franquicias existentes (idempotente). El titular se puede editar
-- después desde la ficha del cliente.
UPDATE clientes SET es_franquicia = true, titular = COALESCE(titular, 'Roxana')
WHERE id = 'da8afe23-42dc-4021-90cf-7653e2c0fb48';   -- ALVEAR CARNICERIA
UPDATE clientes SET es_franquicia = true, titular = COALESCE(titular, 'Carla Tissera')
WHERE id = '716e69a6-c1ec-41fd-83f2-ad9de51d9f04';   -- MONTE CRISTO CARNICERIA
