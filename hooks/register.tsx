import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Documento, Raster, RespuestaGuardar } from '../types'
import { extension, ignorada, listaDeOpcion, rutasEnComando } from './rutas'
import { textoParaClaude } from './texto'
import { abrirDocumento, accion, estaSucia, guardadoListo, nuevaApp, pintar, puntero, rueda, tecla } from './motor'
import type { Efecto, ImagenCuadro } from './motor'

const PANEL = 'lector-archivos'
const version = atom({ plugin: 'lector-archivos', key: 'version' } as const, 0)

/** Lo que Claude abre solo, salvo que la persona cambie la opción «extensiones». */
const AUTOMATICOS_DEFECTO = 'docx, docm, xlsx, xlsm, pptx, pptm, pdf, md, markdown, csv, tsv, png, jpg, jpeg, gif'
const HERRAMIENTA = 'leer'
/** Archivos de trabajo de Claude: abrirlos cada vez solo estorba. */
const INTERNOS = /(^|[\\/])(\.claude|\.git|node_modules)[\\/]|(^|[\\/])(CLAUDE|MEMORY|SKILL)\.md$/i
const TOPE_RASTER = 40
const AVISO_CLAUDE = [
  '# Lector de archivos',
  'La persona tiene instalado el mod «Lector de archivos»: un visor y editor de documentos dentro de esta terminal.',
  '- Para leer un .docx, .xlsx, .pptx, .pdf, .md, .csv o .json usa la herramienta mcp__lector-archivos__leer: te da el contenido con su estructura y al mismo tiempo se lo muestra a la persona en el visor. Prefiérela a Read, python, unzip o pandoc para leer esos formatos.',
  '- Cuando creas o modificas uno de esos archivos (con Write, Edit o un script), el visor lo abre solo para que la persona vea el resultado; no hace falta que se lo describas en detalle.',
  '- La persona puede abrir cualquier archivo con /leer <ruta>, editar Word, Excel, CSV y texto en el visor, y guardar con Ctrl+S (queda una copia del original en .respaldos/ junto al archivo).',
].join('\n')

const app = nuevaApp()
const rasters = new Map<string, Raster>()
const pendientes = new Set<string>()
let ultimoAck = 0
let firmaImagenes = ''
let binarioListo = ''
let ultimas: ImagenCuadro[] = []
let sistema = { os: '', arch: '', como: '' }

/** Las opciones del mod (`userConfig`), leídas al cargar. */
const config = { abrirSolo: true, extensiones: new Set(listaDeOpcion(AUTOMATICOS_DEFECTO)), ignorar: [] as string[], anchoPanel: 110 }

async function binario($: EngineInterface): Promise<string> {
  if (binarioListo) return binarioListo
  let os = 'windows'
  let arch = 'amd64'
  let como = 'por descarte (no respondió uname)'
  // Windows lo dice en su variable OS; ahí no se pregunta a uname, que solo existe con Git Bash.
  // El binario de amd64 también corre en un Windows ARM, emulado.
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') como = 'variable OS=Windows_NT'
  else {
    try {
      const r = await $.process.run(['uname', '-s', '-m'], { timeoutMs: 5000 })
      if (r.exitCode === 0) {
        const [s, m] = r.stdout.trim().split(/\s+/)
        if (s === 'Darwin') os = 'darwin'
        else if (s === 'Linux') os = 'linux'
        arch = m === 'arm64' || m === 'aarch64' ? 'arm64' : 'amd64'
        como = `uname: ${r.stdout.trim()}`
      }
    } catch {
      // Sin uname y sin OS=Windows_NT: se intenta con el de Windows.
    }
  }
  sistema = { os, arch, como }
  binarioListo = `${$.plugin.root}/bin/lector-${os}-${arch}${os === 'windows' ? '.exe' : ''}`
  return binarioListo
}

