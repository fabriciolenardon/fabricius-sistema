# Balanza Systel **Cuora NEO** — instalación en la central

> Hermano de [`balanza-systel-cuora-max.md`](balanza-systel-cuora-max.md). **Leé ese primero**: los
> conceptos (los dos modos, por qué el formato del código importa, cómo lo lee la Caja) valen igual
> y acá no se repiten. Este documento cubre **sólo lo que cambia** en la Neo.
>
> Estado: **relevado del manual oficial, pendiente de confirmar en el equipo.** Lo que está
> verificado y lo que hay que probar está marcado en cada sección.

Comprada el 13/09/2026 para **sumar** a la central (Río Primero), donde ya trabaja una Cuora Max.
Las dos van a convivir: **tienen que emitir exactamente el mismo código de barras** o la Caja va a
leer bien una y mal la otra.

---

## 1. En qué se diferencia de la Max

| | Cuora Max | **Cuora Neo** |
|---|---|---|
| Software de PC | **Qendra** | **no usa Qendra** — tiene *página web interna* |
| Configuración | menú de la balanza + Qendra | pantalla **táctil** + web desde cualquier PC o celular |
| Productos en memoria | 128 cargados | hasta **100.000** |
| Diseño del ticket | fijo, no se puede tocar | **editor gráfico completo** (texto, imágenes, campos) |
| Conectividad | USB | **Ethernet + WiFi + USB host** |
| Papel | continuo 57 mm / etiqueta | igual: continuo 57 mm / etiqueta 55×44 |

Las dos consecuencias importantes:

- **El ritual del CSV de Qendra no aplica.** Todo el capítulo 4.1 del doc de la Max (formato nativo
  de 48 columnas, CRLF, "128 registros a importar", borrar antes de re-importar) es de Qendra, y la
  Neo no lo usa. La carga de productos es otro camino — ver §5.
- **El precio en el ticket ahora SÍ se puede sacar.** En la Max quedó cerrado como imposible
  (capítulo 8). La Neo tiene editor de ticket: se elige qué campo va en cada lugar. Es la
  oportunidad de resolver ese pendiente viejo.

---

## 2. Ticket, no etiqueta — confirmado

**Decisión de Fabricio (13/09/2026) y el manual le da la razón**, textual:

> *"El modo ticket está concebido para realizar la venta de varios artículos y que la suma se
> imprima en un sólo comprobante."*

La etiqueta autoadhesiva es **una por producto** (va pegada al paquete). Para una venta de varios
cortes hacen falta varias etiquetas; el ticket de papel continuo los lista todos en un comprobante.

**Cómo se pone en modo ticket** (manual, "Cambio de papel"):

1. Girar la palanca y sacar el carretel vacío.
2. Poner el rollo de **papel continuo de 57 mm**.
3. Pasar el papel **sólo por el cabezal**, dejándolo libre unos centímetros — ⚠️ **NO** colocarlo en
   el eje recolector (eso es sólo para etiquetas).
4. Cerrar el cabezal girando la palanca suave.
5. **Seleccionar el tipo de papel TICKET.**

En Configuración → General → solapa **Impresión** está *Auto Rewind*: se activa **sólo para
etiquetas**. Con papel continuo va apagado.

---

## 3. ⚠️ El formato del código de barras — lo que hay que cambiar sí o sí

La central está en **modo PESO** desde el 19/08/2026 (verificado hoy en la base:
`config_sistema.ean13_formato` → `por_sucursal` tiene `1`, `2` y `3` todas en `"peso"`). La Neo
tiene que emitir **gramos**, no importe, igual que la Max de al lado.

### La trampa: la Neo viene de fábrica con otro reparto de dígitos

| | Patrón de fábrica de la Neo | **Lo que necesitamos** |
|---|---|---|
| Venta por **peso** | `20` + **4 PLU** + **6 importe** | `20` + **5 PLU** + **5 peso (gramos)** |
| Venta por **unidad** | `21` + 4 PLU + 6 importe | `21` + 4 PLU + 6 campo |
| **Varios** (total) | `22` + 2 balanza + 8 importe | igual |

