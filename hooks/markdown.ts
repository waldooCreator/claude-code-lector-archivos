// De Markdown (CommonMark + GFM, tolerante) a los bloques que maqueta el visor.
// Puro: sin Node ni DOM. La persona nunca debe ver la sintaxis original.

import type { Bloque, Celda, Parrafo, Run } from '../types'
import { dibujarMermaid } from './mermaid'

type Img = { img: true; src: string; alt: string; href?: string }
type Token = Run | Img
type Delim = { d: string; n: number; orig: number; abre: boolean; cierra: boolean }
type Nodo = Token | Delim

type Nota = { lineas: string[] }
type Ctx = {
  carpeta: string
  refs: Map<string, { url: string; titulo?: string }>
  notas: Map<string, Nota>
  numeros: Map<string, number>
  orden: string[]
}
type Op = { nivel: number; html: boolean; prof: number }

const MAX_PROF = 40
const COLOR_ENLACE = '#0b5cad'
const COLOR_CHIP = '#e4e7ec'
const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' }

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±', para: '¶', sect: '§', euro: '€',
  pound: '£', yen: '¥', cent: '¢', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', cross: '✗',
  iexcl: '¡', iquest: '¿', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', infin: '∞', ne: '≠', le: '≤', ge: '≥',
}

const EMOJIS: Record<string, string> = {
  smile: '😄', smiley: '😃', grin: '😁', joy: '😂', wink: '😉', blush: '😊', sunglasses: '😎', thinking: '🤔', cry: '😢', sob: '😭',
  rocket: '🚀', white_check_mark: '✅', heavy_check_mark: '✔', check: '✔', warning: '⚠', x: '❌', star: '⭐', star2: '🌟', tada: '🎉', sparkles: '✨',
  bulb: '💡', fire: '🔥', memo: '📝', book: '📖', books: '📚', heart: '❤', blue_heart: '💙', green_heart: '💚', broken_heart: '💔',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', clap: '👏', pray: '🙏', muscle: '💪', wave: '👋', eyes: '👀', point_right: '👉', point_left: '👈',
  zap: '⚡', boom: '💥', bug: '🐛', wrench: '🔧', hammer: '🔨', gear: '⚙', package: '📦', lock: '🔒', unlock: '🔓', key: '🔑',
  mag: '🔍', link: '🔗', pushpin: '📌', paperclip: '📎', calendar: '📆', clock: '🕐', hourglass: '⌛', email: '📧', phone: '☎', computer: '💻',
  bar_chart: '📊', chart_with_upwards_trend: '📈', moneybag: '💰', dollar: '💵', trophy: '🏆', dart: '🎯', art: '🎨', construction: '🚧', recycle: '♻',
  information_source: 'ℹ', question: '❓', exclamation: '❗', no_entry: '⛔', stop_sign: '🛑', arrow_right: '➡', arrow_left: '⬅', arrow_up: '⬆', arrow_down: '⬇',
  sunny: '☀', cloud: '☁', umbrella: '☔', snowflake: '❄', coffee: '☕', beer: '🍺', pizza: '🍕', globe_with_meridians: '🌐', earth_americas: '🌎', house: '🏠',
}

const ETIQUETAS_BLOQUE = new Set(
  'details div p center section article header footer nav aside main figure figcaption table thead tbody tfoot tr td th caption ul ol li dl dt dd blockquote pre hr form fieldset script style h1 h2 h3 h4 h5 h6'.split(' '),
)

const parrafo = (r: Run[], extra: Partial<Parrafo> = {}): Parrafo => ({ k: 'p', id: -1, r, ed: 0, ...extra })
const esImg = (t: Nodo): t is Img => 'img' in t
const esDelim = (t: Nodo): t is Delim => 'd' in t
const sangria = (l: string) => l.length - l.replace(/^ +/, '').length
const enBlanco = (l: string) => !l.trim()
const quitar = (l: string, n: number) => l.slice(Math.min(n, sangria(l)))

function normalizarSangria(l: string): string {
  const m = /^[ \t]+/.exec(l)
  if (!m || !m[0].includes('\t')) return l
  let col = 0
  for (const ch of m[0]) col += ch === '\t' ? 4 - (col % 4) : 1
  return ' '.repeat(col) + l.slice(m[0].length)
}

const decodificarUrl = (u: string) => u.replace(/&amp;/g, '&').replace(/\\([()[\]])/g, '$1')
const normalRef = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

// Inicios de bloque

const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RE_CERCA = /^ {0,3}(`{3,}|~{3,})(.*)$/
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/
const RE_CITA = /^ {0,3}> ?/
const RE_ITEM = /^( *)([-+*]|\d{1,9}[.)])( +|$)(.*)$/
const RE_DEF = /^ {0,3}\[([^\]^][^\]]*)\]:\s*(?:<([^>]*)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/
const RE_NOTA = /^ {0,3}\[\^([^\]]+)\]:[ \t]*(.*)$/
const RE_ABRE_HTML = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/
const RE_CIERRA_HTML = /^ {0,3}<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/

function abreCerca(l: string): { marca: string; info: string } | null {
  const m = RE_CERCA.exec(l)
  if (!m) return null
  if (m[1]![0] === '`' && m[2]!.includes('`')) return null
  return { marca: m[1]!, info: m[2]!.trim() }
}

function cierraCerca(l: string, marca: string): boolean {
  const t = l.trim()
  return sangria(l) <= 3 && t.length >= marca.length && [...t].every(c => c === marca[0])
}

type Item = { ind: number; marca: string; ordenada: boolean; resto: string; off: number }

function item(l: string): Item | null {
  if (RE_HR.test(l)) return null
  const m = RE_ITEM.exec(l)
  if (!m) return null
  const ind = m[1]!.length
  const marca = m[2]!
  const huecos = m[3]!.length
  const resto = m[4]!
  const base = ind + marca.length
  const off = !resto || huecos > 4 ? base + 1 : base + huecos
  return { ind, marca, ordenada: /\d/.test(marca), resto: huecos > 4 ? ' '.repeat(huecos - 1) + resto : resto, off }
}

function esEtiquetaBloque(l: string): boolean {
  if (/^ {0,3}<!--/.test(l)) return true
  const m = RE_ABRE_HTML.exec(l) ?? RE_CIERRA_HTML.exec(l)
  return !!m && ETIQUETAS_BLOQUE.has(m[1]!.toLowerCase())
}

/** Corta un párrafo: lo que puede interrumpirlo sin línea en blanco. */
function iniciaBloque(l: string): boolean {
  if (RE_ATX.test(l) || abreCerca(l) || RE_HR.test(l) || RE_CITA.test(l) || esEtiquetaBloque(l)) return true
  const it = item(l)
  if (!it || it.ind >= 4 || !it.resto.trim()) return false
  return !it.ordenada || /^1[.)]$/.test(it.marca)
}

const esFilaDelim = (l: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)

function celdasDe(l: string): string[] {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  const salida: string[] = []
  let act = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '\\' && s[i + 1] === '|') {
      act += '|'
      i++
    } else if (c === '`') {
      const fin = s.indexOf('`', i + 1)
      if (fin > 0) {
        act += s.slice(i, fin + 1)
        i = fin
      } else act += c
    } else if (c === '|') {
      salida.push(act)
      act = ''
    } else act += c
  }
  if (act.trim() || !l.trim().endsWith('|')) salida.push(act)
  return salida.map(c => c.trim())
}

