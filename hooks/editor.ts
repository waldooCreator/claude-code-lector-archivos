// Edición de documentos Word: texto y formato sobre los párrafos, deshacer, y
// el resumen de lo cambiado que el binario aplica sobre el archivo original.

import type { Bloque, DocWord, Guardado, Parrafo, Run } from '../types'

/** Párrafo en edición: `_o` el párrafo original del que viene, `_m` tocado. */
export type ParrafoE = Parrafo & { _o?: number; _m?: 1 }
/** Run en edición: `_fmt` si la persona le cambió la fuente o el tamaño. */
export type RunE = Run & { _fmt?: 1 }

export type Pos = { p: number; c: number }
export type EntradaPlana = { par: ParrafoE; cont: Bloque[]; idx: number }
export type Formato = { b?: boolean; i?: boolean; u?: boolean; font?: string; pt?: number }

export type EstadoEditor = {
  doc: DocWord & { firma: string }
  planos: EntradaPlana[]
  cur: Pos
  ancla: Pos | null
  /** Formato pedido para lo próximo que se escriba, si no hay selección. */
  pendiente: Formato | null
  xDeseada: number | null
  deshacer: { bloques: string; cur: Pos }[]
  rehacer: { bloques: string; cur: Pos }[]
  borrados: number[]
  sucio: boolean
  /** Si la última acción fue escribir, se agrupan las letras en un solo deshacer. */
  escribiendo: boolean
}

export const textoDe = (p: Parrafo) => p.r.map(r => r.t).join('')

function caminar(bloques: Bloque[], salida: EntradaPlana[]): void {
  bloques.forEach((b, idx) => {
    if (b.k === 'p') salida.push({ par: b as ParrafoE, cont: bloques, idx })
    else if (b.k === 'tabla') for (const f of b.filas) for (const c of f) caminar(c.b, salida)
    else if (b.k === 'cita') caminar(b.b, salida)
  })
}

export function aplanar(bloques: Bloque[]): EntradaPlana[] {
  const salida: EntradaPlana[] = []
  caminar(bloques, salida)
  return salida
}

export function nuevoEditor(doc: DocWord & { firma: string }): EstadoEditor {
  const planos = aplanar(doc.bloques)
  const primero = Math.max(0, planos.findIndex(x => x.par.ed !== 0))
  return { doc, planos, cur: { p: primero, c: 0 }, ancla: null, pendiente: null, xDeseada: null, deshacer: [], rehacer: [], borrados: [], sucio: false, escribiendo: false }
}

export const editable = (e: EstadoEditor, p: number) => e.doc.editable && e.planos[p]?.par.ed !== 0

function guardarPaso(e: EstadoEditor): void {
  e.deshacer.push({ bloques: JSON.stringify(e.doc.bloques), cur: { ...e.cur } })
  if (e.deshacer.length > 100) e.deshacer.shift()
  e.rehacer = []
}

function restaurar(e: EstadoEditor, desde: { bloques: string; cur: Pos }): void {
  e.doc.bloques = JSON.parse(desde.bloques) as Bloque[]
  e.planos = aplanar(e.doc.bloques)
  e.cur = desde.cur
  e.ancla = null
}

export function deshacer(e: EstadoEditor): void {
  const paso = e.deshacer.pop()
  if (!paso) return
  e.rehacer.push({ bloques: JSON.stringify(e.doc.bloques), cur: { ...e.cur } })
  restaurar(e, paso)
  e.sucio = e.deshacer.length > 0 || e.borrados.length > 0
  e.escribiendo = false
}

export function rehacer(e: EstadoEditor): void {
  const paso = e.rehacer.pop()
  if (!paso) return
  e.deshacer.push({ bloques: JSON.stringify(e.doc.bloques), cur: { ...e.cur } })
  restaurar(e, paso)
  e.sucio = true
  e.escribiendo = false
}

const menor = (a: Pos, b: Pos) => a.p < b.p || (a.p === b.p && a.c < b.c)

export function seleccion(e: EstadoEditor): [Pos, Pos] | null {
  if (!e.ancla || (e.ancla.p === e.cur.p && e.ancla.c === e.cur.c)) return null
  return menor(e.ancla, e.cur) ? [e.ancla, e.cur] : [e.cur, e.ancla]
}

