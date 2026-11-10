// Dibuja diagramas Mermaid con caracteres de caja, sin navegador y sin fallar nunca.

const MAX_NODOS = 200
const MAX_ENLACES = 800
const MAX_LADO = 2500
const MAX_TEXTO = 26
const MAX_LINEAS_NODO = 4
const MAX_ETIQUETA = 24
const ANCHO_COMODO = 110

type Resultado = { lineas: string[]; titulo?: string }
type Trazo = 'n' | 'p' | 'g'
type Cabeza = '' | 'flecha' | 'x' | 'o' | 'tri' | 'rombo' | 'lleno'
type Forma = 'rect' | 'redondo' | 'circulo' | 'rombo' | 'doble' | 'punto'
type Dir = 'TD' | 'BT' | 'LR' | 'RL'

type Grupo = { id: string; titulo: string; padre: Grupo | null }
type Nodo = { id: string; lineas: string[]; forma: Forma; secciones?: string[][]; grupo: Grupo | null; definido?: boolean }
type Enlace = { de: string; a: string; trazo: Trazo; ini: Cabeza; fin: Cabeza; texto: string }
type Grafo = { dir: Dir; nodos: Map<string, Nodo>; enlaces: Enlace[]; grupos: Grupo[]; truncado?: number }

// Medidas y limpieza de texto

function anchoCar(cp: number): number {
  if (cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2
  return 1
}

function ancho(s: string): number {
  let w = 0
  for (const ch of s) w += anchoCar(ch.codePointAt(0)!)
  return w
}

function recortar(s: string, n: number): string {
  if (ancho(s) <= n) return s
  let w = 0
  let r = ''
  for (const ch of s) {
    const c = anchoCar(ch.codePointAt(0)!)
    if (w + c > n - 1) break
    r += ch
    w += c
  }
  return `${r}…`
}

const rellenar = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - ancho(s)))

