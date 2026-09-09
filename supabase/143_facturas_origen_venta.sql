-- ============================================================
-- 143 — De qué venta salió cada factura
-- ============================================================
-- Hasta hoy, para facturar una venta que YA está cargada había que ir a
-- Facturación → Cargar venta y volver a escribir el importe a mano. El
-- sistema no tenía forma de saber que esa factura era de esa venta, así
-- que tampoco podía avisar "esta ya la facturaste".
--
-- Estas dos columnas son ese vínculo. Las dos son opcionales: las
-- facturas cargadas a mano (y todas las viejas) siguen con NULL y nada
-- cambia para ellas.
--
-- El índice único es el candado de verdad contra la factura repetida: la
-- base no deja marcar dos facturas contra la misma venta. El front ya
-- chequea antes de pedir el CAE, pero un candado de pantalla se puede
-- perder (doble click, dos pestañas abiertas, el celular que reintenta);
-- este no.
--
-- on delete set null: anular una venta minorista BORRA la fila
-- (lib/anularVenta.js), y si eso arrastrara la factura nos estaríamos
-- comiendo un comprobante que ARCA ya autorizó. La factura queda, se
-- queda sin origen, y se corrige con una nota de crédito como siempre.
-- ============================================================

alter table facturas
  add column if not exists venta_id  uuid references ventas_minoristas(id) on delete set null,
  add column if not exists remito_id uuid references remitos(id)           on delete set null;

comment on column facturas.venta_id  is 'Venta del mostrador que originó esta factura (NULL si se cargó a mano)';
comment on column facturas.remito_id is 'Remito mayorista que originó esta factura (NULL si se cargó a mano)';

-- Una venta, una factura. Una sola vez.
create unique index if not exists facturas_venta_unica
  on facturas (venta_id) where venta_id is not null;

create unique index if not exists facturas_remito_unico
  on facturas (remito_id) where remito_id is not null;

-- Para armar rápido la lista de "todavía sin facturar" del período
create index if not exists facturas_venta_lookup  on facturas (venta_id)  where venta_id  is not null;
create index if not exists facturas_remito_lookup on facturas (remito_id) where remito_id is not null;

-- ── Si hiciera falta re-facturar una venta ──────────────────────────
-- Pasa cuando la primera factura salió mal y se anuló con una nota de
-- crédito. El índice único no lo permite con la referencia puesta, así
-- que primero se le saca el origen a la factura anulada:
--
--   update facturas set venta_id = null where id = <id de la factura anulada>;
--
-- y recién ahí la venta vuelve a aparecer en la lista de sin facturar.
