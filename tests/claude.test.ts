import { expect, test } from 'claude-code/testing'

import type { Documento } from '../types'
import { ignorada, listaDeOpcion, rutasEnComando } from '../hooks/rutas'
import { textoParaClaude } from '../hooks/texto'

const EXT = new Set(listaDeOpcion('docx, xlsx, pdf, md, csv'))

test('encuentra los documentos que nombra un comando', () => {
  expect(rutasEnComando('python3 -c "import openpyxl" && soffice --convert-to pdf "Informe final.docx" --outdir salida', EXT)).toEqual(['Informe final.docx'])
  expect(rutasEnComando("unzip -p 'mi libro.xlsx' xl/workbook.xml", EXT)).toEqual(['mi libro.xlsx'])
  expect(rutasEnComando('pandoc notas.md -o /tmp/notas.pdf', EXT)).toEqual(['notas.md', '/tmp/notas.pdf'])
  expect(rutasEnComando('cp datos.csv copia\\ de\\ datos.csv', EXT)).toEqual(['datos.csv', 'copia de datos.csv'])
})

test('entiende rutas de Windows y comandos de PowerShell', () => {
  expect(rutasEnComando('python -c "print(1)" "C:\\Users\\Ana Pérez\\Documents\\Informe.docx"', EXT)).toEqual(['C:\\Users\\Ana Pérez\\Documents\\Informe.docx'])
  expect(rutasEnComando("Copy-Item -Path 'ventas.xlsx' -Destination D:\\respaldo\\ventas.xlsx", EXT)).toEqual(['ventas.xlsx', 'D:\\respaldo\\ventas.xlsx'])
  expect(rutasEnComando('Get-ChildItem *.docx', EXT)).toEqual([])
  expect(rutasEnComando('Remove-Item viejo.docx', EXT)).toEqual([])
  expect(rutasEnComando('python script.py notas.txt', EXT)).toEqual([])
})

test('opciones: listas de extensiones y carpetas ignoradas', () => {
  expect(listaDeOpcion('.DOCX, xlsx;pdf  md')).toEqual(['docx', 'xlsx', 'pdf', 'md'])
  expect(ignorada('C:\\proyecto\\dist\\a.pdf', ['dist'])).toBe(true)
  expect(ignorada('/home/x/distribucion/a.pdf', ['dist'])).toBe(false)
})

test('no abre nada en comandos de git, listados, comodines o URLs', () => {
  expect(rutasEnComando('git add README.md', EXT)).toEqual([])
  expect(rutasEnComando('ls *.pdf', EXT)).toEqual([])
  expect(rutasEnComando('curl -O https://ejemplo.org/a.pdf', EXT)).toEqual([])
  expect(rutasEnComando('for f in *.docx; do echo $f.docx; done', EXT)).toEqual([])
})

test('un Excel llega a Claude con hojas, celdas y fórmulas', () => {
  const doc: Documento = {
    tipo: 'xlsx',
    firma: 'x',
    hojas: [{ nombre: 'Ventas', filas: 2, cols: 2, celdas: [[0, 0, 'Total'], [0, 1, 30, '30,00', 'SUM(B2:B3)']], estilos: [], anchos: {}, combinadas: [] }],
  }
  const t = textoParaClaude(doc, 'ventas.xlsx')
  expect(t).toContain('Hoja «Ventas»')
  expect(t).toContain('A1="Total"')
  expect(t).toContain('B1="30,00" (=SUM(B2:B3))')
})

test('un Word llega con títulos, listas y tablas', () => {
  const doc: Documento = {
    tipo: 'docx',
    firma: 'x',
    editable: true,
    fuentes: [],
    defFont: 'Calibri',
    defPt: 11,
    bloques: [
      { k: 'p', id: 0, est: 'h1', r: [{ t: 'Resumen' }] },
      { k: 'p', id: 1, lista: { marca: '•', nivel: 0 }, r: [{ t: 'Uno' }] },
      { k: 'tabla', filas: [[{ b: [{ k: 'p', id: 2, r: [{ t: 'A' }] }] }, { b: [{ k: 'p', id: 3, r: [{ t: 'B' }] }] }]] },
    ],
  }
  const t = textoParaClaude(doc, 'informe.docx')
  expect(t).toContain('## Resumen')
  expect(t).toContain('- Uno')
  expect(t).toContain('| A | B |')
})

test('un texto largo se entrega por partes', () => {
  const doc: Documento = { tipo: 'texto', firma: 'x', texto: 'a'.repeat(50_000), codificacion: 'utf-8' }
  const primera = textoParaClaude(doc, 'largo.txt')
  expect(primera).toContain('desde=40000')
  expect(textoParaClaude(doc, 'largo.txt', 40_000)).toHaveLength(10_000)
})