/** Quita marcas del lenguaje y parte en líneas por `<br>`. */
function textos(crudo: string): string[] {
  let s = crudo.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  if (s.startsWith('`') && s.endsWith('`') && s.length >= 2) s = s.slice(1, -1)
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\bfa[bsrl]?:fa-[\w-]+\s*/g, '')
    .replace(/#(quot|amp|lt|gt|nbsp);/g, (_, e: string) => ({ quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' })[e] ?? ' ')
    .replace(/#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(+n, 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\*\*|__/g, '')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
  return s
    .split('\n')
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function textoUnaLinea(crudo: string, max: number): string {
  return recortar(textos(crudo).join(' '), max)
}

function envolver(lineas: string[], max = MAX_TEXTO, tope = MAX_LINEAS_NODO): string[] {
  const salida: string[] = []
  for (const l of lineas) {
    let act = ''
    for (const palabra of l.split(' ')) {
      const p = recortar(palabra, max)
      if (!act) act = p
      else if (ancho(act) + 1 + ancho(p) <= max) act += ` ${p}`
      else {
        salida.push(act)
        act = p
      }
    }
    if (act) salida.push(act)
  }
  if (salida.length > tope) {
    const cortado = salida.slice(0, tope)
    cortado[tope - 1] = recortar(`${cortado[tope - 1]} …`, max)
    return cortado
  }
  return salida
}

// Lienzo con máscara de direcciones

const ARR = 1
const DER = 2
const ABA = 4
const IZQ = 8
const G_N = ' │─└││┌├─┘─┴┐┤┬┼'
const G_G = ' ┃━┗┃┃┏┣━┛━┻┓┫┳╋'
const G_P = ' ┆┄└┆┆┌├┄┘┄┴┐┤┬┼'
const AGENO = '\u0000'

class Lienzo {
  mask: number[]
  estilo: string[]
  txt: string[]
  fondo: string[]
  alto: number
  largo: number
  constructor(alto: number, largo: number) {
    this.alto = alto
    this.largo = largo
    const n = alto * largo
    this.mask = new Array<number>(n).fill(0)
    this.estilo = new Array<string>(n).fill('')
    this.txt = new Array<string>(n).fill('')
    this.fondo = new Array<string>(n).fill('')
  }
  ok(f: number, c: number): boolean {
    return f >= 0 && c >= 0 && f < this.alto && c < this.largo
  }
  idx(f: number, c: number): number {
    return f * this.largo + c
  }
  bit(f: number, c: number, m: number, tr: Trazo): void {
    if (!this.ok(f, c)) return
    const i = this.idx(f, c)
    this.mask[i] = this.mask[i]! | m
    const e = this.estilo[i]
    this.estilo[i] = !e || e === tr ? tr : 'n'
  }
  linea(f1: number, c1: number, f2: number, c2: number, tr: Trazo = 'n'): void {
    if (f1 === f2) {
      const [a, b] = c1 < c2 ? [c1, c2] : [c2, c1]
      for (let c = a; c <= b; c++) this.bit(f1, c, (c > a ? IZQ : 0) | (c < b ? DER : 0), tr)
    } else if (c1 === c2) {
      const [a, b] = f1 < f2 ? [f1, f2] : [f2, f1]
      for (let f = a; f <= b; f++) this.bit(f, c1, (f > a ? ARR : 0) | (f < b ? ABA : 0), tr)
    }
  }
  poner(f: number, c: number, s: string): void {
    let x = c
    for (const ch of s) {
      const w = anchoCar(ch.codePointAt(0)!)
      if (w === 0) continue
      if (this.ok(f, x)) this.txt[this.idx(f, x)] = ch
      if (w === 2 && this.ok(f, x + 1)) this.txt[this.idx(f, x + 1)] = AGENO
      x += w
    }
  }
  libre(f: number, c: number, n: number): boolean {
    if (f < 0 || f >= this.alto || c < 0 || c + n > this.largo) return false
    for (let x = c; x < c + n; x++) {
      const i = this.idx(f, x)
      if (this.mask[i] || this.txt[i]) return false
    }
    return true
  }
  glifo(i: number): string {
    const m = this.mask[i]!
    if (!m) return ''
    const e = this.estilo[i]
    return (e === 'g' ? G_G : e === 'p' ? G_P : G_N)[m]!
  }
  /** Cambia los bordes de una caja ya enmascarada por su forma final. */
  caja(f: number, c: number, al: number, an: number, forma: Forma): void {
    this.linea(f, c, f, c + an - 1)
    this.linea(f + al - 1, c, f + al - 1, c + an - 1)
    this.linea(f, c, f + al - 1, c)
    this.linea(f, c + an - 1, f + al - 1, c + an - 1)
    if (forma === 'redondo' || forma === 'circulo') {
      this.poner(f, c, '╭')
      this.poner(f, c + an - 1, '╮')
      this.poner(f + al - 1, c, '╰')
      this.poner(f + al - 1, c + an - 1, '╯')
    } else if (forma === 'rombo') {
      this.poner(f, c, '╱')
      this.poner(f, c + an - 1, '╲')
      this.poner(f + al - 1, c, '╲')
      this.poner(f + al - 1, c + an - 1, '╱')
    } else if (forma === 'doble') {
      const cambio: Record<string, string> = { '┌': '╔', '┐': '╗', '└': '╚', '┘': '╝', '─': '═', '│': '║', '┬': '╤', '┴': '╧', '├': '╟', '┤': '╢', '┼': '╬' }
      const fijar = (y: number, x: number) => {
        const g = this.glifo(this.idx(y, x))
        this.poner(y, x, cambio[g] ?? g)
      }
      for (let x = c; x < c + an; x++) {
        fijar(f, x)
        fijar(f + al - 1, x)
      }
      for (let y = f + 1; y < f + al - 1; y++) {
        fijar(y, c)
        fijar(y, c + an - 1)
      }
    }
  }
  salida(): string[] {
    const filas: string[] = []
    for (let f = 0; f < this.alto; f++) {
      let s = ''
      for (let c = 0; c < this.largo; c++) {
        const i = this.idx(f, c)
        const t = this.txt[i]
        if (t === AGENO) continue
        s += t || this.glifo(i) || this.fondo[i] || ' '
      }
      filas.push(s.replace(/\s+$/, ''))
    }
    while (filas.length && !filas[0]) filas.shift()
    while (filas.length && !filas[filas.length - 1]) filas.pop()
    const izq = Math.min(...filas.filter(Boolean).map(x => x.length - x.trimStart().length), Infinity)
    return Number.isFinite(izq) ? filas.map(x => x.slice(izq)) : filas
  }
}

// Modelo de grafo

function nuevoGrafo(dir: Dir): Grafo {
  return { dir, nodos: new Map(), enlaces: [], grupos: [] }
}

function nodoDe(g: Grafo, id: string, grupo: Grupo | null): Nodo {
  let n = g.nodos.get(id)
  if (!n) {
    n = { id, lineas: envolver(textos(id)), forma: 'rect', grupo }
    if (!n.lineas.length) n.lineas = [recortar(id, MAX_TEXTO)]
    g.nodos.set(id, n)
  } else if (!n.grupo && grupo) n.grupo = grupo
  return n
}

function definirNodo(g: Grafo, id: string, grupo: Grupo | null, texto: string | undefined, forma?: Forma): void {
  const n = nodoDe(g, id, grupo)
  if (texto !== undefined && !n.definido) {
    const l = envolver(textos(texto))
    if (l.length) n.lineas = l
    n.definido = true
  }
  if (forma && (n.forma === 'rect' || !n.definido)) n.forma = forma
}

const rutaGrupo = (g: Grupo | null): Grupo[] => {
  const r: Grupo[] = []
  for (let x = g; x; x = x.padre) r.unshift(x)
  return r
}

// Maquetado por capas

type V = { real: number; capa: number; s: number; t: number; der: number; c: number; tr: Trazo; ruta: Grupo[] }
type Seg = { de: number; a: number; e: number; primero: boolean; ultimo: boolean }
type Puerto = { v: number; col: number; fin: Cabeza; texto: string }
type Red = { capa: number; trazo: Trazo; ini: Cabeza; srcs: Puerto[]; tgts: Puerto[]; pista: number }

/** Regresión isotónica con separaciones: el orden se conserva y las posiciones se acercan a lo deseado. */
function acomodar(deseo: number[], sep: number[], peso: number[]): number[] {
  const n = deseo.length
  const acc = [0]
  for (let i = 1; i < n; i++) acc.push(acc[i - 1]! + sep[i - 1]!)
  const bloques: { suma: number; peso: number; ini: number; fin: number }[] = []
  for (let i = 0; i < n; i++) {
    const w = peso[i]!
    bloques.push({ suma: (deseo[i]! - acc[i]!) * w, peso: w, ini: i, fin: i })
    while (bloques.length > 1) {
      const a = bloques[bloques.length - 2]!
      const b = bloques[bloques.length - 1]!
      if (a.suma / a.peso < b.suma / b.peso) break
      a.suma += b.suma
      a.peso += b.peso
      a.fin = b.fin
      bloques.pop()
    }
  }
  const x = new Array<number>(n).fill(0)
  for (const b of bloques) {
    const v = Math.round(b.suma / b.peso)
    for (let i = b.ini; i <= b.fin; i++) x[i] = v + acc[i]!
  }
  return x
}

function maquetarGrafo(g: Grafo, dir: Dir): string[] {
  const horiz = dir === 'LR' || dir === 'RL'
  const nodos = [...g.nodos.values()]
  const indice = new Map(nodos.map((n, i) => [n.id, i]))
  const bucles: string[][] = nodos.map(() => [])
  const edges: { de: number; a: number; trazo: Trazo; ini: Cabeza; fin: Cabeza; texto: string }[] = []
  for (const e of g.enlaces) {
    const de = indice.get(e.de)
    const a = indice.get(e.a)
    if (de === undefined || a === undefined) continue
    if (de === a) {
      bucles[de]!.push(e.texto ? `↺ ${e.texto}` : '↺')
      continue
    }
    edges.push({ de, a, trazo: e.trazo, ini: e.ini, fin: e.fin, texto: e.texto })
  }

  // Rompe ciclos invirtiendo las aristas de retroceso.
  const salen: number[][] = nodos.map(() => [])
  const entran = nodos.map(() => 0)
  edges.forEach((e, i) => {
    salen[e.de]!.push(i)
    entran[e.a]!++
  })
  const color = nodos.map(() => 0)
  const visitar = (u: number) => {
    color[u] = 1
    for (const i of salen[u]!) {
      const e = edges[i]!
      if (color[e.a] === 1) e.texto = `\u0001${e.texto}`
      else if (color[e.a] === 0) visitar(e.a)
    }
    color[u] = 2
  }
  nodos.forEach((_, u) => {
    if (!entran[u] && !color[u]) visitar(u)
  })
  nodos.forEach((_, u) => {
    if (!color[u]) visitar(u)
  })
  for (const e of edges) {
    if (e.texto.startsWith('\u0001')) {
      e.texto = e.texto.slice(1)
      ;[e.de, e.a] = [e.a, e.de]
      ;[e.ini, e.fin] = [e.fin, e.ini]
    }
  }

  // Rango por camino más largo.
  const rango = nodos.map(() => 0)
  const grado = nodos.map(() => 0)
  const sal2: number[][] = nodos.map(() => [])
  for (const e of edges) {
    grado[e.a]!++
    sal2[e.de]!.push(e.a)
  }
  const cola = nodos.map((_, i) => i).filter(i => !grado[i])
  const topo: number[] = []
  for (let p = 0; p < cola.length; p++) {
    const u = cola[p]!
    topo.push(u)
    for (const v of sal2[u]!) {
      rango[v] = Math.max(rango[v]!, rango[u]! + 1)
      if (--grado[v]! === 0) cola.push(v)
    }
  }
  // Acerca las fuentes a sus hijos para evitar aristas largas.
  for (let p = topo.length - 1; p >= 0; p--) {
    const u = topo[p]!
    const tieneEntrada = edges.some(e => e.a === u)
    if (!tieneEntrada && sal2[u]!.length) rango[u] = Math.min(...sal2[u]!.map(v => rango[v]!)) - 1
  }
  const nCapas = Math.max(0, ...rango) + 1

  // Tamaños base
  const textoNodo = nodos.map((n, i) => [...n.lineas, ...bucles[i]!])
  const tamano = nodos.map((n, i) => {
    if (n.forma === 'punto') return { an: 1, al: 1 }
    const anT = Math.max(...textoNodo[i]!.map(ancho), ...(n.secciones ?? []).flat().map(ancho), 1)
    let al = textoNodo[i]!.length + 2
    for (const sec of n.secciones ?? []) if (sec.length) al += sec.length + 1
    return { an: anT + 4, al }
  })

  // Vértices y segmentos
  const vs: V[] = nodos.map((n, i) => ({ real: i, capa: rango[i]!, s: 0, t: 0, der: 0, c: 0, tr: 'n', ruta: rutaGrupo(n.grupo) }))
  const segs: Seg[] = []
  edges.forEach((e, ei) => {
    let prev = e.de
    let primero = true
    for (let r = rango[e.de]! + 1; r < rango[e.a]!; r++) {
      vs.push({ real: -1, capa: r, s: 1, t: 1, der: 0, c: 0, tr: e.trazo, ruta: [] })
      const d = vs.length - 1
      segs.push({ de: prev, a: d, e: ei, primero, ultimo: false })
      prev = d
      primero = false
    }
    segs.push({ de: prev, a: e.a, e: ei, primero, ultimo: true })
  })

  if (vs.length > 4000 || segs.length > 6000) throw new Error('demasiado grande')

  const capas: number[][] = Array.from({ length: nCapas }, () => [])
  vs.forEach((v, i) => capas[v.capa]!.push(i))
  const altos: number[][] = vs.map(() => [])
  const bajos: number[][] = vs.map(() => [])
  for (const s of segs) {
    bajos[s.de]!.push(s.a)
    altos[s.a]!.push(s.de)
  }

  // Orden: baricentro con pasadas alternas, conservando grupos contiguos.
  const pos = vs.map(() => 0)
  const fijarPos = () => capas.forEach(c => c.forEach((v, i) => (pos[v] = i)))
  fijarPos()
  const ordenarCapa = (lista: number[], clave: number[], nivel: number): number[] => {
    const racimos = new Map<string, number[]>()
    const items: { clave: number; vs: number[] }[] = []
    for (const v of lista) {
      const gr = vs[v]!.ruta[nivel]
      if (gr) {
        if (!racimos.has(gr.id)) {
          const arr: number[] = []
          racimos.set(gr.id, arr)
          items.push({ clave: 0, vs: arr })
        }
        racimos.get(gr.id)!.push(v)
      } else items.push({ clave: clave[v]!, vs: [v] })
    }
    for (const it of items) if (it.vs.length > 1 || vs[it.vs[0]!]!.ruta[nivel]) it.clave = it.vs.reduce((a, v) => a + clave[v]!, 0) / it.vs.length
    const orden = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.clave - b.it.clave || a.i - b.i)
    const salida: number[] = []
    for (const { it } of orden) salida.push(...(it.vs.some(v => vs[v]!.ruta[nivel]) ? ordenarCapa(it.vs, clave, nivel + 1) : it.vs))
    return salida
  }
  const cruces = (): number => {
    let total = 0
    const porCapa: Seg[][] = Array.from({ length: nCapas }, () => [])
    for (const s of segs) porCapa[vs[s.de]!.capa]!.push(s)
    for (const lista of porCapa) {
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const a = lista[i]!
          const b = lista[j]!
          if ((pos[a.de]! - pos[b.de]!) * (pos[a.a]! - pos[b.a]!) < 0) total++
        }
      }
    }
    return total
  }
  let mejor = cruces()
  let mejorCapas = capas.map(c => [...c])
  const pasadas = segs.length > 1500 ? 4 : 16
  for (let it = 0; it < pasadas && mejor > 0; it++) {
    const baja = it % 2 === 0
    for (let k = 0; k < nCapas; k++) {
      const c = baja ? k : nCapas - 1 - k
      const clave = pos.slice()
      for (const v of capas[c]!) {
        const vec = baja ? altos[v]! : bajos[v]!
        if (vec.length) clave[v] = vec.reduce((a, x) => a + pos[x]!, 0) / vec.length
      }
      capas[c] = ordenarCapa(capas[c]!, clave, 0)
      capas[c]!.forEach((v, i) => (pos[v] = i))
    }
    const n = cruces()
    if (n < mejor) {
      mejor = n
      mejorCapas = capas.map(c => [...c])
    }
  }
  mejorCapas.forEach((c, i) => (capas[i] = c))
  fijarPos()

  // Redes por canal: abanicos que comparten pista.
  const redes: Red[][] = Array.from({ length: Math.max(0, nCapas - 1) }, () => [])
  const porCanal: Seg[][] = Array.from({ length: Math.max(0, nCapas - 1) }, () => [])
  for (const s of segs) porCanal[vs[s.de]!.capa]!.push(s)
  porCanal.forEach((lista, r) => {
    const abanicos = new Map<string, Red>()
    const reds: Red[] = []
    for (const s of lista) {
      const e = edges[s.e]!
      const ini = s.primero ? e.ini : ''
      const fin = s.ultimo ? e.fin : ''
      const texto = s.ultimo ? e.texto : ''
      const clave = ini ? '' : `${s.de}|${e.trazo}`
      let red = clave ? abanicos.get(clave) : undefined
      if (!red) {
        red = { capa: r, trazo: e.trazo, ini, srcs: [{ v: s.de, col: 0, fin: '', texto: '' }], tgts: [], pista: -1 }
        reds.push(red)
        if (clave) abanicos.set(clave, red)
      }
      const prev = red.tgts.find(t => t.v === s.a)
      if (prev) {
        if (texto) prev.texto = prev.texto ? `${prev.texto}, ${texto}` : texto
        if (!prev.fin) prev.fin = fin
      } else red.tgts.push({ v: s.a, col: 0, fin, texto })
    }
    // Abanico de entrada: varias fuentes simples hacia un mismo destino.
    const convergen = new Map<string, Red>()
    const finales: Red[] = []
    for (const red of reds) {
      const t = red.tgts[0]!
      const simple = red.tgts.length === 1 && !red.ini && !t.texto && vs[t.v]!.real >= 0
      if (simple) {
        const clave = `${t.v}|${red.trazo}|${t.fin}`
        const previa = convergen.get(clave)
        if (previa) {
          previa.srcs.push(red.srcs[0]!)
          continue
        }
        convergen.set(clave, red)
      }
      finales.push(red)
    }
    redes[r] = finales
  })

  const entradas: Red[][] = vs.map(() => [])
  const salidas: Red[][] = vs.map(() => [])
  for (const lista of redes) {
    for (const red of lista) {
      for (const s of red.srcs) salidas[s.v]!.push(red)
      for (const t of red.tgts) entradas[t.v]!.push(red)
    }
  }

  // Tamaños finales: la caja crece para dar sitio a los puertos.
  const anchoEtiqueta = (v: number) => Math.max(0, ...entradas[v]!.flatMap(r => r.tgts.filter(t => t.v === v).map(t => ancho(t.texto))))
  const sepEntrada = (v: number) => {
    if (horiz) return 2
    const w = anchoEtiqueta(v)
    return Math.max(3, w ? w + 3 : 3)
  }
  vs.forEach((v, i) => {
    if (v.real < 0) return
    const { an, al } = tamano[v.real]!
    const base = horiz ? al : an
    const nE = entradas[i]!.length
    const nS = salidas[i]!.length
    const req = Math.max(nE > 1 ? (nE - 1) * sepEntrada(i) + 3 : 0, nS > 1 ? (nS - 1) * 3 + 3 : 0)
    v.s = Math.max(base, req)
    if (v.s % 2 === 0) v.s++
    v.t = horiz ? an : al
    if (!horiz) {
      const w = anchoEtiqueta(i)
      if (w) {
        const off = Math.floor(((nE - 1) * sepEntrada(i)) / 2)
        v.der = Math.max(0, off + 2 + w - Math.floor(v.s / 2))
      }
    }
  })

  const conGrupos = g.grupos.some(gr => nodos.some(n => rutaGrupo(n.grupo).includes(gr)))
  const altura = new Map<Grupo, number>()
  for (const gr of g.grupos) altura.set(gr, 1)
  for (const gr of g.grupos) {
    let h = 1
    for (let x = gr.padre; x; x = x.padre) {
      h++
      altura.set(x, Math.max(altura.get(x) ?? 1, h))
    }
  }
  const maxAlt = conGrupos ? Math.max(1, ...altura.values()) : 0

  // Un grupo en columna única se ensancha para que su título quepa.
  if (!horiz) {
    for (const gr of g.grupos) {
      const miembros = vs.map((v, i) => ({ v, i })).filter(({ v }) => v.ruta.includes(gr))
      const capasUsadas = new Set(miembros.map(({ v }) => v.capa))
      if (!miembros.length || capasUsadas.size !== miembros.length) continue
      for (const { v } of miembros) v.der = Math.max(v.der, ancho(gr.titulo) + 6 - v.s)
    }
  }

  // Coordenadas transversales
  const hw = (v: number) => Math.floor(vs[v]!.s / 2)
  const separacion = (a: number, b: number): number => {
    const dummy = vs[a]!.real < 0 || vs[b]!.real < 0
    let hueco = horiz ? (dummy ? 1 : 1) : dummy ? 2 : 3
    const ra = vs[a]!.ruta[0]
    const rb = vs[b]!.ruta[0]
    if (ra !== rb) hueco += 2 * maxAlt + 1
    return hw(a) + vs[a]!.der + 1 + hueco + hw(b)
  }
  capas.forEach(capa => {
    let x = 0
    capa.forEach((v, i) => {
      vs[v]!.c = i === 0 ? hw(v) : x + separacion(capa[i - 1]!, v)
      x = vs[v]!.c
    })
  })
  const pesoDe = (v: number) => (vs[v]!.real < 0 ? 3 : 1)
  const pasar = (c: number, vecinos: number[][]) => {
    const capa = capas[c]!
    if (!capa.length) return
    const deseo = capa.map(v => {
      // Dentro de un subgrafo manda el vecino del mismo grupo: el marco queda compacto.
      const propios = vs[v]!.ruta[0] ? vecinos[v]!.filter(x => vs[x]!.ruta[0] === vs[v]!.ruta[0]) : []
      const lista = propios.length ? propios : vecinos[v]!
      return lista.length ? lista.reduce((a, x) => a + vs[x]!.c, 0) / lista.length : vs[v]!.c
    })
    const sep = capa.slice(0, -1).map((v, i) => separacion(v, capa[i + 1]!))
    const nuevo = acomodar(deseo, sep, capa.map(pesoDe))
    capa.forEach((v, i) => (vs[v]!.c = nuevo[i]!))
  }
  for (let it = 0; it < 10; it++) {
    for (let c = 1; c < nCapas; c++) pasar(c, altos)
    for (let c = nCapas - 2; c >= 0; c--) pasar(c, bajos)
  }
  for (let c = 1; c < nCapas; c++) pasar(c, altos)

  // Origen con margen.
  const margenU = 2 + maxAlt + 2 * maxAlt
  let minU = Infinity
  vs.forEach((v, i) => (minU = Math.min(minU, v.c - hw(i))))
  if (!Number.isFinite(minU)) minU = 0
  vs.forEach(v => (v.c += margenU - minU))
  let maxU = 0
  vs.forEach((v, i) => (maxU = Math.max(maxU, v.c + hw(i) + v.der)))

  // Puertos
  const repartir = (lista: Puerto[], c: number, sep: number, clave: (p: Puerto) => number) => {
    const orden = lista.map((p, i) => ({ p, i })).sort((a, b) => clave(a.p) - clave(b.p) || a.i - b.i)
    const n = orden.length
    orden.forEach(({ p }, i) => {
      p.col = c + Math.round((i - (n - 1) / 2) * sep)
    })
  }
  const asignarPuertos = () => {
    vs.forEach((v, i) => {
      const ent: Puerto[] = entradas[i]!.flatMap(r => r.tgts.filter(t => t.v === i))
      const sal: Puerto[] = salidas[i]!.flatMap(r => r.srcs.filter(s => s.v === i))
      const redDe = new Map<Puerto, Red>()
      for (const r of entradas[i]!) for (const t of r.tgts) if (t.v === i) redDe.set(t, r)
      for (const r of salidas[i]!) for (const s of r.srcs) if (s.v === i) redDe.set(s, r)
      repartir(ent, v.c, sepEntrada(i), p => {
        const r = redDe.get(p)!
        return r.srcs.reduce((a, s) => a + vs[s.v]!.c, 0) / r.srcs.length
      })
      repartir(sal, v.c, 3, p => {
        const r = redDe.get(p)!
        return r.tgts.reduce((a, t) => a + vs[t.v]!.c, 0) / r.tgts.length
      })
    })
  }
  asignarPuertos()
  // Endereza las aristas largas: cada falso nodo se alinea con el puerto real vecino.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    for (const capa of capas) {
      capa.forEach((v, i) => {
        if (vs[v]!.real >= 0) return
        const puertos = [...entradas[v]!.flatMap(r => r.srcs), ...salidas[v]!.flatMap(r => r.tgts)].filter(p => vs[p.v]!.real >= 0)
        for (const p of puertos) {
          const ant = capa[i - 1]
          const sig = capa[i + 1]
          if (ant !== undefined && p.col < vs[ant]!.c + separacion(ant, v)) continue
          if (sig !== undefined && vs[sig]!.c < p.col + separacion(v, sig)) continue
          vs[v]!.c = p.col
          break
        }
      })
    }
    asignarPuertos()
  }

  // Pistas horizontales por canal.
  const numPistas: number[] = redes.map(lista => {
    const conH = lista.filter(r => {
      const cols = [...r.srcs, ...r.tgts].map(p => p.col)
      return Math.min(...cols) !== Math.max(...cols)
    })
    const rangoCol = (r: Red) => {
      const cols = [...r.srcs, ...r.tgts].map(p => p.col)
      return [Math.min(...cols), Math.max(...cols)] as const
    }
    const antes = new Map<Red, Set<Red>>(conH.map(r => [r, new Set<Red>()]))
    for (const a of conH) {
      for (const b of conH) {
        if (a !== b && a.srcs.some(s => b.tgts.some(t => t.col === s.col))) antes.get(b)!.add(a)
      }
    }
    const pistas: (readonly [number, number])[][] = []
    const pend = new Set(conH)
    while (pend.size) {
      const libres = [...pend].filter(r => [...antes.get(r)!].every(a => !pend.has(a)))
      const candidatos = libres.length ? libres : [...pend]
      candidatos.sort((a, b) => rangoCol(a)[0] - rangoCol(b)[0])
      const r = candidatos[0]!
      pend.delete(r)
      // Ciclo de restricciones: se corre un puerto de llegada para romperlo.
      if (!libres.length) {
        for (const t of r.tgts) {
          if (vs[t.v]!.real < 0 || ![...pend].some(a => a.srcs.some(s => s.col === t.col))) continue
          const usados = new Set(lista.flatMap(x => [...x.srcs, ...x.tgts]).map(p => p.col))
          const borde = hw(t.v) - 1
          const c = vs[t.v]!.c
          const nueva = [1, -1, 2, -2, 3, -3].map(d => t.col + d).find(col => !usados.has(col) && Math.abs(col - c) <= borde)
          if (nueva !== undefined) t.col = nueva
        }
        for (const a of [...antes.get(r)!]) if (!a.srcs.some(s => r.tgts.some(t => t.col === s.col))) antes.get(r)!.delete(a)
      }
      const [ini, fin] = rangoCol(r)
      let k = 0
      for (const a of antes.get(r)!) if (a.pista >= 0) k = Math.max(k, a.pista + 1)
      while (pistas[k]?.some(([x, y]) => ini <= y + 1 && x <= fin + 1)) k++
      if (!pistas[k]) pistas[k] = []
      pistas[k]!.push([ini, fin])
      r.pista = k
    }
    return pistas.length
  })

  // Coordenadas a lo largo de las capas
  const grosor = capas.map(c => Math.max(1, ...c.map(v => vs[v]!.t)))
  const inicio: number[] = []
  const conIni = redes.map(l => l.some(r => r.ini))
  const zonaEt = redes.map(l => Math.max(0, ...l.flatMap(r => r.tgts.map(t => ancho(t.texto)))))
  const reservaArriba = (c: number) => (conGrupos ? maxAlt : conIni[c] || (horiz && numPistas[c]!) ? 1 : 0)
  const grosorZona = (c: number) => (zonaEt[c]! === 0 ? 0 : horiz ? zonaEt[c]! + 2 : 1)
  let vAcum = 1 + maxAlt + (conGrupos ? maxAlt : 0)
  capas.forEach((_, c) => {
    inicio[c] = vAcum
    vAcum += grosor[c]!
    if (c < nCapas - 1) {
      let canal = reservaArriba(c) + numPistas[c]! + grosorZona(c) + maxAlt + 1
      if (horiz && canal < 3) canal = 3
      vAcum += canal
    }
  })
  const totalV = vAcum + maxAlt + 1
  const totalU = maxU + margenU + 2
  if (totalV > MAX_LADO || totalU > MAX_LADO) throw new Error('demasiado grande')
  const lienzo = horiz ? new Lienzo(totalU, totalV) : new Lienzo(totalV, totalU)
  const real = (v: number, u: number): [number, number] => {
    if (dir === 'TD') return [v, u]
    if (dir === 'BT') return [totalV - 1 - v, u]
    if (dir === 'LR') return [u, v]
    return [u, totalV - 1 - v]
  }
  const trazar = (v1: number, u1: number, v2: number, u2: number, tr: Trazo) => {
    const [f1, c1] = real(v1, u1)
    const [f2, c2] = real(v2, u2)
    lienzo.linea(f1, c1, f2, c2, tr)
  }
  const cabezas = { flecha: ['▼', '▲', '▶', '◀'], x: ['×', '×', '×', '×'], o: ['○', '○', '○', '○'], tri: ['▽', '△', '▷', '◁'], rombo: ['◇', '◇', '◇', '◇'], lleno: ['◆', '◆', '◆', '◆'] }
  const glifoCabeza = (c: Cabeza, avance: boolean): string => {
    if (!c) return ''
    const adelante = dir === 'TD' ? 0 : dir === 'BT' ? 1 : dir === 'LR' ? 2 : 3
    const atras = [1, 0, 3, 2][adelante]!
    return cabezas[c][avance ? adelante : atras]!
  }
  const ponerCabeza = (v: number, u: number, c: Cabeza, avance: boolean) => {
    const [f, x] = real(v, u)
    lienzo.poner(f, x, glifoCabeza(c, avance))
  }

  const finBanda = (c: number) => inicio[c]! + grosor[c]!
  const lejano = (v: number): number => {
    const x = vs[v]!
    return x.real >= 0 ? inicio[x.capa]! + x.t - 1 : finBanda(x.capa) - 1
  }
  vs.forEach(v => {
    if (v.real < 0) trazar(inicio[v.capa]!, v.c, finBanda(v.capa) - 1, v.c, v.tr)
  })

  const pendientesEt: { red: Red; t: Puerto; z: number; c: number }[] = []
  redes.forEach((lista, c) => {
    const base = finBanda(c) + reservaArriba(c)
    const cerca = inicio[c + 1]!
    const flecha = cerca - 1
    for (const red of lista) {
      const pistaV = base + red.pista
      for (const s of red.srcs) {
        let desde = lejano(s.v)
        if (red.ini) {
          desde += 1
          ponerCabeza(desde, s.col, red.ini, false)
        }
        s.fin = ''
        if (red.pista < 0) continue
        trazar(desde, s.col, pistaV, s.col, red.trazo)
      }
      for (const t of red.tgts) {
        const hasta = t.fin ? flecha : cerca
        if (red.pista < 0) {
          const s = red.srcs[0]!
          let desde = lejano(s.v)
          if (red.ini) desde += 1
          trazar(desde, s.col, hasta, t.col, red.trazo)
        } else trazar(pistaV, t.col, hasta, t.col, red.trazo)
        if (t.fin) ponerCabeza(flecha, t.col, t.fin, true)
        if (t.texto) pendientesEt.push({ red, t, z: base + numPistas[c]!, c })
      }
      if (red.pista >= 0) {
        const cols = [...red.srcs, ...red.tgts].map(p => p.col)
        trazar(pistaV, Math.min(...cols), pistaV, Math.max(...cols), red.trazo)
      }
    }
  })

  // Marcos de subgrafos (van al fondo: las líneas pasan por encima).
  const leyenda: string[] = []
  for (const gr of g.grupos) {
    const miembros = vs.map((v, i) => ({ v, i })).filter(({ v }) => v.real >= 0 && v.ruta.includes(gr))
    if (!miembros.length) continue
    const alt = altura.get(gr) ?? 1
    const v1 = Math.min(...miembros.map(({ v }) => inicio[v.capa]!)) - 1 - alt
    const v2 = Math.max(...miembros.map(({ v }) => finBanda(v.capa))) - 1 + alt
    const u1 = Math.min(...miembros.map(({ v, i }) => v.c - hw(i))) - 1 - alt
    const u2 = Math.max(...miembros.map(({ v, i }) => v.c + hw(i) + v.der)) + 1 + alt
    // Un nodo ajeno dentro del marco lo haría engañoso.
    const invade = vs.some((v, i) => v.real >= 0 && !v.ruta.includes(gr) && inicio[v.capa]! + v.t - 1 >= v1 && inicio[v.capa]! <= v2 && v.c + hw(i) >= u1 && v.c - hw(i) <= u2)
    if (invade) {
      leyenda.push(`${recortar(gr.titulo, 30)}: ${miembros.map(({ v }) => nodos[v.real]!.lineas[0]).join(', ')}`)
      continue
    }
    const [fa, ca] = real(v1, u1)
    const [fb, cb] = real(v2, u2)
    const [f1, f2] = fa < fb ? [fa, fb] : [fb, fa]
    const [c1, c2] = ca < cb ? [ca, cb] : [cb, ca]
    for (let x = c1; x <= c2; x++) {
      lienzo.fondo[lienzo.idx(f1, x)] = '┄'
      lienzo.fondo[lienzo.idx(f2, x)] = '┄'
    }
    for (let y = f1; y <= f2; y++) {
      lienzo.fondo[lienzo.idx(y, c1)] = '┆'
      lienzo.fondo[lienzo.idx(y, c2)] = '┆'
    }
    lienzo.fondo[lienzo.idx(f1, c1)] = '┌'
    lienzo.fondo[lienzo.idx(f1, c2)] = '┐'
    lienzo.fondo[lienzo.idx(f2, c1)] = '└'
    lienzo.fondo[lienzo.idx(f2, c2)] = '┘'
    const titulo = ` ${recortar(gr.titulo, Math.max(4, c2 - c1 - 5))} `
    const w = ancho(titulo)
    for (let x = c1 + 1; x + w <= c2 - 1; x++) {
      if (lienzo.libre(f1, x, w)) {
        lienzo.poner(f1, x, titulo)
        break
      }
    }
  }

  // Cajas al final: sus bordes recogen las uniones de las líneas.
  vs.forEach((v, i) => {
    if (v.real < 0) return
    const n = nodos[v.real]!
    const [fa, ca] = real(inicio[v.capa]!, v.c - hw(i))
    const [fb, cb] = real(inicio[v.capa]! + v.t - 1, v.c + hw(i))
    const f = Math.min(fa, fb)
    const c = Math.min(ca, cb)
    const al = Math.abs(fb - fa) + 1
    const an = Math.abs(cb - ca) + 1
    if (n.forma === 'punto') {
      lienzo.poner(f, c, textoNodo[v.real]![0] ?? '●')
      return
    }
    lienzo.caja(f, c, al, an, n.forma)
    const lineas = textoNodo[v.real]!
    const secciones = n.secciones ?? []
    const usado = lineas.length + secciones.reduce((a, s) => a + (s.length ? s.length + 1 : 0), 0)
    let y = f + 1 + Math.max(0, Math.floor((al - 2 - usado) / 2))
    for (const l of lineas) {
      lienzo.poner(y++, c + Math.floor((an - ancho(l)) / 2), l)
    }
    for (const sec of secciones) {
      if (!sec.length) continue
      lienzo.linea(y, c, y, c + an - 1)
      y++
      for (const l of sec) lienzo.poner(y++, c + 2, l)
    }
  })

  // Etiquetas en el canal
  const colocar = (f: number, c: number, s: string) => {
    if (!lienzo.libre(f, c, ancho(s))) return false
    lienzo.poner(f, c, s)
    return true
  }
  for (const { t, z, c } of pendientesEt) {
    const w = ancho(t.texto)
    if (horiz) {
      const zi = dir === 'LR' ? z + 1 : totalV - 1 - (z + grosorZona(c) - 1)
      const fila = t.col
      if (colocar(fila - 1, zi, t.texto) || colocar(fila + 1, zi, t.texto)) continue
      for (let d = 2; d < 8; d++) if (colocar(fila - d, zi, t.texto) || colocar(fila + d, zi, t.texto)) break
    } else {
      const [f, col] = real(z, t.col)
      if (colocar(f, col + 2, t.texto) || colocar(f, col - 1 - w, t.texto)) continue
      for (let d = 1; d < 6; d++) if (colocar(f - d, col + 2, t.texto) || colocar(f + d, col + 2, t.texto)) break
    }
  }

  const salida = lienzo.salida()
  if (leyenda.length) salida.push('', ...leyenda)
  return salida
}

