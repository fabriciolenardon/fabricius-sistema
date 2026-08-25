# Balanza Systel Cuora Max + Qendra — manual de integración

Todo lo necesario para conectar una balanza **Systel Cuora Max** (administrada con el software de PC
**Qendra**) al sistema, desde cero. Escrito a partir de la instalación real de Fabricius —
Río Primero y Monte Cristo— incluyendo las trampas que costaron días de trabajo.

Sirve como procedimiento de instalación para cualquier carnicería nueva.

---

## 1. Cómo se conectan las tres piezas

```
   BALANZA                    QENDRA (PC)                  SISTEMA (web)
   Cuora Max      <-- USB/COM -->   catálogo         <-- CSV -->   precios
   pesa e imprime               de productos y PLU              (fuente de verdad)
       |
       | etiqueta con código de barras EAN-13
       v
   LECTOR EN LA CAJA  -->  el sistema decodifica y cobra
```

Tres cosas que conviene tener claras antes de tocar nada:

- **Qendra no habla con el sistema.** Es el administrador de la balanza y nada más. El puente entre
  ambos mundos es **el código de barras de la etiqueta**, y nada más que eso.
- **El PLU es la llave.** El mismo número identifica al producto en la balanza y en el sistema
  (`precios.codigo_balanza`). Si no coinciden, el escaneo no encuentra el producto.
- **El código de barras NO lleva el nombre del producto ni el vendedor.** Solo PLU + un número. Todo
  lo demás lo pone el sistema.

---

## 2. Los dos modos de trabajo (la decisión más importante)

El código de barras de la etiqueta puede llevar el **importe** o el **peso**. Se parece a un detalle
técnico y no lo es: define cuánto trabajo da mantener el sistema para siempre.

### Modo IMPORTE — no recomendado

La etiqueta trae los pesos ($) ya calculados por la balanza. El sistema deriva los kg dividiendo por
su propio precio, así que el precio se cancela y **termina cobrando lo que dice la etiqueta**.

Consecuencia: **los precios de la balanza y del sistema tienen que ser idénticos siempre.** Si
cambiás un precio solo en el sistema, la caja cobra el viejo y descuenta kg incorrectos, **sin
avisar** — para el sistema la cuenta cierra.

Y como Qendra no pisa productos existentes al importar, actualizar **un** precio obliga a borrar los
128 productos y reimportarlos enteros.

### Modo PESO — recomendado

La etiqueta trae los **gramos reales**. El sistema toma el peso de la etiqueta y el precio de su
propia lista.

- Cambiás un precio en el sistema y ya está: cobra bien y descuenta bien el stock, al instante.
- **La balanza no se toca nunca más por precios.** Se carga una sola vez con los PLU.
- Con varias sucursales, cada una actualiza su lista desde el sistema sin que nadie viaje a
  configurar balanzas.

**El costo:** la balanza sigue imprimiendo en el ticket un importe calculado con *su* precio
guardado. Si ese precio queda viejo, el papel muestra un número y la caja cobra otro. Deja de ser un
problema de plata y pasa a ser cosmético (ver §8).

> **Recomendación para instalaciones nuevas: modo peso desde el día uno.** Fabricius arrancó en
> importe y migró en 08/2026; migrar después obliga a coordinar el cambio con el mostrador cerrado.

---

## 3. Formato del código de barras

Los tres formatos conviven y **si uno queda mal armado, se rompen los tres**. Cada patrón debe sumar
exactamente 12 posiciones (la balanza agrega sola el dígito verificador).

| Tipo | Patrón | Significado |
|---|---|---|
| **Peso** | `20` + 5 PLU + 5 campo | artículos pesables — el campo es importe (modo importe) o **gramos** (modo peso) |
| **Unidad** | `21` + 4 PLU + 6 campo | artículos no pesables |
| **Suma** | `22` + 2 nro. balanza + 8 importe | el total del ticket |

