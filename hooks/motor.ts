// El visor: pestañas, lo que cada formato dibuja y lo que hace cada tecla.
// Puro: recibe teclas y clics, y devuelve el cuadro y los efectos a realizar.

import type { Bloque, CuadroVisor, Diapositiva, DocHoja, DocPdf, DocPptx, DocWord, Documento, Guardado, Parrafo, Tramo } from '../types'
import * as Ed from './editor'
import * as Ho from './hoja'
import { Lienzo, NEGRITA, CURSIVA, SUBRAYADO, TACHADO, aligerar, anchoDe, anchoTexto } from './lienzo'
import { altoPagina, maquetar, paginar, TINTA } from './maqueta'
import type { Linea, Opciones } from './maqueta'
import { bloquesDeMarkdown } from './markdown'

export type ImagenCuadro = { src: string; ruta: string; cols: number; filas: number; x: number; y: number; desdeF: number; desdeC: number; verF: number; verC: number }
export type Efecto =
  | { t: 'guardar'; id: number; ruta: string; datos: Guardado }
  | { t: 'copiar'; texto: string }
  | { t: 'cerrar-panel' }
  | { t: 'recargar'; id: number; ruta: string }

type TextoE = { lineas: string[]; cur: { l: number; c: number }; ancla: { l: number; c: number } | null; sy: number; sx: number; deshacer: { t: string; l: number; c: number }[]; rehacer: { t: string; l: number; c: number }[]; sucio: boolean; firma: string; codificacion: string }
type FilaV = { papel: boolean; linea?: Linea; pag: number }
type Maquetado = { filas: FilaV[]; paginas: number; porP: Map<number, number[]>; anchoU: number; x0: number; inicioPag: number[]; firma: string }

type VistaDoc = { t: 'doc'; ed: Ed.EstadoEditor | null; bloques: Bloque[]; defPt: number; scroll: number; ancho: number | null; maq: Maquetado | null; arrastre: boolean; xCursor: number }
type VistaHoja = { t: 'hoja'; est: Ho.EstadoHoja; arrastre: boolean }
type VistaDiapo = { t: 'diapo'; doc: DocPptx; n: number; notas: boolean }
type VistaPdf = { t: 'pdf'; doc: DocPdf; n: number; scroll: number; ancho: number | null; imagen: boolean }
type VistaImagen = { t: 'imagen'; w: number; h: number; zoom: number; px: number; py: number }
type VistaTexto = { t: 'texto'; e: TextoE; arrastre: boolean }
type VistaJson = { t: 'json'; raiz: unknown; abiertos: Set<string>; scroll: number; cur: number }
export type Vista = VistaDoc | VistaHoja | VistaDiapo | VistaPdf | VistaImagen | VistaTexto | VistaJson

export type Pestana = { id: number; ruta: string; nombre: string; ext: string; vista: Vista; alterna?: Vista; carpeta: string; aviso?: string; confirmarCierre?: boolean }
export type App = { pestanas: Pestana[]; activa: number; sig: number; aviso: string; menu: { x: number; y: number; items: { t: string; a: string }[] } | null; W: number; H: number; L: Lienzo | null; medidas: Map<string, { cols: number; filas: number }>; ultimoAck: number; arrastreBarra: boolean }

const VERDE = '#217346'
const AZUL = '#2b579a'
const NARANJA = '#b7472a'
const ROJO = '#b30b00'
const PIZARRA = '#3f4b5b'
const MESA = '#3a3f47'
const PAPEL = '#ffffff'
const CHROME = '#2b2f36'
const CHROME_ALTO = '#3a4049'
const TEXTO_CLARO = '#e8eaed'
const TENUE_CLARO = '#a6adb8'
const SEL = '#b4d7ff'
const CURSOR = '#1f2328'

