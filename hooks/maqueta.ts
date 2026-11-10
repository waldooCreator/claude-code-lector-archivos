// De bloques a líneas de hoja: parte párrafos, dibuja tablas, citas y código,
// y reparte el resultado en páginas como las de un PDF.

import type { Bloque, Celda as CeldaT, Parrafo, Run } from '../types'
import { CURSIVA, NEGRITA, SUBRAYADO, TACHADO, anchoDe, anchoTexto } from './lienzo'

/** Un trozo de línea. `p` y `o`: párrafo y carácter de origen, para el cursor. */
export type Seg = { x: number; s: string; f: string; h?: string; a: number; p?: number; o?: number }
export type ImagenLinea = { src: string; cols: number; filas: number; fila: number; x: number; alt?: string }
export type Linea = { segs: Seg[]; bg?: string; img?: ImagenLinea }

export const TINTA = '#1f2328'
const TENUE = '#667085'
const REGLA = '#c9ced6'
const CODIGO_FONDO = '#f4f4f5'
const AZUL_TITULO = '#1f3864'

export type Opciones = { defPt: number; indice: Map<Parrafo, number>; medidas: Map<string, { cols: number; filas: number }>; sinRegla?: boolean }

const ESTILO_TITULO: Record<string, { c: string; a: number; antes: number; despues: number; regla?: string; centro?: boolean }> = {
  titulo: { c: AZUL_TITULO, a: NEGRITA, antes: 1, despues: 1, regla: '━', centro: true },
  subtitulo: { c: TENUE, a: CURSIVA, antes: 0, despues: 1, centro: true },
  h1: { c: AZUL_TITULO, a: NEGRITA, antes: 1, despues: 1, regla: '━' },
  h2: { c: '#2f5496', a: NEGRITA, antes: 1, despues: 1, regla: '─' },
  h3: { c: '#2f5496', a: NEGRITA, antes: 1, despues: 0 },
  h4: { c: '#3b4a63', a: NEGRITA | CURSIVA, antes: 1, despues: 0 },
  h5: { c: '#3b4a63', a: CURSIVA, antes: 0, despues: 0 },
  h6: { c: TENUE, a: CURSIVA, antes: 0, despues: 0 },
}

function atributos(r: Run): number {
  return (r.b ? NEGRITA : 0) | (r.i ? CURSIVA : 0) | (r.u || r.href ? SUBRAYADO : 0) | (r.s ? TACHADO : 0)
}

type Trozo = { s: string; w: number; f: string; h?: string; a: number; o: number; salto?: boolean }

/** Corta los runs en palabras y espacios, recordando de qué carácter salió cada uno. */
function trozos(par: Parrafo, opc: Opciones, base: { f: string; a: number }): Trozo[] {
  const salida: Trozo[] = []
  let offset = 0
  for (const r of par.r) {
    const relativo = r.pt ? r.pt / opc.defPt : 1
    const a = atributos(r) | base.a | (relativo >= 1.4 ? NEGRITA : 0)
    const f = r.c ?? (r.href ? '#0b5cad' : relativo <= 0.8 ? TENUE : base.f)
    const partes = r.t.match(/\n|\t|[^\S\n\t]+|[^\s]+/g) ?? []
    for (const p of partes) {
      if (p === '\n') salida.push({ s: '', w: 0, f, h: r.h, a, o: offset, salto: true })
      else if (p === '\t') salida.push({ s: '    ', w: 4, f, h: r.h, a, o: offset })
      else salida.push({ s: p, w: anchoTexto(p), f, h: r.h, a, o: offset })
      offset += p.length
    }
  }
  return salida
}

/** Una palabra más larga que la línea se parte por caracteres. */
function partirLarga(t: Trozo, ancho: number): Trozo[] {
  const salida: Trozo[] = []
  let s = ''
  let w = 0
  let o = t.o
  let inicio = t.o
  for (const ch of t.s) {
    const cw = anchoDe(ch.codePointAt(0)!)
    if (w + cw > ancho && s) {
      salida.push({ ...t, s, w, o: inicio })
      s = ''
      w = 0
      inicio = o
    }
    s += ch
    w += cw
    o += ch.length
  }
  if (s) salida.push({ ...t, s, w, o: inicio })
  return salida
}

