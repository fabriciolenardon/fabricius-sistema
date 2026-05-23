// ============================================================
// PDF Printable — abre una ventana imprimible (HTML → PDF)
// ============================================================
// El usuario hace Ctrl+P y elige "Guardar como PDF". Sin libs
// externas, sin dependencias. Todo client-side.
// ============================================================

export function abrirVentanaImprimible({ titulo = 'Documento', contenidoHtml, autoprint = true }) {
  const w = window.open('', '_blank', 'width=900,height=1200')
  if (!w) {
    alert('El navegador bloqueó la ventana emergente. Habilitalo y volvé a intentar.')
    return
  }
  const css = `
    <style>
      @page { margin: 14mm 12mm; }
      body { font-family: 'Helvetica', 'Arial', sans-serif; color: #111; margin: 0; padding: 0; }
      .h1 { font-size: 26px; font-weight: 800; margin: 0 0 4px; letter-spacing: 1px; }
      .h2 { font-size: 16px; font-weight: 700; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #c9a84c; }
      .sub { font-size: 11px; color: #666; margin-bottom: 14px; }
      .badge { display: inline-block; background: #c9a84c; color: #000; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 1px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
      th { background: #1a1408; color: #c9a84c; padding: 8px 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      td { padding: 7px 6px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) td { background: #fafafa; }
      .right { text-align: right; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .gold { color: #b8902a; }
      .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 10px; color: #888; text-align: center; }
      .precio-old { text-decoration: line-through; color: #999; font-size: 10px; }
      .precio-new { color: #2a8a2a; font-weight: 700; }
      .oferta-badge { background: #4a8a2a; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; margin-left: 4px; }
      @media print {
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
      }
    </style>
  `
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>${css}</head><body>${contenidoHtml}</body></html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
  if (autoprint) {
    setTimeout(() => { try { w.print() } catch {} }, 500)
  }
}