const color = (v: Vista, ext: string) => (v.t === 'hoja' ? VERDE : v.t === 'diapo' ? NARANJA : v.t === 'pdf' ? ROJO : v.t === 'doc' && ext !== 'md' ? AZUL : PIZARRA)
const limitar = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const TAMANOS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]
const FUENTES = ['Calibri', 'Arial', 'Times New Roman', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Courier New']

export function nuevaApp(): App {
  return { pestanas: [], activa: 0, sig: 1, aviso: '', menu: null, W: 100, H: 30, L: null, medidas: new Map(), ultimoAck: 0, arrastreBarra: false }
}

const nombreDe = (ruta: string) => ruta.split(/[\\/]/).pop() ?? ruta
const carpetaDe = (ruta: string) => ruta.slice(0, Math.max(ruta.lastIndexOf('/'), ruta.lastIndexOf('\\')))
const extDe = (ruta: string) => nombreDe(ruta).split('.').pop()?.toLowerCase() ?? ''

function nuevoTexto(texto: string, firma: string, codificacion: string): TextoE {
  return { lineas: texto.replace(/\r\n?/g, '\n').split('\n'), cur: { l: 0, c: 0 }, ancla: null, sy: 0, sx: 0, deshacer: [], rehacer: [], sucio: false, firma, codificacion }
}

function vistaDoc(bloques: Bloque[], defPt: number, ed: Ed.EstadoEditor | null): VistaDoc {
  return { t: 'doc', ed, bloques, defPt, scroll: 0, ancho: null, maq: null, arrastre: false, xCursor: 0 }
}

function vistaDe(doc: Documento, ruta: string): { vista: Vista; alterna?: Vista } {
  const ext = extDe(ruta)
  switch (doc.tipo) {
    case 'docx': {
      const ed = Ed.nuevoEditor(doc as DocWord & { firma: string })
      return { vista: vistaDoc(doc.bloques, doc.defPt || 11, doc.editable ? ed : ed) }
    }
    case 'xlsx':
    case 'csv':
      return { vista: { t: 'hoja', est: Ho.nuevaHoja(doc as DocHoja & { firma: string }), arrastre: false } }
    case 'pptx':
      return { vista: { t: 'diapo', doc, n: 0, notas: false } }
    case 'pdf':
      return { vista: { t: 'pdf', doc, n: 0, scroll: 0, ancho: null, imagen: false } }
    case 'imagen':
      return { vista: { t: 'imagen', w: doc.w, h: doc.h, zoom: 1, px: 0, py: 0 } }
    case 'texto': {
      const editor: VistaTexto = { t: 'texto', e: nuevoTexto(doc.texto, doc.firma, doc.codificacion), arrastre: false }
      if (ext === 'md' || ext === 'markdown') return { vista: vistaDoc(bloquesDeMarkdown(doc.texto, carpetaDe(ruta)), 11, null), alterna: editor }
      if (ext === 'json') {
        try {
          const raiz = JSON.parse(doc.texto)
          return { vista: { t: 'json', raiz, abiertos: new Set(['$']), scroll: 0, cur: 0 }, alterna: editor }
        } catch {
          return { vista: editor }
        }
      }
      return { vista: editor }
    }
  }
}

export function abrirDocumento(app: App, ruta: string, doc: Documento): void {
  const { vista, alterna } = vistaDe(doc, ruta)
  const previa = app.pestanas.findIndex(p => p.ruta === ruta)
  const pestana: Pestana = { id: previa >= 0 ? app.pestanas[previa]!.id : app.sig++, ruta, nombre: nombreDe(ruta), ext: extDe(ruta), vista, alterna, carpeta: carpetaDe(ruta), aviso: doc.aviso }
  if (previa >= 0) {
    app.pestanas[previa] = pestana
    app.activa = previa
  } else {
    app.pestanas.push(pestana)
    app.activa = app.pestanas.length - 1
  }
  app.menu = null
  app.aviso = doc.aviso ?? ''
}

export function estaSucia(p: Pestana): boolean {
  const s = (v?: Vista) => (v?.t === 'doc' ? !!v.ed?.sucio : v?.t === 'hoja' ? v.est.sucio : v?.t === 'texto' ? v.e.sucio : false)
  return s(p.vista) || s(p.alterna)
}

// ── Pintar

function boton(L: Lienzo, x: number, y: number, t: string, a: string, fondo: string, on = false, f = TEXTO_CLARO): number {
  const w = anchoTexto(t) + 2
  L.fill(x, y, w, 1, on ? '#ffffff' : fondo)
  L.put(x + 1, y, t, on ? fondo : f, on ? '#ffffff' : fondo, on ? NEGRITA : 0)
  L.zona(x, y, w, 1, a)
  return x + w
}

function pintarPestanas(app: App, L: Lienzo): void {
  L.fill(0, 0, L.cols, 1, CHROME)
  let x = 0
  // Con muchas pestañas se saltan las primeras para que la activa siga a la vista.
  const anchoDePestana = (p: Pestana) => anchoTexto(` ${estaSucia(p) ? '● ' : ''}${p.nombre.length > 22 ? p.nombre.slice(0, 19) + '…' : p.nombre} `) + 3
  let desde = 0
  let usado = app.pestanas.slice(0, app.activa + 1).reduce((a, p) => a + anchoDePestana(p), 0)
  while (usado > L.cols && desde < app.activa) usado -= anchoDePestana(app.pestanas[desde++]!)
  app.pestanas.forEach((p, i) => {
    if (i < desde) return
    const activa = i === app.activa
    const fondo = activa ? color(p.vista, p.ext) : CHROME_ALTO
    const marca = estaSucia(p) ? '● ' : ''
    const nombre = p.nombre.length > 22 ? p.nombre.slice(0, 19) + '…' : p.nombre
    const t = ` ${marca}${nombre} `
    const w = anchoTexto(t)
    L.fill(x, 0, w + 3, 1, fondo)
    L.put(x, 0, t, activa ? '#ffffff' : TEXTO_CLARO, fondo, activa ? NEGRITA : 0)
    L.zona(x, 0, w, 1, `tab:${i}`)
    L.put(x + w, 0, '✕', activa ? '#ffffff' : TENUE_CLARO, fondo)
    L.zona(x + w, 0, 2, 1, `cerrar:${i}`)
    x += w + 3
  })
}

function pintarBarra(app: App, p: Pestana, L: Lienzo): void {
  const v = p.vista
  const c = color(v, p.ext)
  L.fill(0, 1, L.cols, 1, c)
  let x = 1
  const b = (t: string, a: string, on = false) => (x = boton(L, x, 1, t, a, c, on))
  const sep = () => (L.put(x, 1, '│', '#ffffff66'.slice(0, 7), c), (x += 2))
  if (v.t === 'doc') {
    if (v.ed && v.ed.doc.editable) {
      const r = Ed.formatoActual(v.ed)
      b('Guardar', 'guardar')
      sep()
      b('N', 'b', !!r.b)
      b('K', 'i', !!r.i)
      b('S', 'u', !!r.u)
      sep()
      const fuente = r.font ?? v.ed.doc.defFont ?? 'Calibri'
      b(`${fuente.length > 16 ? fuente.slice(0, 15) + '…' : fuente} ▾`, 'menu-fuente')
      b('A-', 'menos')
      L.put(x, 1, String(r.pt ?? v.defPt), '#ffffff', c, NEGRITA)
      x += String(r.pt ?? v.defPt).length + 1
      b('A+', 'mas')
      sep()
      b('↶', 'deshacer')
      b('↷', 'rehacer')
      sep()
    } else if (p.alterna) {
      b('Editar fuente', 'alternar')
      sep()
    }
    b('−', 'zoom-')
    b('+', 'zoom+')
    b('Ajustar', 'ajustar')
  } else if (v.t === 'texto') {
    b('Guardar', 'guardar')
    sep()
    b('↶', 'deshacer')
    b('↷', 'rehacer')
    if (p.alterna) {
      sep()
      b(p.ext === 'json' ? 'Ver árbol' : 'Ver documento', 'alternar')
    }
  } else if (v.t === 'json') {
    if (p.alterna) b('Editar texto', 'alternar')
  } else if (v.t === 'hoja') {
    b('Guardar', 'guardar')
    sep()
    b('↶', 'deshacer')
    b('↷', 'rehacer')
  } else if (v.t === 'diapo') {
    b('◀', 'ant')
    b(`${v.n + 1} / ${v.doc.diapositivas.length}`, 'nada')
    b('▶', 'sig')
    sep()
    b('Notas', 'notas', v.notas)
  } else if (v.t === 'pdf') {
    b('◀', 'ant')
    b(`${v.n + 1} / ${v.doc.paginas.length}`, 'nada')
    b('▶', 'sig')
    sep()
    b('−', 'zoom-')
    b('+', 'zoom+')
    b('Ajustar', 'ajustar')
    sep()
    b(v.imagen ? 'Ver texto' : 'Ver imagen', 'imagen')
  } else if (v.t === 'imagen') {
    b('−', 'zoom-')
    b('+', 'zoom+')
    b('Ajustar', 'ajustar')
    L.put(x + 1, 1, `${Math.round(v.zoom * 100)} %`, '#ffffff', c)
  }
}

function pintarEstado(app: App, p: Pestana, L: Lienzo, resumen: string): void {
  const y = L.filas - 1
  L.fill(0, y, L.cols, 1, CHROME)
  const izq = app.aviso || resumen
  L.put(1, y, izq.slice(0, L.cols - 2), app.aviso ? '#ffd27a' : TEXTO_CLARO, CHROME)
  const der = estaSucia(p) ? 'Modificado · ctrl+s guarda' : ''
  if (der && izq.length + der.length + 4 < L.cols) L.put(L.cols - der.length - 1, y, der, '#ffd27a', CHROME)
}

function barraVertical(L: Lienzo, x: number, y: number, alto: number, pos: number, total: number): void {
  if (total <= alto) return
  L.fill(x, y, 1, alto, '#50565f')
  const grosor = Math.max(1, Math.round((alto * alto) / total))
  const inicio = y + Math.round((pos / Math.max(1, total - alto)) * (alto - grosor))
  L.fill(x, inicio, 1, grosor, '#aeb4bd')
  L.zona(x, y, 1, alto, `barra:${y}:${alto}:${total}`)
}

function maquetarDoc(v: VistaDoc, app: App, W: number): Maquetado {
  const anchoHoja = limitar(v.ancho ?? Math.min(W - 6, 100), 30, 200)
  const margen = anchoHoja >= 70 ? 8 : anchoHoja >= 45 ? 4 : 2
  const anchoU = Math.max(20, anchoHoja - margen * 2)
  const firma = `${anchoU}:${app.medidas.size}`
  if (v.maq && v.maq.firma === firma) return v.maq
  const indice = new Map<Parrafo, number>()
  v.ed?.planos.forEach((x, i) => indice.set(x.par, i))
  const opc: Opciones = { defPt: v.defPt, indice, medidas: app.medidas }
  const bloques = v.ed ? v.ed.doc.bloques : v.bloques
  const { lineas, saltos } = maquetar(bloques, anchoU, opc)
  const paginas = paginar(lineas, saltos, altoPagina(anchoHoja) - 4)
  const filas: FilaV[] = []
  const inicioPag: number[] = []
  const porP = new Map<number, number[]>()
  paginas.forEach((pag, n) => {
    inicioPag.push(filas.length)
    filas.push({ papel: true, pag: n }, { papel: true, pag: n })
    for (const linea of pag) {
      const idx = filas.length
      filas.push({ papel: true, linea, pag: n })
      for (const s of linea.segs) if (s.p !== undefined) {
        const lista = porP.get(s.p) ?? []
        if (lista[lista.length - 1] !== idx) lista.push(idx)
        porP.set(s.p, lista)
      }
    }
    filas.push({ papel: true, pag: n }, { papel: true, pag: n }, { papel: false, pag: n })
  })
  const x0 = Math.max(0, Math.floor((W - 1 - anchoU - margen * 2) / 2)) + margen
  const maq: Maquetado = { filas, paginas: paginas.length, porP, anchoU, x0, inicioPag, firma }
  v.maq = maq
  return maq
}

/** Dónde queda el cursor: fila virtual y columna dentro de la hoja. */
function caret(v: VistaDoc, maq: Maquetado): { fila: number; x: number } | null {
  const e = v.ed
  if (!e) return null
  const filas = maq.porP.get(e.cur.p)
  if (!filas) return null
  let mejor: { fila: number; x: number } | null = null
  for (const f of filas) {
    for (const s of maq.filas[f]!.linea!.segs) {
      if (s.p !== e.cur.p) continue
      const o = s.o ?? 0
      if (e.cur.c >= o && e.cur.c <= o + s.s.length) {
        if (e.cur.c === o + s.s.length && mejor && s.s.length) continue
        if (e.cur.c < o + s.s.length || !mejor) {
          let x = s.x
          let i = o
          for (const ch of s.s) {
            if (i >= e.cur.c) break
            x += anchoDe(ch.codePointAt(0)!)
            i += ch.length
          }
          mejor = { fila: f, x }
        }
      }
    }
  }
  if (mejor) return mejor
  const ultimaFila = filas[filas.length - 1]!
  const segs = maq.filas[ultimaFila]!.linea!.segs.filter(s => s.p === e.cur.p)
  const u = segs[segs.length - 1]
  return u ? { fila: ultimaFila, x: u.x + anchoTexto(u.s) } : null
}

/** El carácter de una fila virtual más cercano a la columna `x`. */
function posEn(maq: Maquetado, fila: number, x: number): Ed.Pos | null {
  const segs = maq.filas[fila]?.linea?.segs.filter(s => s.p !== undefined)
  if (!segs?.length) return null
  let elegido = segs[segs.length - 1]!
  for (const s of segs) {
    if (x < s.x + anchoTexto(s.s)) {
      elegido = s
      break
    }
  }
  let i = elegido.o ?? 0
  let cx = elegido.x
  for (const ch of elegido.s) {
    const w = anchoDe(ch.codePointAt(0)!)
    if (cx + w > x) return { p: elegido.p!, c: i }
    cx += w
    i += ch.length
  }
  return { p: elegido.p!, c: i }
}

function dibujarLinea(L: Lienzo, linea: Linea, x0: number, y: number, seleccion: (p: number, o: number) => boolean): void {
  for (const s of linea.segs) {
    let x = x0 + s.x
    let o = s.o ?? 0
    for (const ch of s.s) {
      const elegido = s.p !== undefined && seleccion(s.p, o)
      x = L.put(x, y, ch, s.f, elegido ? SEL : s.h, s.a)
      o += ch.length
    }
  }
}

function pintarDoc(app: App, p: Pestana, v: VistaDoc, L: Lienzo, imgs: ImagenCuadro[]): string {
  const y0 = 2
  const alto = L.filas - 3
  const W = L.cols
  const maq = maquetarDoc(v, app, W)
  L.fill(0, y0, W, alto, MESA)
  const total = maq.filas.length
  v.scroll = limitar(v.scroll, 0, Math.max(0, total - alto))
  const sel = v.ed ? Ed.seleccion(v.ed) : null
  const seleccionado = (par: number, o: number) => {
    if (!sel) return false
    const [a, b] = sel
    if (par < a.p || par > b.p) return false
    if (par === a.p && o < a.c) return false
    if (par === b.p && o >= b.c) return false
    return true
  }
  const margen = maq.x0 - Math.max(0, Math.floor((W - 1 - maq.anchoU - (maq.x0 - Math.floor((W - 1 - maq.anchoU) / 2)) * 0) / 2))
  const xPapel = Math.max(0, Math.floor((W - 1 - (maq.anchoU + 2 * (maq.anchoU + 16 <= W ? 8 : 4))) / 2))
  const anchoP = maq.anchoU + 2 * (maq.x0 - xPapel)
  void margen
  for (let i = 0; i < alto; i++) {
    const fila = maq.filas[v.scroll + i]
    const y = y0 + i
    if (!fila) continue
    if (fila.papel) {
      L.fill(xPapel, y, anchoP, 1, PAPEL)
      if (fila.linea) dibujarLinea(L, fila.linea, maq.x0, y, seleccionado)
      if (fila.linea?.img) marcarImagen(L, fila.linea, maq.x0, y)
    }
  }
  recogerImagenes(maq.filas.map(f => f.linea), v.scroll, alto, y0, maq.x0, p.ruta, imgs)
  const pos = caret(v, maq)
  if (pos && pos.fila >= v.scroll && pos.fila < v.scroll + alto) {
    v.xCursor = pos.x
    const y = y0 + pos.fila - v.scroll
    const celda = L.celdas[y]?.[maq.x0 + pos.x]
    if (celda) {
      celda.b = CURSOR
      celda.f = '#ffffff'
    }
  }
  L.zona(0, y0, W - 1, alto, 'hoja-doc')
  barraVertical(L, W - 1, y0, alto, v.scroll, total)
  let pag = 0
  for (let i = 0; i < maq.inicioPag.length; i++) if (maq.inicioPag[i]! <= v.scroll + 2) pag = i
  let palabras = 0
  for (const x of v.ed?.planos ?? []) palabras += Ed.textoDe(x.par).split(/\s+/).filter(Boolean).length
  const zoom = `${Math.round((maq.anchoU / 84) * 100)} %`
  const noEd = v.ed && !v.ed.doc.editable ? ' · solo lectura' : ''
  return `Página ${pag + 1} de ${maq.paginas}${v.ed ? ` · ${palabras.toLocaleString('es')} palabras` : ''} · ${zoom}${noEd}`
}

function marcarImagen(L: Lienzo, linea: Linea, x0: number, y: number): void {
  const img = linea.img!
  L.fill(x0 + img.x, y, img.cols, 1, '#e5e7eb')
  if (img.fila === Math.floor(img.filas / 2)) {
    const t = img.alt ?? 'imagen'
    L.put(x0 + img.x + Math.max(0, Math.floor((img.cols - anchoTexto(t)) / 2)), y, t.slice(0, img.cols), '#667085', '#e5e7eb', CURSIVA)
  }
}

function recogerImagenes(lineas: (Linea | undefined)[], scroll: number, alto: number, y0: number, x0: number, ruta: string, imgs: ImagenCuadro[]): void {
  for (let i = 0; i < alto; ) {
    const l = lineas[scroll + i]
    if (!l?.img) {
      i++
      continue
    }
    const img = l.img
    let n = 1
    while (i + n < alto && lineas[scroll + i + n]?.img?.src === img.src && lineas[scroll + i + n]!.img!.fila === img.fila + n) n++
    imgs.push({ src: img.src, ruta, cols: img.cols, filas: img.filas, x: x0 + img.x, y: y0 + i, desdeF: img.fila, desdeC: 0, verF: n, verC: img.cols })
    i += n
  }
}

function pintarHoja(p: Pestana, v: VistaHoja, L: Lienzo): string {
  const est = v.est
  const h = est.hojas[est.activa]!
  const W = L.cols
  const y0 = 2
  const barraF = y0
  L.fill(0, barraF, W, 1, '#f3f4f6')
  const ref = Ho.refDe(h.cur[0], h.cur[1])
  L.put(1, barraF, ref.padEnd(7), TINTA, '#ffffff', NEGRITA)
  L.put(9, barraF, 'fx', '#6b7280', '#f3f4f6', CURSIVA)
  const celda = h.celdas.get(`${h.cur[0]},${h.cur[1]}`)
  const contenido = est.edicion ? est.edicion.texto : celda?.f ? `=${celda.f}` : celda ? Ho.mostrar(celda.v) : ''
  L.put(12, barraF, contenido.slice(0, W - 14), TINTA, '#f3f4f6')
  if (est.edicion) {
    L.fondo(12 + anchoTexto(contenido.slice(0, est.edicion.cur)), barraF, CURSOR, '#ffffff')
    L.put(W - 3, barraF, '✕', '#b42318', '#f3f4f6', NEGRITA)
    L.zona(W - 4, barraF, 3, 1, 'cancelar-celda')
  }
  const yCab = y0 + 1
  const yDatos = yCab + 1
  const yTabs = L.filas - 2
  const alto = yTabs - yDatos
  L.fill(0, yCab, W, L.filas - 1 - yCab, '#ffffff')
  const rowW = Math.max(4, String(h.filas + alto).length + 2)
  const ancho = (c: number) => limitar(h.anchos[String(c)] ?? 10, 2, 60)

  const [fzF, fzC] = h.congela
  h.scrollF = Math.max(h.scrollF, fzF)
  h.scrollC = Math.max(h.scrollC, fzC)
  const cols: { c: number; x: number; w: number }[] = []
  let x = rowW
  for (let c = 0; c < fzC; c++) {
    cols.push({ c, x, w: ancho(c) })
    x += ancho(c) + 1
  }
  for (let c = h.scrollC; x < W; c++) {
    cols.push({ c, x, w: ancho(c) })
    x += ancho(c) + 1
  }
  const filas: { f: number; y: number }[] = []
  let y = yDatos
  for (let f = 0; f < fzF && y < yTabs; f++, y++) filas.push({ f, y })
  for (let f = h.scrollF; y < yTabs; f++, y++) filas.push({ f, y })

  const [f1, c1, f2, c2] = Ho.rangoActivo(h)
  L.fill(0, yCab, W, 1, '#e7e9ec')
  for (const col of cols) {
    const activa = col.c >= c1 && col.c <= c2
    const l = Ho.letraDe(col.c)
    L.fill(col.x, yCab, col.w, 1, activa ? '#c6d9c9' : '#e7e9ec')
    L.put(col.x + Math.floor((col.w - l.length) / 2), yCab, l, '#374151', activa ? '#c6d9c9' : '#e7e9ec', activa ? NEGRITA : 0)
    L.zona(col.x, yCab, col.w, 1, `colcab:${col.c}`)
  }

  const cubiertas = new Set<string>()
  for (const [mf1, mc1, mf2, mc2] of h.combinadas) for (let f = mf1; f <= mf2; f++) for (let c = mc1; c <= mc2; c++) if (f !== mf1 || c !== mc1) cubiertas.add(`${f},${c}`)

  for (const fila of filas) {
    const activa = fila.f >= f1 && fila.f <= f2
    L.fill(0, fila.y, rowW, 1, activa ? '#c6d9c9' : '#e7e9ec')
    const n = String(fila.f + 1)
    L.put(rowW - n.length - 1, fila.y, n, '#374151', activa ? '#c6d9c9' : '#e7e9ec', activa ? NEGRITA : 0)
    L.zona(0, fila.y, rowW, 1, `filacab:${fila.f}`)
    for (const col of cols) {
      L.zona(col.x, fila.y, col.w + 1, 1, `cel:${fila.f}:${col.c}`)
      L.put(col.x + col.w, fila.y, '│', '#e5e7eb', '#ffffff')
    }
    // Primero los fondos, luego los textos: un texto puede invadir celdas vacías.
    for (const col of cols) {
      const c = h.celdas.get(`${fila.f},${col.c}`)
      const est2 = c?.s !== undefined ? h.estilos[c.s] : undefined
      if (est2?.bg) L.fill(col.x, fila.y, col.w, 1, est2.bg)
    }
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!
      if (cubiertas.has(`${fila.f},${col.c}`)) continue
      const c = h.celdas.get(`${fila.f},${col.c}`)
      if (!c) continue
      const t = Ho.mostrado(c)
      if (!t) continue
      const est2 = c.s !== undefined ? h.estilos[c.s] : undefined
      const a = (est2?.b ? NEGRITA : 0) | (est2?.i ? CURSIVA : 0) | (est2?.u ? SUBRAYADO : 0)
      const combinada = h.combinadas.find(m => m[0] === fila.f && m[1] === col.c)
      let disponible = col.w
      if (combinada) {
        for (let j = i + 1; j < cols.length && cols[j]!.c <= combinada[3]; j++) disponible += cols[j]!.w + 1
      } else if (typeof c.v === 'string' && est2?.al !== 'r') {
        for (let j = i + 1; j < cols.length && !h.celdas.has(`${fila.f},${cols[j]!.c}`); j++) disponible += cols[j]!.w + 1
      }
      const w = anchoTexto(t)
      const numerica = typeof c.v === 'number'
      let texto = t
      if (w > disponible) {
        if (numerica) texto = '#'.repeat(col.w)
        else texto = [...t].slice(0, disponible).join('')
      }
      const al = combinada && !est2?.al ? 'c' : (est2?.al ?? (numerica ? 'r' : 'l'))
      const tw = anchoTexto(texto)
      const dx = al === 'r' ? Math.max(0, disponible - tw) : al === 'c' ? Math.max(0, Math.floor((disponible - tw) / 2)) : 0
      const color2 = est2?.c ?? (typeof c.v === 'string' && c.v.startsWith('#') ? '#b42318' : TINTA)
      for (const [k, ch] of [...texto].entries()) {
        const cx = col.x + dx + anchoTexto([...texto].slice(0, k).join(''))
        L.put(cx, fila.y, ch, color2, undefined, a)
      }
    }
    for (const col of cols) {
      if (fila.f < f1 || fila.f > f2 || col.c < c1 || col.c > c2) continue
      const actual = fila.f === h.cur[0] && col.c === h.cur[1]
      for (let i = col.x; i < Math.min(W, col.x + col.w); i++) L.fondo(i, fila.y, actual ? '#9fd3ae' : '#d5ecd9')
    }
  }
  if (fzF > 0 && filas[fzF - 1]) for (let i = 0; i < W; i++) { const c = L.celdas[filas[fzF - 1]!.y]?.[i]; if (c) c.a |= SUBRAYADO }

  L.fill(0, yTabs, W, 1, '#d7dbe0')
  let tx = 1
  est.hojas.forEach((ho, i) => {
    if (ho.oculta) return
    const t = ` ${ho.nombre} `
    const on = i === est.activa
    L.put(tx, yTabs, t, on ? VERDE : '#374151', on ? '#ffffff' : '#d7dbe0', on ? NEGRITA : 0)
    L.zona(tx, yTabs, anchoTexto(t), 1, `hoja:${i}`)
    tx += anchoTexto(t) + 1
  })

  const numeros: number[] = []
  for (let f = f1; f <= f2 && numeros.length < 20000; f++)
    for (let c = c1; c <= c2 && numeros.length < 20000; c++) {
      const celdaN = h.celdas.get(`${f},${c}`)
      if (typeof celdaN?.v === 'number') numeros.push(celdaN.v)
    }
  const suma = numeros.reduce((a, b) => a + b, 0)
  const res = numeros.length > 1 ? `Suma ${Ho.mostrar(suma)} · Promedio ${Ho.mostrar(suma / numeros.length)} · ` : ''
  return `${res}${h.nombre} · ${h.filas} filas · ${h.cols} columnas`
}