/** Un párrafo completo a líneas de `ancho` columnas. */
function maquetarParrafo(par: Parrafo, ancho: number, opc: Opciones): Linea[] {
  const est = par.est ? ESTILO_TITULO[par.est] : undefined
  const cita = par.est === 'cita'
  const codigo = par.est === 'codigo'
  const base = { f: est?.c ?? TINTA, a: est?.a ?? (cita ? CURSIVA : 0) }
  const idx = opc.indice.get(par)
  const sang = Math.min(par.sang ?? 0, Math.floor(ancho / 2)) + (cita ? 2 : 0)
  const marca = par.lista ? `${par.lista.marca} ` : ''
  const margenLista = par.lista ? par.lista.nivel * 3 + 1 : 0
  const anchoMarca = anchoTexto(marca)
  const izquierda = sang + margenLista + anchoMarca
  const util = Math.max(Math.min(8, ancho), ancho - izquierda)

  const piezas = trozos(par, opc, base).flatMap(t => (t.w > util ? partirLarga(t, util) : [t]))
  const filas: Trozo[][] = [[]]
  let w = 0
  for (const t of piezas) {
    if (t.salto) {
      filas.push([])
      w = 0
      continue
    }
    const blanco = !t.s.trim()
    if (w + t.w > util && !blanco && filas[filas.length - 1]!.length) {
      filas.push([])
      w = 0
    }
    filas[filas.length - 1]!.push(t)
    w += t.w
  }

  const lineas: Linea[] = []
  filas.forEach((fila, n) => {
    const total = fila.reduce((a, t) => a + t.w, 0)
    let x = izquierda
    const al = par.al ?? (est?.centro ? 'c' : undefined)
    if (al === 'c') x = izquierda + Math.max(0, Math.floor((util - total) / 2))
    if (al === 'r') x = izquierda + Math.max(0, util - total)
    const segs: Seg[] = []
    if (n === 0 && marca) segs.push({ x: x - anchoMarca, s: marca, f: par.lista!.marca.match(/[☐☑]/) ? '#2f5496' : TINTA, a: 0 })
    let extra = 0
    let huecos = 0
    if (par.al === 'j' && n < filas.length - 1) {
      huecos = fila.filter(t => !t.s.trim()).length
      extra = Math.max(0, util - total)
    }
    let repartido = 0
    let visto = 0
    if (fila.length === 0) segs.push({ x, s: '', f: base.f, a: base.a, p: idx, o: n === 0 ? 0 : (filas[n - 1]![filas[n - 1]!.length - 1]?.o ?? 0) + 1 })
    for (const t of fila) {
      segs.push({ x, s: t.s, f: t.f, h: t.h ?? (codigo ? CODIGO_FONDO : undefined), a: t.a, p: idx, o: t.o })
      x += t.w
      if (huecos && !t.s.trim()) {
        visto++
        const meta = Math.round((extra * visto) / huecos)
        x += meta - repartido
        repartido = meta
      }
    }
    lineas.push({ segs })
  })
  if (cita) for (const l of lineas) l.segs.unshift({ x: 0, s: '▌', f: '#98a2b3', a: 0 })
  if (est?.regla && !opc.sinRegla) lineas.push({ segs: [{ x: 0, s: est.regla.repeat(ancho), f: REGLA, a: 0 }] })
  const vacia = (): Linea => ({ segs: [] })
  return [...Array.from({ length: est?.antes ?? 0 }, vacia), ...lineas, ...Array.from({ length: est?.despues ?? (par.lista || codigo ? 0 : 1) }, vacia)]
}

function desplazar(lineas: Linea[], dx: number): Linea[] {
  return lineas.map(l => ({ ...l, segs: l.segs.map(s => ({ ...s, x: s.x + dx })), ...(l.img ? { img: { ...l.img, x: l.img.x + dx } } : {}) }))
}

