# 🤖 ASISTENTE IA — CARNICERÍAS FABRICIUS

## CÓMO INSTALARLO (3 minutos)

---

### 📦 PASO 1 — DESCOMPRIMIR EN TU CARPETA

1. Tomá este ZIP
2. Extraelo **DENTRO** de tu carpeta `fabricius-app`
3. Los archivos se van a meter solos en su lugar:
   - `src/components/AsistenteIA.jsx`
   - `src/lib/gemini.js`
   - `src/lib/asistenteTools.js`

⚠️ Si el descompresor te pregunta "¿reemplazar archivos?", elegí **No** (por las dudas), porque estos son archivos NUEVOS.

---

### 💾 PASO 2 — CREAR LA TABLA `gastos` EN SUPABASE

1. Entrá a https://supabase.com
2. Abrí tu proyecto **fabricius-sistema**
3. Menú izquierdo → **SQL Editor**
4. Clickeá **"New query"**
5. Copiá y pegá esto:

```sql
CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  monto NUMERIC NOT NULL,
  categoria TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  sucursal TEXT,
  creado_por TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

6. Clickeá **Run ▶️** (o Ctrl+Enter)
7. Tiene que decir **"Success. No rows returned"** ✅

---

### ✏️ PASO 3 — IMPORTAR EL ASISTENTE EN TU APP

Abrí `src/App.jsx` en el Bloc de notas.

**Arriba del todo** (donde tenés los otros `import`), agregá esta línea:

```jsx
import AsistenteIA from './components/AsistenteIA'
```

Ahora buscá en el archivo el JSX principal — el que envuelve toda la app del administrador. Justo **ANTES** del último `</div>` o `</>` de tu componente principal, agregá:

```jsx
<AsistenteIA />
```

💡 Si querés que el asistente aparezca solo cuando estás logueado, ponelo adentro del bloque donde verifiques el login.

Guardá el archivo.

---

### 🚀 PASO 4 — SUBIRLO A GITHUB Y DEPLOY

Abrí el **símbolo del sistema** (CMD) o terminal dentro de la carpeta `fabricius-app` y ejecutá:

```
git add .
git commit -m "asistente IA con Gemini"
git push
```

Esperá 2 minutos. Vercel va a hacer el deploy automáticamente.

---

### ✅ PASO 5 — PROBARLO

1. Entrá a tu sistema (mejor en **modo incógnito** para evitar caché)
2. Vas a ver un **botón redondo con 🤖** abajo a la derecha
3. Clickealo
4. Probá estos comandos:

   - "¿Cuánto stock hay?"
   - "¿Qué clientes tienen deuda?"
   - "Cargame un gasto de $5000 de combustible"
   - Subí una foto de un ticket con el botón 📎

---

## ❓ SI ALGO FALLA

Mandame el error y lo resolvemos. Las cosas más comunes que pueden fallar:

1. **"Falta la API key de Gemini"** → revisá que en Vercel la variable se llame exactamente `VITE_GEMINI_API_KEY`
2. **"Table 'gastos' does not exist"** → falta correr el SQL del Paso 2
3. **"Cannot find module 'AsistenteIA'"** → el archivo no quedó en `src/components/`
4. **Nombres de tablas distintos** → si tus tablas tienen otros nombres, los ajustamos en `asistenteTools.js`

---

## 🔮 PRÓXIMOS PASOS

Una vez que el asistente esté andando, podemos sumar:
- Cargar entrada de depósito por foto del remito
- Cargar pagos de clientes
- Actualizar precios por voz
- Reportes semanales automáticos
- Mucho más 💪