/** Mantiene la celda activa a la vista. */
function verCelda(h: Ho.HojaE, filasVis: number, W: number): void {
  const [f, c] = h.cur
  const [fzF, fzC] = h.congela
  if (f >= fzF) {
    if (f < h.scrollF) h.scrollF = f
    const libre = filasVis - fzF
    if (f >= h.scrollF + libre) h.scrollF = f - libre + 1
  }
  if (c >= fzC) {
    if (c < h.scrollC) h.scrollC = c
    const ancho = (k: number) => limitar(h.anchos[String(k)] ?? 10, 2, 60) + 1
    let usado = 6
    for (let k = 0; k < fzC; k++) usado += ancho(k)
    for (let k = h.scrollC; k <= c; k++) usado += ancho(k)
    while (usado > W && h.scrollC < c) {
      usado -= ancho(h.scrollC)
      h.scrollC++
    }
  }
}

function pintarDiapo(app: App, p: Pestana, v: VistaDiapo, L: Lienzo, imgs: ImagenCuadro[]): string {
  const y0 = 2
  const altoTotal = L.filas - 3
  const notas = v.notas ? Math.min(8, Math.floor(altoTotal / 3)) : 0
  const alto = altoTotal - notas
  L.fill(0, y0, L.cols, altoTotal, MESA)
  const rel = v.doc.alto > 0 ? v.doc.ancho / v.doc.alto : 16 / 9
  let cols = L.cols - 4
  let filas = Math.round(cols / rel / 2)
  if (filas > alto - 2) {
    filas = alto - 2
    cols = Math.round(filas * 2 * rel)
  }
  const x0 = Math.floor((L.cols - cols) / 2)
  const yS = y0 + Math.floor((alto - filas) / 2)
  const d: Diapositiva | undefined = v.doc.diapositivas[v.n]
  if (!d) return 'Presentación vacía'
  L.fill(x0, yS, cols, filas, d.bg ?? PAPEL)
  const opc: Opciones = { defPt: 18, indice: new Map(), medidas: app.medidas, sinRegla: true }
  for (const forma of d.formas) {
    const fx = x0 + Math.round(forma.x * cols)
    const fy = yS + Math.round(forma.y * filas)
    const fw = Math.max(1, Math.round(forma.w * cols))
    const fh = Math.max(1, Math.round(forma.h * filas))
    if (forma.bg) L.fill(fx, fy, fw, fh, forma.bg)
    if (forma.borde && fw >= 2 && fh >= 2) {
      L.put(fx, fy, '┌' + '─'.repeat(fw - 2) + '┐', forma.borde, forma.bg)
      L.put(fx, fy + fh - 1, '└' + '─'.repeat(fw - 2) + '┘', forma.borde, forma.bg)
      for (let k = 1; k < fh - 1; k++) {
        L.put(fx, fy + k, '│', forma.borde, forma.bg)
        L.put(fx + fw - 1, fy + k, '│', forma.borde, forma.bg)
      }
    }
    if (forma.tipo === 'img' && forma.src) {
      L.fill(fx, fy, fw, fh, '#e5e7eb')
      imgs.push({ src: forma.src, ruta: p.ruta, cols: fw, filas: fh, x: fx, y: fy, desdeF: 0, desdeC: 0, verF: fh, verC: fw })
    }
    if (forma.b?.length) {
      const relleno = fw >= 6 ? 1 : 0
      const { lineas } = maquetar(forma.b, Math.max(4, fw - relleno * 2), opc)
      while (lineas.length && lineas[lineas.length - 1]!.segs.length === 0) lineas.pop()
      lineas.slice(0, fh).forEach((l, n) => dibujarLinea(L, l, fx + relleno, fy + n, () => false))
    }
  }
  if (notas) {
    const yN = y0 + alto
    L.fill(0, yN, L.cols, notas, '#f5f1e6')
    L.put(2, yN, 'Notas del orador', '#7a6a3a', '#f5f1e6', NEGRITA)
    const texto = d.notas || 'Esta diapositiva no tiene notas.'
    const { lineas } = maquetar([{ k: 'p', id: -1, r: [{ t: texto }], ed: 0 }], L.cols - 4, opc)
    lineas.slice(0, notas - 1).forEach((l, n) => dibujarLinea(L, l, 2, yN + 1 + n, () => false))
  }
  L.zona(0, y0, Math.floor(L.cols / 3), alto, 'ant')
  L.zona(Math.floor(L.cols / 3), y0, L.cols, alto, 'sig')
  return `Diapositiva ${v.n + 1} de ${v.doc.diapositivas.length}${d.notas ? ' · tiene notas' : ''}`
}

