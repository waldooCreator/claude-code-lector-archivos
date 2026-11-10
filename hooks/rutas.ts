// Qué documentos nombra un comando de Bash o PowerShell, para mostrarlos en el visor.

/** Una ruta con extensión dentro de un comando: entre comillas, o suelta (con `\ ` para los espacios). */
const EN_COMANDO = /"([^"\n]+\.[A-Za-z0-9]{1,8})"|'([^'\n]+\.[A-Za-z0-9]{1,8})'|((?:[^\s"'`|;&<>()=,]|\\ )+\.[A-Za-z0-9]{1,8})(?=[\s"'`|;&<>()),]|$)/g

/** Comandos que solo listan, mueven o borran el archivo, o lo pasan a git: abrirlo ahí estorba. */
const SIN_VISOR = /^\s*(git|ls|dir|find|stat|du|wc|file|rm|del|mv|move|chmod|chown|touch|Get-ChildItem|gci|Remove-Item|ri|Move-Item|Rename-Item|Get-Item|Test-Path)\b/i

export const extension = (ruta: string) => (ruta.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? '').toLowerCase()

/** Las rutas con una de `extensiones` tal como aparecen en el comando, sin URLs, comodines ni variables. */
export function rutasEnComando(comando: string, extensiones: ReadonlySet<string>): string[] {
  if (SIN_VISOR.test(comando)) return []
  const salida: string[] = []
  for (const m of comando.matchAll(EN_COMANDO)) {
    const cruda = m[1] ?? m[2] ?? (m[3] ?? '').replace(/\\ /g, ' ')
    if (!cruda || !extensiones.has(extension(cruda))) continue
    if (/^[a-z]+:\/\//i.test(cruda) || /[*?$%]/.test(cruda)) continue
    if (!salida.includes(cruda)) salida.push(cruda)
  }
  return salida
}

/** Lo que escribe la persona en las opciones: «docx, .xlsx pdf» → {docx, xlsx, pdf}. */
export function listaDeOpcion(texto: string): string[] {
  return texto.split(/[\s,;]+/).map(x => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
}

/** ¿Está la ruta dentro de alguna carpeta (o es alguno de los nombres) de `ignorar`? */
export function ignorada(ruta: string, ignorar: readonly string[]): boolean {
  const partes = ruta.split(/[\\/]/).map(p => p.toLowerCase())
  return ignorar.some(n => partes.includes(n.toLowerCase()))
}
