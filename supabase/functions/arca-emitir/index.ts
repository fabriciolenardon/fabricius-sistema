// =============================================================================
// EDGE FUNCTION: arca-emitir  (CONEXIÓN DIRECTA, sin AfipSDK)
// =============================================================================
// Emite un comprobante electrónico contra ARCA y devuelve el CAE.
//   1) WSAA: obtiene/usa el TA (token+sign) firmando con el certificado.
//   2) WSFEv1: FECompUltimoAutorizado → siguiente número.
//   3) WSFEv1: FECAESolicitar → CAE (o Errores/Observaciones).
//   4) Guarda la fila en `facturas`.
//
// Soporta: Factura A/B/C, IVA por alícuota (carne 10,5%), detalle de ítems,
// y APODERADO (certificado de un CUIT distinto del emisor). ARCA recibe solo
// los totales; el detalle de productos es para el PDF. Nunca se inventa un CAE.
// =============================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getTA } from './wsaa.ts'
import { ultimoAutorizado, solicitarCAE, detResponse, extraerErrores, extraerObservaciones } from './wsfe.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Facturas: A=1, B=6, C=11 · Notas de Débito: A=2, B=7, C=12 · Notas de Crédito: A=3, B=8, C=13
const COMPROBANTES_OK = new Set([1, 2, 3, 6, 7, 8, 11, 12, 13])
const CODIGOS_C = new Set([11, 12, 13])   // letra C (sin IVA discriminado): Factura/ND/NC C
const CODIGOS_A = new Set([1, 2, 3])      // letra A
const IVA_IDS_OK = new Set([3, 4, 5, 6, 8, 9])
const IVA_PCT: Record<number, number> = { 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Falta autenticación', 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !user) return jsonError('No autenticado', 401)
    const { data: profile } = await supabaseUser.from('profiles').select('rol').eq('id', user.id).single()
    if (profile?.rol !== 'admin') return jsonError('Solo el administrador puede emitir', 403)

    const body = await req.json().catch(() => ({}))
    const cuenta_id = Number(body.cuenta_id)
    if (!cuenta_id) return jsonError('cuenta_id es obligatorio')
    const comprobante_codigo = Number(body.comprobante_codigo)
    if (!COMPROBANTES_OK.has(comprobante_codigo)) return jsonError('Comprobante no soportado (Factura/NC/ND A, B o C)')
    const iva_id = IVA_IDS_OK.has(Number(body.iva_id)) ? Number(body.iva_id) : 4
    const esC = CODIGOS_C.has(comprobante_codigo)
    const esNotaCD = [2, 3, 7, 8, 12, 13].includes(comprobante_codigo) // Nota de Crédito/Débito

    // Importes: desde ítems (detalle) o modo simple.
    let items = Array.isArray(body.items) ? body.items.filter((it: any) => it && Number(it.cantidad) > 0) : null
    if (items && items.length === 0) items = null
    let impNeto = 0, impIva = 0, impTotal = 0
    let ivaArray: Array<{ Id: number; BaseImp: number; Importe: number }> = []
    const itemsCalc: any[] = []
    if (items) {
      for (const it of items) {
        const cant = Number(it.cantidad) || 0
        const pu = Number(it.precio_unit) || 0
        const neto = round2(cant * pu)
        const ivaId = esC ? 0 : (IVA_IDS_OK.has(Number(it.iva_id)) ? Number(it.iva_id) : 4)
        const pct = esC ? 0 : (IVA_PCT[ivaId] ?? 0)
        const iva = round2(neto * pct / 100)
        itemsCalc.push({ descripcion: String(it.descripcion || '').slice(0, 200), cantidad: cant, precio_unit: pu, iva_id: esC ? null : ivaId, neto, iva, total: round2(neto + iva) })
      }
      impNeto = round2(itemsCalc.reduce((s, i) => s + i.neto, 0))
      impIva = esC ? 0 : round2(itemsCalc.reduce((s, i) => s + i.iva, 0))
      impTotal = round2(impNeto + impIva)
      if (!esC) {
        const groups: Record<number, { base: number; imp: number }> = {}
        for (const i of itemsCalc) { if (!groups[i.iva_id]) groups[i.iva_id] = { base: 0, imp: 0 }; groups[i.iva_id].base = round2(groups[i.iva_id].base + i.neto); groups[i.iva_id].imp = round2(groups[i.iva_id].imp + i.iva) }
        ivaArray = Object.entries(groups).map(([id, g]) => ({ Id: Number(id), BaseImp: g.base, Importe: g.imp }))
      }
    } else {
      impTotal = round2(Number(body.importe_total))
      const impIvaIn = round2(Number(body.importe_iva) || 0)
      let neto = round2(Number(body.importe_neto) || 0)
      if (esC) { neto = impTotal; impIva = 0 } else { if (!(neto > 0)) neto = round2(impTotal - impIvaIn); impIva = impIvaIn }
      impNeto = neto
      if (!esC && impIva > 0) ivaArray = [{ Id: iva_id, BaseImp: impNeto, Importe: impIva }]
    }
    if (!(impTotal > 0)) return jsonError('El total debe ser mayor a 0')

    const doc_tipo = Number(body.doc_tipo) || 99
    const doc_nro = String(body.doc_nro || '0').replace(/[-\s.]/g, '') || '0'
    const cond_iva_receptor = Number(body.cond_iva_receptor) || 5
    const concepto = Number(body.concepto) || 1
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) ? String(body.fecha) : fechaHoyARG()

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: cuenta, error: cuentaErr } = await supabaseAdmin.from('cuentas_fiscales').select('id, nombre, cuit').eq('id', cuenta_id).single()
    if (cuentaErr || !cuenta) return jsonError('Cuenta no encontrada')
    const { data: cfg } = await supabaseAdmin.from('arca_config').select('*').eq('cuenta_id', cuenta_id).single()
    if (!cfg?.cert || !cfg?.key) return jsonError('La cuenta no tiene credenciales ARCA cargadas')

    const ambiente = cfg.ambiente === 'produccion' ? 'produccion' : 'homologacion'
    const punto_venta = Number(cfg.punto_venta) || 1
    const cuitNum = Number(String(cuenta.cuit).replace(/[-\s.]/g, ''))           // emisor
    const certCuit = String(cfg.cert_cuit || cuenta.cuit).replace(/[-\s.]/g, '') // titular del certificado

    // 1) WSAA — TA del titular del certificado (apoderado si difiere)
    const ta = await getTA(supabaseAdmin, { certCuit, ambiente, cert: cfg.cert, key: cfg.key })
    if (!ta.ok || !ta.token || !ta.sign) return jsonError('No se pudo autenticar con ARCA: ' + (ta.error || 'sin token'))
    const Auth = { Token: ta.token, Sign: ta.sign, Cuit: cuitNum } // emite a nombre del emisor

    // 2) Último autorizado → siguiente número
    const ult = await ultimoAutorizado(ambiente, Auth, punto_venta, comprobante_codigo)
    if (!ult.ok) return jsonError('No se pudo consultar el último comprobante: ' + ult.error)
    const numero = (ult.nro || 0) + 1
    const letraComp = esC ? 'C' : (CODIGOS_A.has(comprobante_codigo) ? 'A' : 'B')

    // Comprobante asociado (obligatorio en Notas de Crédito/Débito): la factura original.
    let cbtesAsoc: Array<Record<string, unknown>> | null = null
    if (esNotaCD) {
      const a = body.cbte_asoc || {}
      const aTipo = Number(a.tipo) || 0, aPtoVta = Number(a.pto_vta) || 0, aNro = Number(a.nro) || 0
      if (!aTipo || !aPtoVta || !aNro) return jsonError('Una Nota de Crédito/Débito necesita el comprobante original asociado (tipo, punto de venta y número).')
      const aFch = /^\d{4}-\d{2}-\d{2}$/.test(String(a.fecha || '')) ? String(a.fecha).replace(/-/g, '') : null
      cbtesAsoc = [{ Tipo: aTipo, PtoVta: aPtoVta, Nro: aNro, Cuit: cuitNum, ...(aFch ? { CbteFch: aFch } : {}) }]
    }

    // 3) FECAESolicitar
    const fch = fecha.replace(/-/g, '')
    const det: Record<string, any> = {
      Concepto: concepto, DocTipo: doc_tipo, DocNro: Number(doc_nro) || 0,
      CbteDesde: numero, CbteHasta: numero, CbteFch: fch,
      ImpTotal: impTotal, ImpTotConc: 0, ImpNeto: impNeto, ImpOpEx: 0, ImpTrib: 0,
      ImpIVA: esC ? 0 : impIva, MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: cond_iva_receptor,
      ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
    }
    if (concepto !== 1) { det.FchServDesde = fch; det.FchServHasta = fch; det.FchVtoPago = fch }

    const sol = await solicitarCAE(ambiente, Auth, { ptoVta: punto_venta, cbteTipo: comprobante_codigo, det, ivaArray })
    if (!sol.ok) return jsonError('Error llamando a ARCA: ' + sol.error)

    const res = sol.result
    const dResp = detResponse(res)
    const resultado = String(res?.FeCabResp?.Resultado || dResp?.Resultado || '')
    const errores = [extraerErrores(res), extraerObservaciones(dResp)].filter(Boolean).join(' · ')

    const filaBase = {
      cuenta_id, tipo: 'emitida', clasificacion: 'venta', fecha,
      punto_venta: String(punto_venta).padStart(5, '0'), numero: String(numero).padStart(8, '0'),
      tipo_comprobante: letraComp, comprobante_codigo, doc_tipo, doc_nro, cond_iva_receptor,
      monto_neto: impNeto, monto_iva: esC ? 0 : impIva, monto_otros: 0, monto_total: impTotal,
      contraparte_id: body.contraparte_id || null, contraparte_nombre: body.contraparte_nombre || null,
      contraparte_cuit: body.contraparte_cuit || null, contraparte_iva: body.contraparte_iva || null,
      concepto: body.descripcion || null, condicion_pago: body.condicion_pago || 'contado',
      items: itemsCalc.length ? itemsCalc : null, emitida_por_arca: true,
    }
    const cbteAsocGuardar = cbtesAsoc ? body.cbte_asoc : null // referencia del comprobante original (NC/ND)

    if (resultado !== 'A' || !dResp?.CAE) {
      const { data: filaRech } = await supabaseAdmin.from('facturas').insert({
        ...filaBase, arca_estado: resultado === 'R' ? 'rechazada' : 'error',
        arca_resultado: { resultado, errores, cbte_asoc: cbteAsocGuardar },
      }).select('id').single()
      return jsonError(`ARCA rechazó el comprobante: ${errores || 'sin detalle'}`, 422, { factura_id: filaRech?.id, estado: resultado === 'R' ? 'rechazada' : 'error', errores })
    }

    const cae = String(dResp.CAE)
    const caeVtoRaw = String(dResp.CAEFchVto || '')
    const cae_vto = caeVtoRaw.length === 8 ? `${caeVtoRaw.slice(0, 4)}-${caeVtoRaw.slice(4, 6)}-${caeVtoRaw.slice(6, 8)}` : null

    const { data: fila, error: insErr } = await supabaseAdmin.from('facturas').insert({
      ...filaBase, cae, cae_vto, arca_estado: 'autorizada', arca_resultado: { resultado, observaciones: errores || null, cbte_asoc: cbteAsocGuardar },
    }).select('*').single()
    if (insErr) return jsonError(`Se obtuvo CAE ${cae} pero falló el guardado local: ${insErr.message}. Anotá el número ${punto_venta}-${numero} y el CAE.`, 500, { cae, cae_vto, numero, punto_venta })

    return jsonOk({ factura_id: fila.id, estado: 'autorizada', cae, cae_vto, punto_venta, numero, comprobante_codigo, cuit_emisor: cuitNum, importe_total: impTotal, observaciones: errores || null })
  } catch (err) {
    return jsonError('Error inesperado: ' + (err instanceof Error ? err.message : String(err)), 500)
  }
})

function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100 }
function fechaHoyARG(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }

function jsonOk(payload: Record<string, unknown>) { return new Response(JSON.stringify({ ok: true, ...payload }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
function jsonError(msg: string, status = 400, extra: Record<string, unknown> = {}) { return new Response(JSON.stringify({ ok: false, error: msg, ...extra }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