function iniciaTabla(l: string[], i: number): boolean {
  const cab = l[i]
  const del = l[i + 1]
  if (cab === undefined || del === undefined || !cab.includes('|') || !esFilaDelim(del) || !del.includes('-')) return false
  if (celdasDe(cab).length === celdasDe(del).length) return true
  return del.includes('|')
}

function finNota(l: string[], i: number): number {
  let fin = i
  for (let j = i + 1; j < l.length; j++) {
    if (enBlanco(l[j]!)) continue
    if (sangria(l[j]!) >= 2) fin = j
    else if (j === fin + 1 && !iniciaBloque(l[j]!) && !RE_NOTA.test(l[j]!) && !RE_DEF.test(l[j]!)) fin = j
    else break
  }
  return fin
}

/** Junta definiciones de enlaces y notas antes de leer el texto en línea. */
function recolectar(lineas: string[], ctx: Ctx): void {
  let cerca = ''
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!.replace(/^( {0,3}> ?)+/, '')
    if (cerca) {
      if (cierraCerca(l, cerca)) cerca = ''
      continue
    }
    const f = abreCerca(l)
    if (f) {
      cerca = f.marca
      continue
    }
    const n = RE_NOTA.exec(l)
    if (n) {
      const fin = finNota(lineas, i)
      const cuerpo = [n[2]!, ...lineas.slice(i + 1, fin + 1).map(x => x.replace(/^ {2,4}/, ''))]
      if (!ctx.notas.has(n[1]!)) ctx.notas.set(n[1]!, { lineas: cuerpo })
      i = fin
      continue
    }
    const d = RE_DEF.exec(l)
    if (d) {
      const clave = normalRef(d[1]!)
      if (!ctx.refs.has(clave)) ctx.refs.set(clave, { url: decodificarUrl(d[2] ?? d[3]!), titulo: d[4] ?? d[5] ?? d[6] })
    }
  }
}

// Texto en línea

const RE_ETIQUETA = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y
const RE_AUTO = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/y
const RE_AUTO_CORREO = /<([\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/y
const RE_URL = /(?:https?:\/\/|www\.)[^\s<]+/y
const RE_CORREO = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/y
const RE_ENTIDAD = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y
const RE_EMOJI = /:([a-z0-9_+-]+):/y
const ESPACIO = /\s/
const PUNT = /[\p{P}\p{S}]/u
const ALFANUM = /[\p{L}\p{N}]/u

function atributo(attrs: string, nombre: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i')
  const m = re.exec(attrs)
  return m ? decodificarEntidades(m[1] ?? m[2] ?? m[3] ?? '') : undefined
}

function decodificarEntidad(cuerpo: string): string | undefined {
  if (cuerpo[0] === '#') {
    const hex = cuerpo[1] === 'x' || cuerpo[1] === 'X'
    const n = parseInt(cuerpo.slice(hex ? 2 : 1), hex ? 16 : 10)
    if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�'
    return String.fromCodePoint(n)
  }
  return ENTIDADES[cuerpo]
}

function decodificarEntidades(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, c: string) => decodificarEntidad(c) ?? m)
}

function aMono(r: Run): void {
  r.font = 'mono'
  r.c = '#c7254e'
  r.h = '#f4f4f5'
}

const MARCA_ETIQUETA: Record<string, (r: Run) => void> = {
  b: r => (r.b = 1),
  strong: r => (r.b = 1),
  i: r => (r.i = 1),
  em: r => (r.i = 1),
  cite: r => (r.i = 1),
  u: r => (r.u = 1),
  ins: r => (r.u = 1),
  s: r => (r.s = 1),
  del: r => (r.s = 1),
  strike: r => (r.s = 1),
  code: aMono,
  kbd: aMono,
  tt: aMono,
  samp: aMono,
  mark: r => (r.h = '#fff3a3'),
}

function marcar(tokens: Token[], f: (r: Run) => void): void {
  for (const t of tokens) if (!esImg(t)) f(t)
}

function hacerEnlace(tokens: Token[], href: string): void {
  for (const t of tokens) {
    if (esImg(t)) t.href = href
    else {
      t.u = 1
      t.c = COLOR_ENLACE
      t.href = href
    }
  }
}

function aSuperOSub(tokens: Token[], tabla: Record<string, string>): void {
  marcar(tokens, r => {
    r.t = [...r.t].map(c => tabla[c] ?? c).join('')
  })
}

/** Busca el cierre `</nombre>` respetando el anidamiento; da la posición de `<` y tras `>`. */
function cierreEtiqueta(s: string, desde: number, nombre: string): { ini: number; fin: number } | null {
  const re = new RegExp(`<(/?)${nombre}(?:\\s[^<>]*)?>`, 'gi')
  re.lastIndex = desde
  let prof = 1
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0].endsWith('/>')) continue
    prof += m[1] ? -1 : 1
    if (prof === 0) return { ini: m.index, fin: m.index + m[0].length }
  }
  return null
}