function dibujarGrafo(g: Grafo): string[] {
  const anchoDe = (l: string[]) => Math.max(0, ...l.map(ancho))
  let r: string[]
  try {
    r = maquetarGrafo(g, g.dir)
    if (anchoDe(r) > ANCHO_COMODO) {
      const horiz = g.dir === 'LR' || g.dir === 'RL'
      const otro = maquetarGrafo(g, horiz ? 'TD' : 'LR')
      if (anchoDe(otro) < anchoDe(r)) r = otro
    }
  } catch {
    // Grafo imposible de maquetar: se listan sus relaciones.
    const nombre = (id: string) => g.nodos.get(id)?.lineas.join(' ') ?? id
    const filas = g.enlaces.slice(0, 38).map(e => `${nombre(e.de)} → ${nombre(e.a)}${e.texto ? ` (${e.texto})` : ''}`)
    if (g.enlaces.length > 38) filas.push(`… y ${g.enlaces.length - 38} relaciones más`)
    return ficha('Diagrama demasiado grande', filas)
  }
  if (g.truncado) r = [...r, '', `… y ${g.truncado} nodos más`]
  return r
}

// Parser de flowchart

function trocearSentencias(fuente: string): string[] {
  const salida: string[] = []
  for (const linea of fuente.split('\n')) {
    let act = ''
    let comillas = false
    for (const ch of linea) {
      if (ch === '"') comillas = !comillas
      if (ch === ';' && !comillas) {
        salida.push(act)
        act = ''
      } else act += ch
    }
    salida.push(act)
  }
  return salida.map(x => x.trim()).filter(Boolean)
}

