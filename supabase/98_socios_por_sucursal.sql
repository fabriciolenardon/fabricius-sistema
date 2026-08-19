-- ============================================================
-- 98 — LOS SOCIOS SON DE CADA NEGOCIO
-- ============================================================
-- Monte Cristo abrió el sistema y en su Dashboard le apareció
-- "Fabricio Lenardon 85% · Ariel Garrone 15%": los socios de la CENTRAL.
-- La sucursal tiene su propio dueño y su propia sociedad.
--
-- Los socios estaban escritos a mano en tres lugares distintos:
--   Dashboard.jsx ............ el widget de distribución (85/15)
--   Gastos.jsx ............... el selector de socio y los topes fabricio/ariel
--   api/aviso-tope-gastos.js . el aviso de WhatsApp
-- Con un solo negocio eso alcanzaba. Con dos, no: pasan a ser datos.
--
-- DÓNDE VIVE CADA COSA
--   socios ....................... quiénes son, su % y su tope individual
--   sucursales.tope_gastos_* ..... el tope TOTAL del negocio y si está activo
--
-- El tope total va en `sucursales` y no en `config_sistema` a propósito:
-- `config_sistema` todavía tiene la PK en `clave` sola, así que no admite un
-- valor por sucursal (ver la deuda de la migración 95). La fila de la sucursal
-- es el lugar natural para lo que es de ese negocio y encima evita esa deuda.
--
-- `socios.clave` es lo que ya se guarda en `gastos.socio` ('fabricio',
-- 'ariel'): se respeta tal cual para no tocar los 500+ gastos históricos.
--
-- Idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1) LA TABLA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS socios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id   integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  clave         text    NOT NULL,   -- lo que se guarda en gastos.socio
  nombre        text    NOT NULL,
  -- Cómo lo saluda el sistema. El local se llama "Monte Cristo" pero al dueño
  -- se lo saluda por su nombre, y si cargó "Pame" el sistema le dice Pame.
  -- Vacío → se usa el primer nombre.
  apodo         text,
  -- El dueño principal: es a quien saluda el Dashboard al entrar.
  es_principal  boolean NOT NULL DEFAULT false,
  porcentaje    numeric NOT NULL DEFAULT 0,
  tope_mensual  numeric,            -- NULL = sin tope propio
  activo        boolean NOT NULL DEFAULT true,
  orden         integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT socios_clave_por_sucursal UNIQUE (sucursal_id, clave)
);

-- Columnas para las tablas que ya existían de una corrida anterior.
ALTER TABLE socios ADD COLUMN IF NOT EXISTS apodo        text;
ALTER TABLE socios ADD COLUMN IF NOT EXISTS es_principal boolean NOT NULL DEFAULT false;

-- Un solo principal por sucursal.
DROP INDEX IF EXISTS socios_un_principal_por_sucursal;
CREATE UNIQUE INDEX socios_un_principal_por_sucursal
  ON socios (sucursal_id) WHERE es_principal;

-- Tope TOTAL del negocio (la suma de todos los socios) y si el control está
-- prendido. Es por sucursal porque cada uno maneja su plata.
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS tope_gastos_total  numeric;
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS tope_gastos_activo boolean NOT NULL DEFAULT false;


-- ------------------------------------------------------------
-- 2) AISLAMIENTO — mismo criterio que el resto (migración 93)
-- ------------------------------------------------------------
ALTER TABLE socios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS socios_admin ON socios;
CREATE POLICY socios_admin ON socios
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Restrictiva: cada uno ve y toca SOLO los socios de su negocio.
DROP POLICY IF EXISTS sucursal_aislamiento ON socios;
CREATE POLICY sucursal_aislamiento ON socios
  AS RESTRICTIVE FOR ALL TO public
  USING      (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal())
  WITH CHECK (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal());

-- Que un alta desde la app caiga en la sucursal de quien la carga.
DROP TRIGGER IF EXISTS trg_set_sucursal_id ON socios;
CREATE TRIGGER trg_set_sucursal_id BEFORE INSERT ON socios
  FOR EACH ROW EXECUTE FUNCTION set_sucursal_id();


-- ------------------------------------------------------------
-- 3) LA CENTRAL, TAL COMO ESTÁ HOY
-- ------------------------------------------------------------
-- Los porcentajes salen del widget del Dashboard (85/15) y los topes
-- individuales de `config_sistema.tope_gastos_socios`, para no perder lo que
-- Fabricio ya tenía configurado.
--
-- Monte Cristo (3) queda A PROPÓSITO SIN SOCIOS: el sistema le va a pedir que
-- los cargue la primera vez que entre. No se inventa una sociedad ajena.
-- ------------------------------------------------------------

INSERT INTO socios (sucursal_id, clave, nombre, apodo, es_principal, porcentaje, tope_mensual, orden)
VALUES
  (1, 'fabricio', 'Fabricio Lenardon', 'Fabri', true,  85,
     (SELECT NULLIF((valor->'topes'->>'fabricio')::numeric, 0) FROM config_sistema WHERE clave='tope_gastos_socios'), 1),
  (1, 'ariel',    'Ariel Garrone',     NULL,   false, 15,
     (SELECT NULLIF((valor->'topes'->>'ariel')::numeric, 0)    FROM config_sistema WHERE clave='tope_gastos_socios'), 2)
ON CONFLICT (sucursal_id, clave) DO NOTHING;


-- Dónde queda cada local: es lo que el Dashboard muestra bajo el saludo.
-- Antes decía "Río Primero, Córdoba" escrito a mano, así que Monte Cristo
-- abría el sistema y leía la dirección de la central.
UPDATE sucursales SET direccion = 'Río Primero, Córdoba'  WHERE id = 1 AND COALESCE(direccion, '') IN ('', 'Río Primero');
UPDATE sucursales SET direccion = 'Monte Cristo, Córdoba' WHERE id = 3 AND COALESCE(direccion, '') = '';
UPDATE sucursales SET direccion = 'Alvear, Córdoba'       WHERE id = 2 AND COALESCE(direccion, '') = '';

-- El tope total y el interruptor, también desde donde estaban.
UPDATE sucursales SET
  tope_gastos_total  = COALESCE(tope_gastos_total,
                        (SELECT NULLIF((valor->>'tope')::numeric, 0) FROM config_sistema WHERE clave='tope_gastos_socios')),
  tope_gastos_activo = COALESCE(
                        (SELECT (valor->>'activo')::boolean FROM config_sistema WHERE clave='tope_gastos_socios'), false)
WHERE id = 1;


-- ------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ------------------------------------------------------------
SELECT 'socios de la central' AS control,
       string_agg(nombre || ' ' || porcentaje || '%', ' · ' ORDER BY orden) AS resultado
  FROM socios WHERE sucursal_id = 1
UNION ALL
SELECT 'socios de Monte Cristo (debe ser 0)', count(*)::text FROM socios WHERE sucursal_id = 3
UNION ALL
SELECT 'tope total de la central', COALESCE(tope_gastos_total::text, 'sin tope') FROM sucursales WHERE id = 1
UNION ALL
SELECT 'control de topes activo', tope_gastos_activo::text FROM sucursales WHERE id = 1;

-- Esperado:
--   socios de la central ............... Fabricio Lenardon 85% · Ariel Garrone 15%
--   socios de Monte Cristo ............. 0    ← los carga su dueño al entrar
--   tope total de la central ........... 4000000
--   control de topes activo ............ true