function pintarPdf(p: Pestana, v: VistaPdf, L: Lienzo, imgs: ImagenCuadro[]): string {
  const y0 = 2
  const alto = L.filas - 3
  L.fill(0, y0, L.cols, alto, MESA)
  const pag = v.doc.paginas[v.n]
  if (!pag) return 'PDF sin páginas'
  if (v.imagen || pag.soloImagen) {
    const cols = L.cols - 4
    const filas = alto - 1
    imgs.push({ src: `pdf:${v.n}`, ruta: p.ruta, cols, filas, x: 2, y: y0, desdeF: 0, desdeC: 0, verF: filas, verC: cols })
    return `Página ${v.n + 1} de ${v.doc.paginas.length}${pag.soloImagen ? ' · página escaneada (imagen)' : ''}`
  }
  const cols = limitar(v.ancho ?? Math.min(L.cols - 6, 110), 40, 220)
  const filas = Math.max(10, Math.round((cols * pag.h) / pag.w / 2))
  v.scroll = limitar(v.scroll, 0, Math.max(0, filas + 2 - alto))
  const x0 = Math.max(0, Math.floor((L.cols - 1 - cols) / 2))
  for (let y = 0; y < alto; y++) {
    const f = y + v.scroll
    if (f >= 1 && f <= filas) L.fill(x0, y0 + y, cols, 1, PAPEL)
  }
  const orden = [...pag.textos].sort((a, b) => a.y - b.y || a.x - b.x)
  const hasta = new Map<number, number>()
  for (const t of orden) {
    const f = Math.min(filas - 1, Math.max(0, Math.round((t.y / pag.h) * filas)))
    const y = y0 + f + 1 - v.scroll
    let x = Math.round((t.x / pag.w) * cols)
    const ocupado = hasta.get(f) ?? 0
    if (x < ocupado) x = ocupado
    const a = (t.b ? NEGRITA : 0) | (t.i ? CURSIVA : 0) | (t.pt >= 15 ? NEGRITA : 0)
    if (y >= y0 && y < y0 + alto) L.put(x0 + x, y, t.t.slice(0, cols - x), t.pt <= 7.5 ? '#667085' : TINTA, PAPEL, a)
    hasta.set(f, x + anchoTexto(t.t))
  }
  L.zona(0, y0, L.cols - 1, alto, 'pdf')
  barraVertical(L, L.cols - 1, y0, alto, v.scroll, filas + 2)
  return `Página ${v.n + 1} de ${v.doc.paginas.length} · ${Math.round((cols / 110) * 100)} %`
}