const FORMAS: [string, string[], Forma][] = [
  ['(((', [')))'], 'circulo'],
  ['([', ['])'], 'redondo'],
  ['[[', [']]'], 'doble'],
  ['[(', [')]'], 'redondo'],
  ['((', ['))'], 'circulo'],
  ['{{', ['}}'], 'rombo'],
  ['[/', ['/]', '\\]'], 'rect'],
  ['[\\', ['\\]', '/]'], 'rect'],
  ['(', [')'], 'redondo'],
  ['[', [']'], 'rect'],
  ['{', ['}'], 'rombo'],
  ['>', [']'], 'rect'],
]

type RefNodo = { id: string; texto?: string; forma?: Forma; fin: number }

function parseRefNodo(s: string, p0: number): RefNodo | null {
  let p = p0
  while (s[p] === ' ') p++
  let id = ''
  if (s[p] === '"') {
    const c = s.indexOf('"', p + 1)
    if (c < 0) return null
    id = s.slice(p + 1, c)
    p = c + 1
  } else {
    const re = /[\p{L}\p{N}_]+(?:[-.:][\p{L}\p{N}_]+)*/uy
    re.lastIndex = p
    const m = re.exec(s)
    if (!m) return null
    id = m[0]
    p += id.length
  }
  let texto: string | undefined
  let forma: Forma | undefined
  for (const [abre, cierres, f] of FORMAS) {
    if (!s.startsWith(abre, p)) continue
    const ini = p + abre.length
    let q = ini
    let fin = -1
    let cierre = ''
    if (s[q] === '"') {
      const c = s.indexOf('"', q + 1)
      if (c > 0) q = c + 1
    }
    const unCar = abre[abre.length - 1]!
    let prof = 0
    for (; q < s.length; q++) {
      if (s.startsWith(abre, q) && abre.length === 1 && unCar !== '>') prof++
      const cc = cierres.find(x => s.startsWith(x, q))
      if (cc) {
        if (prof === 0) {
          fin = q
          cierre = cc
          break
        }
        prof--
      }
    }
    if (fin < 0) continue
    texto = s.slice(ini, fin)
    forma = f
    p = fin + cierre.length
    break
  }
  if (s.startsWith(':::', p)) {
    const re = /:::[\w-]+/y
    re.lastIndex = p
    const m = re.exec(s)
    if (m) p += m[0].length
  }
  return { id, texto, forma, fin: p }
}

type RefEnlace = { trazo: Trazo; ini: Cabeza; fin: Cabeza; texto: string; pos: number }

