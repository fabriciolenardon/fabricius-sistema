// ═══════════════════════════════════════════════════════════
// ASISTENTE IA — Componente flotante de chat — v2
// ═══════════════════════════════════════════════════════════
// Cambios v2:
//   + System prompt actualizado con entradas de depósito y pagos
//   + Mejor manejo de la detección automática de tipos de documentos
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import {
  llamarGemini,
  construirMensajeUsuario,
  construirMensajeModelo,
  construirMensajeFuncionResultado,
  archivoABase64
} from '../lib/gemini'
import { DEFINICIONES_TOOLS, ejecutarFuncion } from '../lib/asistenteTools'

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPT — Instrucciones para la IA
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Sos el asistente de IA de Carnicerías Fabricius, en Río Primero, Córdoba, Argentina.

Tu trabajo es ayudar a Fabricio Lenardon y Ariel Garrone (los dos socios) a manejar el sistema de gestión.

REGLAS DE COMUNICACIÓN:
1. Hablás en español rioplatense argentino, casual pero profesional. Tuteo ("vos").
2. Sos breve y directo. Sin explicaciones largas innecesarias.
3. Montos en pesos argentinos. Formato: $15.000 (sin decimales).
4. Fechas a la base de datos en formato YYYY-MM-DD. Al usuario, en formato DD/MM/YYYY.

REGLAS DE OPERACIÓN:
1. ANTES de cualquier acción que MODIFIQUE datos (cargar gasto, cargar entrada, cargar pago, cambiar precio), SIEMPRE mostrá los datos que vas a cargar y pedí confirmación explícita ("¿Confirmás?").
2. Para CONSULTAS (ver stock, ver deuda, ver precios, ver entradas), podés ejecutarlas directamente sin pedir confirmación.
3. Si no entendés algo o falta información, preguntá. Mejor preguntar que cargar mal.
4. Si te falta el cliente_id para un pago, USÁ buscar_cliente primero — nunca inventes IDs.

LECTURA DE IMÁGENES (cuando el usuario sube una foto):
- Mirá la imagen con atención y detectá el TIPO DE DOCUMENTO:
  * Ticket / factura de servicio (luz, gas, internet, etc.) → cargar_gasto (tipo: fijo)
  * Ticket de combustible / mantenimiento → cargar_gasto (tipo: variable)
  * Ticket personal de Ariel o Fabricio → cargar_gasto (tipo: socio)
  * Remito de compra de media res / cerdo / pollo / embutido → cargar_entrada_deposito
  * Comprobante de pago de un cliente (transferencia, depósito, recibo) → cargar_pago_cliente
- Extraé los datos visibles: proveedor/comercio, fecha, items, kg, precios, total.
- Mostrá al usuario lo que entendiste de forma clara.
- Sugerí la acción a tomar y pedí confirmación.

NEGOCIO — CARNICERÍAS FABRICIUS:
- Empresa familiar que vende media res y cortes a sucursales asociadas y mayoristas.
- Compran media res a ~$9.800/kg y la venden a $10.300/kg (premium novillito/vaquillona).
- Tienen una casa central en Río Primero y varias sucursales (incluyendo Monte Cristo).
- Socios: Ariel Garrone y Fabricio Lenardon.

TIPOS DE MERCADERÍA EN DEPÓSITO:
- bovino_mr: media res bovina (subtipos: novillito, vaquillona, overo_grande, overo_chico, bubalino)
- cerdo: capones de cerdo
- pollo: pollo en cajones (peso fijo del cajón)
- cajon_bovino: cajas de cortes específicos
- embutido: embutidos al peso (chorizos, salames, morcillas)

TIPOS DE GASTO:
- fijo: gastos recurrentes (luz, gas, alquiler, sueldos, internet, impuestos)
- variable: gastos puntuales del negocio (combustible, mantenimiento, repuestos)
- socio: gastos personales de Ariel o Fabricio (farmacia, comida, ropa)