/** Parte los runs para que haya un corte justo en `c`; dice qué índice empieza ahí. */
function cortar(par: ParrafoE, c: number): number {
  let o = 0
  for (let i = 0; i < par.r.length; i++) {
    const r = par.r[i]!
    if (c === o) return i
    if (c < o + r.t.length) {
      const k = c - o
      par.r.splice(i, 1, { ...r, t: r.t.slice(0, k) }, { ...r, t: r.t.slice(k) })
      return i + 1
    }
    o += r.t.length
  }
  return par.r.length
}

function formatoEn(par: ParrafoE, c: number): RunE {
  let o = 0
  let ultimo: Run | undefined
  for (const r of par.r) {
    if (c > o && c <= o + r.t.length) return r
    if (c === 0 && r.t.length) return r
    o += r.t.length
    if (r.t.length) ultimo = r
  }
  return ultimo ?? par.r[0] ?? { t: '' }
}

export function formatoActual(e: EstadoEditor): RunE {
  const par = e.planos[e.cur.p]?.par
  if (!par) return { t: '' }
  const r = formatoEn(par, e.cur.c)
  if (!e.pendiente) return r
  return { ...r, b: e.pendiente.b === undefined ? r.b : e.pendiente.b ? 1 : undefined, i: e.pendiente.i === undefined ? r.i : e.pendiente.i ? 1 : undefined, u: e.pendiente.u === undefined ? r.u : e.pendiente.u ? 1 : undefined, font: e.pendiente.font ?? r.font, pt: e.pendiente.pt ?? r.pt }
}

function aplicar(r: RunE, f: Formato): RunE {
  const n: RunE = { ...r }
  if (f.b !== undefined) f.b ? (n.b = 1) : delete n.b
  if (f.i !== undefined) f.i ? (n.i = 1) : delete n.i
  if (f.u !== undefined) f.u ? (n.u = 1) : delete n.u
  if (f.font !== undefined) (n.font = f.font), (n._fmt = 1)
  if (f.pt !== undefined) (n.pt = f.pt), (n._fmt = 1)
  return n
}

function compactar(par: ParrafoE): void {
  const salida: Run[] = []
  for (const r of par.r) {
    if (!r.t && par.r.length > 1) continue
    const u = salida[salida.length - 1]
    const mismo = u && ['b', 'i', 'u', 's', 'c', 'h', 'font', 'pt', 'o', 'href', '_fmt'].every(k => (u as Record<string, unknown>)[k] === (r as Record<string, unknown>)[k])
    if (u && mismo) u.t += r.t
    else salida.push({ ...r })
  }
  par.r = salida
}

/** Borra el tramo seleccionado. El cursor queda al inicio. */
function borrarRango(e: EstadoEditor, a: Pos, b: Pos): void {
  if (a.p === b.p) {
    const par = e.planos[a.p]!.par
    const i = cortar(par, a.c)
    const j = cortar(par, b.c)
    par.r.splice(i, j - i)
    if (!par.r.length) par.r.push({ t: '' })
    par._m = 1
    compactar(par)
  } else {
    const primero = e.planos[a.p]!.par
    const ultimo = e.planos[b.p]!.par
    const i = cortar(primero, a.c)
    primero.r.splice(i)
    const j = cortar(ultimo, b.c)
    const cola = ultimo.r.slice(j)
    const propios = cola.map(r => (ultimo.id === primero.id ? r : soltar(r)))
    primero.r.push(...propios)
    if (!primero.r.length) primero.r.push({ t: '' })
    primero._m = 1
    compactar(primero)
    for (let p = b.p; p > a.p; p--) quitar(e, p)
    e.planos = aplanar(e.doc.bloques)
  }
  e.cur = { ...a }
  e.ancla = null
  e.sucio = true
}

/** Un run que llega de otro párrafo: su `o` ya no sirve y lleva su formato explícito. */
const soltar = (r: Run): Run => ({ ...r, o: undefined, _fmt: 1 }) as RunE

function quitar(e: EstadoEditor, p: number): void {
  const { par, cont, idx } = e.planos[p]!
  if ((par.id ?? -1) >= 0) e.borrados.push(par.id)
  cont.splice(idx, 1)
  // Los índices de los hermanos que siguen cambian: se recalculan al aplanar.
  e.planos = aplanar(e.doc.bloques)
}

/** Mismo contenedor: dos párrafos que se pueden unir o partir sin romper una tabla. */
const mismoContenedor = (e: EstadoEditor, a: number, b: number) => e.planos[a]?.cont === e.planos[b]?.cont