function parseEnlace(s: string, p0: number): RefEnlace | null {
  let p = p0
  while (s[p] === ' ') p++
  let ini: Cabeza = ''
  if (s[p] === '<' && /[-=]/.test(s[p + 1] ?? '')) {
    ini = 'flecha'
    p++
  } else if ((s[p] === 'x' || s[p] === 'o') && /[-=]/.test(s[p + 1] ?? '') && p > 0 && s[p - 1] === ' ') {
    ini = s[p] === 'x' ? 'x' : 'o'
    p++
  }
  const re = /-\.+-?|-{2,}|={2,}/y
  re.lastIndex = p
  const m = re.exec(s)
  if (!m) return null
  const op = m[0]
  let q = p + op.length
  const trazo: Trazo = op[1] === '.' ? 'p' : op[0] === '=' ? 'g' : 'n'
  const cabeza = (i: number): [Cabeza, number] => {
    const c = s[i]
    const sig = s[i + 1] ?? ' '
    if (c === '>') return ['flecha', 1]
    if ((c === 'x' || c === 'o') && !/[\p{L}\p{N}_]/u.test(sig)) return [c === 'x' ? 'x' : 'o', 1]
    return ['', 0]
  }
  let [fin, adv] = cabeza(q)
  q += adv
  let texto = ''
  if (!fin && (op === '--' || op === '==' || op === '-.')) {
    const reC = op === '-.' ? /\.+-[>xo]?/g : op === '==' ? /={2,}[>xo]?/g : /-{2,}[>xo]?/g
    let desde = q
    while (s[desde] === ' ') desde++
    if (s[desde] === '"') {
      const c = s.indexOf('"', desde + 1)
      if (c > 0) desde = c + 1
    }
    reC.lastIndex = desde
    const mc = reC.exec(s)
    if (mc) {
      texto = s.slice(q, mc.index).trim()
      const u = mc[0][mc[0].length - 1]!
      fin = u === '>' ? 'flecha' : u === 'x' ? 'x' : u === 'o' ? 'o' : ''
      q = mc.index + mc[0].length
    }
  }
  let r = q
  while (s[r] === ' ') r++
  if (s[r] === '|') {
    const c = s.indexOf('|', r + 1)
    if (c > 0) {
      texto = s.slice(r + 1, c).trim()
      q = c + 1
    }
  }
  return { trazo, ini, fin, texto: texto ? textoUnaLinea(texto, MAX_ETIQUETA) : '', pos: q }
}

const IGNORADAS = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/i

function parseFlowchart(lineas: string[], cabecera: string): Grafo {
  const mdir = /^\s*(?:graph|flowchart)(?:-elk)?\s+(TD|TB|LR|RL|BT)/i.exec(cabecera)
  const d = (mdir?.[1] ?? 'TD').toUpperCase()
  const g = nuevoGrafo(d === 'TB' ? 'TD' : (d as Dir))
  const pila: Grupo[] = []
  let nGrupo = 0
  const actual = () => pila[pila.length - 1] ?? null
  const refGrupo = (s: string, p: number) => {
    const lista: RefNodo[] = []
    let q = p
    for (;;) {
      const n = parseRefNodo(s, q)
      if (!n) return lista.length ? { lista, fin: q } : null
      lista.push(n)
      q = n.fin
      let r = q
      while (s[r] === ' ') r++
      if (s[r] === '&') q = r + 1
      else return { lista, fin: q }
    }
  }
  for (const st of trocearSentencias(lineas.join('\n')).slice(0, 30000)) {
    const msg = /^subgraph\b\s*(.*)$/i.exec(st)
    if (msg) {
      const resto = msg[1]!.trim()
      nGrupo++
      let id = resto || `grupo${nGrupo}`
      let titulo = resto
      const mt = /^([^[\s"]+)\s*\[(.*)\]$/.exec(resto)
      if (mt) {
        id = mt[1]!
        titulo = mt[2]!
      }
      const gr: Grupo = { id, titulo: textoUnaLinea(titulo, 40) || id, padre: actual() }
      g.grupos.push(gr)
      pila.push(gr)
      continue
    }
    if (/^end\b/i.test(st) && st.toLowerCase() === 'end') {
      pila.pop()
      continue
    }
    if (IGNORADAS.test(st)) continue
    const primero = refGrupo(st, 0)
    if (!primero) continue
    for (const n of primero.lista) definirNodo(g, n.id, actual(), n.texto, n.forma)
    let prev = primero
    let pos = primero.fin
    for (;;) {
      const enlace = parseEnlace(st, pos)
      if (!enlace) break
      const sig = refGrupo(st, enlace.pos)
      if (!sig) break
      for (const n of sig.lista) definirNodo(g, n.id, actual(), n.texto, n.forma)
      for (const a of prev.lista) {
        for (const b of sig.lista) {
          if (g.enlaces.length < MAX_ENLACES) g.enlaces.push({ de: a.id, a: b.id, trazo: enlace.trazo, ini: enlace.ini, fin: enlace.fin, texto: enlace.texto })
        }
      }
      prev = sig
      pos = sig.fin
    }
  }
  podarYResolverGrupos(g)
  return g
}

/** Un enlace a un subgrafo va a su primer miembro; se limita el tamaño. */
function podarYResolverGrupos(g: Grafo): void {
  const primeroDe = new Map<string, string>()
  for (const gr of g.grupos) {
    for (const n of g.nodos.values()) {
      if (n.grupo && rutaGrupo(n.grupo).includes(gr) && !g.grupos.some(x => x.id === n.id)) {
        primeroDe.set(gr.id, n.id)
        break
      }
    }
  }
  for (const e of g.enlaces) {
    e.de = primeroDe.get(e.de) ?? e.de
    e.a = primeroDe.get(e.a) ?? e.a
  }
  for (const gr of g.grupos) if (primeroDe.has(gr.id)) g.nodos.delete(gr.id)
  if (g.nodos.size > MAX_NODOS) {
    const ids = [...g.nodos.keys()]
    g.truncado = ids.length - MAX_NODOS
    for (const id of ids.slice(MAX_NODOS)) g.nodos.delete(id)
    g.enlaces = g.enlaces.filter(e => g.nodos.has(e.de) && g.nodos.has(e.a))
  }
}

// Diagrama de estados

function parseEstados(lineas: string[]): Grafo {
  const g = nuevoGrafo('TD')
  const pila: Grupo[] = []
  let enNota = false
  const nodoEspecial = (txt: string, de: boolean): string => {
    if (txt !== '[*]') return txt
    const id = `${de ? '__ini' : '__fin'}${pila.length}`
    const n = nodoDe(g, id, pila[pila.length - 1] ?? null)
    n.forma = 'punto'
    n.lineas = [de ? '●' : '◉']
    return id
  }
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (enNota) {
      if (/^end note/i.test(t)) enNota = false
      continue
    }
    if (/^note\b/i.test(t)) {
      if (!t.includes(':')) enNota = true
      continue
    }
    const md = /^direction\s+(TD|TB|LR|RL|BT)/i.exec(t)
    if (md) {
      const d = md[1]!.toUpperCase()
      g.dir = d === 'TB' ? 'TD' : (d as Dir)
      continue
    }
    if (t === '}') {
      pila.pop()
      continue
    }
    if (t === '--') continue
    const compuesto = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w-]+)\s*\{$/.exec(t)
    if (compuesto) {
      const gr: Grupo = { id: compuesto[2]!, titulo: textoUnaLinea(compuesto[1] ?? compuesto[2]!, 40), padre: pila[pila.length - 1] ?? null }
      g.grupos.push(gr)
      pila.push(gr)
      continue
    }
    const decl = /^state\s+"([^"]+)"\s+as\s+([\w-]+)/.exec(t)
    if (decl) {
      definirNodo(g, decl[2]!, pila[pila.length - 1] ?? null, decl[1]!, 'redondo')
      continue
    }
    const especial = /^state\s+([\w-]+)\s*<<(\w+)>>/.exec(t)
    if (especial) {
      const n = nodoDe(g, especial[1]!, pila[pila.length - 1] ?? null)
      if (especial[2] === 'choice') {
        n.forma = 'rombo'
        n.lineas = ['?']
        n.definido = true
      } else n.forma = 'rect'
      continue
    }
    const tr = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.*))?$/.exec(t)
    if (tr) {
      const de = nodoEspecial(tr[1]!.trim(), true)
      const a = nodoEspecial(tr[2]!.trim(), false)
      for (const id of [de, a]) if (!id.startsWith('__')) nodoDe(g, id, pila[pila.length - 1] ?? null).forma = g.nodos.get(id)?.forma === 'rombo' ? 'rombo' : 'redondo'
      g.enlaces.push({ de, a, trazo: 'n', ini: '', fin: 'flecha', texto: tr[3] ? textoUnaLinea(tr[3], MAX_ETIQUETA) : '' })
      continue
    }
    const desc = /^([\w-]+)\s*:\s*(.+)$/.exec(t)
    if (desc) {
      definirNodo(g, desc[1]!, pila[pila.length - 1] ?? null, desc[2]!, 'redondo')
      continue
    }
    if (/^[\w-]+$/.test(t)) nodoDe(g, t, pila[pila.length - 1] ?? null).forma = 'redondo'
  }
  podarYResolverGrupos(g)
  return g
}

// Diagrama de clases

const rel_clase = /^("?[\w.~-]+"?)\s*(?:"([^"]*)"\s*)?(<\|--|<\|\.\.|\*--|o--|--\|>|\.\.\|>|--\*|--o|-->|<--|\.\.>|<\.\.|--|\.\.)\s*(?:"([^"]*)"\s*)?("?[\w.~-]+"?)\s*(?::\s*(.*))?$/

function parseClases(lineas: string[]): Grafo {
  const g = nuevoGrafo('TD')
  const miembros = new Map<string, { attrs: string[]; metodos: string[] }>()
  const limpia = (s: string) => s.replace(/~([^~]*)~/g, '<$1>').replace(/^"|"$/g, '')
  const clase = (raw: string) => {
    const id = raw.replace(/^"|"$/g, '').replace(/~.*$/, '')
    const n = nodoDe(g, id, null)
    n.lineas = [recortar(limpia(raw), MAX_TEXTO)]
    n.definido = true
    if (!miembros.has(id)) miembros.set(id, { attrs: [], metodos: [] })
    return id
  }
  const agregar = (id: string, m: string) => {
    const texto = recortar(limpia(m.trim()).replace(/[$*]$/, ''), 34)
    if (texto) (texto.includes('(') ? miembros.get(id)!.metodos : miembros.get(id)!.attrs).push(texto)
  }
  let dentro: string | null = null
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    if (dentro) {
      if (t.endsWith('}')) {
        if (t.length > 1) agregar(dentro, t.slice(0, -1))
        dentro = null
      } else if (!/^<<.*>>$/.test(t)) agregar(dentro, t)
      continue
    }
    const md = /^direction\s+(TD|TB|LR|RL|BT)/i.exec(t)
    if (md) {
      const d = md[1]!.toUpperCase()
      g.dir = d === 'TB' ? 'TD' : (d as Dir)
      continue
    }
    if (/^(note|link|click|callback|style|classDef|namespace)\b/i.test(t) || t.startsWith('<<')) continue
    const mc = /^class\s+([\w.~-]+|"[^"]+")(?:\s*\[.*?\])?\s*(\{)?(.*)$/.exec(t)
    if (mc) {
      const id = clase(mc[1]!)
      if (mc[2]) {
        dentro = id
        const resto = mc[3]!.trim()
        if (resto.endsWith('}')) {
          dentro = null
          if (resto.length > 1) agregar(id, resto.slice(0, -1))
        } else if (resto) agregar(id, resto)
      }
      continue
    }
    const rel = rel_clase.exec(t)
    if (rel) {
      const de = clase(rel[1]!)
      const a = clase(rel[5]!)
      const op = rel[3]!
      const tabla: Record<string, [Cabeza, Cabeza, Trazo]> = {
        '<|--': ['tri', '', 'n'],
        '<|..': ['tri', '', 'p'],
        '*--': ['lleno', '', 'n'],
        'o--': ['rombo', '', 'n'],
        '--|>': ['', 'tri', 'n'],
        '..|>': ['', 'tri', 'p'],
        '--*': ['', 'lleno', 'n'],
        '--o': ['', 'rombo', 'n'],
        '-->': ['', 'flecha', 'n'],
        '<--': ['flecha', '', 'n'],
        '..>': ['', 'flecha', 'p'],
        '<..': ['flecha', '', 'p'],
        '--': ['', '', 'n'],
        '..': ['', '', 'p'],
      }
      const [ini, fin, trazo] = tabla[op]!
      const partes = [rel[2], rel[6] ? textoUnaLinea(rel[6], MAX_ETIQUETA) : undefined, rel[4]].filter(Boolean)
      g.enlaces.push({ de, a, trazo, ini, fin, texto: recortar(partes.join(' '), MAX_ETIQUETA) })
      continue
    }
    const mm = /^([\w.~-]+)\s*:\s*(.+)$/.exec(t)
    if (mm) {
      const id = clase(mm[1]!)
      agregar(id, mm[2]!)
    }
  }
  for (const [id, m] of miembros) {
    const n = g.nodos.get(id)
    if (n) n.secciones = [m.attrs, m.metodos]
  }
  podarYResolverGrupos(g)
  return g
}

