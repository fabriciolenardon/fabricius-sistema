-- ============================================================
-- 102 — CLAVE DE CAJA POR BOCA (para eliminar una compra)
-- ============================================================
-- Pedido de Fabricio (22/08/2026): eliminar una compra tiene que pedir una
-- clave, cada negocio pone la suya, y sólo el dueño puede cambiarla.
--
-- Hoy eliminar un ingreso pide apenas un `confirm()` del navegador — que
-- además en iPhone/PWA se suprime sin avisar (regla de oro N°4).
--
-- DÓNDE SE GUARDA Y POR QUÉ NO EN config_sistema
-- `config_sistema` tiene la PK en `clave` sola (deuda de la mig 95): no admite
-- un valor por sucursal. Igual que el tope de gastos (mig 98), esto va en su
-- propia tabla con `sucursal_id`.
--
-- POR QUÉ UNA TABLA APARTE Y NO UNA COLUMNA EN `sucursales`
-- `sucursales` la puede leer cualquier usuario logueado (la app necesita el
-- nombre y la dirección). RLS filtra FILAS, no columnas: una clave ahí sería
-- legible con la API por cualquiera. Esta tabla, en cambio, **no tiene policy
-- de SELECT**: nadie la lee desde la app, ni el dueño. Se usa por RPC. Mismo
-- patrón que `arca_config` con el certificado.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS claves_operativas (
  sucursal_id  integer PRIMARY KEY REFERENCES sucursales(id),
  clave_caja   text NOT NULL,
  updated_at   timestamptz DEFAULT now(),
  updated_por  text
);

ALTER TABLE claves_operativas ENABLE ROW LEVEL SECURITY;
-- A propósito: CERO policies. Sin SELECT, sin INSERT, sin UPDATE desde la app.
-- Todo pasa por las funciones de abajo, que son SECURITY DEFINER.


-- ------------------------------------------------------------
-- ¿Es el dueño de SU negocio?
-- ------------------------------------------------------------
-- Mismo criterio que `puedeAjustarStock()` en src/lib/permisos.js: el CEO en la
-- central (los otros dos admin no), y el usuario `sucursal` en su boca. El id
-- del CEO es el mismo que ya está en permisos.js.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION es_dueno_negocio()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (rol = 'sucursal' OR id = 'cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0'::uuid)
  )
$$;


-- ------------------------------------------------------------
-- Definir / cambiar la clave de MI boca. Sólo el dueño.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_clave_caja(p_clave text, p_quien text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_suc integer := mi_sucursal();
BEGIN
  IF NOT es_dueno_negocio() THEN
    RAISE EXCEPTION 'Solo el dueño del negocio puede cambiar la clave de caja';
  END IF;
  IF v_suc IS NULL THEN
    RAISE EXCEPTION 'El usuario no pertenece a ninguna sucursal';
  END IF;
  IF p_clave IS NULL OR length(trim(p_clave)) < 4 THEN
    RAISE EXCEPTION 'La clave tiene que tener al menos 4 caracteres';
  END IF;

  INSERT INTO claves_operativas (sucursal_id, clave_caja, updated_at, updated_por)
  VALUES (v_suc, trim(p_clave), now(), p_quien)
  ON CONFLICT (sucursal_id) DO UPDATE
    SET clave_caja = excluded.clave_caja,
        updated_at = now(),
        updated_por = excluded.updated_por;
  RETURN true;
END $$;


-- ------------------------------------------------------------
-- ¿Mi boca ya tiene clave configurada? (no devuelve la clave)
-- ------------------------------------------------------------
-- Mientras no haya ninguna, la eliminación sigue funcionando como hasta hoy y
-- la pantalla avisa que hay que configurarla. Así el pedido no deja a nadie
-- sin poder trabajar el día que se aplica.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hay_clave_caja()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM claves_operativas WHERE sucursal_id = mi_sucursal())
$$;


-- ------------------------------------------------------------
-- Verificar la clave que se tipeó. Devuelve true/false, nunca la clave.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION verificar_clave_caja(p_clave text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM claves_operativas
    WHERE sucursal_id = mi_sucursal()
      AND clave_caja = trim(p_clave)
  )
$$;

REVOKE ALL ON FUNCTION set_clave_caja(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_clave_caja(text, text) TO authenticated;
REVOKE ALL ON FUNCTION hay_clave_caja() FROM public, anon;
GRANT EXECUTE ON FUNCTION hay_clave_caja() TO authenticated;
REVOKE ALL ON FUNCTION verificar_clave_caja(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION verificar_clave_caja(text) TO authenticated;

-- ============================================================
-- VERIFICACIÓN (correr aparte)
-- ============================================================
-- Un admin que NO es el CEO no puede definirla:
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<uuid de Ariel>","role":"authenticated"}';
-- select set_clave_caja('1234');   -- error: solo el dueño
-- rollback;
--
-- Y nadie puede leer la tabla:
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"cc59fc4b-ff6d-4322-bbfc-0de5728ccfe0","role":"authenticated"}';
-- select count(*) from claves_operativas;   -- 0 filas: no hay policy de SELECT
-- rollback;
-- ============================================================
