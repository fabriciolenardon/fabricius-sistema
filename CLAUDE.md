# FABRICIUS — Sistema de gestión de carnicería (Fabricius SAS)

Sistema interno de gestión para la carnicería de Fabricio Lenardon: caja minorista,
depósito/stock, proveedores, clientes mayoristas, cierre semanal, facturación ARCA,
sueldos, cheques y asistente IA (IRIS). Corre en producción — los cambios que se
mergean a `main` se deployan solos a Vercel.

## Stack

- **Frontend**: React 18 + Vite (JSX puro, sin TypeScript). Estilos inline con variables CSS (`var(--amber)`, `var(--surface)`, etc.).
- **Backend**: Supabase (Postgres + RLS + edge functions). Proyecto: `uephtvbnkovbxhkatbtg`.
- **Deploy**: Vercel (auto-deploy al mergear a `main`). Funciones serverless en `api/` (WhatsApp webhook, etc.).
- **Facturación**: conexión directa a ARCA/AFIP (WSAA/WSFE, sin SDK externo) vía edge functions `arca-config`/`arca-emitir`.

## Flujo de trabajo (importante)

- **Siempre `npm run build` antes de mergear.** Es la única verificación (no hay tests). Un build roto tumba el deploy de Vercel.
- **PRs**: crear el PR con `gh` y **mergearlo directamente** (`gh pr merge N --squash`) sin preguntar — Fabricio lo pidió así. Avisarle solo lo que queda de su lado (ej. migraciones).
- **Migraciones SQL**: los archivos van numerados en `supabase/`. NO se aplican solas: Fabricio las corre a mano en el SQL Editor de Supabase. Si algo tira error de "schema cache" o columna inexistente, casi siempre es una migración sin aplicar.
- Commits y PRs en español, estilo `feat(modulo): descripción` / `fix(modulo): descripción`.

## Reglas de oro (bugs históricos — no repetir)

1. **Los `numeric` de Supabase llegan como STRING.** Nunca `.toFixed()` directo sobre un valor de la DB (pantalla negra). Usar `Number()`, `fmtKg`, `fmtPrecio` (`src/lib/formatos.js`).
2. **Horario ARG siempre.** Todo formateo de fecha/hora fuerza `timeZone: 'America/Argentina/Buenos_Aires'`. Usar helpers de `src/lib/fechas.js` (`fechaHoyARG`, `fechaRelativaARG`, etc.), nunca la TZ del navegador.
3. **Supabase corta en 1000 filas.** Toda consulta que sume/liste períodos largos debe paginar con `fetchAllRows` (`src/lib/supabase.js`) o subdeclara totales en silencio.
4. **NO usar `window.confirm`/`prompt` en flujos nuevos** — iOS/PWA los suprime sin error y la acción se pierde. Confirmación inline o modal propio.
5. **NUNCA modificar `movimientos_ctacte` (cta cte de clientes) sin pedido explícito.** Es la única fuente de verdad de quién le debe a Fabricio. Leer/mostrar está OK. El saldo se recalcula con `recomputarSaldoCliente` — nunca sumar/restar a mano.
6. **No confundir** `movimientos_ctacte` (clientes: quién me debe) con `movimientos_proveedores` (a quién le debo).

## Modelo de datos — conceptos clave

### Compras a proveedores: 3 tablas paralelas
Una compra vive en `entradas_deposito` (stock) + `movimientos_proveedores` (cta cte, debe/haber) + `compras_proveedores` (dashboard "comprado esta semana"). Linkean por `entrada_id`. Corregir un importe exige tocar las TRES.
- Entradas con `destino='desposte'` o `'elaboracion'` son **internas** (importe 0, mercadería ya comprada que se transforma) — nunca contarlas como compras.
- Compras cargadas a mano desde el legajo viven solo en `movimientos_proveedores` con `entrada_id IS NULL`.
- Movimientos con `anulado=true` no suman.