// Diagrama entidad-relación

const CARD: Record<string, string> = { '||': '1', '|o': '0..1', 'o|': '0..1', '}|': '1..n', '|{': '1..n', '}o': '0..n', 'o{': '0..n' }

function parseEr(lineas: string[]): Grafo {
  const g = nuevoGrafo('TD')
  const attrs = new Map<string, string[]>()
  const entidad = (id: string) => {
    const lim = id.replace(/^"|"$/g, '')
    const n = nodoDe(g, lim, null)
    n.definido = true
    if (!attrs.has(lim)) attrs.set(lim, [])
    return lim
  }
  let dentro: string | null = null
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    if (dentro) {
      if (t === '}') dentro = null
      else {
        const m = /^([\w()[\],.-]+)\s+([\w-]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?/.exec(t)
        attrs.get(dentro)!.push(recortar(m ? `${m[1]} ${m[2]}${m[3] ? ` ${m[3]}` : ''}` : textoUnaLinea(t, 34), 34))
      }
      continue
    }
    const mo = /^("?[\w-]+"?)\s*\{$/.exec(t)
    if (mo) {
      dentro = entidad(mo[1]!)
      continue
    }
    const r = /^("?[\w-]+"?)\s+([|}o][|o])(--|\.\.)([|o][|{o])\s+("?[\w-]+"?)\s*(?::\s*(.*))?$/.exec(t)
    if (r) {
      const de = entidad(r[1]!)
      const a = entidad(r[5]!)
      const cards = `${CARD[r[2]!] ?? '?'} : ${CARD[r[4]!] ?? '?'}`
      const verbo = r[6] ? textoUnaLinea(r[6].replace(/^"|"$/g, ''), MAX_ETIQUETA) : ''
      g.enlaces.push({ de, a, trazo: r[3] === '..' ? 'p' : 'n', ini: '', fin: 'flecha', texto: recortar(verbo ? `${verbo} (${cards})` : cards, MAX_ETIQUETA) })
      continue
    }
    if (/^"?[\w-]+"?$/.test(t)) entidad(t)
  }
  for (const [id, a] of attrs) {
    const n = g.nodos.get(id)
    if (n) n.secciones = [a]
  }
  podarYResolverGrupos(g)
  return g
}

// Diagrama de secuencia

type Evento =
  | { t: 'm'; de: number; a: number; lineas: string[]; trazo: Trazo; cab: string }
  | { t: 'n'; pos: 'over' | 'left' | 'right'; a: number; b: number; lineas: string[] }
  | { t: 'abre'; nombre: string; texto: string }
  | { t: 'sep'; texto: string }
  | { t: 'cierra' }

const FLECHA_SEC = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*(.+?)\s*(?::\s*(.*))?$/

function dibujarSecuencia(lineas: string[]): Resultado {
  const ps: { id: string; texto: string; actor: boolean }[] = []
  const indice = new Map<string, number>()
  const asegurar = (id: string, texto?: string, actor = false): number => {
    const k = id.trim()
    let i = indice.get(k)
    if (i === undefined) {
      i = ps.length
      indice.set(k, i)
      ps.push({ id: k, texto: recortar(textoUnaLinea(texto ?? k, MAX_TEXTO) || k, MAX_TEXTO), actor })
    } else if (texto) ps[i]!.texto = recortar(textoUnaLinea(texto, MAX_TEXTO) || k, MAX_TEXTO)
    return i
  }
  const eventos: Evento[] = []
  let numero = false
  let cuenta = 0
  let titulo: string | undefined
  const pilaAbierta: string[] = []
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    let m: RegExpExecArray | null
    if (/^autonumber\b/i.test(t)) {
      numero = true
      continue
    }
    if ((m = /^title\s*:?\s*(.+)$/i.exec(t))) {
      titulo = textoUnaLinea(m[1]!, 60)
      continue
    }
    if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(t))) {
      asegurar(m[2]!.replace(/^"|"$/g, ''), m[3]?.replace(/^"|"$/g, ''), m[1]!.toLowerCase() === 'actor')
      continue
    }
    if (/^(activate|deactivate|create|destroy|link|links|accTitle|accDescr)\b/i.test(t)) continue
    if ((m = /^note\s+(over|left of|right of)\s+([^:]+?)\s*:\s*(.*)$/i.exec(t))) {
      const pos = m[1]!.toLowerCase().startsWith('over') ? 'over' : m[1]!.toLowerCase().startsWith('left') ? 'left' : 'right'
      const ids = m[2]!.split(',').map(x => x.trim())
      const a = asegurar(ids[0]!)
      const b = asegurar(ids[ids.length - 1]!)
      eventos.push({ t: 'n', pos, a: Math.min(a, b), b: Math.max(a, b), lineas: envolver(textos(m[3]!), 34, 6) })
      continue
    }
    if ((m = /^(loop|alt|opt|par|critical|break|rect|box)\b\s*(.*)$/i.exec(t))) {
      const nombre = m[1]!.toLowerCase()
      pilaAbierta.push(nombre)
      if (nombre !== 'rect' && nombre !== 'box') eventos.push({ t: 'abre', nombre, texto: textoUnaLinea(m[2] ?? '', 40) })
      continue
    }
    if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(t))) {
      eventos.push({ t: 'sep', texto: textoUnaLinea(m[2] ?? '', 40) || (m[1]!.toLowerCase() === 'else' ? 'si no' : 'y') })
      continue
    }
    if (/^end\b/i.test(t)) {
      const n = pilaAbierta.pop()
      if (n && n !== 'rect' && n !== 'box') eventos.push({ t: 'cierra' })
      continue
    }
    if ((m = FLECHA_SEC.exec(t))) {
      const op = m[2]!
      const de = asegurar(m[1]!)
      const a = asegurar(m[3]!)
      const trazo: Trazo = op.startsWith('--') || op.startsWith('<<--') ? 'p' : 'n'
      let cab = '▶'
      if (op === '->' || op === '-->') cab = ''
      else if (op.endsWith('x')) cab = '×'
      else if (op.endsWith(')')) cab = '›'
      if (eventos.filter(e => e.t === 'm').length > 400) continue
      cuenta++
      const prefijo = numero ? `${cuenta}. ` : ''
      const lin = envolver(textos(prefijo + (m[4] ?? '')), 34, 4)
      eventos.push({ t: 'm', de, a, lineas: lin, trazo, cab })
    }
  }
  while (ps.length > 30) {
    ps.pop()
  }
  if (!ps.length) return fichaDesconocida(lineas.join('\n'))

  const n = ps.length
  const anchos = ps.map(p => {
    const w = ancho(p.texto) + 4
    return w % 2 ? w : w + 1
  })
  const hw = anchos.map(w => Math.floor(w / 2))
  const cons: [number, number, number][] = []
  for (let i = 0; i + 1 < n; i++) cons.push([i, i + 1, hw[i]! + hw[i + 1]! + 4])
  let extIzq = hw[0]!
  let extDer = hw[n - 1]!
  const anchoL = (l: string[]) => Math.max(0, ...l.map(ancho))
  for (const e of eventos) {
    if (e.t === 'm') {
      const w = anchoL(e.lineas)
      if (e.de === e.a) {
        const need = w + 8
        if (e.de + 1 < n) cons.push([e.de, e.de + 1, need])
        else extDer = Math.max(extDer, need)
      } else cons.push([Math.min(e.de, e.a), Math.max(e.de, e.a), w + 4])
    } else if (e.t === 'n') {
      const w = anchoL(e.lineas) + 4
      if (e.pos === 'over') {
        if (e.a === e.b) {
          const m = Math.ceil(w / 2) + 1
          if (e.a > 0) cons.push([e.a - 1, e.a, m + hw[e.a - 1]!])
          else extIzq = Math.max(extIzq, m)
          if (e.a < n - 1) cons.push([e.a, e.a + 1, m + hw[e.a + 1]!])
          else extDer = Math.max(extDer, m)
        } else cons.push([e.a, e.b, w - 2])
      } else if (e.pos === 'left') {
        if (e.a > 0) cons.push([e.a - 1, e.a, w + 3 + hw[e.a - 1]!])
        else extIzq = Math.max(extIzq, w + 3)
      } else {
        if (e.b < n - 1) cons.push([e.b, e.b + 1, w + 3 + hw[e.b + 1]!])
        else extDer = Math.max(extDer, w + 3)
      }
    }
  }
  const x = [0]
  for (let j = 1; j < n; j++) {
    let v = x[j - 1]! + 1
    for (const [a, b, need] of cons) if (b === j) v = Math.max(v, x[a]! + need)
    x[j] = v
  }
  // Profundidad de bloques para reservar margen.
  let prof = 0
  let maxProf = 0
  for (const e of eventos) {
    if (e.t === 'abre') maxProf = Math.max(maxProf, ++prof)
    else if (e.t === 'cierra') prof--
  }
  const margen = maxProf ? 2 + 2 * maxProf : 2
  const desplaz = extIzq + margen + 1
  const col = x.map(v => v + desplaz)
  const izqMarco = desplaz - extIzq - 2
  const derMarco = col[n - 1]! + extDer + 2

  const dibujos: ((l: Lienzo) => void)[] = []
  const pilaM: { desde: number; nombre: string; texto: string; seps: { f: number; texto: string }[]; d: number }[] = []
  let fila = 4
  for (const e of eventos) {
    if (e.t === 'm') {
      const a = col[e.de]!
      const b = col[e.a]!
      if (e.de === e.a) {
        const f = fila
        const texto = e.lineas
        fila += Math.max(3, texto.length + 1)
        dibujos.push(l => {
          l.linea(f, a, f, a + 3, e.trazo)
          l.linea(f, a + 3, f + 1, a + 3, e.trazo)
          l.linea(f + 1, a + 3, f + 1, a + 1, e.trazo)
          l.poner(f + 1, a + 1, '◀')
          texto.forEach((t, i) => l.poner(f + i, a + 5, t))
        })
      } else {
        const izq = Math.min(a, b)
        const der = Math.max(a, b)
        const haciaDer = b > a
        const f = fila + e.lineas.length
        const lin = e.lineas
        const fila0 = fila
        fila = f + 1
        dibujos.push(l => {
          const c1 = haciaDer ? a : a - 1
          const c2 = haciaDer ? b - 1 : b + 1
          l.linea(f, a, f, c2, e.trazo)
          l.poner(f, c2, e.cab ? (e.cab === '▶' ? (haciaDer ? '▶' : '◀') : e.cab === '›' ? (haciaDer ? '›' : '‹') : e.cab) : e.trazo === 'p' ? '┄' : '─')
          void c1
          lin.forEach((t, i) => l.poner(fila0 + i, Math.floor((izq + der - ancho(t)) / 2) + 1, t))
        })
      }
    } else if (e.t === 'n') {
      const w = anchoL(e.lineas) + 4
      const alto = e.lineas.length + 2
      const f = fila
      let c0 = 0
      let wn = w
      if (e.pos === 'over') {
        if (e.a === e.b) c0 = col[e.a]! - Math.floor(w / 2)
        else {
          c0 = col[e.a]! - 2
          wn = Math.max(w, col[e.b]! - col[e.a]! + 5)
        }
      } else if (e.pos === 'left') c0 = col[e.a]! - w - 2
      else c0 = col[e.b]! + 3
      fila += alto + 1
      const lin = e.lineas
      dibujos.push(l => {
        for (let y = f; y < f + alto; y++) for (let k = c0; k < c0 + wn; k++) l.poner(y, k, ' ')
        l.poner(f, c0, `┌${'─'.repeat(wn - 2)}┐`)
        l.poner(f + alto - 1, c0, `└${'─'.repeat(wn - 2)}┘`)
        for (let y = f + 1; y < f + alto - 1; y++) {
          l.poner(y, c0, '│')
          l.poner(y, c0 + wn - 1, '│')
        }
        lin.forEach((t, i) => l.poner(f + 1 + i, c0 + Math.floor((wn - ancho(t)) / 2), t))
      })
    } else if (e.t === 'abre') {
      fila += 1
      pilaM.push({ desde: fila, nombre: e.nombre, texto: e.texto, seps: [], d: pilaM.length })
      fila += 2
    } else if (e.t === 'sep') {
      fila += 1
      const m = pilaM[pilaM.length - 1]
      if (m) m.seps.push({ f: fila, texto: e.texto })
      fila += 2
    } else {
      const m = pilaM.pop()
      if (m) {
        const hasta = fila
        fila += 2
        dibujos.push(l => {
          const c1 = izqMarco - 2 * (maxProf - 1 - m.d)
          const c2 = derMarco + 2 * (maxProf - 1 - m.d)
          l.linea(m.desde, c1, m.desde, c2)
          l.linea(hasta, c1, hasta, c2)
          l.linea(m.desde, c1, hasta, c1)
          l.linea(m.desde, c2, hasta, c2)
          l.poner(m.desde, c1 + 1, recortar(` ${m.nombre}${m.texto ? ` ${m.texto}` : ''} `, c2 - c1 - 2))
          for (const s of m.seps) {
            l.linea(s.f, c1, s.f, c2, 'p')
            l.poner(s.f, c1 + 1, recortar(` ${s.texto} `, c2 - c1 - 2))
          }
        })
      }
    }
  }
  // Bloques sin cerrar: se dan por cerrados al final.
  while (pilaM.length) {
    const m = pilaM.pop()!
    const hasta = fila
    fila += 2
    dibujos.push(l => {
      const c1 = izqMarco - 2 * (maxProf - 1 - m.d)
      const c2 = derMarco + 2 * (maxProf - 1 - m.d)
      l.linea(m.desde, c1, m.desde, c2)
      l.linea(hasta, c1, hasta, c2)
      l.linea(m.desde, c1, hasta, c1)
      l.linea(m.desde, c2, hasta, c2)
      l.poner(m.desde, c1 + 1, recortar(` ${m.nombre}${m.texto ? ` ${m.texto}` : ''} `, c2 - c1 - 2))
    })
  }
  const filaPie = fila
  const lienzo = new Lienzo(filaPie + 4, derMarco + 2 * maxProf + 4)
  ps.forEach((p, i) => {
    const c = col[i]! - hw[i]!
    lienzo.linea(2, col[i]!, filaPie, col[i]!)
    lienzo.caja(0, c, 3, anchos[i]!, p.actor ? 'redondo' : 'rect')
    lienzo.poner(1, c + Math.floor((anchos[i]! - ancho(p.texto)) / 2), p.texto)
    lienzo.caja(filaPie, c, 3, anchos[i]!, p.actor ? 'redondo' : 'rect')
    lienzo.poner(filaPie + 1, c + Math.floor((anchos[i]! - ancho(p.texto)) / 2), p.texto)
  })
  for (const d of dibujos) d(lienzo)
  return { lineas: lienzo.salida(), titulo }
}

