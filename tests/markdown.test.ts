import { expect, test } from 'claude-code/testing'

import type { Bloque, Parrafo, Run } from '../types'
import { bloquesDeMarkdown } from '../hooks/markdown'
import { dibujarMermaid } from '../hooks/mermaid'

const md = (t: string) => bloquesDeMarkdown(t, '/docs/guia')
const par = (b: Bloque | undefined) => b as Parrafo
const texto = (b: Bloque | undefined) => par(b).r.map(r => r.t).join('')
const run = (b: Bloque | undefined, t: string): Run | undefined => par(b).r.find(r => r.t === t)

test('títulos ATX y Setext', () => {
  const b = md('# Uno\n\nDos\n---\n\nTres\n===\n\n###### Seis ##')
  expect(b.map(x => par(x).est)).toEqual(['h1', 'h2', 'h1', 'h6'])
  expect(texto(b[3])).toBe('Seis')
  expect(par(b[0]).id).toBe(-1)
  expect(par(b[0]).ed).toBe(0)
})

test('énfasis, código, enlaces y escapes', () => {
  const b = md('**n** *c* ***a*** ~~t~~ `x` [e](http://a.b) \\*no\\* &amp; :rocket:')
  expect(run(b[0], 'n')?.b).toBe(1)
  expect(run(b[0], 'c')?.i).toBe(1)
  expect(run(b[0], 'a')).toMatchObject({ b: 1, i: 1 })
  expect(run(b[0], 't')?.s).toBe(1)
  expect(run(b[0], 'x')).toMatchObject({ font: 'mono', c: '#c7254e', h: '#f4f4f5' })
  expect(run(b[0], 'e')).toMatchObject({ u: 1, c: '#0b5cad', href: 'http://a.b' })
  expect(texto(b[0])).toContain('*no*')
  expect(texto(b[0])).toContain('&')
  expect(texto(b[0])).toContain('🚀')
  expect(texto(b[0])).not.toContain('**')
})

test('autolinks, referencias y salto duro', () => {
  const b = md('<http://x.y> y https://z.w, mira [t][id]  \nfin\n\n[id]: http://r.s "T"')
  expect(run(b[0], 'http://x.y')?.href).toBe('http://x.y')
  expect(run(b[0], 'https://z.w')?.href).toBe('https://z.w')
  expect(run(b[0], 't')?.href).toBe('http://r.s')
  expect(texto(b[0])).toContain('\nfin')
  expect(b.length).toBe(1)
})

test('notas al pie al final bajo un hr', () => {
  const b = md('Texto[^a].\n\n[^a]: La nota.\n\nOtro')
  expect(texto(b[0])).toBe('Texto¹.')
  expect(b[b.length - 2]).toEqual({ k: 'hr' })
  expect(texto(b[b.length - 1])).toBe('¹ La nota.')
})

test('HTML en línea', () => {
  const b = md('a<br>b <b>n</b> <kbd>k</kbd> <span>s</span> x<sup>2</sup> <a href="http://h">l</a>')
  expect(texto(b[0])).toContain('a\nb')
  expect(run(b[0], 'n')?.b).toBe(1)
  expect(run(b[0], 'k')?.font).toBe('mono')
  expect(texto(b[0])).toContain('x²')
  expect(run(b[0], 'l')?.href).toBe('http://h')
  expect(texto(b[0])).not.toContain('<span')
})

test('listas anidadas respetando el inicio', () => {
  const b = md('3. uno\n4. dos\n   - sub\n     - subsub\n\n- a\n    - b')
  expect(par(b[0]).lista).toEqual({ marca: '3.', nivel: 0 })
  expect(par(b[1]).lista).toEqual({ marca: '4.', nivel: 0 })
  expect(par(b[2]).lista).toEqual({ marca: '◦', nivel: 1 })
  expect(par(b[3]).lista).toEqual({ marca: '▪', nivel: 2 })
  expect(par(b[4]).lista).toEqual({ marca: '•', nivel: 0 })
  expect(par(b[5]).lista).toEqual({ marca: '◦', nivel: 1 })
})

test('sublista con dos espacios bajo un número', () => {
  const b = md('1. a\n  - b\n2. c')
  expect(par(b[1]).lista?.nivel).toBe(1)
  expect(par(b[2]).lista).toEqual({ marca: '2.', nivel: 0 })
})

