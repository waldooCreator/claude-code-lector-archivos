import type { ClientKeyEvent, ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

import type { CuadroVisor } from '../types'

// El panel es una terminal tonta: dibuja el cuadro que le llega y manda las
// teclas y clics al mod. Solo un mensaje por cuadro llega al mod, y uno nuevo
// reemplaza al anterior, así que las teclas se juntan en una cola con número
// y se reenvían hasta que el mod las acusa: ninguna se pierde al teclear rápido.

type Entrada = [number, string, number] | [number, 'p', string, number, number, number]

let cola: Entrada[] = []
let siguiente = 1
let ultimoEnvio = ''

const ESPECIALES = new Set(['up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'return', 'tab', 'backspace', 'delete', 'space'])

function leerTecla(ev: ClientKeyEvent): string | null {
  if (ESPECIALES.has(ev.key)) return ev.key
  if (/^\x1b?\[12~$/.test(ev.key)) return 'f2'
  if (/^\x1b?(\[[\d;]*[~A-Za-z]|O[A-Z])$/.test(ev.key)) return null
  return ev.key.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') || null
}

const Visor: ClientModule<CuadroVisor & JsonValue, { n: number }> = (props, surface) => {
  const { Box, Text } = surface.elements
  const cuadro = props as CuadroVisor
  if (surface.state === undefined) {
    surface.setState({ n: 0 })
    cola = []
    siguiente = 1
    ultimoEnvio = ''
    surface.every(16, () => {
      if (!cola.length) return
      const carga = JSON.stringify(cola)
      if (carga === ultimoEnvio && Date.now() % 12 !== 0) return
      ultimoEnvio = carga
      surface.post({ q: cola as unknown as JsonValue, w: surface.columns, h: surface.rows })
    })
  }
  // Lo que el mod ya acusó sale de la cola.
  if (cuadro.ack) cola = cola.filter(e => e[0] > cuadro.ack)

  surface.onKey((ev: ClientKeyEvent) => {
    const k = leerTecla(ev)
    if (k === null) return
    const mods = (ev.ctrl ? 1 : 0) | (ev.shift ? 2 : 0) | (ev.meta ? 4 : 0)
    cola.push([siguiente++, k, mods])
  })
  surface.onPointer((ev: ClientPointerEvent) => {
    if (ev.type !== 'down' && ev.type !== 'up' && ev.type !== 'move') return
    if (ev.type === 'down' && ev.button && ev.button !== 'left') return
    if (ev.type === 'move' && !ev.button) return
    cola.push([siguiente++, 'p', ev.type, ev.x, ev.y, ev.shift ? 1 : 0])
  })

  return (
    <Box flexDirection="column" width={surface.columns || cuadro.ancho} height={surface.rows || cuadro.alto}>
      {cuadro.filas.map(fila => (
        <Text wrap="truncate-end">
          {fila.map(t => (
            <Text
              color={t[1]}
              backgroundColor={t[2]}
              {...(t[3] && t[3] & 1 ? { bold: true } : {})}
              {...(t[3] && t[3] & 2 ? { italic: true } : {})}
              {...(t[3] && t[3] & 4 ? { underline: true } : {})}
              {...(t[3] && t[3] & 8 ? { strikethrough: true } : {})}
            >
              {t[0]}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Visor