function destinoEnlace(s: string, i: number): { url: string; titulo?: string; fin: number } | null {
  // s[i] === '('
  let p = i + 1
  while (p < s.length && ESPACIO.test(s[p]!)) p++
  let url = ''
  if (s[p] === '<') {
    const c = s.indexOf('>', p)
    if (c < 0) return null
    url = s.slice(p + 1, c)
    p = c + 1
  } else {
    let prof = 0
    const ini = p
    for (; p < s.length; p++) {
      const c = s[p]!
      if (c === '\\') p++
      else if (ESPACIO.test(c)) break
      else if (c === '(') prof++
      else if (c === ')') {
        if (prof === 0) break
        prof--
      }
    }
    url = s.slice(ini, p)
  }
  let q = p
  while (q < s.length && ESPACIO.test(s[q]!)) q++
  let titulo: string | undefined
  if (s[q] === '"' || s[q] === "'" || s[q] === '(') {
    const cierre = s[q] === '(' ? ')' : s[q]!
    const c = s.indexOf(cierre, q + 1)
    if (c > 0) {
      titulo = s.slice(q + 1, c)
      q = c + 1
      while (q < s.length && ESPACIO.test(s[q]!)) q++
    }
  }
  if (s[q] === ')') return { url: decodificarUrl(url), titulo, fin: q + 1 }
  // Tolerante: una ruta con espacios sin ángulos.
  const c = s.indexOf(')', i)
  if (c > 0 && !s.slice(i, c).includes('\n')) return { url: decodificarUrl(s.slice(i + 1, c).trim()), fin: c + 1 }
  return null
}