function pintarImagen(p: Pestana, v: VistaImagen, L: Lienzo, imgs: ImagenCuadro[]): string {
  const y0 = 2
  const alto = L.filas - 3
  L.fill(0, y0, L.cols, alto, MESA)
  const cols = Math.min(512, Math.round((L.cols - 2) * v.zoom))
  const filas = Math.min(256, Math.round(alto * v.zoom))
  const verC = Math.min(cols, L.cols)
  const verF = Math.min(filas, alto)
  v.px = limitar(v.px, 0, Math.max(0, cols - verC))
  v.py = limitar(v.py, 0, Math.max(0, filas - verF))
  imgs.push({ src: '-', ruta: p.ruta, cols, filas, x: Math.floor((L.cols - verC) / 2), y: y0 + Math.floor((alto - verF) / 2), desdeF: v.py, desdeC: v.px, verF, verC })
  const medida = v.w && v.h ? `${v.w} × ${v.h} px · ` : ''
  return `${medida}${Math.round(v.zoom * 100)} %`
}

function pintarTexto(p: Pestana, v: VistaTexto, L: Lienzo): string {
  const e = v.e
  const y0 = 2
  const alto = L.filas - 3
  const gutter = String(e.lineas.length).length + 2
  const util = L.cols - gutter - 1
  L.fill(0, y0, L.cols, alto, '#ffffff')
  L.fill(0, y0, gutter, alto, '#f0f2f5')
  e.sy = limitar(e.sy, 0, Math.max(0, e.lineas.length - alto))
  const sel = rangoTexto(e)
  for (let i = 0; i < alto; i++) {
    const n = e.sy + i
    const linea = e.lineas[n]
    if (linea === undefined) break
    const y = y0 + i
    const num = String(n + 1)
    L.put(gutter - num.length - 1, y, num, n === e.cur.l ? '#111827' : '#98a2b3', '#f0f2f5')
    const visible = linea.replace(/\t/g, '  ')
    const ch = [...visible].slice(e.sx, e.sx + util).join('')
    L.put(gutter, y, ch, TINTA, '#ffffff')
    if (sel && n >= sel[0].l && n <= sel[1].l) {
      const desde = n === sel[0].l ? sel[0].c : 0
      const hasta = n === sel[1].l ? sel[1].c : [...visible].length + 1
      for (let k = Math.max(0, desde - e.sx); k < Math.min(util, hasta - e.sx); k++) L.fondo(gutter + k, y, SEL)
    }
    if (n === e.cur.l) {
      const cx = e.cur.c - e.sx
      if (cx >= 0 && cx < util) L.fondo(gutter + cx, y, CURSOR, '#ffffff')
    }
  }
  L.zona(0, y0, L.cols - 1, alto, 'texto')
  barraVertical(L, L.cols - 1, y0, alto, e.sy, e.lineas.length)
  return `Línea ${e.cur.l + 1}, columna ${e.cur.c + 1} · ${e.lineas.length} líneas · ${e.codificacion}`
}

type FilaJson = { nivel: number; clave: string; valor: unknown; ruta: string; contenedor: boolean; n: number }

function filasJson(v: VistaJson): FilaJson[] {
  const salida: FilaJson[] = []
  const entrar = (valor: unknown, clave: string, ruta: string, nivel: number) => {
    const contenedor = valor !== null && typeof valor === 'object'
    const n = contenedor ? Object.keys(valor as object).length : 0
    salida.push({ nivel, clave, valor, ruta, contenedor, n })
    if (contenedor && v.abiertos.has(ruta) && salida.length < 20000) for (const [k, x] of Object.entries(valor as object)) entrar(x, k, `${ruta}.${k}`, nivel + 1)
  }
  entrar(v.raiz, '$', '$', 0)
  return salida
}

function pintarJson(p: Pestana, v: VistaJson, L: Lienzo): string {
  const y0 = 2
  const alto = L.filas - 3
  L.fill(0, y0, L.cols, alto, '#ffffff')
  const filas = filasJson(v)
  v.cur = limitar(v.cur, 0, filas.length - 1)
  if (v.cur < v.scroll) v.scroll = v.cur
  if (v.cur >= v.scroll + alto) v.scroll = v.cur - alto + 1
  v.scroll = limitar(v.scroll, 0, Math.max(0, filas.length - alto))
  for (let i = 0; i < alto; i++) {
    const f = filas[v.scroll + i]
    if (!f) break
    const y = y0 + i
    if (v.scroll + i === v.cur) L.fill(0, y, L.cols - 1, 1, '#eaf2ff')
    let x = 1 + f.nivel * 2
    if (f.contenedor) {
      x = L.put(x, y, v.abiertos.has(f.ruta) ? '▾ ' : '▸ ', '#667085')
    } else x += 2
    if (f.clave !== '$') x = L.put(x, y, /^\d+$/.test(f.clave) ? `${f.clave}: ` : `"${f.clave}": `, '#0550ae', undefined, /^\d+$/.test(f.clave) ? 0 : NEGRITA)
    const val = f.valor
    if (f.contenedor) {
      const esLista = Array.isArray(val)
      L.put(x, y, esLista ? `[ ${f.n} elementos ]` : `{ ${f.n} campos }`, '#667085', undefined, CURSIVA)
    } else {
      const t = typeof val === 'string' ? JSON.stringify(val) : String(val)
      const c = typeof val === 'string' ? '#0a7d32' : typeof val === 'number' ? '#b35900' : '#8250df'
      L.put(x, y, [...t].slice(0, Math.max(0, L.cols - x - 2)).join(''), c)
    }
    L.zona(0, y, L.cols - 1, 1, `json:${v.scroll + i}`)
  }
  barraVertical(L, L.cols - 1, y0, alto, v.scroll, filas.length)
  return `${filas.length} filas · Enter abre o cierra`
}

function pintarVacio(L: Lienzo): void {
  L.fill(0, 0, L.cols, L.filas, MESA)
  const lineas = ['Lector de archivos', '', 'Escribe  /leer <ruta>  para abrir un documento.', 'Word, Excel, PowerPoint, PDF, Markdown, CSV, JSON, imágenes y texto.']
  lineas.forEach((t, i) => L.put(Math.max(0, Math.floor((L.cols - anchoTexto(t)) / 2)), Math.floor(L.filas / 2) - 2 + i, t, i === 0 ? '#ffffff' : TENUE_CLARO, MESA, i === 0 ? NEGRITA : 0))
}

export function pintar(app: App, W: number, H: number): { cuadro: CuadroVisor; imagenes: ImagenCuadro[] } {
  app.W = W
  app.H = H
  const L = new Lienzo(W, H, CHROME)
  const imgs: ImagenCuadro[] = []
  const p = app.pestanas[app.activa]
  if (!p) pintarVacio(L)
  else {
    pintarPestanas(app, L)
    pintarBarra(app, p, L)
    const v = p.vista
    let resumen = ''
    if (v.t === 'doc') resumen = pintarDoc(app, p, v, L, imgs)
    else if (v.t === 'hoja') resumen = pintarHoja(p, v, L)
    else if (v.t === 'diapo') resumen = pintarDiapo(app, p, v, L, imgs)
    else if (v.t === 'pdf') resumen = pintarPdf(p, v, L, imgs)
    else if (v.t === 'imagen') resumen = pintarImagen(p, v, L, imgs)
    else if (v.t === 'texto') resumen = pintarTexto(p, v, L)
    else resumen = pintarJson(p, v, L)
    pintarEstado(app, p, L, resumen)
  }
  if (app.menu) {
    const { x, y, items } = app.menu
    const w = Math.max(...items.map(i => anchoTexto(i.t))) + 4
    items.forEach((it, i) => {
      L.fill(x, y + i, w, 1, '#ffffff')
      L.put(x + 2, y + i, it.t, TINTA, '#ffffff')
      L.zona(x, y + i, w, 1, it.a)
    })
  }
  app.L = L
  const filas: Tramo[][] = aligerar(L.tramos())
  return { cuadro: { filas, ack: app.ultimoAck, ancho: W, alto: H }, imagenes: imgs }
}

// ── Teclas y ratón

type Mods = { ctrl?: boolean; shift?: boolean; meta?: boolean }

function rangoTexto(e: TextoE): [{ l: number; c: number }, { l: number; c: number }] | null {
  if (!e.ancla || (e.ancla.l === e.cur.l && e.ancla.c === e.cur.c)) return null
  const antes = e.ancla.l < e.cur.l || (e.ancla.l === e.cur.l && e.ancla.c < e.cur.c)
  return antes ? [e.ancla, e.cur] : [e.cur, e.ancla]
}

function pasoTexto(e: TextoE): void {
  e.deshacer.push({ t: e.lineas.join('\n'), l: e.cur.l, c: e.cur.c })
  if (e.deshacer.length > 200) e.deshacer.shift()
  e.rehacer = []
}

function escribirTexto(e: TextoE, texto: string): void {
  pasoTexto(e)
  const sel = rangoTexto(e)
  if (sel) borrarRangoTexto(e, sel)
  const linea = e.lineas[e.cur.l]!
  const partes = texto.split('\n')
  const cola = linea.slice(e.cur.c)
  e.lineas[e.cur.l] = linea.slice(0, e.cur.c) + partes[0]
  if (partes.length > 1) {
    const ultima = partes[partes.length - 1]!
    e.lineas.splice(e.cur.l + 1, 0, ...partes.slice(1, -1), ultima + cola)
    e.cur = { l: e.cur.l + partes.length - 1, c: ultima.length }
  } else {
    e.lineas[e.cur.l] += cola
    e.cur.c += partes[0]!.length
  }
  e.ancla = null
  e.sucio = true
}

function borrarRangoTexto(e: TextoE, [a, b]: NonNullable<ReturnType<typeof rangoTexto>>): void {
  e.lineas.splice(a.l, b.l - a.l + 1, e.lineas[a.l]!.slice(0, a.c) + e.lineas[b.l]!.slice(b.c))
  e.cur = { ...a }
  e.ancla = null
  e.sucio = true
}