El `20`/`21`/`22` es el "valor de inicio": el `2` es el prefijo y el segundo dígito identifica el
tipo. Por eso el equipo N° 20 hace que los totales arranquen con `2220`.

### Cómo lo lee el sistema

`src/lib/balanzaEAN.js` decodifica; la config vive en `config_sistema.clave='ean13_formato'`:

```json
{ "tipo": "peso", "prefijo": "2", "plu_digitos": 6, "campo_digitos": 5,
  "por_sucursal": { "2": { "tipo": "precio_pesos" } } }
```

- `1 + 6 + 5 = 12` es el mismo patrón que el `20 + 5P + 5C` de Qendra: el `0` del "20" se cuenta como
  primer dígito del PLU. Como los PLU no pasan de 3 cifras, el relleno con ceros los hace idénticos.
- **`por_sucursal` permite que cada boca esté en un modo distinto** (`src/lib/balanzaFormato.js`).
  Es imprescindible: las balanzas se reconfiguran en días distintos y una boca no puede romperse
  mientras espera su turno.

### El punto decimal no se detecta

El código son **dígitos enteros sin separador**. En modo peso el sistema asume **gramos** y divide
por 1000, siempre. `01055` → 1055 g → 1,055 kg.

Por eso **la prueba del kilo es obligatoria**: si la balanza escribiera en otra unidad, no hay forma
de notarlo salvo probando. Con 5 dígitos el tope es 99,999 kg por etiqueta y la resolución 1 gramo.

---

## 4. Instalación desde cero

### 4.1 Cargar los productos en Qendra

El asistente (Archivo → Importar) es **muy** quisquilloso. El sistema exporta el archivo ya listo
desde **Precios → 🏷️ PLU/Balanza → "⚖️ Exportar CSV para Qendra"**, en el formato nativo de Qendra:
48 columnas separadas por `;`, sin fila de títulos, precios con coma decimal, CRLF y sin BOM.

En el asistente:

1. Tipo: **Productos**, archivo `*.csv`, delimitador `;`
2. **"Primer fila como títulos" DESTILDADO**
3. **Elegí el archivo A MANO** — recuerda la ruta anterior e importa el viejo si no la cambiás
4. Mapeo **por posición desde CERO**: sección=0, N°PLU=1, descripción=2, código=3, lista1=4,
   lista2=5, tipo de venta=6, **Configuración EAN=29**, el resto sin asignar
5. Sección → tercera opción ("contiene el NOMBRE de la sección")
6. Tipo de venta → Peso/Unidad (no puede quedar sin asignar)

**Antes de iniciar, mirá el número de la pantalla final: "N registros a importar".** Si dice
**0**, no inicies — el cartel *"Importación finalizada con éxito"* aparece igual habiendo importado
cero. Verificá después en Secciones → Cantidad.

#### Probá el mapeo con DOS productos antes de importar los 128

El punto 4 del mapeo —**Configuración EAN = columna 29**— es lo que evita tener que pasar cada
producto a "EAN General" a mano. Si el asistente lo ignorara, no te enterás hasta imprimir una
etiqueta, y arreglarlo producto por producto es una mañana (pasó en Río Primero el 21/07).

Sale barato descubrirlo antes:

1. Copiá **las dos primeras líneas** del CSV a un archivo aparte. Ojo: si lo editás en un editor
   que guarde en LF o meta BOM, la prueba falla por otro motivo y te confunde. Lo más seguro es
   generarlo con el mismo código que exporta el grande.
2. Importalo con el mapeo completo. Tiene que decir **2 registros a importar**.
3. Abrí la ficha de uno → pestaña **Configuración EAN** → tiene que decir **EAN General**.
4. Si dice "EAN del PLU", el mapeo no tomó: revisá que la columna 29 esté asignada y volvé a probar.
5. Cuando dé bien: **Productos → seleccionar todo → Borrar**, y ahora sí importá los 128.

