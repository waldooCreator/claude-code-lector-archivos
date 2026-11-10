// La hoja de cálculo: celdas, fórmulas sencillas y lo que hay que guardar.

import type { DocHoja, Estilo, Guardado, Hoja } from '../types'

export type Valor = number | string | boolean | null
export type CeldaE = { v: Valor; m?: string; f?: string; s?: number; tocada?: boolean }

export type HojaE = {
  nombre: string
  filas: number
  cols: number
  celdas: Map<string, CeldaE>
  estilos: Estilo[]
  anchos: Record<string, number>
  combinadas: [number, number, number, number][]
  congela: [number, number]
  oculta?: 1
  scrollF: number
  scrollC: number
  cur: [number, number]
  ancla: [number, number] | null
}

export type EstadoHoja = {
  doc: DocHoja & { firma: string }
  hojas: HojaE[]
  activa: number
  /** Texto en edición de la celda activa. */
  edicion: { texto: string; cur: number } | null
  deshacer: { h: number; k: string; antes: CeldaE | null; despues: CeldaE | null }[][]
  rehacer: { h: number; k: string; antes: CeldaE | null; despues: CeldaE | null }[][]
  sucio: boolean
}

const clave = (f: number, c: number) => `${f},${c}`

export function letraDe(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function columnaDe(s: string): number {
  let n = 0
  for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

export const refDe = (f: number, c: number) => `${letraDe(c)}${f + 1}`

function aHojaE(h: Hoja): HojaE {
  const celdas = new Map<string, CeldaE>()
  for (const [f, c, v, m, fx, s] of h.celdas) {
    const celda: CeldaE = { v: v ?? null }
    if (m) celda.m = m
    if (fx) celda.f = fx
    if (s !== undefined && s !== null) celda.s = s
    celdas.set(clave(f, c), celda)
  }
  return {
    nombre: h.nombre,
    filas: h.filas,
    cols: h.cols,
    celdas,
    estilos: h.estilos,
    anchos: h.anchos,
    combinadas: h.combinadas ?? [],
    congela: h.congela ?? [0, 0],
    oculta: h.oculta,
    scrollF: 0,
    scrollC: 0,
    cur: [0, 0],
    ancla: null,
  }
}

export function nuevaHoja(doc: DocHoja & { firma: string }): EstadoHoja {
  const hojas = doc.hojas.map(aHojaE)
  const activa = Math.max(0, hojas.findIndex(h => !h.oculta))
  return { doc, hojas, activa, edicion: null, deshacer: [], rehacer: [], sucio: false }
}

// ── Fórmulas

type Token = { t: 'num'; v: number } | { t: 'txt'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string }
type Nodo =
  | { k: 'val'; v: Valor }
  | { k: 'celda'; hoja?: string; f: number; c: number }
  | { k: 'rango'; hoja?: string; f1: number; c1: number; f2: number; c2: number }
  | { k: 'fn'; n: string; a: Nodo[] }
  | { k: 'bin'; op: string; a: Nodo; b: Nodo }
  | { k: 'neg'; a: Nodo }
  | { k: 'pct'; a: Nodo }

const ALIAS: Record<string, string> = {
  SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', SI: 'IF', REDONDEAR: 'ROUND', ENTERO: 'INT',
  LARGO: 'LEN', MAYUSC: 'UPPER', MINUSC: 'LOWER', CONCATENAR: 'CONCATENATE', Y: 'AND', O: 'OR', NO: 'NOT',
  MAX: 'MAX', MIN: 'MIN', HOY: 'TODAY', POTENCIA: 'POWER', RESIDUO: 'MOD', RAIZ: 'SQRT',
}

function tokens(s: string): Token[] {
  const salida: Token[] = []
  const re = /\s+|(\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)|"((?:[^"]|"")*)"|((?:'[^']+'|[A-Za-zÁÉÍÓÚÑáéíóúñ_][\wÁÉÍÓÚÑáéíóúñ.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?!\w)(?::\$?[A-Za-z]{1,3}\$?\d+)?)|([A-Za-zÁÉÍÓÚÑáéíóúñ_][\wÁÉÍÓÚÑáéíóúñ.]*)|(<=|>=|<>|[-+*/^&=<>(),;:%])/gy
  let m: RegExpExecArray | null
  let fin = 0
  while (fin < s.length && (m = re.exec(s))) {
    fin = re.lastIndex
    if (m[1]) salida.push({ t: 'num', v: Number(m[1].replace(',', '.')) })
    else if (m[2] !== undefined) salida.push({ t: 'txt', v: m[2].replace(/""/g, '"') })
    else if (m[4]) salida.push({ t: 'ref', v: (m[3] ?? '') + m[4] })
    else if (m[5]) salida.push({ t: 'id', v: m[5] })
    else if (m[6]) salida.push({ t: 'op', v: m[6] })
  }
  if (fin < s.length) throw new Error('sintaxis')
  return salida
}

