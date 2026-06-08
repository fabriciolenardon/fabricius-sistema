-- Viáticos en sueldos: monto que SUMA al neto del empleado. Se controla con un
-- toggle por liquidación (clickeable). `tiene_viaticos` en el empleado marca a
-- quiénes les corresponde (solo Luciano Paez y Giuliana Frontera), y deja el
-- toggle pre-activado para ellos. En el resumen impreso, la línea "Viáticos"
-- aparece SOLO si el toggle está activado (privacidad: el resto no ve la palabra).
ALTER TABLE liquidaciones_sueldos ADD COLUMN IF NOT EXISTS viaticos numeric DEFAULT 0;
ALTER TABLE empleados_sueldos ADD COLUMN IF NOT EXISTS tiene_viaticos boolean DEFAULT false;
UPDATE empleados_sueldos SET tiene_viaticos = true WHERE id IN (3, 5);
