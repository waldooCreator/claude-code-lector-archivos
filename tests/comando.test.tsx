import { expect, test } from 'claude-code/testing'

const TEXTO = JSON.stringify({ tipo: 'texto', texto: '# Hola', codificacion: 'utf-8', firma: 'x' })

test('/leer abre el archivo con el binario del mod y muestra el panel', async ($, on) => {
  const opens: unknown[] = []
  const llamadas: string[][] = []
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    llamadas.push([...e.argv])
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: 'Linux x86_64\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    return { value: { exitCode: 0, stdout: TEXTO, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('session.cwd', () => ({ value: '/proyecto' }) as never)
  on('ui.open', (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })

  const ran = await $.command.run({ command: 'leer', args: '"nota.md"' } as never)
  expect(ran).toMatchObject({ text: 'Abierto: nota.md' })
  expect(opens).toHaveLength(1)
  const abrir = llamadas.find(a => a[1] === 'abrir')!
  expect(abrir[0]).toContain('/bin/lector-linux-amd64')
  expect(abrir[2]).toBe('/proyecto/nota.md')
})

test('un archivo que no se puede abrir lo dice sin romper la sesión', async ($, on) => {
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) =>
    e.argv[0] === 'uname'
      ? ({ value: { exitCode: 0, stdout: 'Linux x86_64\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never)
      : ({ value: { exitCode: 0, stdout: '{"error":"archivo binario"}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never),
  )
  on('session.cwd', () => ({ value: '/proyecto' }) as never)

  const ran = await $.command.run({ command: 'leer', args: 'raro.bin' } as never)
  expect(ran).toMatchObject({ text: 'No se pudo abrir: archivo binario' })
})