function parsear(s: string): Nodo {
  const ts = tokens(s)
  let i = 0
  const op = (v: string) => {
    const t = ts[i]
    if (t?.t === 'op' && t.v === v) {
      i++
      return true
    }
    return false
  }
  const comparacion = (): Nodo => {
    let a = concat()
    while (ts[i]?.t === 'op' && ['=', '<', '>', '<=', '>=', '<>'].includes(ts[i]!.v as string)) {
      const o = (ts[i++] as { v: string }).v
      a = { k: 'bin', op: o, a, b: concat() }
    }
    return a
  }
  const concat = (): Nodo => {
    let a = suma()
    while (op('&')) a = { k: 'bin', op: '&', a, b: suma() }
    return a
  }
  const suma = (): Nodo => {
    let a = producto()
    for (;;) {
      if (op('+')) a = { k: 'bin', op: '+', a, b: producto() }
      else if (op('-')) a = { k: 'bin', op: '-', a, b: producto() }
      else return a
    }
  }
  const producto = (): Nodo => {
    let a = potencia()
    for (;;) {
      if (op('*')) a = { k: 'bin', op: '*', a, b: potencia() }
      else if (op('/')) a = { k: 'bin', op: '/', a, b: potencia() }
      else return a
    }
  }
  const potencia = (): Nodo => {
    const a = unario()
    return op('^') ? { k: 'bin', op: '^', a, b: potencia() } : a
  }
  const unario = (): Nodo => {
    if (op('-')) return { k: 'neg', a: unario() }
    if (op('+')) return unario()
    let a = atomo()
    while (op('%')) a = { k: 'pct', a }
    return a
  }
  const atomo = (): Nodo => {
    const t = ts[i++]
    if (!t) throw new Error('fin')
    if (t.t === 'num') return { k: 'val', v: t.v }
    if (t.t === 'txt') return { k: 'val', v: t.v }
    if (t.t === 'ref') return referencia(t.v)
    if (t.t === 'id') {
      const nombre = t.v.toUpperCase()
      if (nombre === 'TRUE' || nombre === 'VERDADERO') return { k: 'val', v: true }
      if (nombre === 'FALSE' || nombre === 'FALSO') return { k: 'val', v: false }
      if (!op('(')) throw new Error('nombre')
      const a: Nodo[] = []
      if (!op(')')) {
        do a.push(comparacion())
        while (op(',') || op(';'))
        if (!op(')')) throw new Error('paréntesis')
      }
      return { k: 'fn', n: ALIAS[nombre] ?? nombre, a }
    }
    if (t.t === 'op' && t.v === '(') {
      const a = comparacion()
      if (!op(')')) throw new Error('paréntesis')
      return a
    }
    throw new Error('sintaxis')
  }
  const n = comparacion()
  if (i < ts.length) throw new Error('sobra')
  return n
}

function referencia(s: string): Nodo {
  const bang = s.lastIndexOf('!')
  const hoja = bang >= 0 ? s.slice(0, bang).replace(/^'|'$/g, '') : undefined
  const ref = (bang >= 0 ? s.slice(bang + 1) : s).replace(/\$/g, '')
  const [a, b] = ref.split(':')
  const uno = /^([A-Za-z]+)(\d+)$/.exec(a!)!
  const f = Number(uno[2]) - 1
  const c = columnaDe(uno[1]!)
  if (!b) return { k: 'celda', hoja, f, c }
  const dos = /^([A-Za-z]+)(\d+)$/.exec(b)!
  const f2 = Number(dos[2]) - 1
  const c2 = columnaDe(dos[1]!)
  return { k: 'rango', hoja, f1: Math.min(f, f2), c1: Math.min(c, c2), f2: Math.max(f, f2), c2: Math.max(c, c2) }
}

class ErrorHoja extends Error {}
const NO_SOPORTADA = '#FORMULA?'

type Contexto = { est: EstadoHoja; h: HojaE; memo: Map<string, Valor>; pila: Set<string> }

function buscarHoja(ctx: Contexto, nombre?: string): HojaE {
  if (nombre === undefined) return ctx.h
  const h = ctx.est.hojas.find(x => x.nombre.toLowerCase() === nombre.toLowerCase())
  if (!h) throw new ErrorHoja('#¡REF!')
  return h
}