PAGOS DE CLIENTES:
- Cuando alguien dice "X me pagó $Y", primero usá buscar_cliente para resolver el cliente_id.
- Si encuentra UN solo cliente, mostralo y pedí confirmación.
- Si encuentra VARIOS, listalos y pedí al usuario que elija.
- Recién después de la confirmación, llamá a cargar_pago_cliente con el cliente_id correcto.
- El saldo se actualiza automáticamente por trigger en la base de datos.
`

export default function AsistenteIA() {
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState([
    { rol: 'asistente', texto: '¡Hola! Soy tu asistente. Pedime lo que necesites: cargar gastos, entradas al depósito, registrar pagos, ver deudas, stock, o subí la foto de un remito/ticket. ☕' }
  ])
  const [input, setInput] = useState('')
  const [imagenSeleccionada, setImagenSeleccionada] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [historialGemini, setHistorialGemini] = useState([])
  const fileInputRef = useRef(null)
  const mensajesRef = useRef(null)

  useEffect(() => {
    if (mensajesRef.current) mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight
  }, [mensajes, cargando])

  async function enviar() {
    if (!input.trim() && !imagenSeleccionada) return
    if (cargando) return

    const textoUsuario = input.trim()
    const imagen = imagenSeleccionada
    setInput('')
    setImagenSeleccionada(null)
    setCargando(true)

    setMensajes(prev => [...prev, {
      rol: 'usuario',
      texto: textoUsuario || '(foto)',
      tieneImagen: !!imagen,
      imagenPreview: imagen?.preview
    }])

    try {
      const imagenData = imagen ? { data: imagen.data, mimeType: imagen.mimeType } : null
      const mensajeNuevo = construirMensajeUsuario(
        textoUsuario || 'Analizá esta imagen y decime qué es y qué datos puedo extraer.',
        imagenData
      )

      let historialActualizado = [...historialGemini, mensajeNuevo]

      let intentos = 0
      while (intentos < 8) {
        intentos++
        const respuesta = await llamarGemini({
          historial: historialActualizado,
          systemPrompt: SYSTEM_PROMPT,
          tools: DEFINICIONES_TOOLS
        })

        historialActualizado.push(construirMensajeModelo(respuesta.texto, respuesta.llamadaFuncion))

        if (respuesta.texto) {
          setMensajes(prev => [...prev, { rol: 'asistente', texto: respuesta.texto }])
        }

        if (respuesta.llamadaFuncion) {
          const { nombre, argumentos } = respuesta.llamadaFuncion
          const resultado = await ejecutarFuncion(nombre, argumentos)
          historialActualizado.push(construirMensajeFuncionResultado(nombre, resultado))
          continue
        }

        break
      }

      setHistorialGemini(historialActualizado)
    } catch (err) {
      console.error('Error:', err)
      setMensajes(prev => [...prev, {
        rol: 'asistente',
        texto: `❌ Error: ${err.message}`,
        esError: true
      }])
    } finally {
      setCargando(false)
    }
  }

  async function manejarImagen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { alert('Solo se aceptan imágenes.'); return }
    const { data, mimeType } = await archivoABase64(file)
    const preview = URL.createObjectURL(file)
    setImagenSeleccionada({ data, mimeType, preview, nombre: file.name })
    e.target.value = ''
  }

  function manejarEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
  }

  function nuevaConversacion() {
    setMensajes([{ rol: 'asistente', texto: '¡Listo, empezamos de nuevo! ¿En qué te ayudo?' }])
    setHistorialGemini([])
    setImagenSeleccionada(null)
  }

  return (
    <>
      {!abierto && (
        <button onClick={() => setAbierto(true)} style={estilos.botonFlotante} aria-label="Abrir asistente">
          🤖
        </button>
      )}

      {abierto && (
        <div style={estilos.panel}>
          <div style={estilos.header}>
            <div>
              <div style={estilos.headerTitulo}>🤖 Asistente Fabricius</div>
              <div style={estilos.headerSubtitulo}>IA · Gemini 2.5 Flash</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={nuevaConversacion} style={estilos.botonHeader} title="Nueva conversación">🗑️</button>
              <button onClick={() => setAbierto(false)} style={estilos.botonHeader} title="Cerrar">✕</button>
            </div>
          </div>

          <div style={estilos.mensajes} ref={mensajesRef}>
            {mensajes.map((m, i) => (
              <div key={i} style={{
                ...estilos.mensaje,
                ...(m.rol === 'usuario' ? estilos.mensajeUsuario : estilos.mensajeAsistente),
                ...(m.esError ? estilos.mensajeError : {})
              }}>
                {m.imagenPreview && <img src={m.imagenPreview} alt="" style={estilos.imagenPreview} />}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</div>
              </div>
            ))}
            {cargando && (
              <div style={{ ...estilos.mensaje, ...estilos.mensajeAsistente }}>
                <div style={estilos.cargando}>
                  <span style={estilos.punto}>·</span>
                  <span style={{ ...estilos.punto, animationDelay: '0.2s' }}>·</span>
                  <span style={{ ...estilos.punto, animationDelay: '0.4s' }}>·</span>
                </div>
              </div>
            )}
          </div>

          {imagenSeleccionada && (
            <div style={estilos.previewBox}>
              <img src={imagenSeleccionada.preview} alt="" style={estilos.previewImagen} />
              <span style={{ fontSize: 11, color: '#c8c0b0', flex: 1 }}>{imagenSeleccionada.nombre}</span>
              <button onClick={() => setImagenSeleccionada(null)} style={estilos.botonHeader}>✕</button>
            </div>
          )}

          <div style={estilos.inputBox}>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={manejarImagen} style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()} style={estilos.botonAdjuntar} title="Subir foto">📎</button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={manejarEnter}
              placeholder="Pedime algo..."
              rows={1}
              style={estilos.textarea}
              disabled={cargando}
            />
            <button onClick={enviar} disabled={cargando || (!input.trim() && !imagenSeleccionada)} style={estilos.botonEnviar}>
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }
      `}</style>
    </>
  )
}