function verCursorTexto(e: TextoE, alto: number, util: number): void {
  if (e.cur.l < e.sy) e.sy = e.cur.l
  if (e.cur.l >= e.sy + alto) e.sy = e.cur.l - alto + 1
  if (e.cur.c < e.sx) e.sx = e.cur.c
  if (e.cur.c >= e.sx + util) e.sx = e.cur.c - util + 1
}

function teclaTexto(p: Pestana, v: VistaTexto, k: string, m: Mods, app: App): Efecto[] {
  const e = v.e
  const alto = app.H - 3
  const mover = (fn: () => void) => {
    if (m.shift) e.ancla ??= { ...e.cur }
    else e.ancla = null
    fn()
  }
  const lon = (l: number) => e.lineas[l]?.length ?? 0
  switch (k) {
    case 'left': mover(() => { if (e.cur.c > 0) e.cur.c--; else if (e.cur.l > 0) e.cur = { l: e.cur.l - 1, c: lon(e.cur.l - 1) } }); break
    case 'right': mover(() => { if (e.cur.c < lon(e.cur.l)) e.cur.c++; else if (e.cur.l < e.lineas.length - 1) e.cur = { l: e.cur.l + 1, c: 0 } }); break
    case 'up': mover(() => { if (e.cur.l > 0) { e.cur.l--; e.cur.c = Math.min(e.cur.c, lon(e.cur.l)) } }); break
    case 'down': mover(() => { if (e.cur.l < e.lineas.length - 1) { e.cur.l++; e.cur.c = Math.min(e.cur.c, lon(e.cur.l)) } }); break
    case 'home': mover(() => { e.cur.c = 0 }); break
    case 'end': mover(() => { e.cur.c = lon(e.cur.l) }); break
    case 'pageup': mover(() => { e.cur.l = Math.max(0, e.cur.l - alto); e.cur.c = Math.min(e.cur.c, lon(e.cur.l)) }); break
    case 'pagedown': mover(() => { e.cur.l = Math.min(e.lineas.length - 1, e.cur.l + alto); e.cur.c = Math.min(e.cur.c, lon(e.cur.l)) }); break
    case 'return': escribirTexto(e, '\n'); break
    case 'tab': escribirTexto(e, '  '); break
    case 'backspace': {
      const sel = rangoTexto(e)
      pasoTexto(e)
      if (sel) borrarRangoTexto(e, sel)
      else if (e.cur.c > 0) {
        const l = e.lineas[e.cur.l]!
        e.lineas[e.cur.l] = l.slice(0, e.cur.c - 1) + l.slice(e.cur.c)
        e.cur.c--
        e.sucio = true
      } else if (e.cur.l > 0) {
        const c = lon(e.cur.l - 1)
        e.lineas.splice(e.cur.l - 1, 2, e.lineas[e.cur.l - 1]! + e.lineas[e.cur.l]!)
        e.cur = { l: e.cur.l - 1, c }
        e.sucio = true
      }
      break
    }
    case 'delete': {
      const sel = rangoTexto(e)
      pasoTexto(e)
      if (sel) borrarRangoTexto(e, sel)
      else if (e.cur.c < lon(e.cur.l)) {
        const l = e.lineas[e.cur.l]!
        e.lineas[e.cur.l] = l.slice(0, e.cur.c) + l.slice(e.cur.c + 1)
        e.sucio = true
      } else if (e.cur.l < e.lineas.length - 1) {
        e.lineas.splice(e.cur.l, 2, e.lineas[e.cur.l]! + e.lineas[e.cur.l + 1]!)
        e.sucio = true
      }
      break
    }
    default:
      if (k.length && !m.ctrl && !m.meta) escribirTexto(e, k === 'space' ? ' ' : k.replace(/\r\n?/g, '\n'))
  }
  verCursorTexto(e, alto, app.W - 8)
  return []
}

function teclaDoc(v: VistaDoc, k: string, m: Mods, app: App): void {
  const e = v.ed
  if (!e) return desplazarDoc(v, k, app)
  const maq = maquetarDoc(v, app, app.W)
  const alto = app.H - 3
  const mover = (fn: () => void) => {
    if (m.shift) e.ancla ??= { ...e.cur }
    else e.ancla = null
    fn()
    e.escribiendo = false
    e.pendiente = null
  }
  const vertical = (d: number) => {
    const pos = caret(v, maq)
    if (!pos) return
    const x = e.xDeseada ?? pos.x
    e.xDeseada = x
    for (let f = pos.fila + d; f >= 0 && f < maq.filas.length; f += d) {
      const destino = posEn(maq, f, x)
      if (destino) {
        e.cur = destino
        return
      }
    }
  }
  const avanceTexto = (fn: () => string | null) => {
    const aviso = fn()
    if (aviso) app.aviso = aviso
    v.maq = null
  }
  switch (k) {
    case 'left': mover(() => { Ed.moverCaracter(e, -1); e.xDeseada = null }); break
    case 'right': mover(() => { Ed.moverCaracter(e, 1); e.xDeseada = null }); break
    case 'up': mover(() => vertical(-1)); break
    case 'down': mover(() => vertical(1)); break
    case 'home': mover(() => { e.cur.c = 0; e.xDeseada = null }); break
    case 'end': mover(() => { e.cur.c = Ed.textoDe(e.planos[e.cur.p]!.par).length; e.xDeseada = null }); break
    case 'pageup': mover(() => { for (let i = 0; i < alto - 2; i++) vertical(-1) }); break
    case 'pagedown': mover(() => { for (let i = 0; i < alto - 2; i++) vertical(1) }); break
    case 'return': avanceTexto(() => Ed.escribir(e, '\n')); break
    case 'backspace': avanceTexto(() => Ed.borrarAtras(e)); break
    case 'delete': avanceTexto(() => Ed.borrarAdelante(e)); break
    case 'tab': avanceTexto(() => Ed.escribir(e, '\t')); break
    default:
      if (k.length && !m.ctrl && !m.meta) avanceTexto(() => Ed.escribir(e, k === 'space' ? ' ' : k))
  }
  const fresco = maquetarDoc(v, app, app.W)
  const pos = caret(v, fresco)
  if (pos) {
    if (pos.fila < v.scroll) v.scroll = Math.max(0, pos.fila - 1)
    if (pos.fila >= v.scroll + alto) v.scroll = pos.fila - alto + 2
  }
}

function desplazarDoc(v: VistaDoc, k: string, app: App): void {
  const alto = app.H - 3
  if (k === 'up') v.scroll -= 2
  else if (k === 'down') v.scroll += 2
  else if (k === 'pageup') v.scroll -= alto - 2
  else if (k === 'pagedown' || k === 'space') v.scroll += alto - 2
  else if (k === 'home') v.scroll = 0
  else if (k === 'end') v.scroll = Number.MAX_SAFE_INTEGER
}

function teclaHoja(v: VistaHoja, k: string, m: Mods, app: App): void {
  const est = v.est
  const h = est.hojas[est.activa]!
  const csv = est.doc.tipo === 'csv'
  const filasVis = app.H - 7
  const confirmarSiHace = () => {
    if (est.edicion) {
      Ho.confirmar(est, est.edicion.texto, csv)
      est.edicion = null
    }
  }
  const mover = (df: number, dc: number) => {
    if (m.shift && !est.edicion) h.ancla ??= [...h.cur]
    else h.ancla = null
    h.cur = [Math.max(0, h.cur[0] + df), Math.max(0, h.cur[1] + dc)]
    verCelda(h, filasVis, app.W)
  }
  if (est.edicion) {
    const ed = est.edicion
    switch (k) {
      case 'return': confirmarSiHace(); mover(1, 0); return
      case 'tab': confirmarSiHace(); mover(0, 1); return
      case 'up': confirmarSiHace(); mover(-1, 0); return
      case 'down': confirmarSiHace(); mover(1, 0); return
      case 'left': if (ed.cur > 0) ed.cur--; return
      case 'right': if (ed.cur < ed.texto.length) ed.cur++; return
      case 'home': ed.cur = 0; return
      case 'end': ed.cur = ed.texto.length; return
      case 'backspace':
        if (ed.cur > 0) {
          ed.texto = ed.texto.slice(0, ed.cur - 1) + ed.texto.slice(ed.cur)
          ed.cur--
        }
        return
      case 'delete':
        ed.texto = ed.texto.slice(0, ed.cur) + ed.texto.slice(ed.cur + 1)
        return
      default:
        if (k.length && !m.ctrl && !m.meta) {
          const t = k === 'space' ? ' ' : k.replace(/[\r\n\t]+/g, ' ')
          ed.texto = ed.texto.slice(0, ed.cur) + t + ed.texto.slice(ed.cur)
          ed.cur += t.length
        }
        return
    }
  }
  switch (k) {
    case 'up': mover(-1, 0); break
    case 'down': case 'return': mover(1, 0); break
    case 'left': mover(0, -1); break
    case 'right': case 'tab': mover(0, 1); break
    case 'pageup': mover(-filasVis, 0); break
    case 'pagedown': mover(filasVis, 0); break
    case 'home': mover(0, -h.cur[1]); break
    case 'end': mover(0, Math.max(0, h.cols - 1 - h.cur[1])); break
    case 'delete': case 'backspace': Ho.borrarRango(est); break
    case 'f2': {
      const c = h.celdas.get(`${h.cur[0]},${h.cur[1]}`)
      const t = c?.f ? `=${c.f}` : c ? Ho.mostrar(c.v) : ''
      est.edicion = { texto: t, cur: t.length }
      break
    }
    default:
      if (k.length && !m.ctrl && !m.meta) {
        const t = k === 'space' ? ' ' : k
        est.edicion = { texto: t, cur: t.length }
      }
  }
}