// Pastel

function dibujarPastel(lineas: string[], cabecera: string): Resultado {
  let titulo: string | undefined
  const mt = /title\s+(.+)$/i.exec(cabecera)
  if (mt) titulo = textoUnaLinea(mt[1]!, 60)
  const datos: { nombre: string; v: number }[] = []
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t || /^showData/i.test(t)) continue
    const m1 = /^title\s+(.+)$/i.exec(t)
    if (m1) {
      titulo = textoUnaLinea(m1[1]!, 60)
      continue
    }
    const m = /^"?([^":]+?)"?\s*:\s*(-?[\d.,]+)/.exec(t)
    if (m) {
      const v = parseFloat(m[2]!.replace(',', '.'))
      if (Number.isFinite(v) && v >= 0) datos.push({ nombre: textoUnaLinea(m[1]!, 24), v })
    }
  }
  if (!datos.length) return fichaDesconocida(lineas.join('\n'))
  const total = datos.reduce((a, d) => a + d.v, 0) || 1
  const w = Math.min(24, Math.max(...datos.map(d => ancho(d.nombre))))
  const BARRA = 30
  const salida = datos.map(d => {
    const pct = (d.v / total) * 100
    const n = d.v > 0 ? Math.max(1, Math.round((d.v / total) * BARRA)) : 0
    return `${rellenar(d.nombre, w)}  ${'█'.repeat(n)}${' '.repeat(BARRA - n)}  ${pct.toFixed(1).padStart(5)}%  ${d.v}`
  })
  return { lineas: salida, titulo }
}

// Gantt

const MS_DIA = 86400000
const UNIDADES: Record<string, number> = { ms: 1, s: 1000, min: 60000, m: 60000, h: 3600000, d: MS_DIA, w: 7 * MS_DIA, M: 30 * MS_DIA, y: 365 * MS_DIA }

function aFecha(s: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim())
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0))
  const d = Date.parse(s)
  return Number.isNaN(d) ? null : d
}

function aDuracion(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|min|[smhdwMy])$/.exec(s.trim())
  return m ? parseFloat(m[1]!) * UNIDADES[m[2]!]! : null
}