### Stock (`stock_actual`, una fila por bucket, campo `kg_disponible`)
- **Invariante medias**: `bovino_mr` = suma de kg de medias `disponibles` en `medias_stock`.
- **Piezas bovinas**: el desposte acredita a buckets específicos (`pieza_costillar`, `pieza_cortito`, `pieza_pierna`, `pieza_paleta`, `pieza_parrillero`, `pieza_cuarto_pistola`, `pieza_costeletal`). El bucket genérico `bovino_pieza` NO recibe créditos — la venta por kg mapea al bucket específico por nombre (`bucketPiezaBovina` en `src/lib/stockHelpers.js`); solo los productos MEDIA RES caen al genérico.
- **Cerdo**: `cerdo` = capones enteros (solo baja al despostar). Los cortes usan `stock_origen` del producto (`cerdo_bondiola`, etc.). Sin `stock_origen` → NO descontar (el bucket genérico `cerdo_pieza` se eliminó).
- **Embutidos**: buckets `emb_*` para los de elaboración propia (via `precios.stock_origen`); `embutido` = comprados/sin clasificar.
- `almacen`/`bebidas`: el campo `kg_disponible` guarda **unidades**.
- Cajones de pollo/rebozado: descuentan kg del producto base × `kg_por_unidad`.
- Al anular una venta, revertir contra el MISMO bucket que debitó (`src/lib/anularVenta.js` usa el `stock_origen` persistido en el item).
- `precios.stock_origen` define qué bucket descuenta cada producto. Productos de VACA deben tener `stock_origen` NULL.

### Caja / ventas minoristas
- El mostrador SOLO cobra ventas al público; las cobranzas mayoristas van por transferencia (no pasan por el arqueo). El arqueo es venta minorista limpia.
- Ventas guardan `items` JSON con `categoria`, `stock_origen`, `kg_por_unidad`, `caja_id`/`pieza_id` para poder anular con reversión exacta.
- Convenios: Blangino (10% empleados, `ventas_minoristas.convenio`), combos (`combos_venta`, excluidos del descuento). La Promo Mundial se eliminó del sistema (ago/2026).

### Cheques
- **Recibidos** de clientes: se endosan a proveedores, NO se cobran → no son ingreso ni tocan cta cte del cliente. Módulo = solo registro + vencimientos.
- **Emitidos** propios: `cheques.origen='emitido'`, estado pendiente/imputado.

### Cierre semanal / mes operativo
- Cierre por semanas enteras lun→dom (`cierres_semanales`, snapshot inmutable + `stock_snapshots`). Lógica en `src/lib/cierreAuto.js` y `src/lib/controlSemanal.js`.
- `meses_operativos`: inicio/cierre manual del mes (no coincide con el calendario). El "mensual en vivo" arranca en `fecha_inicio` del mes operativo.
- "Por pagar" al cierre = compras del período, NO el saldo acumulado del libro mayor.
- KPIs comparables: 01→hoy vs 01→mismo día del mes anterior (nunca parcial vs completo).

### Proveedores (legajo)
- Legajo con: "Comprado en la semana" (columnas por rubro deducidas SOLAS del historial de `entradas_deposito` — `GRUPOS_COMPRA` en `Deposito.jsx`), cuenta corriente ledger (debe/haber/saldo), historial de compras, datos en modal.
- `pagos_proveedores_semanal` es el modelo VIEJO (congelado) — solo fallback para proveedores sin cta cte inicializada.

### Portales cliente/franquicia
- Objeto `CATEGORIAS` hardcodeado ×3 (`ClientePrecios`, `ClienteNuevoPedido`, `FranquiciaPrecios`) define qué categorías ve cada portal. Si una categoría no está ahí, "no aparece" aunque haya datos. Clientes NO ven almacén/bebidas/insumos; franquicias SÍ ven insumos.
- Despacho a franquicias: resolver el cliente por `tipo='carniceria'` (hay clientes homónimos — nunca `.single()` por nombre).

### IRIS (asistente IA) y WhatsApp
- El chat interno se llama IRIS (claves internas `fabri_*`/`chad_*` no se renombran). Tools de consulta en el backend del asistente; la TV del local usa el dashboard JARVIS (`useDashboardData`).
- WhatsApp: webhook `api/whatsapp.js` (Cloud API de Meta). Bug del 9 argentino: entra `549...`, se responde `54...`.

## Diagnóstico rápido

- **"No me aparece X en el sistema"** → PRIMERO `gh pr list` (¿PR sin mergear?) y si el worktree está atrasado vs `origin/main`. Recién después debuggear el componente.
- **Error "schema cache" / columna inexistente** → migración de `supabase/` sin aplicar.
- **Stock negativo en un bucket** → buscar qué venta/flujo debita de un bucket que no recibe créditos; regularizar moviendo entre buckets, no borrando historial.
- **Totales que no cierran en períodos largos** → límite de 1000 filas sin `fetchAllRows`.
