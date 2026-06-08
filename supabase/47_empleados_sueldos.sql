-- Empleados de Sueldos en tabla (antes hardcodeados en el front) para que el
-- VALOR HORA sea editable y se guarde. Los ids 1-6 coinciden con los del
-- mapeo iVMS (NOMBRE_A_EMPLEADO) para no romper la importación de fichadas.
-- Además se agrega `adelantos` a las liquidaciones (descuento aparte de boletas).
CREATE TABLE IF NOT EXISTS empleados_sueldos (
  id integer PRIMARY KEY,
  apellido text NOT NULL,
  nombre text NOT NULL,
  valor_hora numeric NOT NULL DEFAULT 0,
  modalidad text DEFAULT 'hora',
  cbu text DEFAULT '',
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE empleados_sueldos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empleados_sueldos_admin ON empleados_sueldos;
CREATE POLICY empleados_sueldos_admin ON empleados_sueldos FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO empleados_sueldos (id, apellido, nombre, valor_hora, modalidad, cbu) VALUES
  (1,'FRONTERA','GERMAN GABRIEL',6000,'hora',''),
  (2,'ARNAUDO','ELIAS COLO',5500,'hora','0200382311000030167612'),
  (3,'PAEZ','LUCIANO',5000,'hora',''),
  (4,'SCIENZA','CAMILA',5000,'hora','Camilabelenscienza'),
  (5,'FRONTERA','GIULIANA',6000,'hora','giu.frontera'),
  (6,'MANSILLA','PRISCILA',5000,'hora','')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE liquidaciones_sueldos ADD COLUMN IF NOT EXISTS adelantos numeric DEFAULT 0;