async function llamar<T>($: EngineInterface, args: string[], stdin?: string, timeoutMs = 120_000): Promise<T> {
  const bin = await binario($)
  const r = await $.process.run([bin, ...args], { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
  if (r.isStdoutTruncated) throw new Error('El documento es demasiado grande para abrirlo.')
  let datos: T & { error?: string }
  try {
    datos = JSON.parse(r.stdout) as T & { error?: string }
  } catch {
    throw new Error(r.stderr.trim().slice(0, 200) || 'El lector no respondió.')
  }
  if (datos.error) throw new Error(datos.error)
  return datos
}

const redibujar = ($: EngineInterface) => update($, version, n => n + 1)

/** La carpeta personal: HOME en Linux y macOS, USERPROFILE en Windows. */
async function carpetaPersonal($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined)) || undefined
}

/** Expande `~` y `%USERPROFILE%`, resuelve lo relativo y quita comillas de una ruta pegada. */
async function resolverRuta($: EngineInterface, cruda: string): Promise<string> {
  let limpia = cruda.trim().replace(/^(['"])(.*)\1$/, '$2')
  const cwd = await $.session.cwd()
  const sep = cwd.includes('\\') ? '\\' : '/'
  if (/^(~|%USERPROFILE%|\$HOME|\$env:USERPROFILE)([\\/]|$)/i.test(limpia)) {
    const casa = await carpetaPersonal($)
    if (casa) limpia = casa.replace(/[\\/]$/, '') + limpia.replace(/^(~|%USERPROFILE%|\$HOME|\$env:USERPROFILE)/i, '')
  }
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(limpia)) return limpia
  return `${cwd.replace(/[\\/]$/, '')}${sep}${limpia}`
}

async function abrirRuta($: EngineInterface, ruta: string, timeoutMs?: number): Promise<Documento> {
  const doc = await llamar<Documento>($, ['abrir', ruta], undefined, timeoutMs)
  abrirDocumento(app, ruta, doc)
  await redibujar($)
  return doc
}

/** Las rutas de documentos que un comando de Bash nombra, resueltas contra la carpeta de trabajo. */
async function rutasDeComando($: EngineInterface, comando: string): Promise<string[]> {
  const halladas: string[] = []
  for (const cruda of rutasEnComando(comando, config.extensiones)) {
    const ruta = await resolverRuta($, cruda)
    if (!halladas.includes(ruta)) halladas.push(ruta)
  }
  const existen: string[] = []
  for (const r of halladas) if (await $.fs.exists(r).catch(() => false)) existen.push(r)
  return existen.slice(-3)
}

async function mostrarPanel($: EngineInterface): Promise<boolean> {
  const r = await $.ui.open({ id: PANEL, title: 'Lector', focus: true, columns: config.anchoPanel, rows: 40 })
  return r.isPlaced
}

async function pedirRaster($: EngineInterface, img: ImagenCuadro): Promise<void> {
  const k = claveRaster(img)
  if (rasters.has(k) || pendientes.has(k)) return
  pendientes.add(k)
  try {
    const interna = img.src.startsWith('archivo:')
    const ruta = interna ? img.src.slice(8) : img.ruta
    const parte = interna ? '-' : img.src
    const r = await llamar<Raster>($, ['raster', ruta, parte, String(img.cols), String(img.filas)])
    rasters.set(k, r)
    if (rasters.size > TOPE_RASTER) rasters.delete(rasters.keys().next().value!)
    // La medida real corrige el alto reservado en la página.
    if (interna && !app.medidas.has(img.src)) app.medidas.set(img.src, { cols: r.cols, filas: r.filas })
    await redibujar($)
  } catch {
    rasters.set(k, { cols: 0, filas: 0, cells: '' })
  } finally {
    pendientes.delete(k)
  }
}

const claveRaster = (i: ImagenCuadro) => `${i.ruta}|${i.src}|${i.cols}x${i.filas}`

/** Recorta del raster completo lo que se ve del recuadro. */
function recorte(r: Raster, img: ImagenCuadro): { cols: number; filas: number; cells: string } | null {
  if (!r.cols || !r.filas) return null
  const verC = Math.min(img.verC, r.cols - img.desdeC)
  const verF = Math.min(img.verF, r.filas - img.desdeF)
  if (verC <= 0 || verF <= 0) return null
  if (img.desdeC === 0 && img.desdeF === 0 && verC === r.cols && verF === r.filas) return { cols: r.cols, filas: r.filas, cells: r.cells }
  const bytes = Uint8Array.fromBase64(r.cells)
  const salida = new Uint8Array(verC * verF * 12)
  for (let f = 0; f < verF; f++) {
    const desde = ((f + img.desdeF) * r.cols + img.desdeC) * 12
    salida.set(bytes.subarray(desde, desde + verC * 12), f * verC * 12)
  }
  return { cols: verC, filas: verF, cells: salida.toBase64() }
}

async function efectos($: EngineInterface, lista: Efecto[], superficie: string): Promise<void> {
  for (const ef of lista) {
    if (ef.t === 'copiar') {
      await $.ui.copy({ text: ef.texto, surface: superficie as never }).catch(() => undefined)
      $.ui.toast('Copiado al portapapeles.')
    } else if (ef.t === 'cerrar-panel') {
      await $.ui.close({ id: PANEL }).catch(() => undefined)
    } else if (ef.t === 'guardar') {
      void guardar($, ef)
    } else if (ef.t === 'recargar') {
      await abrirRuta($, ef.ruta).catch(() => undefined)
    }
  }
}

async function guardar($: EngineInterface, ef: Extract<Efecto, { t: 'guardar' }>): Promise<void> {
  app.aviso = 'Guardando…'
  await redibujar($)
  try {
    const r = await llamar<RespuestaGuardar>($, ['guardar', ef.ruta], JSON.stringify(ef.datos))
    if (r.ok) {
      guardadoListo(app, ef.id, r.firma)
      app.aviso = `Guardado. Copia del original en ${r.respaldo.split(/[\\/]/).slice(-2).join('/')}`
    } else {
      app.aviso = r.conflicto ? `${r.error} No se guardó: ciérralo y vuelve a abrirlo.` : r.error
    }
  } catch (err) {
    app.aviso = err instanceof Error ? err.message : 'No se pudo guardar.'
  }
  await redibujar($)
}

/** Abre el visor sobre lo que Claude acaba de leer o escribir, sin estorbar. */
async function abrirSolo($: EngineInterface, ruta: unknown): Promise<void> {
  if (typeof ruta !== 'string') return
  if (!config.extensiones.has(extension(ruta)) || INTERNOS.test(ruta) || ignorada(ruta, config.ignorar)) return
  const previa = app.pestanas.find(p => p.ruta === ruta)
  if (previa && estaSucia(previa)) {
    app.aviso = 'Claude cambió este archivo y tienes cambios sin guardar: guárdalos en otra copia.'
    return
  }
  await abrirRuta($, ruta, 15_000)
  await $.ui.open({ id: PANEL, title: 'Lector', columns: config.anchoPanel, rows: 40 })
}

/** Revisa que todo esté en su sitio y lo cuenta en palabras: para la persona y para Claude. */
async function diagnosticar($: EngineInterface): Promise<string> {
  const lineas: string[] = ['Diagnóstico del Lector de archivos', '']
  const bien = (t: string) => lineas.push(`✔ ${t}`)
  const mal = (t: string) => lineas.push(`✘ ${t}`)
  const v = await $.session.version().catch(() => undefined)
  lineas.push(`Claude Code: ${v?.version ?? 'desconocida'} (probado con 2.1.303)`)
  binarioListo = ''
  const bin = await binario($)
  lineas.push(`Sistema detectado: ${sistema.os} ${sistema.arch} (${sistema.como})`)
  lineas.push(`Carpeta del mod: ${$.plugin.root}`)
  lineas.push(`Carpeta de trabajo: ${await $.session.cwd()}`)
  lineas.push(`Carpeta personal: ${(await carpetaPersonal($)) ?? 'no encontrada (HOME/USERPROFILE vacías): «~» no funcionará'}`)
  lineas.push('')
  if (!(await $.fs.exists(bin).catch(() => false))) {
    mal(`No está el programa del lector: ${bin}`)
    lineas.push('  La carpeta bin/ del mod está incompleta. Vuelve a clonar el repositorio o revisa que el antivirus no lo haya borrado.')
  } else {
    bien(`Programa del lector: ${bin}`)
    const inicio = Date.now()
    try {
      const doc = await llamar<Documento>($, ['abrir', `${$.plugin.root}/README.md`], undefined, 20_000)
      bien(`El programa arranca y lee archivos (${doc.tipo}, ${Date.now() - inicio} ms)`)
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err)
      mal(`El programa no arranca: ${motivo}`)
      if (sistema.os === 'windows') lineas.push('  En Windows suele ser el antivirus o SmartScreen bloqueando el .exe (no está firmado). Ábrelo una vez desde el Explorador y elige «Ejecutar de todas formas», o agrega la carpeta bin\\ del mod a las exclusiones de Windows Defender.')
      else lineas.push(`  Prueba darle permiso de ejecución: chmod +x "${bin}"`)
    }
  }
  lineas.push('')
  lineas.push(`Apertura automática: ${config.abrirSolo ? 'encendida' : 'apagada'}`)
  lineas.push(`  Extensiones: ${[...config.extensiones].join(', ')}`)
  lineas.push(`  Nunca abre: CLAUDE.md, MEMORY.md, SKILL.md y lo que esté en .claude, .git o node_modules${config.ignorar.length ? `, ${config.ignorar.join(', ')}` : ''}`)
  lineas.push('  Escucha las herramientas Read, Write, Edit, Bash y PowerShell de Claude y de sus subagentes.')
  lineas.push(`Herramienta de Claude: mcp__lector-archivos__${HERRAMIENTA}`)
  lineas.push(`Ancho pedido para el panel: ${config.anchoPanel} columnas (el panel aparece solo si la terminal es ancha o está en pantalla completa)`)
  return lineas.join('\n')
}

export const register: Register = (on, options) => {
  config.abrirSolo = options.abrirSolo !== false
  if (typeof options.extensiones === 'string' && listaDeOpcion(options.extensiones).length) config.extensiones = new Set(listaDeOpcion(options.extensiones))
  if (typeof options.ignorar === 'string') config.ignorar = listaDeOpcion(options.ignorar)
  if (typeof options.anchoPanel === 'number' && options.anchoPanel >= 40) config.anchoPanel = Math.round(options.anchoPanel)

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: HERRAMIENTA,
      description:
        'Lee un documento de la persona (Word .docx, Excel .xlsx, PowerPoint .pptx, PDF, Markdown, CSV, JSON, texto o imagen) ' +
        'y a la vez lo abre en el visor del Lector de archivos para que la persona lo vea con su formato original. ' +
        'Devuelve el contenido como texto con su estructura: títulos, listas y tablas de un Word; cada hoja con sus celdas, valores y fórmulas de un Excel; ' +
        'cada diapositiva con sus notas; cada página de un PDF. Úsala siempre que necesites leer uno de esos archivos, en lugar de Read, python o unzip. ' +
        'Si el texto es largo, la respuesta dice desde dónde seguir.',
      inputSchema: {
        type: 'object',
        properties: {
          ruta: { type: 'string', description: 'Ruta del archivo, absoluta o relativa a la carpeta de trabajo.' },
          desde: { type: 'integer', minimum: 0, description: 'Carácter desde el que seguir leyendo un documento largo (lo indica la respuesta anterior).' },
        },
        required: ['ruta'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'diagnostico',
      description:
        'Revisa la instalación del Lector de archivos en este equipo: sistema operativo detectado, si su programa arranca, versión de Claude Code, carpetas y opciones de apertura automática. ' +
        'Úsala al instalar o adaptar el mod (ver INSTALAR.md y ADAPTAR.md en la carpeta del mod) o cuando el visor no abre un archivo.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.command.register({ name: 'leer-diagnostico', description: 'Revisa que el Lector de archivos funcione en este equipo' })
    await $.command.register({ name: 'leer', description: 'Abre un documento en el visor: Word, Excel, PowerPoint, PDF, Markdown, CSV, JSON, imágenes y texto', argumentHint: '<ruta del archivo>' })
    return next(e)
  })

  on('command.run', { command: 'leer-diagnostico' }, async $ => ({ text: await diagnosticar($) }))

  on('tool.call', { tool: 'mcp__lector-archivos__diagnostico' as never }, async $ => ({ result: await diagnosticar($) })).catch(() => ({
    result: 'El diagnóstico falló dentro del mod. Revisa la carpeta del mod y ejecuta claude plugin validate sobre ella.',
  }))

  on('command.run', { command: 'leer' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    if (!args) {
      await mostrarPanel($)
      return { text: 'Escribe /leer <ruta del archivo> para abrir un documento.' }
    }
    try {
      const ruta = await resolverRuta($, args)
      await abrirRuta($, ruta)
      const puesto = await mostrarPanel($)
      return { text: puesto ? `Abierto: ${ruta.split(/[\\/]/).pop()}` : 'El visor se abrirá cuando la terminal tenga más espacio.' }
    } catch (err) {
      return { text: err instanceof Error ? `No se pudo abrir: ${err.message}` : 'No se pudo abrir el archivo.' }
    }
  })

  // Claude (o un subagente suyo) leyó o escribió un documento: se le muestra a la persona.
  // Read también cuenta cuando falla: Read no entiende un .docx o un .xlsx, pero la persona sí quiere verlo.
  on('tool.call', { tool: ['Read', 'Write', 'Edit'] }, async ($, e, next) => {
    const hecho = await next(e)
    const ok = !('deny' in hecho) && (e.tool === 'Read' || !(hecho as { isError?: boolean }).isError)
    const ruta = (e as { file_path?: unknown }).file_path
    if (config.abrirSolo && ok && typeof ruta === 'string' && (await $.fs.exists(ruta).catch(() => false))) await abrirSolo($, ruta).catch(() => undefined)
    return hecho
  })

  // Lo mismo cuando lo toca por la terminal (python, pandoc, libreoffice, cp…), en Bash o en PowerShell de Windows.
  on('tool.call', { tool: ['Bash', 'PowerShell'] as never }, async ($, e, next) => {
    const hecho = await next(e)
    if (!config.abrirSolo || 'deny' in hecho) return hecho
    const comando = (e as { command?: unknown }).command
    if (typeof comando !== 'string' || comando.length > 20_000) return hecho
    const rutas = await rutasDeComando($, comando).catch(() => [] as string[])
    for (const r of rutas) await abrirSolo($, r).catch(() => undefined)
    return hecho
  })

  // La herramienta de Claude: lee el documento como texto y a la vez se lo muestra a la persona.
  on('tool.call', { tool: 'mcp__lector-archivos__leer' as never }, async ($, e) => {
    const pedido = e as unknown as { ruta?: string; desde?: number }
    if (!pedido.ruta) return { result: 'Falta la ruta del archivo.' }
    const ruta = await resolverRuta($, pedido.ruta)
    try {
      const doc = await abrirRuta($, ruta)
      await $.ui.open({ id: PANEL, title: 'Lector', columns: 110, rows: 40 }).catch(() => undefined)
      return { result: textoParaClaude(doc, ruta.split(/[\\/]/).pop() ?? ruta, Math.max(0, pedido.desde ?? 0)) }
    } catch (err) {
      return { result: `No se pudo leer ${ruta}: ${err instanceof Error ? err.message : 'error desconocido'}` }
    }
  }).catch(() => ({ result: 'El lector de archivos falló al abrir el documento.' }))

  // Claude sabe en cada sesión que tiene el visor y cómo usarlo.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes(`mcp__lector-archivos__${HERRAMIENTA}`)) return r
    return { sections: [...r.sections, { id: 'lector-archivos:uso', scope: 'session' as const, text: AVISO_CLAUDE }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const els = $.ui.resolve(e)
    if (!('Client' in els) || !('Raster' in els)) return <els.Text dimColor>El lector de archivos se usa desde la terminal.</els.Text>
    const { Box, Client, Raster: RasterEl } = els
    await read($, version)
    const W = Math.max(40, e.props.bodyColumns || 100)
    const H = Math.max(12, e.props.scroll?.bodyRows ?? 30)
    const { cuadro, imagenes } = pintar(app, W, H)
    ultimas = imagenes
    firmaImagenes = imagenes.map(claveRaster).join(';') + imagenes.map(i => `${i.x},${i.y},${i.desdeF},${i.desdeC}`).join(';')
    for (const img of imagenes) if (!rasters.has(claveRaster(img))) void pedirRaster($, img)
    return (
      <Box width={W} height={H}>
        <Client key="visor" module="./visor.tsx" props={cuadro} width={W} height={H} />
        {imagenes.flatMap((img, i) => {
          const r = rasters.get(claveRaster(img))
          const parte = r && recorte(r, img)
          if (!parte) return []
          const dx = Math.max(0, Math.floor((img.verC - parte.cols) / 2))
          const dy = Math.max(0, Math.floor((img.verF - parte.filas) / 2))
          return [
            <Box position="absolute" top={img.y + dy} left={img.x + dx}>
              <RasterEl key={`i${i}`} columns={parte.cols} rows={parte.filas} cells={parte.cells} />
            </Box>,
          ]
        })}
      </Box>
    )
  })

  on('ui.message', { requestId: PANEL }, async ($, e) => {
    const m = e.data as { q?: unknown[]; w?: number; h?: number }
    if (!Array.isArray(m?.q)) return {}
    const W = m.w && m.w > 0 ? m.w : app.W
    const H = m.h && m.h > 0 ? m.h : app.H
    app.W = W
    app.H = H
    for (const entrada of m.q as ([number, string, number] | [number, 'p', string, number, number, number])[]) {
      if (entrada[0] <= ultimoAck) continue
      ultimoAck = entrada[0]
      if (entrada[1] === 'p') {
        const [, , tipo, x, y, shift] = entrada as [number, 'p', 'down' | 'move' | 'up', number, number, number]
        await efectos($, puntero(app, { tipo, x, y, ...(shift ? { shift: true } : {}) }), e.surface)
      } else {
        const [, k, mods] = entrada as [number, string, number]
        await efectos($, tecla(app, k, { ctrl: !!(mods & 1), shift: !!(mods & 2), meta: !!(mods & 4) }), e.surface)
      }
    }
    app.ultimoAck = ultimoAck
    const { cuadro, imagenes } = pintar(app, W, H)
    ultimas = imagenes
    const firma = imagenes.map(claveRaster).join(';') + imagenes.map(i => `${i.x},${i.y},${i.desdeF},${i.desdeC}`).join(';')
    // Las imágenes viven en el árbol del panel: si se movieron, hay que redibujarlo.
    if (firma !== firmaImagenes) await redibujar($)
    return { props: cuadro }
  })

  on('ui.scroll', { requestId: PANEL }, async ($, e) => {
    rueda(app, e.by)
    await redibujar($)
    return {}
  })

  on('ui.close', { id: PANEL }, async ($, e, next) => {
    const sucia = app.pestanas.find(estaSucia)
    if (sucia && e.origin.kind === 'person') app.aviso = `${sucia.nombre} tiene cambios sin guardar.`
    return next(e)
  })

  void accion
  void ultimas
}
