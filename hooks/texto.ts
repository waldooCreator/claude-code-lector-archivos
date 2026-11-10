// Lo que Claude lee de un documento: el contenido como texto ordenado, con
// la estructura a la vista (títulos, listas, tablas, hojas y celdas, diapositivas).

import type { Bloque, Documento, Hoja, Run } from '../types'

const TOPE = 40_000

const textoRuns = (r: Run[]) => r.map(x => (x.b && x.t.trim() ? `**${x.t}**` : x.t)).join('')

function bloques(lista: Bloque[], salida: string[], nivelCita = ''): void {
  for (const b of lista) {
    if (b.k === 'p') {
      const t = textoRuns(b.r)
      const h = b.est === 'titulo' ? '# ' : b.est?.startsWith('h') ? '#'.repeat(Number(b.est.slice(1)) + (b.est === 'h1' ? 1 : 1)) + ' ' : ''
      const marca = b.lista ? `${'  '.repeat(b.lista.nivel)}${/\d/.test(b.lista.marca) ? b.lista.marca : '-'} ` : ''
      if (t.trim() || marca) salida.push(`${nivelCita}${h}${marca}${t}`)
      else salida.push('')
    } else if (b.k === 'tabla') {
      const filas = b.filas.map(f => f.map(c => {
        const partes: string[] = []
        bloques(c.b, partes)
        return partes.filter(Boolean).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      }))
      if (!filas.length) continue
      const n = Math.max(...filas.map(f => f.length))
      salida.push('', `| ${filas[0]!.concat(Array(n - filas[0]!.length).fill('')).join(' | ')} |`, `|${' --- |'.repeat(n)}`)
      for (const f of filas.slice(1)) salida.push(`| ${f.concat(Array(n - f.length).fill('')).join(' | ')} |`)
      salida.push('')
    } else if (b.k === 'img') salida.push(`[imagen${b.alt ? `: ${b.alt}` : ''}]`)
    else if (b.k === 'salto') salida.push('', '--- (salto de página) ---', '')
    else if (b.k === 'hr') salida.push('---')
    else if (b.k === 'cod') salida.push('```' + b.lang, b.texto, '```')
    else if (b.k === 'cita') bloques(b.b, salida, nivelCita + '> ')
    else if (b.k === 'figura') salida.push('```', ...b.lineas, '```')
  }
}

function letra(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function hoja(h: Hoja, salida: string[]): void {
  salida.push(`## Hoja «${h.nombre}»${h.oculta ? ' (oculta)' : ''} — ${h.filas} filas × ${h.cols} columnas`)
  const porFila = new Map<number, string[]>()
  for (const [f, c, v, m, fx] of h.celdas) {
    if (v === null && !fx) continue
    const valor = m ?? (typeof v === 'string' ? v : String(v))
    const celda = `${letra(c)}${f + 1}=${JSON.stringify(valor)}${fx ? ` (=${fx})` : ''}`
    const lista = porFila.get(f) ?? []
    lista.push(celda)
    porFila.set(f, lista)
  }
  for (const [f, celdas] of [...porFila].sort((a, b) => a[0] - b[0])) salida.push(`Fila ${f + 1}: ${celdas.join('  ')}`)
  if (h.combinadas.length) salida.push(`Celdas combinadas: ${h.combinadas.map(([a, b, c, d]) => `${letra(b)}${a + 1}:${letra(d)}${c + 1}`).join(', ')}`)
  salida.push('')
}

/** El documento como texto para Claude, desde `desde` y hasta un tope de caracteres. */
export function textoParaClaude(doc: Documento, nombre: string, desde = 0): string {
  const salida: string[] = []
  switch (doc.tipo) {
    case 'docx':
      salida.push(`Documento de Word «${nombre}»${doc.editable ? '' : ' (no editable sin riesgo)'}`, '')
      bloques(doc.bloques, salida)
      break
    case 'xlsx':
    case 'csv':
      salida.push(`${doc.tipo === 'xlsx' ? 'Libro de Excel' : 'CSV'} «${nombre}» con ${doc.hojas.length} hoja(s). Cada celda: referencia=valor mostrado (=fórmula si la tiene).`, '')
      for (const h of doc.hojas) hoja(h, salida)
      break
    case 'pptx':
      salida.push(`Presentación «${nombre}» con ${doc.diapositivas.length} diapositivas`, '')
      doc.diapositivas.forEach((d, i) => {
        salida.push(`## Diapositiva ${i + 1}`)
        for (const f of d.formas) {
          if (f.tipo === 'img') salida.push('[imagen]')
          if (f.b) bloques(f.b, salida)
        }
        if (d.notas) salida.push(`Notas del orador: ${d.notas}`)
        salida.push('')
      })
      break
    case 'pdf':
      salida.push(`PDF «${nombre}» con ${doc.paginas.length} páginas`, '')
      doc.paginas.forEach((p, i) => {
        salida.push(`## Página ${i + 1}`)
        if (p.soloImagen) salida.push('[página escaneada: solo imagen, sin texto]')
        let y = -1
        let linea = ''
        for (const t of [...p.textos].sort((a, b) => a.y - b.y || a.x - b.x)) {
          if (Math.abs(t.y - y) > 2 && linea) {
            salida.push(linea)
            linea = ''
          }
          y = t.y
          linea += (linea && !linea.endsWith(' ') && !t.t.startsWith(' ') ? ' ' : '') + t.t
        }
        if (linea) salida.push(linea)
        salida.push('')
      })
      break
    case 'texto':
      salida.push(doc.texto)
      break
    case 'imagen':
      salida.push(`Imagen «${nombre}» de ${doc.w} × ${doc.h} píxeles (${doc.formato}). Se le muestra a la persona en el visor; para verla tú, usa la herramienta Read sobre el archivo.`)
      break
  }
  if (doc.aviso) salida.push('', `Aviso del lector: ${doc.aviso}`)
  const todo = salida.join('\n')
  const parte = todo.slice(desde, desde + TOPE)
  const resto = todo.length - desde - parte.length
  return resto > 0 ? `${parte}\n\n[… faltan ${resto.toLocaleString('es')} caracteres: vuelve a llamar con desde=${desde + parte.length}]` : parte
}