function valorCelda(ctx: Contexto, h: HojaE, f: number, c: number): Valor {
  const id = `${h.nombre}!${clave(f, c)}`
  if (ctx.memo.has(id)) return ctx.memo.get(id)!
  const celda = h.celdas.get(clave(f, c))
  if (!celda) return null
  if (!celda.f) return celda.v
  if (ctx.pila.has(id)) throw new ErrorHoja('#CIRCULAR')
  ctx.pila.add(id)
  let v: Valor
  try {
    v = evaluar(parsear(celda.f), { ...ctx, h })
  } catch (err) {
    if (err instanceof ErrorHoja && err.message === NO_SOPORTADA) v = celda.v
    else if (err instanceof ErrorHoja) v = err.message
    else v = celda.v
  }
  ctx.pila.delete(id)
  ctx.memo.set(id, v)
  return v
}

function aNumero(v: Valor): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === '') return 0
  const n = Number(String(v).replace(',', '.'))
  if (Number.isNaN(n)) throw new ErrorHoja('#¡VALOR!')
  return n
}

const aTexto = (v: Valor) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'VERDADERO' : 'FALSO') : String(v))

function valoresRango(ctx: Contexto, n: Extract<Nodo, { k: 'rango' }>): Valor[] {
  const h = buscarHoja(ctx, n.hoja)
  const salida: Valor[] = []
  const f2 = Math.min(n.f2, h.filas + 1)
  const c2 = Math.min(n.c2, h.cols + 1)
  for (let f = n.f1; f <= f2; f++) for (let c = n.c1; c <= c2; c++) salida.push(valorCelda(ctx, h, f, c))
  return salida
}

function numeros(ctx: Contexto, args: Nodo[]): number[] {
  const salida: number[] = []
  for (const a of args) {
    if (a.k === 'rango') {
      for (const v of valoresRango(ctx, a)) if (typeof v === 'number') salida.push(v)
    } else if (a.k === 'celda') {
      const v = valorCelda(ctx, buscarHoja(ctx, a.hoja), a.f, a.c)
      if (typeof v === 'number') salida.push(v)
    } else salida.push(aNumero(evaluar(a, ctx)))
  }
  return salida
}

function evaluar(n: Nodo, ctx: Contexto): Valor {
  switch (n.k) {
    case 'val':
      return n.v
    case 'celda':
      return valorCelda(ctx, buscarHoja(ctx, n.hoja), n.f, n.c)
    case 'rango':
      return valoresRango(ctx, n)[0] ?? null
    case 'neg':
      return -aNumero(evaluar(n.a, ctx))
    case 'pct':
      return aNumero(evaluar(n.a, ctx)) / 100
    case 'bin': {
      const a = evaluar(n.a, ctx)
      const b = evaluar(n.b, ctx)
      switch (n.op) {
        case '+': return aNumero(a) + aNumero(b)
        case '-': return aNumero(a) - aNumero(b)
        case '*': return aNumero(a) * aNumero(b)
        case '/': {
          const d = aNumero(b)
          if (d === 0) throw new ErrorHoja('#¡DIV/0!')
          return aNumero(a) / d
        }
        case '^': return aNumero(a) ** aNumero(b)
        case '&': return aTexto(a) + aTexto(b)
        default: {
          const ambosNum = typeof a !== 'string' && typeof b !== 'string'
          const x = ambosNum ? aNumero(a) : aTexto(a).toLowerCase()
          const y = ambosNum ? aNumero(b) : aTexto(b).toLowerCase()
          if (n.op === '=') return x === y
          if (n.op === '<>') return x !== y
          if (n.op === '<') return x < y
          if (n.op === '>') return x > y
          if (n.op === '<=') return x <= y
          return x >= y
        }
      }
    }
    case 'fn':
      return funcion(n.n, n.a, ctx)
  }
}