test('tareas y bloques dentro de un ítem', () => {
  const b = md('- [ ] no\n- [x] sí\n\n  segundo párrafo\n\n  ```js\n  a()\n  ```')
  expect(par(b[0]).lista?.marca).toBe('☐')
  expect(texto(b[0])).toBe('no')
  expect(par(b[1]).lista?.marca).toBe('☑')
  expect(par(b[2]).sang).toBe(3)
  expect(b[3]).toEqual({ k: 'cod', lang: 'js', texto: 'a()' })
})

test('tablas GFM con alineación e inline', () => {
  const b = md('| A | B | C |\n|:--|:-:|--:|\n| **x** | y\\|z | `c` |\n| solo |')
  const t = b[0] as Extract<Bloque, { k: 'tabla' }>
  expect(t.k).toBe('tabla')
  expect(t.filas[0]![0]!.bg).toBe('#e8ecf2')
  expect(t.filas[0]![0]!.b[0]).toMatchObject({ r: [{ t: 'A', b: 1 }] })
  expect(par(t.filas[0]![1]!.b[0]).al).toBe('c')
  expect(par(t.filas[0]![2]!.b[0]).al).toBe('r')
  expect(par(t.filas[1]![0]!.b[0]).r[0]).toMatchObject({ t: 'x', b: 1 })
  expect(texto(t.filas[1]![1]!.b[0])).toBe('y|z')
  expect(t.filas[2]!.length).toBe(3)
  expect(t.anchos).toBeUndefined()
})

test('código: cercas, sangrado y arte', () => {
  const b = md('```py\nx = 1\n```\n\n~~~\nz\n~~~\n\n    sang\n\n```\n┌──┐\n└──┘\n```\n\n```text\n+---+\n```\n\n```ts\nconst a = "──"\n```')
  expect(b[0]).toEqual({ k: 'cod', lang: 'py', texto: 'x = 1' })
  expect(b[1]).toEqual({ k: 'cod', lang: '', texto: 'z' })
  expect(b[2]).toEqual({ k: 'cod', lang: '', texto: 'sang' })
  expect(b[3]).toEqual({ k: 'figura', lineas: ['┌──┐', '└──┘'] })
  expect(b[4]).toEqual({ k: 'figura', lineas: ['+---+'] })
  expect((b[5] as { k: string }).k).toBe('cod')
})

test('mermaid en cerca es figura sin código', () => {
  const b = md('```mermaid\nflowchart TD\n  A --> B\n```')
  const f = b[0] as Extract<Bloque, { k: 'figura' }>
  expect(f.k).toBe('figura')
  expect(f.lineas.join('\n')).not.toContain('-->')
  expect(f.lineas.join('\n')).toContain('▼')
})

test('citas anidadas y avisos', () => {
  const b = md('> uno\n> > dos\n\n> [!WARNING]\n> ojo\n\n> [!TIP] rápido')
  const c = b[0] as Extract<Bloque, { k: 'cita' }>
  expect(c.k).toBe('cita')
  expect(texto(c.b[0])).toBe('uno')
  expect((c.b[1] as { k: string }).k).toBe('cita')
  const a = b[1] as Extract<Bloque, { k: 'cita' }>
  expect(a.tipo).toBe('warning')
  expect(texto(a.b[0])).toBe('ojo')
  expect((b[2] as Extract<Bloque, { k: 'cita' }>).tipo).toBe('tip')
  expect(texto((b[2] as Extract<Bloque, { k: 'cita' }>).b[0])).toBe('rápido')
})

test('frontmatter como tabla clave/valor', () => {
  const b = md('---\ntitle: "Hola"\ntags: [a, b]\nlista:\n  - x\n  - y\n---\n\n# T')
  const t = b[0] as Extract<Bloque, { k: 'tabla' }>
  expect(t.k).toBe('tabla')
  expect(t.filas[0]![0]!.b[0]).toMatchObject({ r: [{ t: 'title', b: 1 }] })
  expect(texto(t.filas[0]![1]!.b[0])).toBe('Hola')
  expect(texto(t.filas[1]![1]!.b[0])).toBe('a, b')
  expect(texto(t.filas[2]![1]!.b[0])).toBe('x, y')
  expect(par(b[1]).est).toBe('h1')
})

