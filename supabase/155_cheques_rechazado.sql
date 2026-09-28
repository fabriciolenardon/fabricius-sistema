-- ============================================================
-- 155 — Estado "rechazado" para cheques recibidos
-- ============================================================
-- Hasta ahora `cheques.estado` solo admitía 'pendiente' | 'imputado'.
-- Cuando un cliente nos daba un cheque que el banco rechazaba no había
-- forma de marcarlo: quedaba 'pendiente' y seguía apareciendo en los
-- vencimientos como si fuera bueno. Pasó con el echeq 90000054 de
-- $550.000 de Matias Castillo (rechazado el 23/09/2026).
--
-- El cheque NO se borra: es el comprobante de que el cliente lo entregó.
-- Se marca, se guarda por qué y sale de los avisos de vencimiento.

alter table cheques drop constraint if exists cheques_estado_check;
alter table cheques add constraint cheques_estado_check
  check (estado in ('pendiente', 'imputado', 'rechazado'));

alter table cheques add column if not exists fecha_rechazo date;
alter table cheques add column if not exists motivo_rechazo text;

comment on column cheques.fecha_rechazo is 'Día en que el banco lo rechazó (solo estado=rechazado)';
comment on column cheques.motivo_rechazo is 'Por qué se rechazó: sin fondos, firma, cuenta cerrada...';
