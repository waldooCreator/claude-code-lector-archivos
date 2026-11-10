import { expect, test } from 'claude-code/testing'

import type { DocHoja, DocWord } from '../types'
import * as Ed from '../hooks/editor'
import * as Ho from '../hooks/hoja'

const docWord = (): DocWord & { firma: string } => ({
  tipo: 'docx',
  firma: 'abc',
  editable: true,
  fuentes: ['Calibri'],
  defFont: 'Calibri',
  defPt: 11,
  bloques: [
    { k: 'p', id: 0, r: [{ t: 'Hola ', o: 0 }, { t: 'mundo', b: 1, o: 1 }] },
    { k: 'p', id: 1, r: [{ t: 'Segundo', o: 0 }] },
    { k: 'p', id: 2, r: [{ t: 'Con enlace', href: 'https://x', o: 0 }], ed: 0 },
  ],
})

test('escribir inserta con el formato del lugar y marca solo lo tocado', () => {
  const e = Ed.nuevoEditor(docWord())
  e.cur = { p: 0, c: 5 }
  expect(Ed.escribir(e, 'X')).toBeNull()
  expect(Ed.textoDe(e.planos[0]!.par)).toBe('Hola Xmundo')
  const g = Ed.resumenGuardado(e)
  expect(g.tipo).toBe('docx')
  if (g.tipo === 'docx') {
    expect(g.parrafos).toHaveLength(1)
    expect(g.parrafos[0]!.id).toBe(0)
  }
})

test('Enter parte el párrafo y ambos van al mismo original', () => {
  const e = Ed.nuevoEditor(docWord())
  e.cur = { p: 1, c: 3 }
  Ed.escribir(e, '\n')
  expect(e.planos.map(x => Ed.textoDe(x.par))).toEqual(['Hola mundo', 'Seg', 'undo', 'Con enlace'])
  expect(e.cur).toEqual({ p: 2, c: 0 })
  const g = Ed.resumenGuardado(e)
  if (g.tipo === 'docx') expect(g.parrafos[0]).toMatchObject({ id: 1, nuevos: [{ r: [{ t: 'Seg' }] }, { r: [{ t: 'undo' }] }] })
})

test('negrita sobre la selección parte el run y al borrar el segundo párrafo se reporta', () => {
  const e = Ed.nuevoEditor(docWord())
  e.cur = { p: 1, c: 0 }
  e.ancla = { p: 1, c: 0 }
  e.cur = { p: 1, c: 3 }
  expect(Ed.formatear(e, { b: true })).toBeNull()
  expect(e.planos[1]!.par.r.map(r => [r.t, !!r.b])).toEqual([['Seg', true], ['undo', false]])
  e.ancla = null
  e.cur = { p: 1, c: 0 }
  Ed.borrarAtras(e)
  expect(e.planos).toHaveLength(2)
  const g = Ed.resumenGuardado(e)
  if (g.tipo === 'docx') expect(g.parrafos.find(x => x.id === 1)?.nuevos).toEqual([])
})

test('cambio de tamaño y fuente solo viajan si la persona los pidió', () => {
  const doc = docWord()
  ;(doc.bloques[0] as { r: { t: string; pt?: number }[] }).r[0]!.pt = 11
  const e = Ed.nuevoEditor(doc)
  e.cur = { p: 0, c: 2 }
  Ed.escribir(e, 'y')
  let g = Ed.resumenGuardado(e)
  if (g.tipo === 'docx') expect(g.parrafos[0]!.nuevos[0]!.r[0]!.pt).toBeUndefined()
  e.ancla = { p: 0, c: 0 }
  e.cur = { p: 0, c: 3 }
  Ed.formatear(e, { pt: 18, font: 'Arial' })
  g = Ed.resumenGuardado(e)
  if (g.tipo === 'docx') expect(g.parrafos[0]!.nuevos[0]!.r[0]).toMatchObject({ pt: 18, font: 'Arial' })
})

test('un párrafo con enlaces no se puede tocar', () => {
  const e = Ed.nuevoEditor(docWord())
  e.cur = { p: 2, c: 1 }
  expect(Ed.escribir(e, 'x')).toContain('no lo modifica')
  expect(Ed.resumenGuardado(e)).toMatchObject({ parrafos: [] })
})

test('deshacer vuelve al estado anterior', () => {
  const e = Ed.nuevoEditor(docWord())
  e.cur = { p: 0, c: 0 }
  Ed.escribir(e, 'a')
  Ed.escribir(e, 'b')
  Ed.deshacer(e)
  expect(Ed.textoDe(e.planos[0]!.par)).toBe('Hola mundo')
})

const docHoja = (): DocHoja & { firma: string } => ({
  tipo: 'xlsx',
  firma: 'f',
  hojas: [
    { nombre: 'Datos', filas: 3, cols: 2, celdas: [[0, 0, 10], [1, 0, 20], [2, 0, 30, undefined, 'SUM(A1:A2)']], estilos: [], anchos: {}, combinadas: [] },
    { nombre: 'Otra', filas: 1, cols: 1, celdas: [[0, 0, 5]], estilos: [], anchos: {}, combinadas: [] },
  ],
})

test('editar una celda recalcula las fórmulas que dependen de ella', () => {
  const est = Ho.nuevaHoja(docHoja())
  est.hojas[0]!.cur = [0, 0]
  Ho.confirmar(est, '100', false)
  expect(est.hojas[0]!.celdas.get('2,0')!.v).toBe(120)
  const g = Ho.resumenHoja(est)
  if (g.tipo === 'xlsx') expect(g.cambios).toEqual(expect.arrayContaining([{ hoja: 0, f: 0, c: 0, v: 100 }, { hoja: 0, f: 2, c: 0, v: 120, formula: 'SUM(A1:A2)' }]))
})

test('fórmulas en español, entre hojas y con error de división', () => {
  const est = Ho.nuevaHoja(docHoja())
  const h = est.hojas[0]!
  h.cur = [0, 1]
  Ho.confirmar(est, '=PROMEDIO(A1:A3)+Otra!A1', false)
  expect(h.celdas.get('0,1')!.v).toBe(25)
  h.cur = [1, 1]
  Ho.confirmar(est, '=SI(A1>5;"alto";"bajo")', false)
  expect(h.celdas.get('1,1')!.v).toBe('alto')
  h.cur = [2, 1]
  Ho.confirmar(est, '=1/0', false)
  expect(h.celdas.get('2,1')!.v).toBe('#¡DIV/0!')
})

test('una función desconocida conserva el valor calculado por Excel', () => {
  const doc = docHoja()
  doc.hojas[0]!.celdas.push([0, 1, 77, undefined, 'VLOOKUP(A1,A1:A3,1,0)'])
  const est = Ho.nuevaHoja(doc)
  est.hojas[0]!.cur = [1, 0]
  Ho.confirmar(est, '21', false)
  expect(est.hojas[0]!.celdas.get('0,1')!.v).toBe(77)
})

test('borrar y deshacer una celda', () => {
  const est = Ho.nuevaHoja(docHoja())
  est.hojas[0]!.cur = [1, 0]
  Ho.borrarRango(est)
  expect(est.hojas[0]!.celdas.has('1,0')).toBe(false)
  Ho.deshacerHoja(est)
  expect(est.hojas[0]!.celdas.get('1,0')!.v).toBe(20)
})

test('nombres de columna', () => {
  expect(Ho.letraDe(0)).toBe('A')
  expect(Ho.letraDe(27)).toBe('AB')
  expect(Ho.refDe(4, 2)).toBe('C5')
})