El borrado del paso 5 no es opcional: Qendra **no pisa** productos existentes, así que si dejás
los 2 de prueba y encima importás los 128, esos 2 quedan salteados con lo que ya tenían.

> ⚠️ **Sin verificar todavía (25/08/2026).** El mapeo de la columna 29 se dedujo del problema de
> Río Primero pero nunca se ejecutó: allá se arregló a mano. Monte Cristo es la primera vez que se
> usa. **Si funciona, borrá esta advertencia; si no, anotá acá qué pasó.**

### 4.2 Configurar el código de barras

**Qendra → Configuración → Códigos de barras** (nodo Equipos). Para modo peso, en la sección
*"artículos de venta por Peso"* el radio de arriba va en **"Imprimir Peso"**; el *Formato* de abajo
queda en `2 de inicio, 5 de PLU y 5 de importe/cantidad`.

No toques las secciones "por Unidad" ni "Suma".

### 4.3 Enviar a la balanza

**Qendra → Comunicación → Actualizar.** El equipo deja de figurar en amarillo (amarillo =
desactualizado, tiene cambios sin enviar).

Cambiar el formato **no requiere reimportar productos**: los PLU quedan como están.

### 4.4 Configurar el sistema y probar

**Precios → 🏷️ PLU/Balanza → "⚖️ Formato del código de barras"**: elegí el modo, **probá una
etiqueta real en el probador** (decodifica sin guardar) y recién ahí guardá.

Pesá 1 kg conocido → imprimí → escaneá en el probador → tiene que decir **1,000 kg**.

> ⚠️ **Entre §4.3 y §4.4 no se puede vender.** La balanza ya emite el formato nuevo y el sistema
> todavía lee el viejo: toda etiqueta escaneada en el medio se cobra mal.

---

## 5. Trampas conocidas

| Síntoma | Causa | Solución |
|---|---|---|
| El código del ticket sale **todo en ceros** | los productos quedaron en "EAN del PLU" con patrón vacío | cada producto debe estar en **"EAN General"**. Mapear la **columna 29** al importar lo deja bien de entrada — probalo con 2 productos primero (§4.1). Señal delatora: el código del TOTAL sí imprime |
| Quedaron en "EAN del PLU" igual, ya con los 128 adentro | el mapeo de la columna 29 no tomó | **no los arregles a mano**: Productos → seleccionar todo → Borrar → reimportar con el mapeo bien. Son minutos contra una mañana |
| "0 registros a importar, 1 con errores" | el CSV tiene saltos de línea Unix (LF) | tiene que ser **CRLF**. Se ve en el Bloc de notas, barra de estado |
| Importa y los precios siguen viejos | Qendra **no pisa** productos existentes, los saltea en silencio | borrar todos los productos en Qendra y reimportar en limpio |
| "Ya existe código/descripción/número" | se renumeraron los PLU en el sistema | ídem: borrar todo e importar de nuevo |
| El CSV se descarga con formato viejo | Chrome cachea la versión anterior del sistema | exportar desde **incógnito** (Ctrl+Shift+N) |
| La grilla de productos queda vacía o desactualizada | la ventana no se refresca sola | cerrar con Volver y reabrir |
| La caja cobra un precio viejo y descuenta kg raros | balanza y sistema con precios distintos, **en modo importe** | sincronizar precios, o mejor: pasar a modo peso |
| La tecla del vendedor B/C/D pita y no hace nada | ese vendedor nunca se logueó | **`2ª F.` + tecla del vendedor** → pide usuario y contraseña |
| El panel de Supabase explota al abrir ventanas | el **traductor de Chrome** reescribe el DOM | "Nunca traducir este sitio" |

---

## 6. Mapa de menús

### Balanza — clave de fábrica `3939`

Menú principal: `1` Totales de ventas · `2` Partes de ventas · `3` Listados · `4` Artículos: altas ·
`5` Sectores: altas · **`6` Usuarios: Alta-Baja** · **`7` Mensaje publicitario** ·
**`8` Configurar Equipo** · `9` Memoria

