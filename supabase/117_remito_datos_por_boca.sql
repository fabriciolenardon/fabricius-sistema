-- ============================================================
-- 117 — EL REMITO SALE CON LOS DATOS DE LA BOCA QUE LO EMITE
-- ============================================================
-- El encabezado del remito tenía la dirección y el teléfono de Río Primero
-- CLAVADOS EN EL CÓDIGO, así que Monte Cristo emitía remitos que decían
-- "Casa Central: Av. Mitre 670 - Río Primero". Es el mismo patrón que ya
-- había mordido en Sueldos (PR #354): la RLS puede estar perfecta y el
-- componente igual mostrar datos de la central por un hardcode.
--
-- Pasan a salir de `sucursales`, que ya tenía `direccion`. Sólo faltaba el
-- teléfono.
--
-- El rótulo también cambia: "Casa Central" sólo si la boca es la central; una
-- franquicia sale como "Sucursal <nombre>".
--
-- Monte Cristo TODAVÍA NO TIENE TELÉFONO y se deja en NULL a propósito: la
-- pantalla omite la línea entera cuando no hay. Mejor sin teléfono que con el
-- de otro local.
--
-- Idempotente.
-- ============================================================

ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS telefono text;

COMMENT ON COLUMN sucursales.telefono IS
  'Teléfono que encabeza los remitos de esa boca. NULL = no se imprime la línea.';

-- La dirección completa de la central vivía sólo en el hardcode: se guarda
-- para no perderla al sacarlo.
UPDATE sucursales SET direccion = 'Av. Mitre 670 - Río Primero, Córdoba',
                      telefono  = '3574 400346'
WHERE id = 1;


-- Verificación: cómo va a encabezar el remito de cada boca.
SELECT id, nombre,
       CASE WHEN tipo = 'central' THEN 'Casa Central' ELSE 'Sucursal ' || nombre END AS rotulo,
       direccion,
       coalesce(telefono, '(no se imprime)') AS telefono
FROM sucursales ORDER BY id;