function funcion(nombre: string, a: Nodo[], ctx: Contexto): Valor {
  const uno = (i = 0) => evaluar(a[i] ?? { k: 'val', v: null }, ctx)
  switch (nombre) {
    case 'SUM': return numeros(ctx, a).reduce((x, y) => x + y, 0)
    case 'AVERAGE': {
      const v = numeros(ctx, a)
      if (!v.length) throw new ErrorHoja('#¡DIV/0!')
      return v.reduce((x, y) => x + y, 0) / v.length
    }
    case 'MIN': { const v = numeros(ctx, a); return v.length ? Math.min(...v) : 0 }
    case 'MAX': { const v = numeros(ctx, a); return v.length ? Math.max(...v) : 0 }
    case 'COUNT': return numeros(ctx, a).length
    case 'COUNTA': {
      let n = 0
      for (const x of a) {
        if (x.k === 'rango') n += valoresRango(ctx, x).filter(v => v !== null && v !== '').length
        else if (uno(a.indexOf(x)) !== null) n++
      }
      return n
    }
    case 'IF': return aNumero(uno(0)) ? uno(1) : a.length > 2 ? uno(2) : false
    case 'AND': return a.every((_, i) => aNumero(uno(i)) !== 0)
    case 'OR': return a.some((_, i) => aNumero(uno(i)) !== 0)
    case 'NOT': return aNumero(uno(0)) === 0
    case 'ABS': return Math.abs(aNumero(uno()))
    case 'INT': return Math.floor(aNumero(uno()))
    case 'ROUND': {
      const d = a.length > 1 ? aNumero(uno(1)) : 0
      const p = 10 ** d
      return Math.round(aNumero(uno()) * p) / p
    }
    case 'POWER': return aNumero(uno(0)) ** aNumero(uno(1))
    case 'MOD': return aNumero(uno(0)) % aNumero(uno(1))
    case 'SQRT': return Math.sqrt(aNumero(uno()))
    case 'LEN': return aTexto(uno()).length
    case 'UPPER': return aTexto(uno()).toUpperCase()
    case 'LOWER': return aTexto(uno()).toLowerCase()
    case 'CONCATENATE':
    case 'CONCAT': return a.map((_, i) => aTexto(uno(i))).join('')
    default:
      throw new ErrorHoja(NO_SOPORTADA)
  }
}

/** Evalúa una fórmula sin `=`; si usa algo que no se conoce, devuelve `actual`. */
export function calcular(est: EstadoHoja, h: HojaE, formula: string, actual: Valor): Valor {
  try {
    return evaluar(parsear(formula), { est, h, memo: new Map(), pila: new Set() })
  } catch (err) {
    if (err instanceof ErrorHoja && err.message !== NO_SOPORTADA) return err.message
    if (err instanceof ErrorHoja) return actual
    return '#¡NOMBRE?'
  }
}

/** Número como lo mostraría una celda General. */
export function mostrar(v: Valor): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v)
    return String(Number(v.toPrecision(11)))
  }
  return v
}

export const mostrado = (c: CeldaE) => c.m ?? mostrar(c.v)

/** Recalcula las fórmulas después de un cambio y marca las que dieron otro valor. */
function recalcular(est: EstadoHoja, registro: { h: number; k: string; antes: CeldaE | null; despues: CeldaE | null }[]): void {
  const memo = new Map<string, Valor>()
  est.hojas.forEach((h, hi) => {
    const ctx: Contexto = { est, h, memo, pila: new Set() }
    for (const [k, celda] of h.celdas) {
      if (!celda.f) continue
      const [f, c] = k.split(',').map(Number) as [number, number]
      const v = valorCelda(ctx, h, f, c)
      if (v !== celda.v) {
        const antes = { ...celda }
        celda.v = v
        delete celda.m
        celda.tocada = true
        registro.push({ h: hi, k, antes, despues: { ...celda } })
      }
    }
  })
}

/** Confirma lo escrito en una celda: número, texto o fórmula. */
export function confirmar(est: EstadoHoja, texto: string, csv: boolean): void {
  const h = est.hojas[est.activa]!
  const [f, c] = h.cur
  const k = clave(f, c)
  const previa = h.celdas.get(k) ?? null
  const nueva: CeldaE = { v: null, tocada: true }
  if (previa?.s !== undefined) nueva.s = previa.s
  const limpio = texto.trim()
  if (!csv && limpio.startsWith('=') && limpio.length > 1) {
    nueva.f = limpio.slice(1)
    h.celdas.set(k, nueva)
    nueva.v = calcular(est, h, nueva.f, null)
  } else if (limpio !== '' && !Number.isNaN(Number(limpio.replace(',', '.'))) && /^-?[\d.,]+$/.test(limpio)) {
    nueva.v = Number(limpio.replace(',', '.'))
    h.celdas.set(k, nueva)
  } else if (limpio === '' && previa?.s === undefined) {
    h.celdas.delete(k)
  } else {
    nueva.v = limpio === '' ? null : texto
    h.celdas.set(k, nueva)
  }
  h.filas = Math.max(h.filas, f + 1)
  h.cols = Math.max(h.cols, c + 1)
  const registro = [{ h: est.activa, k, antes: previa, despues: h.celdas.get(k) ?? null }]
  recalcular(est, registro)
  est.deshacer.push(registro)
  est.rehacer = []
  est.sucio = true
}

