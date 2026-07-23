// ═══════════════════════════════════════════════════════════
// PARTE DEL DÍA DE IRIS — briefing proactivo al primer saludo
// ═══════════════════════════════════════════════════════════
// La primera vez que abrís a Iris cada día, además de saludar te pone
// al día con lo importante SIN que le preguntes: cómo cerró ayer,
// cheques por vencer y stock flojo. Son consultas directas a Supabase
// (rápidas, deterministas, sin gastar llamadas de IA).
// Devuelve un array de frases cortas (máx 3) listas para mostrar/leer.

import { supabase } from './supabase'
import { fechaHoyARG, fechaRelativaARG, diaSemanaARG } from './fechas'
import { fmtArs } from './whatsapp'

export async function armarBriefing() {
  try {
    const hoy = fechaHoyARG()
    const ayer = fechaRelativaARG(-1)
    const antier = fechaRelativaARG(-2)
    const en3dias = fechaRelativaARG(3)

    const [ventasAyer, ventasAntier, cheques, stock] = await Promise.all([
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').eq('fecha', ayer),
      supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').eq('fecha', antier),
      // Cheques POR COBRAR (no emitidos) que vencen entre hoy y 3 días
      supabase.from('cheques').select('numero, cliente_nombre, monto, fecha_pago')
        .neq('estado', 'imputado').neq('origen', 'emitido')
        .gte('fecha_pago', hoy).lte('fecha_pago', en3dias).order('fecha_pago'),
      supabase.from('stock_actual').select('tipo, kg_disponible'),
    ])

    const items = []
    const sumar = (r) => (r.data || []).reduce((s, v) => s + (Number(v.total) || 0), 0)

    // ⏰ LUNES DE COBRANZAS: ranking de morosos. Mismo criterio que las
    // tarjetas de Clientes: mora = saldo − compras de la semana en curso
    // (lo de esta semana se cobra la próxima, no es mora). Un lunes a la
    // mañana la semana recién arranca → casi toda la deuda visible es
    // vieja: el día perfecto para salir a cobrarla.
    if (diaSemanaARG() === 'lunes') {
      const [{ data: clis }, { data: movsSem }] = await Promise.all([
        supabase.from('clientes').select('id, nombre, saldo').gt('saldo', 0),
        supabase.from('movimientos_ctacte').select('cliente_id, debe').gte('fecha', hoy).gt('debe', 0),
      ])
      const debeSem = {}
      ;(movsSem || []).forEach(m => { debeSem[m.cliente_id] = (debeSem[m.cliente_id] || 0) + (Number(m.debe) || 0) })
      const morosos = (clis || [])
        .map(c => ({ nombre: (c.nombre || '').trim(), mora: Math.max(0, (Number(c.saldo) || 0) - (debeSem[c.id] || 0)) }))
        .filter(c => c.mora > 0.01)
        .sort((a, b) => b.mora - a.mora)
      if (morosos.length > 0) {
        const total = morosos.reduce((s, c) => s + c.mora, 0)
        const top = morosos.slice(0, 3).map(c => `${c.nombre} (${fmtArs(c.mora)})`).join(', ')
        items.push(`⏰ Lunes de cobranzas: ${fmtArs(total)} en la calle de ${morosos.length} clientes. Los más grandes: ${top}.`)
      }
    }

    // 💵 Cómo cerró ayer la caja (vs anteayer si hay dato)
    const tAyer = sumar(ventasAyer)
    const tAntier = sumar(ventasAntier)
    if (tAyer > 0) {
      let linea = `💵 Ayer la caja cerró en ${fmtArs(tAyer)}`
      if (tAntier > 0) {
        const v = ((tAyer - tAntier) / tAntier) * 100
        linea += v >= 0
          ? `, un ${v.toFixed(0)}% arriba del día anterior 👏`
          : `, un ${Math.abs(v).toFixed(0)}% abajo del día anterior`
      }
      items.push(linea + '.')
    }

    // 📄 Cheques por vencer (los 2 más urgentes)
    ;(cheques.data || []).slice(0, 2).forEach(c => {
      const dias = Math.round((new Date(c.fecha_pago + 'T12:00') - new Date(hoy + 'T12:00')) / 86400000)
      const cuando = dias <= 0 ? '¡vence HOY!' : dias === 1 ? 'vence mañana' : `vence en ${dias} días`
      items.push(`📄 Cheque de ${(c.cliente_nombre || '#' + c.numero).trim()} por ${fmtArs(c.monto)} — ${cuando}`)
    })

    // 📦 Stock flojo en los rubros principales (mismos mínimos del Dashboard)
    const mapa = {}
    ;(stock.data || []).forEach(r => { mapa[r.tipo] = Number(r.kg_disponible) || 0 })
    const MINIMOS = [
      ['bovino_mr', 'media res', 100],
      ['bovino_corte', 'cortes bovinos', 50],
      ['pollo', 'pollo', 100],
      ['cerdo', 'cerdo', 50],
    ]
    const flojos = MINIMOS.filter(([tipo, , min]) => (mapa[tipo] || 0) < min).map(([, nombre]) => nombre)
    if (flojos.length > 0) items.push(`📦 Stock flojo de ${flojos.join(', ')} — fijate si hay que reponer.`)

    return items.slice(0, 3)
  } catch {
    // Sin briefing no se rompe nada: Iris saluda normal
    return []
  }
}