test('una regla inicial no es frontmatter', () => {
  const b = md('---\n\nTexto\n\n---')
  expect(b[0]).toEqual({ k: 'hr' })
  expect(b[2]).toEqual({ k: 'hr' })
})

test('imágenes locales, remotas y chips', () => {
  const b = md('![foto](../img/a%20b.png)\n\n![web](https://x.y/z.png)\n\n![d](data:image/png;base64,AA)\n\nmira ![ci](https://img.shields.io/x.svg) ya')
  expect(b[0]).toEqual({ k: 'img', src: 'archivo:/docs/img/a b.png', w: 0, h: 0, alt: 'foto' })
  expect(par(b[1]).r[0]).toMatchObject({ t: '🖼 web', i: 1, c: '#667085', href: 'https://x.y/z.png' })
  expect(par(b[2]).r[0]!.href).toBeUndefined()
  expect(run(b[3], ' ci ')).toMatchObject({ h: '#e4e7ec', c: '#344054' })
  expect(texto(b[3])).toContain('mira')
})

test('carpeta con barras invertidas', () => {
  const b = bloquesDeMarkdown('![x](a/b.png)', 'C:\\docs\\v1')
  expect((b[0] as Extract<Bloque, { k: 'img' }>).src).toBe('archivo:C:/docs/v1/a/b.png')
})

test('HTML de bloque', () => {
  const b = md(`<div align="center">

# Título

<img src="logo.png" alt="Logo">

</div>

<!-- oculto -->

<details>
<summary>Más</summary>

**dentro**

</details>

<p align="center">Centrado <b>sí</b></p>

<h2 align="center">Alto</h2>`)
  expect(par(b[0])).toMatchObject({ est: 'h1', al: 'c' })
  expect(b[1]).toEqual({ k: 'img', src: 'archivo:/docs/guia/logo.png', w: 0, h: 0, alt: 'Logo' })
  expect(par(b[2]).est).toBe('h4')
  expect(texto(b[2])).toBe('▾ Más')
  expect(par(b[3]).r[0]).toMatchObject({ t: 'dentro', b: 1 })
  expect(par(b[4]).al).toBe('c')
  expect(texto(b[4])).toBe('Centrado sí')
  expect(par(b[5])).toMatchObject({ est: 'h2', al: 'c' })
  expect(JSON.stringify(b)).not.toContain('oculto')
  expect(JSON.stringify(b)).not.toContain('<')
})

test('texto hostil no rompe', () => {
  for (const t of ['', '[', '[[[[[', '*'.repeat(9000), '> '.repeat(500) + 'x', '<div', '| a |\n|---', '```', '- [', '![](', '&#xZZ;', '<!--']) {
    expect(Array.isArray(bloquesDeMarkdown(t, '/a'))).toBe(true)
  }
})

// Comprobación de trazado: toda línea debe llegar a algo.
const DIRECCIONES: Record<string, number> = { '│': 5, '─': 10, '└': 3, '┌': 6, '├': 7, '┘': 9, '┴': 11, '┐': 12, '┤': 13, '┬': 14, '┼': 15, '┃': 5, '━': 10, '┗': 3, '┏': 6, '┣': 7, '┛': 9, '┻': 11, '┓': 12, '┫': 13, '┳': 14, '╋': 15, '┆': 5, '┄': 10 }

function sinCabosSueltos(lineas: string[]): void {
  const g = lineas.map(l => [...l])
  const en = (f: number, c: number) => g[f]?.[c] ?? ' '
  g.forEach((fila, f) =>
    fila.forEach((ch, c) => {
      const d = DIRECCIONES[ch]
      if (!d) return
      if (d & 1) expect(en(f - 1, c)).not.toBe(' ')
      if (d & 2) expect(en(f, c + 1)).not.toBe(' ')
      if (d & 4) expect(en(f + 1, c)).not.toBe(' ')
      if (d & 8) expect(en(f, c - 1)).not.toBe(' ')
    }),
  )
}