function cierreCorchete(s: string, i: number): number {
  let prof = 0
  const tope = Math.min(s.length, i + 4000)
  for (let p = i; p < tope; p++) {
    const c = s[p]!
    if (c === '\\') p++
    else if (c === '`') {
      const n = /`+/y
      n.lastIndex = p
      const m = n.exec(s)!
      const fin = s.indexOf(m[0], p + m[0].length)
      if (fin > 0 && fin < tope) p = fin + m[0].length - 1
      else p += m[0].length - 1
    } else if (c === '[') prof++
    else if (c === ']') {
      prof--
      if (prof === 0) return p
    }
  }
  return -1
}

function aplicarEnfasis(n: Nodo[]): void {
  const fondo = new Map<string, number>()
  for (let c = 0; c < n.length; c++) {
    const cierre = n[c]!
    if (!esDelim(cierre) || !cierre.cierra) continue
    while (cierre.n > 0) {
      const k = `${cierre.d}${cierre.abre ? 1 : 0}${cierre.orig % 3}`
      const lim = fondo.get(k) ?? -1
      let abre: Delim | null = null
      let pos = -1
      for (let o = c - 1; o > lim; o--) {
        const x = n[o]!
        if (!esDelim(x) || x.d !== cierre.d || !x.abre || x.n <= 0) continue
        if ((x.cierra || cierre.abre) && (x.orig + cierre.orig) % 3 === 0 && !(x.orig % 3 === 0 && cierre.orig % 3 === 0)) continue
        if (x.d === '~' && (x.n < 2 || cierre.n < 2)) continue
        abre = x
        pos = o
        break
      }
      if (!abre) {
        fondo.set(k, c - 1)
        break
      }
      const uso = abre.d === '~' || (abre.n >= 2 && cierre.n >= 2) ? 2 : 1
      const marca = (r: Run) => {
        if (abre!.d === '~') r.s = 1
        else if (uso === 2) r.b = 1
        else r.i = 1
      }
      for (let j = pos + 1; j < c; j++) {
        const x = n[j]!
        if (esDelim(x)) n[j] = { t: x.d.repeat(x.n) }
        const y = n[j]!
        if (!esDelim(y) && !esImg(y)) marca(y)
      }
      abre.n -= uso
      cierre.n -= uso
    }
  }
}

function fundir(tokens: Token[]): Token[] {
  const salida: Token[] = []
  for (const t of tokens) {
    if (!esImg(t) && !t.t) continue
    const u = salida[salida.length - 1]
    if (u && !esImg(u) && !esImg(t)) {
      const { t: _a, ...ra } = u
      const { t: _b, ...rb } = t
      if (JSON.stringify(ra) === JSON.stringify(rb)) {
        u.t += t.t
        continue
      }
    }
    salida.push(t)
  }
  return salida
}

function textoPlano(tokens: Token[]): string {
  return tokens.map(t => (esImg(t) ? t.alt : t.t)).join('')
}

function enLinea(s: string, ctx: Ctx, prof = 0, enEnlace = false): Token[] {
  if (prof > 8) return [{ t: s }]
  const nodos: Nodo[] = []
  let txt = ''
  const volcar = () => {
    if (txt) nodos.push({ t: txt })
    txt = ''
  }
  const sinCierre = new Set<number>()
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === '\\') {
      const n = s[i + 1]
      if (n === '\n') {
        txt = txt.replace(/ +$/, '') + '\n'
        i += 2
        while (s[i] === ' ') i++
        continue
      }
      if (n && /[!-/:-@[-`{-~]/.test(n)) {
        txt += n
        i += 2
        continue
      }
      txt += c
      i++
      continue
    }
    if (c === '\n') {
      if (/ {2,}$/.test(txt)) txt = txt.replace(/ +$/, '') + '\n'
      else txt = txt.replace(/ +$/, '') + ' '
      i++
      while (s[i] === ' ') i++
      continue
    }
    if (c === '`') {
      let n = 1
      while (s[i + n] === '`') n++
      let fin = -1
      if (!sinCierre.has(n)) {
        const marca = '`'.repeat(n)
        for (let p = s.indexOf(marca, i + n); p >= 0; p = s.indexOf(marca, p + 1)) {
          let k = 0
          while (s[p + k] === '`') k++
          if (k === n) {
            fin = p
            break
          }
          p += k - 1
        }
        if (fin < 0) sinCierre.add(n)
      }
      if (fin < 0) {
        txt += '`'.repeat(n)
        i += n
        continue
      }
      let cod = s.slice(i + n, fin).replace(/\n/g, ' ')
      if (cod.length > 1 && cod.startsWith(' ') && cod.endsWith(' ') && cod.trim()) cod = cod.slice(1, -1)
      volcar()
      const r: Run = { t: cod }
      aMono(r)
      nodos.push(r)
      i = fin + n
      continue
    }
    if (c === '<') {
      if (s.startsWith('<!--', i)) {
        const fin = s.indexOf('-->', i + 4)
        i = fin < 0 ? s.length : fin + 3
        continue
      }
      RE_AUTO.lastIndex = i
      const au = RE_AUTO.exec(s)
      if (au) {
        volcar()
        nodos.push({ t: au[1]!, u: 1, c: COLOR_ENLACE, href: au[1]! })
        i += au[0].length
        continue
      }
      RE_AUTO_CORREO.lastIndex = i
      const ac = RE_AUTO_CORREO.exec(s)
      if (ac) {
        volcar()
        nodos.push({ t: ac[1]!, u: 1, c: COLOR_ENLACE, href: `mailto:${ac[1]}` })
        i += ac[0].length
        continue
      }
      RE_ETIQUETA.lastIndex = i
      const m = RE_ETIQUETA.exec(s)
      if (m) {
        const nombre = m[2]!.toLowerCase()
        const attrs = m[3] ?? ''
        const tras = i + m[0].length
        if (nombre === 'br') {
          volcar()
          txt = '\n'
          i = tras
          while (s[i] === ' ' || s[i] === '\n') i++
          continue
        }
        if (nombre === 'img') {
          const src = atributo(attrs, 'src')
          if (src) {
            volcar()
            nodos.push({ img: true, src, alt: atributo(attrs, 'alt') ?? '' })
          }
          i = tras
          continue
        }
        if (m[1] || m[4]) {
          i = tras
          continue
        }
        if (nombre === 'script' || nombre === 'style') {
          const c2 = cierreEtiqueta(s, tras, nombre)
          i = c2 ? c2.fin : s.length
          continue
        }
        const c2 = cierreEtiqueta(s, tras, nombre)
        const interior = s.slice(tras, c2 ? c2.ini : s.length)
        const sig = c2 ? c2.fin : s.length
        const dentro = enLinea(interior, ctx, prof + 1, enEnlace || nombre === 'a')
        volcar()
        if (MARCA_ETIQUETA[nombre]) marcar(dentro, MARCA_ETIQUETA[nombre]!)
        else if (nombre === 'sup') aSuperOSub(dentro, SUPER)
        else if (nombre === 'sub') aSuperOSub(dentro, SUB)
        else if (nombre === 'a') {
          const href = atributo(attrs, 'href')
          if (href) hacerEnlace(dentro, href)
        }
        nodos.push(...dentro)
        i = sig
        continue
      }
    }
    if ((c === '!' && s[i + 1] === '[') || c === '[') {
      const esImagen = c === '!'
      const abre = esImagen ? i + 1 : i
      if (!esImagen) {
        const nm = /^\[\^([^\]]+)\]/.exec(s.slice(i, i + 200))
        if (nm && ctx.notas.has(nm[1]!)) {
          volcar()
          let num = ctx.numeros.get(nm[1]!)
          if (!num) {
            num = ctx.numeros.size + 1
            ctx.numeros.set(nm[1]!, num)
            ctx.orden.push(nm[1]!)
          }
          nodos.push({ t: [...String(num)].map(d => SUPER[d]!).join('') })
          i += nm[0].length
          continue
        }
      }
      const cierre = cierreCorchete(s, abre)
      if (cierre > 0) {
        const etiqueta = s.slice(abre + 1, cierre)
        let destino: { url: string; fin: number } | null = null
        if (s[cierre + 1] === '(') destino = destinoEnlace(s, cierre + 1)
        if (!destino) {
          let clave = etiqueta
          let fin = cierre + 1
          if (s[cierre + 1] === '[') {
            const c3 = s.indexOf(']', cierre + 2)
            if (c3 > 0) {
              const t = s.slice(cierre + 2, c3)
              if (t.trim()) clave = t
              fin = c3 + 1
            }
          }
          const ref = ctx.refs.get(normalRef(clave))
          if (ref) destino = { url: ref.url, fin }
        }
        if (destino && (esImagen || !enEnlace)) {
          volcar()
          if (esImagen) {
            const alt = textoPlano(enLinea(etiqueta, ctx, prof + 1, true)).trim()
            nodos.push({ img: true, src: destino.url, alt })
          } else {
            const dentro = enLinea(etiqueta, ctx, prof + 1, true)
            const lista = dentro.length ? dentro : [{ t: destino.url }]
            hacerEnlace(lista, destino.url)
            nodos.push(...lista)
          }
          i = destino.fin
          continue
        }
      }
      txt += c
      i++
      continue
    }
    if (c === '*' || c === '_' || c === '~') {
      let n = 1
      while (s[i + n] === c) n++
      const previo = i > 0 ? s[i - 1]! : ' '
      const sig = s[i + n] ?? ' '
      const espPrev = ESPACIO.test(previo)
      const espSig = ESPACIO.test(sig)
      const puntPrev = PUNT.test(previo)
      const puntSig = PUNT.test(sig)
      const izq = !espSig && (!puntSig || espPrev || puntPrev)
      const der = !espPrev && (!puntPrev || espSig || puntSig)
      volcar()
      const abre = c === '_' ? izq && (!der || puntPrev) : izq
      const cierra = c === '_' ? der && (!izq || puntSig) : der
      nodos.push({ d: c, n, orig: n, abre, cierra })
      i += n
      continue
    }
    if (c === '&') {
      RE_ENTIDAD.lastIndex = i
      const m = RE_ENTIDAD.exec(s)
      const v = m ? decodificarEntidad(m[1]!) : undefined
      if (m && v !== undefined) {
        txt += v
        i += m[0].length
        continue
      }
    }
    if (c === ':') {
      RE_EMOJI.lastIndex = i
      const m = RE_EMOJI.exec(s)
      const v = m ? EMOJIS[m[1]!] : undefined
      if (m && v) {
        txt += v
        i += m[0].length
        continue
      }
    }
    if (!enEnlace && (c === 'h' || c === 'w')) {
      const previo = i > 0 ? s[i - 1]! : ' '
      if (!ALFANUM.test(previo)) {
        RE_URL.lastIndex = i
        const m = RE_URL.exec(s)
        if (m) {
          let u = m[0]
          for (;;) {
            if (/[?!.,:;*_~'"]$/.test(u)) u = u.slice(0, -1)
            else if (u.endsWith(')') && (u.match(/\)/g)?.length ?? 0) > (u.match(/\(/g)?.length ?? 0)) u = u.slice(0, -1)
            else break
          }
          if (u.length > 7) {
            volcar()
            nodos.push({ t: u, u: 1, c: COLOR_ENLACE, href: u.startsWith('www.') ? `http://${u}` : u })
            i += u.length
            continue
          }
        }
      }
    }
    if (!enEnlace && /[a-zA-Z0-9]/.test(c) && (i === 0 || !/[a-zA-Z0-9._+-]/.test(s[i - 1]!))) {
      RE_CORREO.lastIndex = i
      const m = RE_CORREO.exec(s)
      if (m) {
        volcar()
        nodos.push({ t: m[0], u: 1, c: COLOR_ENLACE, href: `mailto:${m[0]}` })
        i += m[0].length
        continue
      }
    }
    txt += c
    i++
  }
  volcar()
  aplicarEnfasis(nodos)
  const salida: Token[] = []
  for (const n of nodos) {
    if (esDelim(n)) {
      if (n.n > 0) salida.push({ t: n.d.repeat(n.n) })
    } else salida.push(n)
  }
  return fundir(salida)
}