export function borrarRango(est: EstadoHoja): void {
  const h = est.hojas[est.activa]!
  const [f1, c1, f2, c2] = rangoActivo(h)
  const registro: { h: number; k: string; antes: CeldaE | null; despues: CeldaE | null }[] = []
  for (let f = f1; f <= f2; f++)
    for (let c = c1; c <= c2; c++) {
      const k = clave(f, c)
      const previa = h.celdas.get(k)
      if (!previa) continue
      const nueva: CeldaE | null = previa.s !== undefined ? { v: null, s: previa.s, tocada: true } : null
      if (nueva) h.celdas.set(k, nueva)
      else {
        h.celdas.delete(k)
        borrados(est).add(`${est.activa}|${k}`)
      }
      registro.push({ h: est.activa, k, antes: previa, despues: nueva })
    }
  if (!registro.length) return
  recalcular(est, registro)
  est.deshacer.push(registro)
  est.rehacer = []
  est.sucio = true
}

const borradosDe = new WeakMap<EstadoHoja, Set<string>>()
function borrados(est: EstadoHoja): Set<string> {
  let s = borradosDe.get(est)
  if (!s) borradosDe.set(est, (s = new Set()))
  return s
}

export function rangoActivo(h: HojaE): [number, number, number, number] {
  const [f, c] = h.cur
  const [af, ac] = h.ancla ?? h.cur
  return [Math.min(f, af), Math.min(c, ac), Math.max(f, af), Math.max(c, ac)]
}

export function deshacerHoja(est: EstadoHoja): void {
  const paso = est.deshacer.pop()
  if (!paso) return
  for (const r of [...paso].reverse()) {
    if (r.antes) est.hojas[r.h]!.celdas.set(r.k, { ...r.antes, tocada: true })
    else {
      est.hojas[r.h]!.celdas.delete(r.k)
      borrados(est).add(`${r.h}|${r.k}`)
    }
  }
  est.rehacer.push(paso)
  est.sucio = true
}

export function rehacerHoja(est: EstadoHoja): void {
  const paso = est.rehacer.pop()
  if (!paso) return
  for (const r of paso) {
    if (r.despues) est.hojas[r.h]!.celdas.set(r.k, { ...r.despues, tocada: true })
    else {
      est.hojas[r.h]!.celdas.delete(r.k)
      borrados(est).add(`${r.h}|${r.k}`)
    }
  }
  est.deshacer.push(paso)
  est.sucio = true
}

export function resumenHoja(est: EstadoHoja): Guardado {
  const firma = est.doc.firma
  if (est.doc.tipo === 'csv') {
    const h = est.hojas[0]!
    let filas = 0
    let cols = 0
    for (const k of h.celdas.keys()) {
      const [f, c] = k.split(',').map(Number) as [number, number]
      filas = Math.max(filas, f + 1)
      cols = Math.max(cols, c + 1)
    }
    const salida: string[][] = []
    for (let f = 0; f < filas; f++) {
      const fila: string[] = []
      for (let c = 0; c < cols; c++) fila.push(mostrar(h.celdas.get(clave(f, c))?.v ?? null))
      salida.push(fila)
    }
    return { tipo: 'csv', firma, filas: salida, sep: est.doc.sep ?? ',' }
  }
  const cambios: Extract<Guardado, { tipo: 'xlsx' }>['cambios'] = []
  est.hojas.forEach((h, hoja) => {
    for (const [k, c] of h.celdas) {
      if (!c.tocada) continue
      const [f, col] = k.split(',').map(Number) as [number, number]
      cambios.push(c.f ? { hoja, f, c: col, v: c.v, formula: c.f } : { hoja, f, c: col, v: c.v })
    }
  })
  for (const id of borrados(est)) {
    const [hs, k] = id.split('|') as [string, string]
    const hoja = Number(hs)
    if (est.hojas[hoja]!.celdas.has(k)) continue
    const [f, c] = k.split(',').map(Number) as [number, number]
    cambios.push({ hoja, f, c, v: null })
  }
  return { tipo: 'xlsx', firma, cambios }
}

export function marcarHojaGuardada(est: EstadoHoja, firma: string): void {
  est.doc.firma = firma
  est.sucio = false
  est.deshacer = []
  est.rehacer = []
  borradosDe.delete(est)
  for (const h of est.hojas) for (const c of h.celdas.values()) delete c.tocada
}