export function escribir(e: EstadoEditor, texto: string): string | null {
  const limpio = texto.replace(/\r\n?/g, '\n')
  if (!limpio) return null
  const sel = seleccion(e)
  if (sel) {
    for (let p = sel[0].p; p <= sel[1].p; p++) if (!editable(e, p)) return 'Esa parte tiene enlaces, imágenes o campos: esta versión no la modifica.'
    if (!mismoContenedor(e, sel[0].p, sel[1].p)) return 'No se puede reemplazar una selección que cruza celdas de una tabla.'
  } else if (!editable(e, e.cur.p)) return 'Este párrafo tiene enlaces, imágenes o campos: esta versión no lo modifica.'
  if (!e.escribiendo || sel || limpio.includes('\n')) guardarPaso(e)
  if (sel) borrarRango(e, sel[0], sel[1])
  const partes = limpio.split('\n')
  partes.forEach((parte, i) => {
    if (i > 0) partirParrafo(e)
    if (parte) insertarEn(e, parte)
  })
  e.escribiendo = !limpio.includes('\n')
  e.sucio = true
  e.xDeseada = null
  return null
}

function insertarEn(e: EstadoEditor, texto: string): void {
  const par = e.planos[e.cur.p]!.par
  const base = formatoActual(e)
  const i = cortar(par, e.cur.c)
  const nuevo: RunE = { ...base, t: texto }
  if (e.pendiente && (e.pendiente.font || e.pendiente.pt)) nuevo._fmt = 1
  par.r.splice(i, 0, nuevo)
  compactar(par)
  par._m = 1
  e.cur.c += texto.length
}

function partirParrafo(e: EstadoEditor): void {
  const { par, cont, idx } = e.planos[e.cur.p]!
  const i = cortar(par, e.cur.c)
  const cola = par.r.splice(i)
  if (!par.r.length) par.r.push({ t: '' })
  const nuevo: ParrafoE = { ...par, id: -1, _o: par._o ?? par.id, _m: 1, r: cola.length ? cola : [{ ...formatoActual(e), t: '' }] }
  par._m = 1
  cont.splice(idx + 1, 0, nuevo)
  e.planos = aplanar(e.doc.bloques)
  e.cur = { p: e.cur.p + 1, c: 0 }
}

export function borrarAtras(e: EstadoEditor): string | null {
  const sel = seleccion(e)
  if (sel) return borrarSeleccion(e, sel)
  if (e.cur.c > 0) {
    if (!editable(e, e.cur.p)) return 'Este párrafo no se puede modificar en esta versión.'
    if (!e.escribiendo) guardarPaso(e)
    const par = e.planos[e.cur.p]!.par
    const t = textoDe(par)
    const desde = /[\udc00-\udfff]/.test(t[e.cur.c - 1] ?? '') ? e.cur.c - 2 : e.cur.c - 1
    borrarRango(e, { p: e.cur.p, c: desde }, { p: e.cur.p, c: e.cur.c })
    e.escribiendo = true
    return null
  }
  if (e.cur.p === 0) return null
  if (!mismoContenedor(e, e.cur.p - 1, e.cur.p)) return null
  if (!editable(e, e.cur.p) || !editable(e, e.cur.p - 1)) return 'Ese párrafo no se puede unir en esta versión.'
  guardarPaso(e)
  const anterior = e.planos[e.cur.p - 1]!.par
  borrarRango(e, { p: e.cur.p - 1, c: textoDe(anterior).length }, { p: e.cur.p, c: 0 })
  e.escribiendo = false
  return null
}

export function borrarAdelante(e: EstadoEditor): string | null {
  const sel = seleccion(e)
  if (sel) return borrarSeleccion(e, sel)
  const par = e.planos[e.cur.p]?.par
  if (!par) return null
  const t = textoDe(par)
  if (e.cur.c < t.length) {
    if (!editable(e, e.cur.p)) return 'Este párrafo no se puede modificar en esta versión.'
    guardarPaso(e)
    const hasta = /[\ud800-\udbff]/.test(t[e.cur.c] ?? '') ? e.cur.c + 2 : e.cur.c + 1
    borrarRango(e, { ...e.cur }, { p: e.cur.p, c: hasta })
    return null
  }
  if (e.cur.p + 1 >= e.planos.length || !mismoContenedor(e, e.cur.p, e.cur.p + 1)) return null
  if (!editable(e, e.cur.p) || !editable(e, e.cur.p + 1)) return 'Ese párrafo no se puede unir en esta versión.'
  guardarPaso(e)
  borrarRango(e, { ...e.cur }, { p: e.cur.p + 1, c: 0 })
  return null
}