**Si se deja el patrón de fábrica, la Caja lee cualquier cosa.** El sistema decodifica
`2 + PLU(6) + campo(5)` — el `0` del "20" cuenta como primer dígito del PLU. Con 4 dígitos de PLU y
6 de importe, el corte cae corrido y el producto y el peso salen mal, sin ningún error visible.

Regla que ya conocemos de la Max y vale igual acá: **cada patrón tiene que sumar 12 posiciones** (la
balanza agrega sola el verificador) y **si uno de los tres queda mal, se rompen los tres**.

### Dónde se configura (manual, pág. 133-134)

Menú → usuario y contraseña → **Configuración** (cuadrante inferior derecho) → **Códigos de Barra**:

1. Elegir la especie en el campo **Tipo** (peso / unidad / varios).
2. Completar los campos **A, B, C y D** con la flecha del extremo derecho: cada uno es un campo del
   código y su **cantidad de dígitos**.
3. La línea **Resultado** muestra cómo va quedando el código armado. **Mirar ahí que dé 12.**
4. **Guardar.**

> ❓ **A confirmar en el equipo:** que el menú desplegable de los campos A/B/C/D ofrezca **PESO**
> (gramos) y no sólo importe. El manual no lista las opciones. En la Max esto se elegía desde
> Qendra ("Imprimir Importe" / "Imprimir Peso"); en la Neo tiene que estar en este desplegable.
> **Si no existiera la opción peso**, la Neo no puede acompañar a la Max y hay que replantear.

### Número de balanza

La Max es el equipo **N° 20** (por eso sus totales arrancan con `2220`). A la Neo conviene darle
**otro número** en Configuración → General → solapa **Balanza** → *Nº de Balanza*, para poder
distinguir de qué equipo salió cada ticket en los reportes. No afecta a la Caja: el código de
*Suma* no se usa para cobrar.

---

## 4. 🔬 La prueba que decide todo — hacerla ANTES de cargar nada

**La pregunta:** cuando se venden varios productos en un ticket, ¿la Neo imprime **un código de
barras por producto** o **uno solo al final** con el total?

**Por qué importa:** la Caja de Fabricius escanea, de cada producto, su PLU y su peso. Necesita **un
código por artículo**. El código de *Varios* (`22` + total) no sirve: no lleva PLU — el manual dice
que se usa *"cuando dos o más artículos se vendan en un mismo comprobante, y sea por lo tanto
imposible incluir el código de artículo"*.

La Max **sí** imprime uno por artículo (lo sabemos por el bug del 21/07: los códigos *por artículo*
salían en ceros mientras el del total salía bien). La Neo debería comportarse igual, pero **el
manual no lo afirma** y no se puede asumir.

**La prueba, 5 minutos:**

1. Cargar papel continuo y poner tipo de papel TICKET.
2. Pesar dos productos distintos en la misma venta y cerrar el ticket.
3. Mirar el papel:
   - **Dos códigos de barras, uno por producto** → ✅ el circuito funciona igual que la Max, seguir
     con §5.
   - **Un solo código al final** → ⚠️ parar. Las salidas posibles son: emitir **un ticket por
     producto** (funciona con el circuito de hoy, gasta más papel), pasar a **etiqueta** (una por
     producto, con pega), o ver si el **editor de tickets** (§1) permite meter el código de barras
     en cada línea del detalle.

---

## 5. Cargar los 128 productos

Los PLU **son los mismos** que ya usan: `precios.codigo_balanza` es del catálogo compartido, así que
la Neo tiene que quedar con **los mismos números de PLU** que la Max, o los tickets de una y otra
apuntarían a productos distintos.

Caminos, de mejor a peor:

1. **Página web interna** — la Neo permite *"la gestión completa de configuración y reportes desde
   cualquier PC o celular sin instalar nada"*. Hay que entrar (por la IP que tome en la red) y ver
   si tiene importación de productos. **Es lo primero a explorar.**
