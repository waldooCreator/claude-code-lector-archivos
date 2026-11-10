# Lector de archivos: guía para adaptarlo

Mod de Claude Code: un visor y editor de documentos dentro de la terminal. Abre Word, Excel, PowerPoint, PDF, Markdown, CSV, JSON, imágenes y texto con el aspecto de su formato original, y le da a Claude una herramienta para leerlos. Para instalarlo, sigue `INSTALAR.md`. Esta guía es para **cambiarlo o adaptarlo** a un equipo.

## Cómo está hecho

```
.claude-plugin/plugin.json   nombre, versión y opciones (userConfig)
hooks/hooks.json             qué módulo carga Claude Code
hooks/register.tsx           el pegamento: /leer, /leer-diagnostico, herramientas de Claude,
                             apertura automática, nota en el system prompt, panel
hooks/motor.ts               el visor: pestañas, barra, dibujo de cada formato, teclas y ratón
hooks/maqueta.ts             bloques → líneas de página (párrafos, tablas, código, citas, imágenes)
hooks/lienzo.ts              la cuadrícula de celdas y su conversión a tramos de color
hooks/visor.tsx              el módulo de superficie (Client): dibuja el cuadro y manda teclas y clics
hooks/editor.ts              edición de Word: texto, formato, deshacer, qué se guarda
hooks/hoja.ts                hoja de cálculo: celdas, fórmulas, deshacer, qué se guarda
hooks/markdown.ts            Markdown → bloques; hooks/mermaid.ts: diagramas dibujados con caracteres
hooks/texto.ts               documento → texto para Claude (herramienta `leer`)
hooks/rutas.ts               qué documentos nombra un comando de Bash/PowerShell; opciones en lista
types/index.d.ts             el contrato JSON entre el binario y el mod
puente/                      el binario en Go (solo biblioteca estándar): abrir, raster, guardar
bin/                         ese binario compilado para cada sistema
ejemplos/                    archivos de prueba inventados
tests/                       pruebas (`claude plugin test .`)
```

Flujo: `register.tsx` ejecuta `bin/lector-<so>-<arq> abrir <ruta>`, que devuelve JSON (`types/index.d.ts`). `motor.ts` lo convierte en una vista, la pinta en un `Lienzo` y la manda al panel. Las teclas y los clics vuelven por `ui.message`. Al guardar, `editor.ts` y `hoja.ts` arman un resumen de cambios y `lector guardar <ruta>` lo aplica sobre el archivo original, dejando una copia en `.respaldos/`.

**La parte TypeScript se carga tal cual**: después de cambiarla no hay que compilar nada, basta con `/reload-plugins`. Solo cambiar `puente/` exige recompilar el binario.

## Reglas

- Solo lectura sobre lo que no se guarda: el binario nunca toca el archivo salvo en `guardar`, y siempre deja respaldo.
- Nada a internet. Nada de rutas personales ni datos de la persona en el código.
- Multiplataforma: rutas con `/` y `\`, procesos por argv (sin shell), nada que solo exista en Linux.
- Después de cada cambio: `claude plugin validate .` y `claude plugin test .`. Luego, la persona escribe `/reload-plugins`.
- Mantén el estilo: español, comentarios cortos, nombres en español.

## Recetas

**Qué archivos se abren solos o qué carpetas se ignoran.** Primero, sin tocar código: son opciones del mod (`extensiones`, `ignorar`, `anchoPanel`, `abrirSolo`). La persona las cambia en `/plugin` → `lector-archivos` → configurar. Los valores por defecto están en `.claude-plugin/plugin.json` y `AUTOMATICOS_DEFECTO`. Los archivos internos que nunca se abren (`INTERNOS`) están en `register.tsx`.

**La apertura automática no ve una herramienta de terminal.** En `register.tsx`, el hook `tool.call` con `{ tool: ['Bash', 'PowerShell'] }`: agrega el nombre de esa herramienta (`claude plugin validate` lista los hooks). Los comandos que nunca abren nada (listar, mover, git) están en `SIN_VISOR`, en `rutas.ts`; agrega ahí los verbos que estorben.

**Lo que Claude sabe del mod.** El texto `AVISO_CLAUDE` y las descripciones de las herramientas `leer` y `diagnostico`, en `register.tsx`.

**Detección del sistema y del binario.** La función `binario()` de `register.tsx`: en Windows usa la variable `OS=Windows_NT`; en los demás, `uname`. Si un equipo necesita otro binario, ajústalo ahí y revisa el resultado con `/leer-diagnostico`.

**Colores y aspecto.** Las constantes del principio de `motor.ts` (`AZUL`, `VERDE`, `MESA`, `PAPEL`…) y los estilos de título en `maqueta.ts` (`ESTILO_TITULO`).

**Una función de Excel nueva.** En `hoja.ts`: un `case` en `funcion()` y, si tiene nombre en español, una entrada en `ALIAS`. Agrega una prueba en `tests/edicion.test.ts`.

**Teclas.** `tecla()` en `motor.ts`. Las teclas con nombre que llegan del terminal están en `ESPECIALES`, en `visor.tsx`; `Esc` nunca llega, porque devuelve el foco al prompt.

**Un formato nuevo o un cambio en cómo se lee o se guarda.** Va en `puente/`, en Go. Agrega el tipo a `types/index.d.ts`, la vista a `motor.ts` y el texto para Claude a `texto.ts`. Recompila (abajo).

## Recompilar el binario (solo si cambias `puente/`)

Hace falta Go 1.26 o más reciente; en Windows, `winget install GoLang.Go`, con permiso de la persona. Pruebas: `cd puente && go test ./...`. Compilar:

```bash
cd puente
for t in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  os=${t%/*}; arch=${t#*/}; ext=$([ "$os" = windows ] && echo .exe)
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w" -o ../bin/lector-$os-$arch$ext .
done
```

En PowerShell, para el equipo actual: `$env:CGO_ENABLED=0; go build -trimpath -ldflags="-s -w" -o ..\bin\lector-windows-amd64.exe .`

## Comprobar

- `claude plugin validate .` lee el manifiesto y el módulo como lo hará Claude Code.
- `claude plugin test .` corre las pruebas de `tests/`.
- `/leer-diagnostico`, o la herramienta `mcp__lector-archivos__diagnostico`, revisa en el equipo real el sistema, el binario, las carpetas y las opciones.
- `/leer ejemplos/informe.docx` sirve como prueba visual (también `ventas.xlsx`, `charla.pptx`, `nota.md`, `datos.csv`, `datos.json` y `foto.png`).