Dentro de `8. Configurar Equipo`:

- **Menú de impresión** → Tipo de papel · Calidad de impresión · Desgaste cabezal *(solo físico)*
- **Balanza** → Actualizar reloj · **Código de barras** · Copias comprobantes · Precios permitidos · Genéricos
- **Conectividad** → el puerto COM
- **Datos del comercio** → nombre y dirección del encabezado del ticket
- **Moneda**

**Regla de oro del teclado: todo lo impreso en NARANJA necesita `2ª F.` antes.** Las letras A/B/C/D
de las teclas de vendedor están en naranja, igual que los números sobre las teclas de letras.

Fila superior: `2ª F.` · `FEC/HOR` · `TEST IMPR.` · `PRECIO MANUAL $` · `CÓDIGO PLU / PLU` ·
`VENTA SIN IMPRESIÓN` · `ANULAR VENTA` · `PRE EMP.` · `LOTE`

### Qendra

- **Configuración** (árbol): Sistema *(Apariencia, Puertos, Comunicación, Importar, Base de Datos)* ·
  Equipos *(**Listados, Reportes y Comprobantes**, **Códigos de barras**)*
- **Administración de equipos** → pestañas General *(modo ticket/etiqueta, permisos de listas,
  "Incluir códigos de barras en tickets")* · Secciones · Publicidades · Configuración *(accesos
  directos, usuarios/vendedores, tono de impresión)* · Opciones avanzadas · Reportes · Herramientas

---

## 7. Operación diaria

**Vendedores (A/B/C/D).** La balanza maneja cuatro vendedores simultáneos. Cada uno se habilita al
empezar el turno con `2ª F.` + su tecla, usuario y contraseña; después suma con la tecla sola. Sirve
para los reportes internos de la balanza (menús 1 y 2). **El vendedor no llega al sistema** — el
código de barras solo lleva PLU y peso.

**Ofertas: van SOLO en el sistema, nunca en la balanza.** La balanza siempre lleva el precio de lista
normal y la caja aplica la oferta al escanear. Con el precio promocional cargado en la balanza el
descuento se aplica dos veces y, en modo importe, además sale mal el peso derivado.

**Mensaje del ticket.** El `7. Mensaje publicitario` imprime una línea de texto libre: nombre del
negocio, teléfono, o aclaraciones como *"el precio final se cobra en caja"*.

---

## 8. Lo que NO se puede

**Sacar el precio del ticket.** Revisados los cinco lugares posibles —Qendra (pestaña General,
accesos directos/"máscaras", Listados-Reportes-Comprobantes) y balanza (`8 → Menú de impresión`)— la
opción no existe: la Cuora Max imprime un ticket de venta y el precio es parte de ese formato.

Alternativas: usar el mensaje publicitario para aclarar, pasar de ticket a **etiqueta** (exige rollos
autoadhesivos) o simplemente convivir con eso, que en modo peso ya no cuesta plata.

---

## 9. Checklist de instalación nueva

- [ ] PLU asignados en el sistema y coincidentes con Qendra
- [ ] Mapeo de la columna 29 probado con **2 productos** antes de importar los 128 (§4.1)
- [ ] Productos importados en Qendra — verificado el "N registros a importar" y Secciones → Cantidad
- [ ] Todos los productos en **"EAN General"** — abierta la ficha de uno para confirmarlo
- [ ] Los tres formatos de código de barras con 12 posiciones, el de Peso en **"Imprimir Peso"**
- [ ] Config enviada a la balanza (el equipo ya no figura amarillo)
- [ ] Formato guardado en el sistema para **esa sucursal**
- [ ] **Prueba del kilo**: pesar 1 kg → escanear → dice 1,000 kg
- [ ] Escanear 2 o 3 productos distintos y verificar kg e importe en el carrito
- [ ] Vendedores habilitados y anotados usuario/clave de cada uno
- [ ] Datos del comercio y mensaje publicitario cargados