2. **Importación por FTP** — Configuración → General → solapa **Importación**: *"Importar desde
   servidor FTP"*, con **Formato de archivo: Systel o MGV** y periodicidad configurable. Si
   conseguimos la especificación del formato "Systel", esto se puede automatizar desde el sistema
   igual que hoy se genera el CSV de Qendra. **Pedirle el formato al soporte de Systel.**
3. **A mano por la pantalla táctil** — Altas y bajas → **PLU's** → *Nuevo*. 128 productos a mano es
   media jornada; último recurso.

> Systel da **asistencia personalizada de instalación** con la compra del equipo (configurar el
> equipo en la red, cargar los productos, personalizar las etiquetas con el logo). **Conviene usarla
> para la carga inicial** y pedirles de paso la especificación del archivo de importación.

### ⚠️ Trampa heredada: el código de barras se configura también POR PRODUCTO

Cada PLU tiene su propia solapa **Código de barras** — *"permite seleccionar la impresión de uno o
más códigos de barra de acuerdo a las necesidades del negocio"*.

Es exactamente donde la Max nos costó una mañana entera: los productos quedaron con una config
propia vacía y **el código salía todo en ceros** aunque la configuración del equipo estuviera
perfecta. La firma del problema: **el código del total imprime bien y el de los artículos no.**

Al cargar los productos, verificar que esta solapa quede apuntando a la configuración general del
equipo, y **probar con 2 productos antes de cargar los 128**.

---

## 6. Checklist de instalación

- [ ] Papel continuo puesto, sin pasar por el eje recolector, **tipo de papel = TICKET**
- [ ] *Auto Rewind* apagado (es para etiquetas)
- [ ] Datos del comercio cargados (encabezado del ticket)
- [ ] Nº de balanza distinto al de la Max (que es 20)
- [ ] **Prueba del ticket de dos productos** (§4) — antes de cargar nada
- [ ] Código de barras **Peso** = `20` + 5 PLU + 5 **gramos**, la línea *Resultado* dando 12
- [ ] Código de barras **Unidad** = `21` + 4 PLU + 6 campo
- [ ] Código de barras **Varios** = `22` + 2 balanza + 8 importe
- [ ] 2 productos de prueba cargados con el PLU real del sistema
- [ ] Cada producto con su solapa de código de barras apuntando a la config del equipo (§5)
- [ ] **Prueba del kilo**: pesar 1 kg conocido → imprimir → escanear en el probador del sistema
      (Precios → 🏷️ PLU/Balanza) → tiene que decir **1,000 kg**
- [ ] Recién ahí, cargar los 128 productos
- [ ] Prueba de venta real de punta a punta: pesar → ticket → escanear en Caja → producto, peso y
      precio correctos

> **No vender con la balanza a medio configurar.** Mientras el formato del código no esté igual al
> de la Max, todo lo que se escanee de la Neo se cobra mal.

---

## 7. Fuentes

- Manual oficial Cuora Neo (PDF, 147 págs.):
  <https://soporte.systel-global.com/downloads/Manuales-de-usuario/Manuales-Usuario-Systel/CUORA-NEO-manual_ESP.pdf>
  — secciones usadas: *Comprobantes* (pág. 31-32), *Cambio de papel* (pág. 17), *Venta de artículos
  en modo ticket* (pág. 55), *Configuración General* (pág. 112-118), *Tickets* (pág. 124-129),
  *Asignar formato* (pág. 132), *Códigos de barras* (pág. 133-134), *PLU's* (pág. 69-71).
- Ficha del producto: <https://systel-global.com/argentina/producto/cuora-neo/>

> 💡 El PDF **sí se puede leer** desde el entorno de trabajo (`curl` + `pdftotext -layout -enc
> UTF-8`). La nota vieja del doc de la Max que decía que los manuales de Systel no se podían abrir
> quedó desactualizada.