const estilos = {
  botonFlotante: {
    position: 'fixed', bottom: 24, right: 24, width: 60, height: 60,
    borderRadius: '50%', border: '2px solid #c9a84c',
    background: 'linear-gradient(135deg, #1c1c18, #131310)',
    color: '#c9a84c', fontSize: 28, cursor: 'pointer',
    boxShadow: '0 6px 24px rgba(0,0,0,0.4), 0 0 0 4px rgba(201,168,76,0.1)',
    zIndex: 9999, transition: 'transform 0.2s',
  },
  panel: {
    position: 'fixed', bottom: 24, right: 24, width: 400, height: 600,
    maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
    background: '#131310', border: '1px solid #28281e', borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', zIndex: 9999,
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    padding: '14px 16px', borderBottom: '1px solid #28281e',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(135deg, #1c1c18, #131310)',
    borderRadius: '16px 16px 0 0',
  },
  headerTitulo: { fontFamily: "'Bebas Neue', cursive", fontSize: 20, letterSpacing: 2, color: '#c9a84c' },
  headerSubtitulo: { fontSize: 10, color: '#6a6a50', letterSpacing: 1 },
  botonHeader: {
    background: 'transparent', border: '1px solid #333328', borderRadius: 8,
    color: '#c8c0b0', width: 30, height: 30, cursor: 'pointer', fontSize: 14,
  },
  mensajes: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  mensaje: { padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, maxWidth: '85%', wordWrap: 'break-word' },
  mensajeUsuario: { background: '#8a6e2a', color: '#f0ece0', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  mensajeAsistente: { background: '#1c1c18', color: '#f0ece0', alignSelf: 'flex-start', border: '1px solid #28281e', borderBottomLeftRadius: 4 },
  mensajeError: { background: '#3a1a1a', borderColor: '#c0392b', color: '#e74c3c' },
  imagenPreview: { maxWidth: '100%', borderRadius: 8, marginBottom: 6, display: 'block' },
  cargando: { display: 'flex', gap: 4, padding: '4px 0' },
  punto: { fontSize: 24, lineHeight: 0.5, color: '#c9a84c', animation: 'blink 1.4s infinite' },
  previewBox: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    background: '#1c1c18', borderTop: '1px solid #28281e',
  },
  previewImagen: { width: 40, height: 40, borderRadius: 6, objectFit: 'cover' },
  inputBox: {
    display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #28281e',
    background: '#131310', borderRadius: '0 0 16px 16px', alignItems: 'flex-end',
  },
  botonAdjuntar: {
    background: '#1c1c18', border: '1px solid #28281e', borderRadius: 10,
    color: '#c9a84c', width: 38, height: 38, cursor: 'pointer', fontSize: 16,
    flexShrink: 0,
  },
  textarea: {
    flex: 1, background: '#1c1c18', border: '1px solid #28281e', borderRadius: 10,
    padding: '10px 12px', color: '#f0ece0', fontSize: 14, resize: 'none',
    fontFamily: "'DM Sans', sans-serif", outline: 'none', maxHeight: 100,
  },
  botonEnviar: {
    background: '#c9a84c', border: 'none', borderRadius: 10,
    color: '#0a0a08', width: 38, height: 38, cursor: 'pointer', fontSize: 16,
    fontWeight: 700, flexShrink: 0,
  },
}