function teclaJson(v: VistaJson, k: string, app: App): void {
  const filas = filasJson(v)
  const f = filas[v.cur]
  const alto = app.H - 3
  if (k === 'up') v.cur--
  else if (k === 'down') v.cur++
  else if (k === 'pageup') v.cur -= alto
  else if (k === 'pagedown') v.cur += alto
  else if (k === 'home') v.cur = 0
  else if (k === 'end') v.cur = filas.length - 1
  else if (k === 'right' && f?.contenedor) v.abiertos.add(f.ruta)
  else if (k === 'left' && f?.contenedor) v.abiertos.delete(f.ruta)
  else if ((k === 'return' || k === 'space') && f?.contenedor) v.abiertos.has(f.ruta) ? v.abiertos.delete(f.ruta) : v.abiertos.add(f.ruta)
}

function irPagina(v: VistaPdf | VistaDiapo, d: number): void {
  const total = v.t === 'pdf' ? v.doc.paginas.length : v.doc.diapositivas.length
  v.n = limitar(v.n + d, 0, total - 1)
  if (v.t === 'pdf') v.scroll = 0
}

export function tecla(app: App, k: string, m: Mods): Efecto[] {
  const p = app.pestanas[app.activa]
  if (!p) return []
  app.aviso = ''
  if (app.menu) app.menu = null
  const v = p.vista
  if (m.ctrl) {
    const c = k.toLowerCase()
    if (c === 's') return accion(app, 'guardar')
    if (c === 'z') return accion(app, 'deshacer')
    if (c === 'y') return accion(app, 'rehacer')
    if (c === 'b' || c === 'n') return accion(app, 'b')
    if (c === 'i' || c === 'k') return accion(app, 'i')
    if (c === 'u') return accion(app, 'u')
    if (c === 'c') return copiar(v)
  }
  switch (v.t) {
    case 'doc':
      if (!v.ed && (k === '+' || k === '=')) return accion(app, 'zoom+')
      if (!v.ed && k === '-') return accion(app, 'zoom-')
      if (!v.ed && k === 'e' && p.alterna) return accion(app, 'alternar')
      teclaDoc(v, k, m, app)
      return []
    case 'hoja':
      teclaHoja(v, k, m, app)
      return []
    case 'texto':
      return teclaTexto(p, v, k, m, app)
    case 'json':
      if (k === 'e' && p.alterna) return accion(app, 'alternar')
      teclaJson(v, k, app)
      return []
    case 'diapo':
      if (k === 'right' || k === 'pagedown' || k === 'down' || k === 'space') irPagina(v, 1)
      else if (k === 'left' || k === 'pageup' || k === 'up') irPagina(v, -1)
      else if (k === 'home') v.n = 0
      else if (k === 'end') v.n = v.doc.diapositivas.length - 1
      else if (k === 'n') v.notas = !v.notas
      return []
    case 'pdf': {
      const alto = app.H - 3
      if (k === 'right' || k === 'pagedown') irPagina(v, 1)
      else if (k === 'left' || k === 'pageup') irPagina(v, -1)
      else if (k === 'down') v.scroll += 2
      else if (k === 'up') v.scroll -= 2
      else if (k === 'space') v.scroll += alto - 2
      else if (k === 'home') (v.n = 0), (v.scroll = 0)
      else if (k === 'end') v.n = v.doc.paginas.length - 1
      else if (k === '+' || k === '=') return accion(app, 'zoom+')
      else if (k === '-') return accion(app, 'zoom-')
      else if (k === 'v') return accion(app, 'imagen')
      return []
    }
    case 'imagen':
      if (k === '+' || k === '=') return accion(app, 'zoom+')
      if (k === '-') return accion(app, 'zoom-')
      if (k === 'left') v.px -= 4
      else if (k === 'right') v.px += 4
      else if (k === 'up') v.py -= 3
      else if (k === 'down') v.py += 3
      return []
  }
}

function copiar(v: Vista): Efecto[] {
  if (v.t === 'doc' && v.ed) {
    const texto = Ed.textoSeleccionado(v.ed)
    return texto ? [{ t: 'copiar', texto }] : []
  }
  if (v.t === 'texto') {
    const sel = rangoTexto(v.e)
    if (!sel) return []
    const [a, b] = sel
    const lineas = v.e.lineas.slice(a.l, b.l + 1)
    lineas[lineas.length - 1] = lineas[lineas.length - 1]!.slice(0, b.c)
    lineas[0] = lineas[0]!.slice(a.c)
    return [{ t: 'copiar', texto: lineas.join('\n') }]
  }
  if (v.t === 'hoja') {
    const h = v.est.hojas[v.est.activa]!
    const [f1, c1, f2, c2] = Ho.rangoActivo(h)
    const filas: string[] = []
    for (let f = f1; f <= f2; f++) {
      const fila: string[] = []
      for (let c = c1; c <= c2; c++) {
        const celda = h.celdas.get(`${f},${c}`)
        fila.push(celda ? Ho.mostrado(celda) : '')
      }
      filas.push(fila.join('\t'))
    }
    return [{ t: 'copiar', texto: filas.join('\n') }]
  }
  return []
}

function guardarVista(p: Pestana): Efecto[] {
  const v = p.vista
  const datos = (): Guardado | null => {
    if (v.t === 'doc' && v.ed?.doc.editable) return Ed.resumenGuardado(v.ed)
    if (v.t === 'hoja') return Ho.resumenHoja(v.est)
    if (v.t === 'texto') return { tipo: 'texto', firma: v.e.firma, texto: v.e.lineas.join('\n'), codificacion: v.e.codificacion }
    return null
  }
  const d = datos()
  return d ? [{ t: 'guardar', id: p.id, ruta: p.ruta, datos: d }] : []
}

/** Lo guardado ya es el original: la firma nueva evita un falso conflicto. */
export function guardadoListo(app: App, id: number, firma: string): void {
  const p = app.pestanas.find(x => x.id === id)
  if (!p) return
  const v = p.vista
  if (v.t === 'doc' && v.ed) Ed.marcarGuardado(v.ed, firma)
  if (v.t === 'hoja') Ho.marcarHojaGuardada(v.est, firma)
  if (v.t === 'texto') {
    v.e.firma = firma
    v.e.sucio = false
  }
  if (p.alterna?.t === 'texto') {
    p.alterna.e.firma = firma
    p.alterna.e.sucio = false
  }
}

export function accion(app: App, a: string): Efecto[] {
  const p = app.pestanas[app.activa]
  if (a.startsWith('tab:')) {
    app.activa = Number(a.slice(4))
    return []
  }
  if (a.startsWith('cerrar:')) return cerrar(app, Number(a.slice(7)))
  if (!p) return []
  const v = p.vista
  const conEditor = (fn: (e: Ed.EstadoEditor) => void) => {
    if (v.t === 'doc' && v.ed?.doc.editable) {
      fn(v.ed)
      v.maq = null
    }
  }
  const reportar = (aviso: string | null) => {
    if (aviso) app.aviso = aviso
  }
  if (a.startsWith('hoja:') && v.t === 'hoja') {
    v.est.activa = Number(a.slice(5))
    v.est.edicion = null
    return []
  }
  if (a.startsWith('fuente:')) {
    conEditor(e => reportar(Ed.formatear(e, { font: a.slice(7) })))
    return []
  }
  switch (a) {
    case 'guardar': return guardarVista(p)
    case 'deshacer':
      if (v.t === 'doc' && v.ed) { Ed.deshacer(v.ed); v.maq = null }
      if (v.t === 'hoja') Ho.deshacerHoja(v.est)
      if (v.t === 'texto') deshacerTexto(v.e)
      return []
    case 'rehacer':
      if (v.t === 'doc' && v.ed) { Ed.rehacer(v.ed); v.maq = null }
      if (v.t === 'hoja') Ho.rehacerHoja(v.est)
      if (v.t === 'texto') rehacerTexto(v.e)
      return []
    case 'b': conEditor(e => reportar(Ed.formatear(e, { b: !Ed.formatoActual(e).b }))); return []
    case 'i': conEditor(e => reportar(Ed.formatear(e, { i: !Ed.formatoActual(e).i }))); return []
    case 'u': conEditor(e => reportar(Ed.formatear(e, { u: !Ed.formatoActual(e).u }))); return []
    case 'mas':
    case 'menos':
      conEditor(e => {
        const actual = Ed.formatoActual(e).pt ?? (v as VistaDoc).defPt
        const i = TAMANOS.findIndex(t => t >= actual)
        const j = limitar((i < 0 ? TAMANOS.length - 1 : i) + (a === 'mas' ? 1 : -1), 0, TAMANOS.length - 1)
        reportar(Ed.formatear(e, { pt: TAMANOS[j]! }))
      })
      return []
    case 'menu-fuente':
      if (v.t === 'doc' && v.ed) {
        const propias = v.ed.doc.fuentes.filter(f => !FUENTES.includes(f))
        const x = app.L?.zonas.find(z => z.accion === 'menu-fuente')?.x ?? 10
        app.menu = { x, y: 2, items: [...FUENTES, ...propias].slice(0, 14).map(f => ({ t: f, a: `fuente:${f}` })) }
      }
      return []
    case 'zoom+':
    case 'zoom-': {
      const d = a === 'zoom+' ? 1 : -1
      if (v.t === 'doc') {
        v.ancho = limitar((v.ancho ?? Math.min(app.W - 6, 100)) + d * 10, 30, 200)
        v.maq = null
      }
      if (v.t === 'pdf') v.ancho = limitar((v.ancho ?? Math.min(app.W - 6, 110)) + d * 12, 40, 220)
      if (v.t === 'imagen') v.zoom = limitar(v.zoom * (d > 0 ? 1.5 : 1 / 1.5), 1, 8)
      return []
    }
    case 'ajustar':
      if (v.t === 'doc') (v.ancho = null), (v.maq = null)
      if (v.t === 'pdf') v.ancho = null
      if (v.t === 'imagen') (v.zoom = 1), (v.px = 0), (v.py = 0)
      return []
    case 'ant': if (v.t === 'pdf' || v.t === 'diapo') irPagina(v, -1); return []
    case 'sig': if (v.t === 'pdf' || v.t === 'diapo') irPagina(v, 1); return []
    case 'notas': if (v.t === 'diapo') v.notas = !v.notas; return []
    case 'imagen': if (v.t === 'pdf') v.imagen = !v.imagen; return []
    case 'alternar': alternar(p); return []
    case 'cancelar-celda': if (v.t === 'hoja') v.est.edicion = null; return []
    default: return []
  }
}

