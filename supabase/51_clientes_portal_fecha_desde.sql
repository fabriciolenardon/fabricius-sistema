-- Fecha desde la cual el portal del cliente/franquicia muestra datos. Sirve
-- cuando cambia el dueño de una franquicia: el nuevo dueño solo ve remitos,
-- movimientos y un saldo recalculado a partir de esa fecha (no la historia ni
-- la deuda del dueño anterior). NULL = el portal ve todo (comportamiento previo).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS portal_fecha_desde date;
-- Monte Cristo cambió de dueño: el nuevo ve desde el 02/06/2026.
UPDATE clientes SET portal_fecha_desde = '2026-06-02'
WHERE id = '716e69a6-c1ec-41fd-83f2-ad9de51d9f04';
