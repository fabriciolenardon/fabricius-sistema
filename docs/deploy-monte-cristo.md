# Deploy separado de Monte Cristo (y de cualquier franquicia)

Cómo darle a una boca su propia dirección y poder actualizarla sin tocar la
central — y qué NO resuelve esto.

## Lo que separa y lo que no

| | ¿Separado? |
|---|---|
| La app (pantallas, versión desplegada) | **Sí**, con este esquema |
| La dirección web / marca | **Sí** |
| Los datos (ventas, stock, cta cte) | Ya estaban separados, por `sucursal_id` + RLS (migraciones 92-95 y 100) |
| La base de datos | **No**: es la misma para las dos bocas |

Que la base sea una sola es a propósito: **la venta de la central es la compra
de la sucursal**. Un remito escribe la cuenta corriente del cliente, el libro
de proveedores de la sucursal, su ingreso de mercadería y su stock, todo en una
operación. En bases separadas eso sería una integración con sus fallas.

**Consecuencia práctica: el código puede divergir, los datos no.** Si un cambio
para Monte Cristo necesita una migración, esa migración corre para las dos.

## Montarlo (una sola vez, en la cuenta de Vercel)

1. Vercel → **Add New → Project** → el mismo repo `fabricius-sistema`.
2. Nombre: `fabricius-monte-cristo`.
3. **Settings → Git → Production Branch: `montecristo`** (la rama ya existe).
4. **Settings → Environment Variables**: copiar TODAS las del proyecto actual
   (mismas claves de Supabase: es la misma base) y agregar una nueva:
   `DEPLOY_SECUNDARIO = 1`.
   Sin esa variable el cron de `api/recordatorio-compras` corre **dos veces** y
   Iris manda el aviso de compras duplicado.
5. Deploy. Queda en `fabricius-monte-cristo.vercel.app` (o el dominio que se le
   ponga).

El webhook de WhatsApp de Meta sigue apuntando al deploy de la central: no se
toca.

## El día a día

La rama `montecristo` **no es un fork**: es un canal de release. Lo normal es
que sea idéntica a `main`.

```bash
# Pasarle a Monte Cristo todo lo que se mergeó en main (lo habitual)
git checkout montecristo && git merge origin/main && git push
```

- **Arreglo o mejora general** → va a `main` como siempre, y después se le pasa
  a `montecristo` con el merge de arriba.
- **Algo solo para ellos** → primero preguntarse si no conviene resolverlo con
  el flag `esSucursal` (que ya existe y sirve para las dos bocas, sin duplicar
  código). Si igual va solo en la rama, que sean pocos commits y anotarlos acá.
- **Congelarles la versión** (ej. probar algo grande en la central sin moverles
  el piso): simplemente no mergear `main` en `montecristo` por unos días.

## La regla que evita el dolor

Cuanto más se separa `montecristo` de `main`, más caro es todo: cada arreglo
hay que llevarlo a mano a cada rama, y una versión vieja puede romperse cuando
la central aplica una migración. Si la rama empieza a acumular cambios propios,
es señal de que ese cambio debería ser un `esSucursal` en `main`.