test('flowchart TD: decisión con dos ramas', () => {
  const { lineas } = dibujarMermaid(`flowchart TD
    A[Inicio] --> B{¿Pago?}
    B -->|Sí| C[Facturar]
    B -->|No| D[Rechazar]
    C --> E((Fin))
    D --> E`)
  const s = lineas.join('\n')
  for (const t of ['Inicio', '¿Pago?', 'Sí', 'No', 'Facturar', 'Rechazar', 'Fin', '▼', '╱', '╭']) expect(s).toContain(t)
  expect(s).not.toContain('-->')
  sinCabosSueltos(lineas)
})

test('flowchart LR: ramas y etiquetas', () => {
  const { lineas } = dibujarMermaid(`flowchart LR
    A[Cliente] --> B(API)
    B -->|lee| C[Base]
    B -->|escribe| D[Cola]
    B -- notifica --> E[Correo]
    D -.-> F[Trabajador]
    F ==> C`)
  const s = lineas.join('\n')
  for (const t of ['Cliente', 'API', 'lee', 'escribe', 'notifica', 'Trabajador', '▶', '┄', '━']) expect(s).toContain(t)
  sinCabosSueltos(lineas)
})

test('flowchart: ciclos, cadenas, Y y subgrafos', () => {
  const uno = dibujarMermaid('graph TD\n A --> B --> C --> A\n A & B --> D')
  sinCabosSueltos(uno.lineas)
  const sub = dibujarMermaid('flowchart TB\n subgraph s1 [Grupo]\n A --> B\n end\n B --> C')
  expect(sub.lineas.join('\n')).toContain('Grupo')
  expect(sub.lineas.join('\n')).toContain('┆')
})

test('sequenceDiagram', () => {
  const { lineas } = dibujarMermaid(`sequenceDiagram
    autonumber
    actor U as Usuario
    participant W as Web
    U->>W: Pide
    W-->>U: Responde
    Note over U,W: Nota
    alt bien
      U-xW: Corta
    else mal
      W->>W: Auto
    end`)
  const s = lineas.join('\n')
  for (const t of ['Usuario', 'Web', '1. Pide', '2. Responde', 'Nota', 'alt bien', 'mal', 'Auto', '▶', '◀', '┄', '×']) expect(s).toContain(t)
  expect(s).not.toContain('->>')
})

test('pie con porcentajes', () => {
  const r = dibujarMermaid('pie title Ventas\n "A" : 75\n "B" : 25')
  expect(r.titulo).toBe('Ventas')
  expect(r.lineas[0]).toContain('75.0%')
  expect(r.lineas[0]).toContain('█'.repeat(23))
  expect(r.lineas[1]).toContain('25.0%')
})

test('estados, clases, ER, gantt, mindmap, timeline y otros', () => {
  expect(dibujarMermaid('stateDiagram-v2\n [*] --> A\n A --> [*] : fin').lineas.join('\n')).toContain('●')
  const cl = dibujarMermaid('classDiagram\n Animal <|-- Pato\n Animal : +edad').lineas.join('\n')
  expect(cl).toContain('+edad')
  expect(cl).toContain('△')
  expect(dibujarMermaid('erDiagram\n A ||--o{ B : tiene').lineas.join('\n')).toContain('tiene')
  const g = dibujarMermaid('gantt\n title P\n section S\n T :a, 2024-01-01, 10d')
  expect(g.titulo).toBe('P')
  expect(g.lineas.join('\n')).toContain('█')
  expect(dibujarMermaid('mindmap\n root((R))\n  A\n   B').lineas.join('\n')).toContain('└─ A')
  expect(dibujarMermaid('timeline\n 2020 : X').lineas.join('\n')).toContain('● 2020')
  expect(dibujarMermaid('journey\n title T\n section S\n  Ir: 3: Yo').lineas.join('\n')).toContain('★★★☆☆')
  expect(dibujarMermaid('gitGraph\n commit').lineas.join('\n')).toContain('commit')
})

test('errores y tamaños enormes dan una ficha o un dibujo acotado', () => {
  expect(dibujarMermaid('').lineas.join('\n')).toContain('Diagrama no reconocido')
  expect(dibujarMermaid('lo que sea --> [x]').lineas.join('\n')).toContain('Diagrama no reconocido')
  let grande = 'graph LR\n'
  for (let i = 0; i < 400; i++) grande += `N${i} --> N${i + 1}\n`
  const r = dibujarMermaid(grande)
  expect(r.lineas.length).toBeGreaterThan(0)
})