/** Anchos de columna: lo pedido en el archivo o según el contenido, ajustado a `ancho`. */
function anchosTabla(filas: CeldaT[][], pedidos: number[] | undefined, ancho: number): number[] {
  const n = Math.max(...filas.map(f => f.reduce((a, c) => a + (c.cs ?? 1), 0)), 1)
  const util = Math.max(n * 3, ancho - n - 1)
  if (pedidos?.length === n && pedidos.every(a => a > 0)) {
    const suma = pedidos.reduce((a, b) => a + b, 0)
    return ajustar(pedidos.map(a => Math.max(3, Math.floor((a / suma) * util))), util)
  }
  const naturales = Array.from({ length: n }, () => 3)
  for (const fila of filas) {
    let col = 0
    for (const c of fila) {
      const tam = c.cs ?? 1
      if (tam === 1) {
        const texto = c.b.map(b => (b.k === 'p' ? b.r.map(r => r.t).join('') : '')).join(' ')
        const largo = Math.max(...texto.split('\n').map(anchoTexto), 1)
        naturales[col] = Math.max(naturales[col]!, Math.min(largo + 2, 60))
      }
      col += tam
    }
  }
  const suma = naturales.reduce((a, b) => a + b, 0)
  if (suma <= util) return naturales
  const minimo = Math.min(10, Math.floor(util / n))
  const flexible = naturales.reduce((a, b) => a + Math.max(0, b - minimo), 0) || 1
  const resto = util - minimo * n
  return ajustar(naturales.map(a => minimo + Math.floor((Math.max(0, a - minimo) / flexible) * resto)), util)
}

function ajustar(anchos: number[], util: number): number[] {
  const salida = [...anchos]
  let falta = util - salida.reduce((a, b) => a + b, 0)
  for (let i = 0; falta > 0 && salida.length; i = (i + 1) % salida.length, falta--) salida[i]!++
  return salida
}

function maquetarTabla(b: Extract<Bloque, { k: 'tabla' }>, ancho: number, opc: Opciones): Linea[] {
  const anchos = anchosTabla(b.filas, b.anchos, ancho)
  const lineas: Linea[] = []
  const borde = (i: string, m: string, d: string, h = '─') => ({ segs: [{ x: 0, s: i + anchos.map(a => h.repeat(a)).join(m) + d, f: REGLA, a: 0 }] })
  lineas.push(borde('┌', '┬', '┐'))
  b.filas.forEach((fila, nf) => {
    let col = 0
    const celdas = fila.map(c => {
      const tam = c.cs ?? 1
      const w = anchos.slice(col, col + tam).reduce((a, v) => a + v, 0) + tam - 1
      const x = 1 + anchos.slice(0, col).reduce((a, v) => a + v + 1, 0)
      col += tam
      const adentro = Math.max(3, w - 2)
      const ls = c.vm ? [] : maquetar(c.b, adentro, opc).lineas
      while (ls.length > 1 && ls[ls.length - 1]!.segs.length === 0) ls.pop()
      return { x, w, ls, bg: c.bg }
    })
    const alto = Math.max(1, ...celdas.map(c => c.ls.length))
    for (let y = 0; y < alto; y++) {
      const segs: Seg[] = []
      let cx = 0
      for (const c of celdas) {
        segs.push({ x: cx, s: '│', f: REGLA, a: 0 })
        if (c.bg) segs.push({ x: c.x, s: ' '.repeat(c.w), f: TINTA, h: c.bg, a: 0 })
        const l = c.ls[y]
        if (l) for (const s of l.segs) segs.push({ ...s, x: s.x + c.x + 1, h: s.h ?? c.bg })
        cx = c.x + c.w
      }
      segs.push({ x: cx, s: '│', f: REGLA, a: 0 })
      lineas.push({ segs })
    }
    lineas.push(nf === b.filas.length - 1 ? borde('└', '┴', '┘') : borde('├', '┼', '┤'))
  })
  lineas.push({ segs: [] })
  return lineas
}