function borrarSeleccion(e: EstadoEditor, sel: [Pos, Pos]): string | null {
  for (let p = sel[0].p; p <= sel[1].p; p++) if (!editable(e, p)) return 'Esa parte no se puede modificar en esta versión.'
  if (!mismoContenedor(e, sel[0].p, sel[1].p)) return 'No se puede borrar una selección que cruza celdas de una tabla.'
  guardarPaso(e)
  borrarRango(e, sel[0], sel[1])
  e.escribiendo = false
  return null
}

/** Aplica un formato a la selección; sin selección, a lo próximo que se escriba. */
export function formatear(e: EstadoEditor, f: Formato): string | null {
  const sel = seleccion(e)
  if (!sel) {
    e.pendiente = { ...e.pendiente, ...f }
    return null
  }
  for (let p = sel[0].p; p <= sel[1].p; p++) if (!editable(e, p)) return 'Esa parte no se puede modificar en esta versión.'
  guardarPaso(e)
  for (let p = sel[0].p; p <= sel[1].p; p++) {
    const par = e.planos[p]!.par
    const desde = p === sel[0].p ? sel[0].c : 0
    const hasta = p === sel[1].p ? sel[1].c : textoDe(par).length
    if (hasta <= desde) continue
    const i = cortar(par, desde)
    const j = cortar(par, hasta)
    for (let k = i; k < j; k++) par.r[k] = aplicar(par.r[k]!, f)
    compactar(par)
    par._m = 1
  }
  e.sucio = true
  e.escribiendo = false
  return null
}

/** Mueve el cursor un carácter, cruzando párrafos. */
export function moverCaracter(e: EstadoEditor, delta: 1 | -1): void {
  const par = e.planos[e.cur.p]?.par
  if (!par) return
  const t = textoDe(par)
  if (delta < 0) {
    if (e.cur.c > 0) e.cur.c -= /[\udc00-\udfff]/.test(t[e.cur.c - 1] ?? '') ? 2 : 1
    else if (e.cur.p > 0) e.cur = { p: e.cur.p - 1, c: textoDe(e.planos[e.cur.p - 1]!.par).length }
  } else {
    if (e.cur.c < t.length) e.cur.c += /[\ud800-\udbff]/.test(t[e.cur.c] ?? '') ? 2 : 1
    else if (e.cur.p + 1 < e.planos.length) e.cur = { p: e.cur.p + 1, c: 0 }
  }
}

export function textoSeleccionado(e: EstadoEditor): string {
  const sel = seleccion(e)
  if (!sel) return ''
  const partes: string[] = []
  for (let p = sel[0].p; p <= sel[1].p; p++) {
    const t = textoDe(e.planos[p]!.par)
    partes.push(t.slice(p === sel[0].p ? sel[0].c : 0, p === sel[1].p ? sel[1].c : t.length))
  }
  return partes.join('\n')
}

/** Lo que `guardar` recibe: solo los párrafos tocados, agrupados por su original. */
export function resumenGuardado(e: EstadoEditor): Guardado {
  const grupos = new Map<number, ParrafoE[]>()
  for (const { par } of e.planos) {
    const clave = par.id >= 0 ? par.id : par._o
    if (clave === undefined) continue
    const g = grupos.get(clave) ?? []
    g.push(par)
    grupos.set(clave, g)
  }
  const parrafos: { id: number; nuevos: { r: Run[] }[] }[] = []
  for (const [id, lista] of grupos) {
    if (!lista.some(p => p._m)) continue
    parrafos.push({ id, nuevos: lista.map(p => ({ r: p.r.map(limpiarRun) })) })
  }
  for (const id of new Set(e.borrados)) if (!grupos.has(id)) parrafos.push({ id, nuevos: [] })
  return { tipo: 'docx', firma: e.doc.firma, parrafos }
}

function limpiarRun(r: RunE): Run {
  const n: Run = { t: r.t }
  if (r.b) n.b = 1
  if (r.i) n.i = 1
  if (r.u) n.u = 1
  if (r.o !== undefined) n.o = r.o
  if (r._fmt && r.font) n.font = r.font
  if (r._fmt && r.pt) n.pt = r.pt
  return n
}

/** Tras guardar: lo tocado ya es el original. Los párrafos conservan su número. */
export function marcarGuardado(e: EstadoEditor, firma: string): void {
  e.doc.firma = firma
  e.sucio = false
  e.borrados = []
  e.deshacer = []
  e.rehacer = []
  e.escribiendo = false
}