function recortar(runs: Run[]): Run[] {
  const r = runs.map(x => ({ ...x }))
  while (r.length && !r[0]!.t.trim()) r.shift()
  while (r.length && !r[r.length - 1]!.t.trim()) r.pop()
  // Los chips conservan su relleno.
  if (r.length && r[0]!.h !== COLOR_CHIP) r[0]!.t = r[0]!.t.replace(/^\s+/, '')
  if (r.length && r[r.length - 1]!.h !== COLOR_CHIP) r[r.length - 1]!.t = r[r.length - 1]!.t.replace(/\s+$/, '')
  return r
}

// Imágenes

const esRemota = (src: string) => /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src) && !/^file:/i.test(src)

function resolverRuta(src: string, carpeta: string): string {
  let s = src.replace(/[?#].*$/, '')
  try {
    s = decodeURIComponent(s)
  } catch {
    // Se deja tal cual.
  }
  s = s.replace(/\\/g, '/').replace(/^file:\/*/i, '/')
  if (/^\/[a-zA-Z]:\//.test(s)) s = s.slice(1)
  const absoluta = s.startsWith('/') || /^[a-zA-Z]:\//.test(s)
  const completa = absoluta ? s : `${carpeta.replace(/\\/g, '/').replace(/\/+$/, '')}/${s}`
  const raiz = completa.startsWith('/') ? '/' : ''
  const partes: string[] = []
  for (const p of completa.split('/')) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (partes.length && !/^[a-zA-Z]:$/.test(partes[partes.length - 1]!)) partes.pop()
    } else partes.push(p)
  }
  return raiz + partes.join('/')
}

const nombreDe = (src: string) => src.replace(/[?#].*$/, '').split(/[\\/]/).pop()?.replace(/\.[a-zA-Z0-9]+$/, '') || 'imagen'

function bloqueImagen(t: Img, ctx: Ctx): Bloque {
  if (esRemota(t.src)) {
    const r: Run = { t: `🖼 ${t.alt || (t.src.startsWith('data:') ? 'imagen' : nombreDe(t.src))}`, i: 1, c: '#667085' }
    const href = t.href ?? (/^https?:/i.test(t.src) ? t.src : undefined)
    if (href) r.href = href
    return parrafo([r])
  }
  return { k: 'img', src: `archivo:${resolverRuta(t.src, ctx.carpeta)}`, w: 0, h: 0, alt: t.alt }
}

function aChip(t: Img): Run {
  const r: Run = { t: ` ${t.alt || nombreDe(t.src)} `, h: COLOR_CHIP, c: '#344054' }
  if (t.href) r.href = t.href
  return r
}

function bloquesDeTokens(tokens: Token[], ctx: Ctx, extra: Partial<Parrafo> = {}): Bloque[] {
  const vis = tokens.filter(t => esImg(t) || t.t.trim())
  if (!vis.length) return []
  if (vis.every(esImg)) {
    const imgs = vis as Img[]
    if (imgs.length === 1 || imgs.every(x => !esRemota(x.src))) return imgs.map(x => bloqueImagen(x, ctx))
  }
  const runs = recortar(tokens.map(t => (esImg(t) ? aChip(t) : t)))
  return runs.length ? [parrafo(runs, extra)] : []
}

function runsDe(texto: string, ctx: Ctx): Run[] {
  return recortar(enLinea(texto, ctx).map(t => (esImg(t) ? aChip(t) : t)))
}

// Código y diagramas

const CAJAS = /[┌┐└┘│─┬┴├┤┼╭╮╰╯═║]/g

function esArte(texto: string): boolean {
  if ((texto.match(CAJAS)?.length ?? 0) >= 2) return true
  return texto.split('\n').some(l => /\+-{2,}\+/.test(l) || /-->/.test(l))
}

function bloqueCodigo(lang: string, texto: string): Bloque {
  const l = lang.toLowerCase()
  if (l === 'mermaid') return { k: 'figura', ...dibujarMermaid(texto) }
  if ((l === '' || l === 'text' || l === 'ascii' || l === 'diagram') && esArte(texto)) return { k: 'figura', lineas: texto.split('\n') }
  return { k: 'cod', lang, texto }
}

// Frontmatter

function valorYaml(v: string): string {
  const s = v.trim()
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => valorYaml(x)).filter(Boolean).join(', ')
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) return s.slice(1, -1)
  return s
}

function frontmatter(l: string[]): { b: Bloque | null; sig: number } {
  if (!l.length || !/^---\s*$/.test(l[0]!)) return { b: null, sig: 0 }
  let fin = -1
  for (let i = 1; i < l.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(l[i]!)) {
      fin = i
      break
    }
  }
  if (fin < 0) return { b: null, sig: 0 }
  const cuerpo = l.slice(1, fin)
  const primera = cuerpo.find(x => x.trim() && !x.trim().startsWith('#'))
  if (primera !== undefined && !/^[^\s:#][^:]*:(\s|$)/.test(primera)) return { b: null, sig: 0 }
  const pares: [string, string][] = []
  for (let i = 0; i < cuerpo.length; i++) {
    const t = cuerpo[i]!
    if (!t.trim() || t.trim().startsWith('#')) continue
    const m = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(t)
    if (!m) continue
    const hijas: string[] = []
    while (i + 1 < cuerpo.length && (enBlanco(cuerpo[i + 1]!) || /^\s/.test(cuerpo[i + 1]!) || /^- /.test(cuerpo[i + 1]!))) {
      i++
      if (cuerpo[i]!.trim()) hijas.push(cuerpo[i]!.trim().replace(/^- +/, ''))
    }
    const v = m[2]!.trim()
    const valor = /^[|>][+-]?$/.test(v) || !v ? hijas.map(valorYaml).join(', ') : valorYaml(v)
    pares.push([m[1]!.trim(), valor])
  }
  if (!pares.length) return { b: null, sig: fin + 1 }
  const filas: Celda[][] = pares.map(([k, v]) => [{ b: [parrafo([{ t: k, b: 1 }])] }, { b: [parrafo([{ t: v }])] }])
  return { b: { k: 'tabla', filas }, sig: fin + 1 }
}

// Listas

function parseLista(l: string[], inicio: number, ctx: Ctx, op: Op): { b: Bloque[]; sig: number } {
  const primero = item(l[inicio]!)!
  const ordenada = primero.ordenada
  const base = primero.ind
  let num = ordenada ? parseInt(primero.marca, 10) : 1
  const salida: Bloque[] = []
  let i = inicio
  while (i < l.length) {
    const it = item(l[i]!)
    if (!it || it.ordenada !== ordenada || it.ind >= base + 2) break
    const cuerpo: string[] = []
    let resto = it.resto
    let marca = ordenada ? `${num}.` : ['•', '◦', '▪'][op.nivel % 3]!
    const tarea = /^\[( |x|X)\](?:\s+|$)(.*)$/.exec(resto)
    if (tarea) {
      marca = tarea[1] === ' ' ? '☐' : '☑'
      resto = tarea[2]!
    }
    cuerpo.push(resto)
    let j = i + 1
    let cerca = ''
    for (; j < l.length; j++) {
      const t = l[j]!
      if (cerca) {
        cuerpo.push(quitar(t, it.off))
        if (cierraCerca(t.trimStart(), cerca)) cerca = ''
        continue
      }
      if (enBlanco(t)) {
        let k = j + 1
        while (k < l.length && enBlanco(l[k]!)) k++
        if (k >= l.length) {
          j = l.length
          break
        }
        const ind = sangria(l[k]!)
        const mi = item(l[k]!)
        if (ind >= Math.min(it.off, it.ind + 2) && !(mi && ind < it.ind + 2)) {
          cuerpo.push('')
          continue
        }
        break
      }
      const ind = sangria(t)
      const mi = item(t)
      const previaEnBlanco = enBlanco(cuerpo[cuerpo.length - 1] ?? '')
      if (mi && ind < it.ind + 2) break
      let linea: string | null = null
      if (ind >= it.off) {
        linea = quitar(t, it.off)
        // Sublista muy sangrada: no debe volverse código.
        if (item(linea.trimStart()) && sangria(linea) >= 4) linea = linea.trimStart()
      } else if (mi) linea = t.slice(Math.min(ind, it.ind + 2))
      else if (!previaEnBlanco && !iniciaBloque(t)) linea = t.trimStart()
      else if (ind >= it.ind + 2) linea = t.trimStart()
      else break
      cuerpo.push(linea)
      const f = abreCerca(linea)
      if (f) cerca = f.marca
    }
    const bloques = parseBloques(cuerpo, ctx, { nivel: op.nivel + 1, html: op.html, prof: op.prof + 1 })
    const prim = bloques[0]
    if (prim && prim.k === 'p' && !prim.lista && prim.est === undefined) {
      prim.lista = { marca, nivel: op.nivel }
      bloques.shift()
      salida.push(prim)
    } else salida.push(parrafo([{ t: '' }], { lista: { marca, nivel: op.nivel } }))
    for (const b of bloques) {
      if (b.k === 'p' && !b.lista && b.sang === undefined) b.sang = op.nivel * 3 + 3
      salida.push(b)
    }
    num++
    i = j
    while (i < l.length && enBlanco(l[i]!)) {
      let k = i
      while (k < l.length && enBlanco(l[k]!)) k++
      const sig = k < l.length ? item(l[k]!) : null
      if (sig && sig.ordenada === ordenada && sig.ind < base + 2) i = k
      else return { b: salida, sig: i }
    }
  }
  return { b: salida, sig: i }
}

// Tablas

function parseTabla(l: string[], i: number, ctx: Ctx): { b: Bloque; sig: number } {
  const cab = celdasDe(l[i]!)
  const del = celdasDe(l[i + 1]!)
  const n = cab.length
  const als = cab.map((_, c) => {
    const d = del[c]?.trim() ?? ''
    if (d.startsWith(':') && d.endsWith(':')) return 'c' as const
    if (d.endsWith(':')) return 'r' as const
    return undefined
  })
  const celda = (texto: string, c: number, cabecera: boolean): Celda => {
    const r = runsDe(texto, ctx)
    const runs = r.length ? r : [{ t: '' }]
    if (cabecera) for (const x of runs) x.b = 1
    const al = als[c]
    const b: Parrafo = al ? parrafo(runs, { al }) : parrafo(runs)
    return cabecera ? { b: [b], bg: '#e8ecf2' } : { b: [b] }
  }
  const filas: Celda[][] = [cab.map((t, c) => celda(t, c, true))]
  let j = i + 2
  for (; j < l.length; j++) {
    const t = l[j]!
    if (enBlanco(t) || !t.includes('|') || iniciaBloque(t)) break
    const cels = celdasDe(t)
    filas.push(Array.from({ length: n }, (_, c) => celda(cels[c] ?? '', c, false)))
  }
  return { b: { k: 'tabla', filas }, sig: j }
}

// HTML de bloque

function alinear(bs: Bloque[], al: 'c' | 'r' | 'j'): void {
  for (const b of bs) {
    if (b.k === 'p' && !b.al) b.al = al
    else if (b.k === 'cita') alinear(b.b, al)
  }
}

function alineacionDe(attrs: string): 'c' | 'r' | undefined {
  const a = (atributo(attrs, 'align') ?? '').toLowerCase()
  const est = (atributo(attrs, 'style') ?? '').toLowerCase()
  const t = /text-align\s*:\s*(\w+)/.exec(est)?.[1] ?? a
  return t === 'center' ? 'c' : t === 'right' ? 'r' : undefined
}

function dedent(lineas: string[]): string[] {
  const sang = lineas.filter(x => x.trim()).map(sangria)
  const min = sang.length ? Math.min(...sang) : 0
  const salida = lineas.map(x => x.slice(Math.min(min, sangria(x))))
  while (salida.length && enBlanco(salida[0]!)) salida.shift()
  while (salida.length && enBlanco(salida[salida.length - 1]!)) salida.pop()
  return salida
}

/** Línea y columna del cierre de `nombre`, saltando las cercas de código. */
function buscarCierre(l: string[], i: number, col: number, nombre: string): { f: number; ini: number; fin: number } | null {
  let prof = 1
  let cerca = ''
  for (let f = i; f < l.length; f++) {
    const t = l[f]!
    if (f > i) {
      if (cerca) {
        if (cierraCerca(t, cerca)) cerca = ''
        continue
      }
      const a = abreCerca(t)
      if (a) {
        cerca = a.marca
        continue
      }
    }
    const re = new RegExp(`<(/?)${nombre}(?:\\s[^<>]*)?>`, 'gi')
    re.lastIndex = f === i ? col : 0
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (m[0].endsWith('/>')) continue
      prof += m[1] ? -1 : 1
      if (prof === 0) return { f, ini: m.index, fin: m.index + m[0].length }
    }
  }
  return null
}

function parseHtml(l: string[], i: number, ctx: Ctx, op: Op): { b: Bloque[]; sig: number } | null {
  // Comentarios
  if (/^ {0,3}<!--/.test(l[i]!)) {
    const col = l[i]!.indexOf('<!--') + 4
    for (let f = i; f < l.length; f++) {
      const p = l[f]!.indexOf('-->', f === i ? col : 0)
      if (p >= 0) {
        const resto = l[f]!.slice(p + 3)
        if (resto.trim()) {
          l[f] = resto.trimStart()
          return { b: [], sig: f }
        }
        return { b: [], sig: f + 1 }
      }
    }
    return { b: [], sig: l.length }
  }
  const cie = RE_CIERRA_HTML.exec(l[i]!)
  if (cie && ETIQUETAS_BLOQUE.has(cie[1]!.toLowerCase())) {
    const resto = l[i]!.slice(cie[0].length)
    if (resto.trim()) {
      l[i] = resto.trimStart()
      return { b: [], sig: i }
    }
    return { b: [], sig: i + 1 }
  }
  // Atributos partidos en varias líneas.
  if (/^ {0,3}<[a-zA-Z][\w-]*(\s[^<>]*)?$/.test(l[i]!)) {
    const nombre = /^ {0,3}<([a-zA-Z][\w-]*)/.exec(l[i]!)![1]!.toLowerCase()
    if (ETIQUETAS_BLOQUE.has(nombre)) {
      for (let f = i + 1; f < Math.min(l.length, i + 12); f++) {
        if (l[f]!.includes('>')) {
          l.splice(i, f - i + 1, l.slice(i, f + 1).map(x => x.trim()).join(' '))
          break
        }
      }
    }
  }
  const m = RE_ABRE_HTML.exec(l[i]!)
  if (!m) return null
  const nombre = m[1]!.toLowerCase()
  if (!ETIQUETAS_BLOQUE.has(nombre)) return null
  const attrs = m[2] ?? ''
  const tras = m[0].length
  const siguienteDe = (f: number, col: number): number => {
    const resto = l[f]!.slice(col)
    if (resto.trim()) {
      l[f] = resto.trimStart()
      return f
    }
    return f + 1
  }
  if (nombre === 'hr') return { b: [{ k: 'hr' }], sig: siguienteDe(i, tras) }
  if (m[3]) return { b: [], sig: siguienteDe(i, tras) }
  let interior: string[]
  let sig: number
  const c = buscarCierre(l, i, tras, nombre)
  if (c) {
    interior = c.f === i ? [l[i]!.slice(tras, c.ini)] : [l[i]!.slice(tras), ...l.slice(i + 1, c.f), l[c.f]!.slice(0, c.ini)]
    sig = siguienteDe(c.f, c.fin)
  } else {
    const hastaBlanco = nombre === 'p' || /^h[1-6]$/.test(nombre)
    let f = i + 1
    if (hastaBlanco) while (f < l.length && !enBlanco(l[f]!)) f++
    else f = l.length
    interior = [l[i]!.slice(tras), ...l.slice(i + 1, f)]
    sig = f
  }
  if (nombre === 'script' || nombre === 'style') return { b: [], sig }
  const interno: Op = { nivel: 0, html: true, prof: op.prof + 1 }
  const al = alineacionDe(attrs) ?? (nombre === 'center' ? 'c' : undefined)
  const conAl = (b: Bloque[]) => {
    if (al) alinear(b, al)
    return b
  }
  if (nombre === 'pre') {
    const crudo = dedent(interior).join('\n').replace(/<\/?code[^>]*>/gi, '').replace(/<[^>]+>/g, '')
    return { b: [bloqueCodigo('', decodificarEntidades(crudo))], sig }
  }
  if (/^h[1-6]$/.test(nombre)) {
    const est = nombre as 'h1'
    let texto = interior.map(x => x.trim()).join(' ')
    const previas: Bloque[] = []
    // Imágenes al principio del título: logo arriba, título debajo.
    for (;;) {
      const mi = /^(?:<a\b[^>]*>\s*)?(<img\b[^>]*>)(?:\s*<\/a>)?\s*(?:<br\s*\/?>\s*)?/i.exec(texto)
      if (!mi) break
      const tokens = enLinea(mi[1]!, ctx)
      for (const t of tokens) if (esImg(t)) previas.push(bloqueImagen(t, ctx))
      texto = texto.slice(mi[0].length)
    }
    const runs = runsDe(texto, ctx)
    const bloques: Bloque[] = [...previas]
    if (runs.length) bloques.push(parrafo(runs, { est }))
    return { b: conAl(bloques), sig }
  }
  if (nombre === 'details') {
    let lineas = interior
    let titulo: Run[] = [{ t: 'Detalles' }]
    const junto = lineas.join('\n')
    const ms = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(junto)
    if (ms) {
      const r = runsDe(ms[1]!.replace(/\n/g, ' '), ctx)
      if (r.length) titulo = r
      lineas = (junto.slice(0, ms.index) + junto.slice(ms.index + ms[0].length)).split('\n')
    }
    const cuerpo = parseBloques(dedent(lineas), ctx, interno)
    return { b: conAl([parrafo([{ t: '▾ ' }, ...titulo], { est: 'h4' }), ...cuerpo]), sig }
  }
  const cuerpo = parseBloques(dedent(interior), ctx, interno)
  if (nombre === 'blockquote') return { b: [{ k: 'cita', b: cuerpo }], sig }
  if (nombre === 'li') {
    const prim = cuerpo[0]
    if (prim?.k === 'p' && !prim.lista) prim.lista = { marca: '•', nivel: op.nivel }
    else cuerpo.unshift(parrafo([{ t: '' }], { lista: { marca: '•', nivel: op.nivel } }))
    return { b: conAl(cuerpo), sig }
  }
  if (nombre === 'ol') {
    let n = parseInt(atributo(attrs, 'start') ?? '1', 10) || 1
    for (const b of cuerpo) if (b.k === 'p' && b.lista?.marca === '•' && b.lista.nivel === 0) b.lista.marca = `${n++}.`
  }
  return { b: conAl(cuerpo), sig }
}

// Bloques

const AVISO = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i

function parseBloques(entrada: string[], ctx: Ctx, op: Op): Bloque[] {
  const l = [...entrada]
  const salida: Bloque[] = []
  if (op.prof > MAX_PROF) {
    const texto = l.map(x => x.trim()).filter(Boolean).join(' ')
    return texto ? [parrafo([{ t: texto }])] : []
  }
  let i = 0
  while (i < l.length) {
    if (op.html && /^ +</.test(l[i]!)) l[i] = l[i]!.trimStart()
    const t = l[i]!
    if (enBlanco(t)) {
      i++
      continue
    }
    // Código con cerca
    const f = abreCerca(t)
    if (f) {
      const ind = sangria(t)
      const cuerpo: string[] = []
      let j = i + 1
      for (; j < l.length; j++) {
        if (cierraCerca(l[j]!, f.marca)) break
        cuerpo.push(quitar(l[j]!, ind))
      }
      const lang = /^\{?\.?([^\s{}]*)/.exec(f.info)?.[1] ?? ''
      salida.push(bloqueCodigo(lang, cuerpo.join('\n')))
      i = j + 1
      continue
    }
    // Código sangrado
    if (sangria(t) >= 4 && !op.html) {
      const cuerpo: string[] = []
      let j = i
      for (; j < l.length; j++) {
        if (enBlanco(l[j]!)) cuerpo.push('')
        else if (sangria(l[j]!) >= 4) cuerpo.push(l[j]!.slice(4))
        else break
      }
      while (cuerpo.length && !cuerpo[cuerpo.length - 1]) cuerpo.pop()
      salida.push(bloqueCodigo('', cuerpo.join('\n')))
      i = j
      continue
    }
    // Definiciones
    if (RE_NOTA.test(t)) {
      i = finNota(l, i) + 1
      continue
    }
    if (RE_DEF.test(t)) {
      i++
      continue
    }
    // Títulos ATX
    const atx = RE_ATX.exec(t)
    if (atx) {
      const est = `h${atx[1]!.length}` as 'h1'
      const r = runsDe(atx[2] ?? '', ctx)
      if (r.length) salida.push(parrafo(r, { est }))
      i++
      continue
    }
    if (RE_HR.test(t)) {
      salida.push({ k: 'hr' })
      i++
      continue
    }
    // Citas y avisos
    if (RE_CITA.test(t)) {
      const dentro: string[] = []
      let j = i
      for (; j < l.length; j++) {
        const x = l[j]!
        if (RE_CITA.test(x)) dentro.push(x.replace(RE_CITA, ''))
        else if (!enBlanco(x) && dentro.length && !enBlanco(dentro[dentro.length - 1]!) && !iniciaBloque(x)) dentro.push(x.trimStart())
        else break
      }
      let tipo: string | undefined
      const a = dentro.length ? AVISO.exec(dentro[0]!) : null
      if (a) {
        tipo = a[1]!.toLowerCase()
        if (a[2]) dentro[0] = a[2]
        else dentro.shift()
      }
      const b = parseBloques(dentro, ctx, { nivel: 0, html: false, prof: op.prof + 1 })
      salida.push(tipo ? { k: 'cita', b, tipo } : { k: 'cita', b })
      i = j
      continue
    }
    // Listas
    const it = item(t)
    if (it) {
      const r = parseLista(l, i, ctx, op)
      salida.push(...r.b)
      i = r.sig
      continue
    }
    // HTML
    if (esEtiquetaBloque(t) || /^ {0,3}<[a-zA-Z][\w-]*(\s[^<>]*)?$/.test(t)) {
      const r = parseHtml(l, i, ctx, op)
      if (r) {
        salida.push(...r.b)
        i = r.sig
        continue
      }
    }
    // Tablas
    if (iniciaTabla(l, i)) {
      const r = parseTabla(l, i, ctx)
      salida.push(r.b)
      i = r.sig
      continue
    }
    // Párrafo y títulos Setext
    const piezas: string[] = [t.trimStart()]
    let j = i + 1
    let est: 'h1' | 'h2' | undefined
    for (; j < l.length; j++) {
      const x = l[j]!
      if (enBlanco(x)) break
      if (/^ {0,3}=+\s*$/.test(x)) {
        est = 'h1'
        j++
        break
      }
      if (/^ {0,3}-+\s*$/.test(x)) {
        est = 'h2'
        j++
        break
      }
      if (iniciaBloque(x) || iniciaTabla(l, j) || RE_NOTA.test(x) || RE_DEF.test(x)) break
      piezas.push(x.trimStart())
    }
    const texto = piezas.join('\n').replace(/\s+$/, '')
    if (est) {
      const r = runsDe(texto, ctx)
      if (r.length) salida.push(parrafo(r, { est }))
    } else salida.push(...bloquesDeTokens(enLinea(texto, ctx), ctx))
    i = j
  }
  return salida
}

// Notas al pie al final del documento

function notasAlPie(ctx: Ctx): Bloque[] {
  const salida: Bloque[] = []
  const hecho = new Set<string>()
  const procesar = (id: string, num: number) => {
    hecho.add(id)
    const nota = ctx.notas.get(id)
    if (!nota) return
    const cuerpo = parseBloques(nota.lineas, ctx, { nivel: 0, html: false, prof: 1 })
    const marca: Run = { t: `${[...String(num)].map(d => SUPER[d]!).join('')} ` }
    const prim = cuerpo[0]
    if (prim?.k === 'p' && !prim.lista) prim.r.unshift(marca)
    else cuerpo.unshift(parrafo([marca]))
    for (const b of cuerpo.slice(1)) if (b.k === 'p' && !b.lista) b.sang = 3
    salida.push(...cuerpo)
  }
  // Una nota puede citar otra: `orden` crece mientras se recorre.
  for (let i = 0; i < ctx.orden.length; i++) {
    const id = ctx.orden[i]!
    if (!hecho.has(id)) procesar(id, ctx.numeros.get(id)!)
  }
  let n = ctx.numeros.size
  for (const id of ctx.notas.keys()) if (!hecho.has(id)) procesar(id, ++n)
  return salida.length ? [{ k: 'hr' }, ...salida] : []
}

export function bloquesDeMarkdown(texto: string, carpeta: string): Bloque[] {
  const lineas = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map(normalizarSangria)
  try {
    const ctx: Ctx = { carpeta, refs: new Map(), notas: new Map(), numeros: new Map(), orden: [] }
    const fm = frontmatter(lineas)
    const cuerpo = lineas.slice(fm.sig)
    recolectar(cuerpo, ctx)
    const b = parseBloques(cuerpo, ctx, { nivel: 0, html: false, prof: 0 })
    return [...(fm.b ? [fm.b] : []), ...b, ...notasAlPie(ctx)]
  } catch {
    return lineas.filter(l => l.trim()).map(l => parrafo([{ t: l.trim() }]))
  }
}