// Resaltado sencillo: palabras clave, cadenas, números y comentarios.
const CLAVE = new Set('if else for while return function const let var class def import from export async await try except catch finally new public private static void int string bool true false null none None True False SELECT FROM WHERE INSERT UPDATE DELETE JOIN ON GROUP BY ORDER AS AND OR NOT func package type struct interface echo fi then do done'.split(' '))

function colorearCodigo(linea: string): { s: string; f: string }[] {
  const salida: { s: string; f: string }[] = []
  const re = /(#.*$|\/\/.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g
  for (const m of linea.matchAll(re)) {
    if (m[1]) salida.push({ s: m[1], f: '#6a737d' })
    else if (m[2]) salida.push({ s: m[2], f: '#0a7d32' })
    else if (m[3]) salida.push({ s: m[3], f: '#b35900' })
    else if (m[4]) salida.push({ s: m[4], f: CLAVE.has(m[4]) ? '#8250df' : TINTA })
    else salida.push({ s: m[5]!, f: TINTA })
  }
  return salida
}

function maquetarCodigo(b: Extract<Bloque, { k: 'cod' }>, ancho: number): Linea[] {
  const util = ancho - 2
  const lineas: Linea[] = []
  const banda = (segs: Seg[]): Linea => ({ segs: [{ x: 0, s: ' '.repeat(ancho), f: TINTA, h: CODIGO_FONDO, a: 0 }, ...segs] })
  if (b.lang) lineas.push(banda([{ x: ancho - b.lang.length - 1, s: b.lang, f: TENUE, h: CODIGO_FONDO, a: CURSIVA }]))
  for (const original of b.texto.replace(/\n$/, '').split('\n')) {
    let x = 1
    let segs: Seg[] = []
    for (const t of colorearCodigo(original.replace(/\t/g, '    '))) {
      const w = anchoTexto(t.s)
      if (x + w > util + 1 && x > 1) {
        lineas.push(banda(segs))
        segs = []
        x = 1
      }
      segs.push({ x, s: t.s, f: t.f, h: CODIGO_FONDO, a: 0 })
      x += w
    }
    lineas.push(banda(segs))
  }
  lineas.push({ segs: [] })
  return lineas
}

const AVISOS: Record<string, { c: string; t: string; bg: string }> = {
  note: { c: '#0969da', t: 'ℹ Nota', bg: '#ddf4ff' },
  tip: { c: '#1a7f37', t: '✔ Consejo', bg: '#dafbe1' },
  important: { c: '#8250df', t: '★ Importante', bg: '#fbefff' },
  warning: { c: '#9a6700', t: '▲ Advertencia', bg: '#fff8c5' },
  caution: { c: '#cf222e', t: '✖ Precaución', bg: '#ffebe9' },
}

function maquetarCita(b: Extract<Bloque, { k: 'cita' }>, ancho: number, opc: Opciones): Linea[] {
  const aviso = b.tipo ? AVISOS[b.tipo] : undefined
  const interior = maquetar(b.b, ancho - 3, opc).lineas
  while (interior.length && interior[interior.length - 1]!.segs.length === 0) interior.pop()
  const color = aviso?.c ?? '#98a2b3'
  const bg = aviso?.bg
  const lineas: Linea[] = []
  const fila = (l: Linea): Linea => ({
    segs: [
      ...(bg ? [{ x: 0, s: ' '.repeat(ancho), f: TINTA, h: bg, a: 0 }] : []),
      { x: 0, s: '▌', f: color, h: bg, a: 0 },
      ...l.segs.map(s => ({ ...s, x: s.x + 2, h: s.h ?? bg, f: bg ? s.f : s.f === TINTA ? '#475467' : s.f, a: bg ? s.a : s.a | CURSIVA })),
    ],
  })
  if (aviso) lineas.push(fila({ segs: [{ x: 0, s: aviso.t, f: aviso.c, a: NEGRITA }] }))
  lineas.push(...interior.map(fila))
  lineas.push({ segs: [] })
  return lineas
}

function maquetarFigura(b: Extract<Bloque, { k: 'figura' }>, ancho: number): Linea[] {
  const salida: Linea[] = [{ segs: [] }]
  const w = Math.max(...b.lineas.map(anchoTexto), 0)
  if (w > ancho) {
    // Más ancha que la hoja: se recorta a la vista en vez de romper el dibujo.
    for (const l of b.lineas) salida.push({ segs: [{ x: 0, s: [...l].slice(0, ancho).join(''), f: '#24476b', a: 0 }] })
  } else {
    const x = Math.floor((ancho - w) / 2)
    for (const l of b.lineas) salida.push({ segs: [{ x, s: l, f: '#24476b', a: 0 }] })
  }
  if (b.titulo) {
    const t = `Figura: ${b.titulo}`
    salida.push({ segs: [{ x: Math.max(0, Math.floor((ancho - anchoTexto(t)) / 2)), s: t, f: TENUE, a: CURSIVA }] })
  }
  salida.push({ segs: [] })
  return salida
}

function maquetarImagen(b: Extract<Bloque, { k: 'img' }>, ancho: number, opc: Opciones): Linea[] {
  const medida = opc.medidas.get(b.src)
  let cols = Math.min(ancho, 70)
  let filas = 14
  if (medida) {
    cols = Math.min(ancho, medida.cols)
    filas = Math.max(1, Math.round((medida.filas * cols) / medida.cols))
  } else if (b.w > 0 && b.h > 0) {
    filas = Math.max(2, Math.min(30, Math.round((cols * b.h) / b.w / 2)))
    if (b.w / b.h < 1) {
      filas = Math.min(filas, 24)
      cols = Math.max(4, Math.round((filas * 2 * b.w) / b.h))
    }
  }
  const x = Math.floor((ancho - cols) / 2)
  const img = { src: b.src, cols, filas, x, alt: b.alt }
  const salida: Linea[] = Array.from({ length: filas }, (_, fila) => ({ segs: [], img: { ...img, fila } }))
  salida.push({ segs: [] })
  return salida
}

/** Una lista de bloques a líneas. También reparte el índice de párrafos editables. */
export function maquetar(bloques: Bloque[], ancho: number, opc: Opciones): { lineas: Linea[]; saltos: number[] } {
  const lineas: Linea[] = []
  const saltos: number[] = []
  for (const b of bloques) {
    if (b.k === 'p') lineas.push(...maquetarParrafo(b, ancho, opc))
    else if (b.k === 'tabla') lineas.push(...maquetarTabla(b, ancho, opc))
    else if (b.k === 'img') lineas.push(...maquetarImagen(b, ancho, opc))
    else if (b.k === 'cod') lineas.push(...maquetarCodigo(b, ancho))
    else if (b.k === 'cita') lineas.push(...maquetarCita(b, ancho, opc))
    else if (b.k === 'figura') lineas.push(...maquetarFigura(b, ancho))
    else if (b.k === 'hr') lineas.push({ segs: [{ x: 0, s: '─'.repeat(ancho), f: REGLA, a: 0 }] }, { segs: [] })
    else if (b.k === 'salto') saltos.push(lineas.length)
  }
  return { lineas, saltos }
}

export type Pagina = { lineas: Linea[]; desde: number }

/** Alto de una página A4 con el ancho dado (una celda es el doble de alta que ancha). */
export const altoPagina = (anchoHoja: number) => Math.round(anchoHoja * 1.414 * 0.5)

/** Reparte líneas en páginas, respetando los saltos y sin dejar un título huérfano. */
export function paginar(lineas: Linea[], saltos: number[], alto: number): Linea[][] {
  const paginas: Linea[][] = []
  let actual: Linea[] = []
  const forzados = new Set(saltos)
  lineas.forEach((l, i) => {
    if (forzados.has(i) && actual.length) {
      paginas.push(actual)
      actual = []
    }
    if (actual.length >= alto) {
      paginas.push(actual)
      actual = []
    }
    if (actual.length === 0 && l.segs.length === 0 && !l.img) return
    actual.push(l)
  })
  if (actual.length || paginas.length === 0) paginas.push(actual)
  return paginas
}

export { desplazar }