function dibujarGantt(lineas: string[]): Resultado {
  type Tarea = { nombre: string; ini: number | null; fin: number | null; dur: number | null; done: boolean; hito: boolean; seccion: string; id: string }
  let titulo: string | undefined
  let seccion = ''
  const tareas: Tarea[] = []
  const porId = new Map<string, Tarea>()
  let previo: Tarea | null = null
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/i.exec(t))) {
      titulo = textoUnaLinea(m[1]!, 60)
      continue
    }
    if ((m = /^section\s+(.+)$/i.exec(t))) {
      seccion = textoUnaLinea(m[1]!, 40)
      continue
    }
    if (/^(dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis|accTitle|accDescr)\b/i.test(t)) continue
    const p = t.indexOf(':')
    if (p < 0) continue
    if (tareas.length >= 300) continue
    const nombre = textoUnaLinea(t.slice(0, p), 24)
    if (!nombre) continue
    const trozos = t.slice(p + 1).split(',').map(x => x.trim()).filter(Boolean)
    const marcas = new Set(['done', 'active', 'crit', 'milestone'])
    const tags = trozos.filter(x => marcas.has(x))
    const resto = trozos.filter(x => !marcas.has(x))
    const tarea: Tarea = { nombre, ini: null, fin: null, dur: null, done: tags.includes('done'), hito: tags.includes('milestone'), seccion, id: '' }
    let fin: string | undefined
    let inicio: string | undefined
    if (resto.length >= 3) [tarea.id, inicio, fin] = [resto[0]!, resto[1], resto[2]]
    else if (resto.length === 2) [inicio, fin] = [resto[0], resto[1]]
    else if (resto.length === 1) fin = resto[0]
    if (inicio) {
      const af = /^after\s+(.+)$/i.exec(inicio)
      if (af) {
        const ends = af[1]!.trim().split(/\s+/).map(id => porId.get(id)?.fin ?? null).filter((v): v is number => v !== null)
        tarea.ini = ends.length ? Math.max(...ends) : (previo?.fin ?? null)
      } else tarea.ini = aFecha(inicio)
    }
    if (tarea.ini === null) tarea.ini = previo?.fin ?? null
    if (fin) {
      const d = aDuracion(fin)
      if (d !== null) tarea.dur = d
      else tarea.fin = aFecha(fin)
    }
    if (tarea.fin === null && tarea.dur !== null) {
      tarea.fin = (tarea.ini ?? 0) + tarea.dur
      if (tarea.ini === null) tarea.ini = 0
    }
    if (tarea.id) porId.set(tarea.id, tarea)
    tareas.push(tarea)
    previo = tarea
  }
  if (!tareas.length) return fichaDesconocida(lineas.join('\n'))
  const con = tareas.filter(t => t.ini !== null && t.fin !== null)
  const ini = con.length ? Math.min(...con.map(t => t.ini!)) : 0
  const fin = con.length ? Math.max(...con.map(t => t.fin!)) : 1
  const rango = Math.max(1, fin - ini)
  const w = Math.max(...tareas.map(t => ancho(t.nombre)))
  const BARRA = 40
  const fecha = (ms: number) => {
    const d = new Date(ms)
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${d.getUTCFullYear()}-${mm}-${dd}`
  }
  const salida: string[] = []
  let act: string | null = null
  for (const t of tareas) {
    if (t.seccion !== act) {
      act = t.seccion
      if (act) salida.push(salida.length ? '' : '', act)
    }
    let barra = ' '.repeat(BARRA)
    let nota = ''
    if (t.ini !== null && t.fin !== null) {
      const a = Math.floor(((t.ini - ini) / rango) * BARRA)
      let b = Math.round(((t.fin - ini) / rango) * BARRA)
      if (b <= a) b = a + 1
      if (b > BARRA) b = BARRA
      const lleno = t.hito ? '◆' : (t.done ? '▓' : '█').repeat(Math.max(1, b - a))
      barra = rellenar(' '.repeat(a) + lleno, BARRA)
      if (ini > MS_DIA) nota = t.hito ? fecha(t.ini) : `${fecha(t.ini)} → ${fecha(t.fin)}`
      else nota = `${Math.round((t.fin - t.ini) / MS_DIA)}d`
    }
    salida.push(`  ${rellenar(t.nombre, w)}  ${barra}  ${nota}`.replace(/\s+$/, ''))
  }
  while (salida[0] === '') salida.shift()
  return { lineas: salida, titulo }
}

// Mapa mental y línea de tiempo

function dibujarMindmap(lineas: string[]): Resultado {
  type N = { txt: string; hijos: N[]; ind: number }
  const raiz: N = { txt: '', hijos: [], ind: -1 }
  const pila: N[] = [raiz]
  let cuenta = 0
  for (const crudo of lineas) {
    if (!crudo.trim() || /^\s*::icon/.test(crudo)) continue
    if (cuenta++ > 400) break
    const ind = crudo.length - crudo.trimStart().length
    let t = crudo.trim()
    const m = /^[\w-]*?(\(\(|\)\)|\(|\[|\{\{|\)|\{)(.*?)(\)\)|\(\(|\)|\]|\}\}|\(|\})$/.exec(t)
    if (m) t = m[2]!
    const nodo: N = { txt: recortar(textos(t).join(' ') || t, 50), hijos: [], ind }
    while (pila.length > 1 && pila[pila.length - 1]!.ind >= ind) pila.pop()
    pila[pila.length - 1]!.hijos.push(nodo)
    pila.push(nodo)
  }
  if (!raiz.hijos.length) return fichaDesconocida(lineas.join('\n'))
  const salida: string[] = []
  const pintar = (n: N, prefijo: string, ultimo: boolean, nivel: number) => {
    salida.push(nivel === 0 ? n.txt : `${prefijo}${ultimo ? '└─ ' : '├─ '}${n.txt}`)
    const p2 = nivel === 0 ? '' : prefijo + (ultimo ? '   ' : '│  ')
    n.hijos.forEach((h, i) => pintar(h, p2, i === n.hijos.length - 1, nivel + 1))
  }
  raiz.hijos.forEach((h, i) => {
    if (i) salida.push('')
    pintar(h, '', true, 0)
  })
  return { lineas: salida }
}

function dibujarTimeline(lineas: string[]): Resultado {
  let titulo: string | undefined
  const salida: string[] = []
  let periodo = false
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/i.exec(t))) {
      titulo = textoUnaLinea(m[1]!, 60)
      continue
    }
    if ((m = /^section\s+(.+)$/i.exec(t))) {
      if (salida.length) salida.push('│')
      salida.push(`┄ ${recortar(textoUnaLinea(m[1]!, 50), 50)} ┄`)
      salida.push('│')
      continue
    }
    const partes = t.split(':').map(x => x.trim())
    const hitos = partes.slice(1).filter(Boolean)
    if (partes[0]) {
      salida.push(`● ${recortar(textoUnaLinea(partes[0], 40), 40)}`)
      periodo = true
    }
    if (!periodo) continue
    for (const h of hitos) salida.push(`│   ${recortar(textoUnaLinea(h, 60), 60)}`)
  }
  if (!salida.length) return fichaDesconocida(lineas.join('\n'))
  return { lineas: salida, titulo }
}

// Fichas

function ficha(tituloCaja: string, cuerpo: string[]): string[] {
  const filas = cuerpo.map(x => recortar(x, 70)).slice(0, 40)
  const w = Math.max(ancho(tituloCaja), ...filas.map(ancho), 10)
  const salida = [`╭${'─'.repeat(w + 2)}╮`, `│ ${rellenar(tituloCaja, w)} │`]
  if (filas.length) salida.push(`├${'─'.repeat(w + 2)}┤`, ...filas.map(f => `│ ${rellenar(f, w)} │`))
  salida.push(`╰${'─'.repeat(w + 2)}╯`)
  return salida
}

function textoLimpio(fuente: string): string[] {
  const salida: string[] = []
  for (const crudo of fuente.split('\n')) {
    let t = crudo.replace(/%%.*$/, '').trim()
    if (!t || /^%%/.test(t)) continue
    t = t
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/<<?-+>?>?|[-=.]{2,}>?>?|-[.x)]|[-=]+[>x]|\|[^|]*\|/g, m => (m.startsWith('|') ? ` ${m.slice(1, -1)} ` : ' → '))
      .replace(/[{}[\]()<>;:"'`#|=*_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t && t !== '→') salida.push(recortar(textoUnaLinea(t, 66) || t, 66))
  }
  return salida
}

function fichaDesconocida(fuente: string): Resultado {
  return { lineas: ficha('Diagrama no reconocido', textoLimpio(fuente)) }
}

const NOMBRES_TIPO: Record<string, string> = {
  journey: 'Recorrido',
  gitgraph: 'Historial de versiones',
  quadrantchart: 'Cuadrante',
  requirementdiagram: 'Requisitos',
  'xychart-beta': 'Gráfico XY',
  'sankey-beta': 'Flujo de Sankey',
  'block-beta': 'Bloques',
  'packet-beta': 'Paquete',
  'kanban': 'Tablero',
  architecture: 'Arquitectura',
  'architecture-beta': 'Arquitectura',
  c4context: 'Contexto C4',
  c4container: 'Contenedores C4',
  c4component: 'Componentes C4',
  c4dynamic: 'Dinámico C4',
  c4deployment: 'Despliegue C4',
  zenuml: 'Secuencia',
}

function dibujarJourney(lineas: string[]): Resultado {
  let titulo: string | undefined
  const salida: string[] = []
  for (const crudo of lineas) {
    const t = crudo.trim()
    if (!t) continue
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/i.exec(t))) {
      titulo = textoUnaLinea(m[1]!, 60)
      continue
    }
    if ((m = /^section\s+(.+)$/i.exec(t))) {
      if (salida.length) salida.push('')
      salida.push(recortar(textoUnaLinea(m[1]!, 50), 50))
      continue
    }
    m = /^(.+?)\s*:\s*(\d+)\s*(?::\s*(.*))?$/.exec(t)
    if (m) {
      const n = Math.max(0, Math.min(5, parseInt(m[2]!, 10)))
      const actores = textoUnaLinea(m[3] ?? '', 40)
      const nombre = textoUnaLinea(m[1]!, 40)
      salida.push(`  ${rellenar(nombre, 28)} ${'★'.repeat(n)}${'☆'.repeat(5 - n)}${actores ? `  ${actores}` : ''}`)
    }
  }
  if (!salida.length) return fichaDesconocida(lineas.join('\n'))
  return { lineas: ficha('Recorrido', salida), titulo }
}

function dibujarGenerico(tipo: string, lineas: string[]): Resultado {
  const nombre = NOMBRES_TIPO[tipo.toLowerCase()] ?? tipo
  const cuerpo = lineas
    .map(l => l.trim())
    .filter(l => l && !/^(accTitle|accDescr)\b/i.test(l))
    .join('\n')
  const titulo = textos(/^title\s+(.+)$/im.exec(cuerpo)?.[1] ?? '').join(' ')
  const filas = textoLimpio(cuerpo.replace(/^title\s+.*$/gim, ''))
  return { lineas: ficha(nombre, filas), titulo: titulo || undefined }
}

// Entrada

function resolver(fuente: string): Resultado {
  let texto = fuente.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim()
  let titulo: string | undefined
  const fm = /^---\n([\s\S]*?)\n---\s*\n?/.exec(texto)
  if (fm) {
    titulo = /^title:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim().replace(/^["']|["']$/g, '')
    texto = texto.slice(fm[0].length)
  }
  texto = texto.replace(/%%\{[\s\S]*?\}%%/g, '')
  const lineas = texto.split('\n').map(l => l.replace(/%%.*$/, ''))
  while (lineas.length && !lineas[0]!.trim()) lineas.shift()
  while (lineas.length && !lineas[lineas.length - 1]!.trim()) lineas.pop()
  if (!lineas.length) return { lineas: ficha('Diagrama no reconocido', []) }
  const cab = lineas[0]!.trim()
  const tipo = cab.split(/[\s;]+/)[0]!.toLowerCase()
  const cuerpo = lineas.slice(1)
  let r: Resultado
  if (tipo === 'graph' || tipo === 'flowchart' || tipo === 'flowchart-elk') {
    const resto = cab.split(';').slice(1).join(';')
    const g = parseFlowchart(resto ? [resto, ...cuerpo] : cuerpo, cab)
    if (!g.nodos.size) return fichaDesconocida(texto)
    r = { lineas: dibujarGrafo(g) }
  } else if (tipo === 'sequencediagram') r = dibujarSecuencia(cuerpo)
  else if (tipo === 'pie') r = dibujarPastel(cuerpo, cab)
  else if (tipo === 'statediagram' || tipo === 'statediagram-v2') {
    const g = parseEstados(cuerpo)
    if (!g.nodos.size) return fichaDesconocida(texto)
    r = { lineas: dibujarGrafo(g) }
  } else if (tipo === 'classdiagram') {
    const g = parseClases(cuerpo)
    if (!g.nodos.size) return fichaDesconocida(texto)
    r = { lineas: dibujarGrafo(g) }
  } else if (tipo === 'erdiagram') {
    const g = parseEr(cuerpo)
    if (!g.nodos.size) return fichaDesconocida(texto)
    r = { lineas: dibujarGrafo(g) }
  } else if (tipo === 'gantt') r = dibujarGantt(cuerpo)
  else if (tipo === 'mindmap') r = dibujarMindmap(cuerpo)
  else if (tipo === 'timeline') r = dibujarTimeline(cuerpo)
  else if (tipo === 'journey') r = dibujarJourney(cuerpo)
  else if (NOMBRES_TIPO[tipo]) r = dibujarGenerico(tipo, cuerpo)
  else return fichaDesconocida(texto)
  const final = titulo ?? r.titulo
  return final ? { lineas: r.lineas, titulo: final } : { lineas: r.lineas }
}

export function dibujarMermaid(fuente: string): { lineas: string[]; titulo?: string } {
  try {
    return resolver(String(fuente ?? ''))
  } catch {
    try {
      return fichaDesconocida(String(fuente ?? ''))
    } catch {
      return { lineas: ficha('Diagrama no reconocido', []) }
    }
  }
}
