// La cuadrícula de celdas que dibuja el visor: se pinta celda a celda y al
// final se agrupa en tramos del mismo color para entregarla a la terminal.

import type { Tramo } from '../types'

export const NEGRITA = 1
export const CURSIVA = 2
export const SUBRAYADO = 4
export const TACHADO = 8

export type Celda = { c: string; f: string; b: string; a: number }
export type Zona = { x: number; y: number; w: number; h: number; accion: string }

/** Lo que ocupa un carácter en la terminal: 0, 1 o 2 celdas. */
export function anchoDe(cp: number): number {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    cp === 0x2705 || cp === 0x274c || cp === 0x2728 || cp === 0x26a1 || cp === 0x2b50
  ) return 2
  return 1
}

export function anchoTexto(s: string): number {
  let n = 0
  for (const ch of s) n += anchoDe(ch.codePointAt(0)!)
  return n
}

const limpio = (ch: string) => (ch < ' ' || (ch >= '\x7f' && ch <= '\x9f') ? ' ' : ch)

export class Lienzo {
  celdas: Celda[][]
  zonas: Zona[] = []
  constructor(readonly cols: number, readonly filas: number, fondo: string) {
    this.celdas = Array.from({ length: filas }, () => Array.from({ length: cols }, () => ({ c: ' ', f: '#000000', b: fondo, a: 0 })))
  }

  /** Escribe `s` desde (x, y) y dice en qué columna terminó. */
  put(x: number, y: number, s: string, f: string, b?: string, a = 0): number {
    const fila = this.celdas[y]
    if (!fila) return x + anchoTexto(s)
    for (const ch of s) {
      const cp = ch.codePointAt(0)!
      const w = anchoDe(cp)
      if (w === 0) {
        const previa = fila[x - 1]
        if (previa && previa.c !== '') previa.c += ch
        continue
      }
      if (x >= 0 && x + w <= this.cols) {
        fila[x] = { c: limpio(ch), f, b: b ?? fila[x]!.b, a }
        if (w === 2) fila[x + 1] = { c: '', f, b: b ?? fila[x + 1]!.b, a }
      }
      x += w
    }
    return x
  }

  fill(x: number, y: number, w: number, h: number, b: string): void {
    for (let j = y; j < y + h; j++) {
      const fila = this.celdas[j]
      if (!fila) continue
      for (let i = Math.max(0, x); i < Math.min(this.cols, x + w); i++) fila[i] = { c: ' ', f: '#000000', b, a: 0 }
    }
  }

  /** Cambia solo el fondo: para la selección y el cursor. */
  fondo(x: number, y: number, b: string, f?: string): void {
    const c = this.celdas[y]?.[x]
    if (!c) return
    c.b = b
    if (f) c.f = f
  }

  zona(x: number, y: number, w: number, h: number, accion: string): void {
    this.zonas.push({ x, y, w, h, accion })
  }

  zonaEn(x: number, y: number): Zona | undefined {
    for (let i = this.zonas.length - 1; i >= 0; i--) {
      const z = this.zonas[i]!
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z
    }
    return undefined
  }

  tramos(): Tramo[][] {
    return this.celdas.map(fila => {
      const salida: Tramo[] = []
      let s = ''
      let c: Celda | null = null
      for (const celda of fila) {
        if (celda.c === '') continue
        const igual = c && c.f === celda.f && c.b === celda.b && c.a === celda.a
        // Un espacio solo depende del fondo: no parte el tramo por su color de letra.
        const blanco = c && celda.c === ' ' && c.b === celda.b && !(celda.a & SUBRAYADO) && !(c.a & SUBRAYADO)
        if (c && (igual || blanco)) {
          s += celda.c
          continue
        }
        if (c) salida.push(c.a ? [s, c.f, c.b, c.a] : [s, c.f, c.b])
        c = celda
        s = celda.c
      }
      if (c) salida.push(c.a ? [s, c.f, c.b, c.a] : [s, c.f, c.b])
      return salida
    })
  }
}

/** El motor desmonta un dibujo de más de 100 000 caracteres: mide lo que se manda. */
export function peso(filas: Tramo[][]): number {
  let n = 0
  for (const fila of filas) for (const t of fila) n += t[0].length + 70
  return n
}

/** Si el cuadro es muy pesado se dibuja con menos matices antes que quedar en blanco. */
export function aligerar(filas: Tramo[][]): Tramo[][] {
  if (peso(filas) <= 85_000) return filas
  return filas.map(fila => {
    const salida: Tramo[] = []
    for (const [s, f, b, a] of fila) {
      const u = salida[salida.length - 1]
      if (u && u[2] === b) u[0] += s
      else salida.push(a ? [s, f, b, a] : [s, f, b])
    }
    return salida
  })
}