function deshacerTexto(e: TextoE): void {
  const paso = e.deshacer.pop()
  if (!paso) return
  e.rehacer.push({ t: e.lineas.join('\n'), l: e.cur.l, c: e.cur.c })
  e.lineas = paso.t.split('\n')
  e.cur = { l: paso.l, c: paso.c }
  e.ancla = null
  e.sucio = true
}

function rehacerTexto(e: TextoE): void {
  const paso = e.rehacer.pop()
  if (!paso) return
  e.deshacer.push({ t: e.lineas.join('\n'), l: e.cur.l, c: e.cur.c })
  e.lineas = paso.t.split('\n')
  e.cur = { l: paso.l, c: paso.c }
  e.ancla = null
  e.sucio = true
}

/** Pasa entre el documento renderizado y su texto; al volver, lo redibuja. */
function alternar(p: Pestana): void {
  const actual = p.vista
  const otra = p.alterna
  if (!otra) return
  if (actual.t === 'texto') {
    const texto = actual.e.lineas.join('\n')
    if (otra.t === 'doc') {
      otra.bloques = bloquesDeMarkdown(texto, p.carpeta)
      otra.maq = null
    }
    if (otra.t === 'json') {
      try {
        otra.raiz = JSON.parse(texto)
      } catch {
        return
      }
    }
  }
  p.vista = otra
  p.alterna = actual
}

function cerrar(app: App, i: number): Efecto[] {
  const p = app.pestanas[i]
  if (!p) return []
  if (estaSucia(p) && !p.confirmarCierre) {
    p.confirmarCierre = true
    app.activa = i
    app.aviso = 'Hay cambios sin guardar: pulsa ✕ otra vez para cerrar sin guardar.'
    return []
  }
  app.pestanas.splice(i, 1)
  app.activa = limitar(app.activa >= i ? app.activa - 1 : app.activa, 0, Math.max(0, app.pestanas.length - 1))
  if (!app.pestanas.length) return [{ t: 'cerrar-panel' }]
  return []
}

export function rueda(app: App, por: number): void {
  const v = app.pestanas[app.activa]?.vista
  if (!v) return
  const d = Math.sign(por) * Math.max(2, Math.abs(por) * 2)
  if (v.t === 'doc') v.scroll = Math.max(0, v.scroll + d)
  else if (v.t === 'texto') v.e.sy = Math.max(0, v.e.sy + d)
  else if (v.t === 'json') v.scroll = Math.max(0, v.scroll + d)
  else if (v.t === 'pdf') {
    const antes = v.scroll
    v.scroll = Math.max(0, v.scroll + d)
    if (d > 0 && v.scroll === antes) irPagina(v, 1)
  } else if (v.t === 'hoja') {
    const h = v.est.hojas[v.est.activa]!
    h.scrollF = Math.max(h.congela[0], h.scrollF + d)
  } else if (v.t === 'diapo') irPagina(v, d > 0 ? 1 : -1)
  else if (v.t === 'imagen') v.py = Math.max(0, v.py + d)
}

export type Puntero = { tipo: 'down' | 'move' | 'up'; x: number; y: number; shift?: boolean }

export function puntero(app: App, ev: Puntero): Efecto[] {
  const L = app.L
  const p = app.pestanas[app.activa]
  if (!L || !p) return []
  const v = p.vista
  const y0 = 2
  if (ev.tipo === 'up') {
    app.arrastreBarra = false
    if (v.t === 'doc') v.arrastre = false
    if (v.t === 'hoja') v.arrastre = false
    if (v.t === 'texto') v.arrastre = false
    return []
  }
  if (ev.tipo === 'move') {
    if (app.arrastreBarra) return moverBarra(app, v, ev)
    if (v.t === 'doc' && v.arrastre && v.ed) {
      const maq = maquetarDoc(v, app, app.W)
      const fila = limitar(ev.y - y0, 0, app.H - 4) + v.scroll
      const pos = posEn(maq, fila, ev.x - maq.x0)
      if (pos) {
        v.ed.ancla ??= { ...v.ed.cur }
        v.ed.cur = pos
      }
      if (ev.y < y0) v.scroll = Math.max(0, v.scroll - 1)
      if (ev.y >= app.H - 1) v.scroll += 1
    }
    if (v.t === 'texto' && v.arrastre) {
      const e = v.e
      const l = limitar(ev.y - y0 + e.sy, 0, e.lineas.length - 1)
      const gutter = String(e.lineas.length).length + 2
      e.ancla ??= { ...e.cur }
      e.cur = { l, c: limitar(ev.x - gutter + e.sx, 0, e.lineas[l]!.length) }
    }
    if (v.t === 'hoja' && v.arrastre) {
      const z = L.zonaEn(ev.x, ev.y)
      if (z?.accion.startsWith('cel:')) {
        const [, f, c] = z.accion.split(':')
        const h = v.est.hojas[v.est.activa]!
        h.ancla ??= [...h.cur]
        h.cur = [Number(f), Number(c)]
      }
    }
    return []
  }
  const z = L.zonaEn(ev.x, ev.y)
  app.aviso = ''
  const habiaMenu = app.menu
  if (!z) {
    app.menu = null
    return []
  }
  if (habiaMenu) app.menu = null
  if (z.accion.startsWith('barra:')) {
    app.arrastreBarra = true
    return moverBarra(app, v, ev)
  }
  if (z.accion === 'hoja-doc' && v.t === 'doc' && v.ed) {
    const maq = maquetarDoc(v, app, app.W)
    const fila = ev.y - y0 + v.scroll
    let pos = posEn(maq, fila, ev.x - maq.x0)
    for (let d = 1; !pos && d < 6; d++) pos = posEn(maq, fila + d, ev.x - maq.x0) ?? posEn(maq, fila - d, ev.x - maq.x0)
    if (pos) {
      if (ev.shift) v.ed.ancla ??= { ...v.ed.cur }
      else v.ed.ancla = null
      v.ed.cur = pos
      v.ed.xDeseada = null
      v.ed.escribiendo = false
      v.ed.pendiente = null
      v.arrastre = true
    }
    return []
  }
  if (z.accion === 'texto' && v.t === 'texto') {
    const e = v.e
    const l = limitar(ev.y - y0 + e.sy, 0, e.lineas.length - 1)
    const gutter = String(e.lineas.length).length + 2
    if (ev.shift) e.ancla ??= { ...e.cur }
    else e.ancla = null
    e.cur = { l, c: limitar(ev.x - gutter + e.sx, 0, e.lineas[l]!.length) }
    v.arrastre = true
    return []
  }
  if (z.accion.startsWith('cel:') && v.t === 'hoja') {
    const [, f, c] = z.accion.split(':')
    const est = v.est
    if (est.edicion) {
      Ho.confirmar(est, est.edicion.texto, est.doc.tipo === 'csv')
      est.edicion = null
    }
    const h = est.hojas[est.activa]!
    if (ev.shift) h.ancla ??= [...h.cur]
    else h.ancla = null
    h.cur = [Number(f), Number(c)]
    v.arrastre = true
    return []
  }
  if (z.accion.startsWith('json:') && v.t === 'json') {
    v.cur = Number(z.accion.slice(5))
    const f = filasJson(v)[v.cur]
    if (f?.contenedor) v.abiertos.has(f.ruta) ? v.abiertos.delete(f.ruta) : v.abiertos.add(f.ruta)
    return []
  }
  if (z.accion === 'pdf' || z.accion === 'nada') return []
  return accion(app, z.accion)
}

function moverBarra(app: App, v: Vista, ev: Puntero): Efecto[] {
  const L = app.L!
  const z = L.zonas.find(x => x.accion.startsWith('barra:'))
  if (!z) return []
  const [, ys, altos, totals] = z.accion.split(':')
  const y = Number(ys)
  const alto = Number(altos)
  const total = Number(totals)
  const pos = Math.round((limitar(ev.y - y, 0, alto - 1) / Math.max(1, alto - 1)) * Math.max(0, total - alto))
  if (v.t === 'doc') v.scroll = pos
  if (v.t === 'texto') v.e.sy = pos
  if (v.t === 'pdf') v.scroll = pos
  if (v.t === 'json') v.scroll = pos
  return []
}

void TACHADO
