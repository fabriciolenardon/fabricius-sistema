// Impresión robusta vía iframe oculto.
//
// Antes se imprimía con `window.open('', '_blank')` + un `<script>window.print()</script>`
// dentro del popup. En tablet/celular/PWA (el caso del kiosko en el mostrador)
// eso abría una vista en blanco que tapaba toda la app y dejaba el diálogo de
// impresión "colgado" sin verse: clickeabas en cualquier parte y no respondía
// nada. También fallaba si el navegador bloqueaba el popup (win === null).
//
// Este helper escribe el HTML en un iframe oculto dentro de la misma página, así
// el diálogo de impresión queda atado a la ventana actual, nunca tapa la app y el
// iframe se autolimpia al terminar de imprimir.
export function imprimirHTML(html) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)

  const limpiar = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }

  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  const lanzar = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.onafterprint = () => setTimeout(limpiar, 100)
      iframe.contentWindow.print()
      // Fallback por si onafterprint no dispara en algún navegador.
      setTimeout(limpiar, 60000)
    } catch (e) {
      console.warn('No se pudo imprimir:', e)
      limpiar()
    }
  }

  if (doc.readyState === 'complete') setTimeout(lanzar, 50)
  else iframe.contentWindow.onload = lanzar
}
