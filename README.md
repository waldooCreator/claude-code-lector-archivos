# 📄 Lector de archivos — lee y edita documentos dentro de Claude Code

Un mod para [Claude Code](https://claude.com/claude-code) que abre tus documentos en un panel de la terminal, con el aspecto de su formato original. Un `.docx` se ve como una hoja de Word, un `.xlsx` como una hoja de cálculo con pestañas y fórmulas, un `.pptx` como diapositivas y un `.md` como un PDF ya maquetado.

Todo ocurre en tu computador: el mod no envía nada a internet. No hay que instalar Python, Node ni nada más, porque trae su propio programa compilado para cada sistema.

**Requisitos:** Claude Code **2.1.303 o más reciente**, en la terminal. Probado en **Linux** (x64); hecho para **Windows 10/11** (x64, y ARM con emulación). Los binarios de macOS están incluidos, pero sin probar.

## Instalación: pídesela a Claude (recomendado, sobre todo en Windows)

Abre Claude Code y pégale esto:

```
Instala el mod lector-archivos desde https://github.com/waldooCreator/claude-code-lector-archivos siguiendo su INSTALAR.md, para todas mis sesiones.
```

Claude lo descarga en una carpeta tuya, comprueba que su programa arranca en tu equipo, lo valida y lo instala para **todas tus sesiones y cualquier carpeta**. Si algo falla en tu equipo (el antivirus, una ruta, la terminal), lo corrige con la guía `ADAPTAR.md` que trae el repositorio. Al final te pedirá escribir `/reload-plugins` una vez. Desde ahí, cualquier sesión nueva lo tiene.

Para comprobar que todo está bien en cualquier momento:

```
/leer-diagnostico
```

<details>
<summary>Instalarlo a mano</summary>

Escribe esto en el prompt de Claude Code (el visor queda activo, pero Claude no podrá adaptarlo después porque se instala una copia):

```
/plugin install lector-archivos --marketplace waldooCreator/claude-code-lector-archivos
```

Responde `y` y elige el alcance **user** para que quede en todas tus sesiones.

Desde una carpeta clonada (lo que hace Claude con `INSTALAR.md`; así los cambios en la carpeta llegan con `/reload-plugins`):

```bash
git clone https://github.com/waldooCreator/claude-code-lector-archivos
claude plugin marketplace add ./claude-code-lector-archivos
claude plugin install lector-archivos@lector-archivos --scope user
```

Para probarlo una sola vez sin instalarlo, en una terminal aparte:

```bash
claude --plugin-dir ./claude-code-lector-archivos
```

Para comprobar que quedó para todas las sesiones, `claude plugin list` debe mostrar `lector-archivos` con `Scope: user` y `enabled`. Las sesiones que ya estaban abiertas lo cargan con `/reload-plugins`; las nuevas, solas.

</details>

## Cómo se usa

Ábrelo a mano con:

```
/leer informe.docx
```

O no hagas nada: **Claude ya sabe que el visor existe** y lo usa solo.

- 🧠 **En su cerebro.** En cada sesión Claude recibe una nota sobre el mod y una herramienta propia, `leer`, para leer documentos. Cuando necesita leer un Word, un Excel, un PowerPoint, un PDF, un Markdown o un CSV, la usa en lugar de Python o `unzip`. Así recibe el contenido con su estructura (títulos, tablas, hojas, celdas, fórmulas, diapositivas) y **tú lo ves al mismo tiempo en el visor**, igual que Estudio SQL te muestra las consultas que hace.
- 👀 **Se abre solo.** Cuando Claude o uno de sus subagentes **lee, crea o modifica** un `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.md`, `.csv` o una imagen, el panel te muestra ese archivo. Da igual cómo lo toque: con sus herramientas o con un comando o script (`python`, `pandoc`, `libreoffice`, `cp`…). Cada documento queda en su pestaña, y si Claude lo cambia, ves la versión nueva.
- 🙈 **No estorba.** No abre los archivos internos de Claude (`CLAUDE.md`, memorias, carpetas `.claude` y `.git`) ni los que solo se listan, se mueven o se pasan a git. Si tienes cambios sin guardar en un documento, no lo reemplaza: te avisa.

### Opciones

Se cambian en `/plugin` → `lector-archivos` → configurar. Todas traen un valor por defecto.

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| Abrir el visor solo | encendida | Apágala si prefieres abrir siempre a mano con `/leer`. La herramienta de Claude sigue funcionando. |
| Qué archivos se abren solos | `docx, docm, xlsx, xlsm, pptx, pptm, pdf, md, markdown, csv, tsv, png, jpg, jpeg, gif` | Agrega o quita extensiones. |
| Carpetas que nunca se abren solas | (vacío) | Por ejemplo `dist, salida, borradores`. |
| Ancho del panel | 110 | Columnas que pide el visor al lado de la conversación. |

Haz clic dentro del panel para escribir en él. `Esc` devuelve el teclado al prompt de Claude. El panel aparece al lado de la conversación cuando la terminal es ancha (unas 110 columnas o más, o en pantalla completa); si es más angosta, espera a que haya espacio o ábrelo con `/leer`.

## Qué hace cada formato

| Formato | Cómo se ve | Qué puedes hacer |
| --- | --- | --- |
| **Word** `.docx` | Páginas blancas con títulos, listas, tablas, imágenes y colores | Escribir, borrar, negrita, cursiva, subrayado, tipo y tamaño de letra, deshacer, guardar |
| **Excel** `.xlsx` | Cuadrícula con letras, filas, pestañas, colores, celdas combinadas y paneles fijos | Editar valores y fórmulas, seleccionar rangos (muestra suma y promedio), cambiar de hoja, guardar |
| **PowerPoint** `.pptx` | Cada diapositiva a escala, con su texto, formas e imágenes | Avanzar y retroceder, ver notas del orador |
| **PDF** `.pdf` | Página por página, con el texto en su sitio | Pasar páginas, zoom, ver la página como imagen |
| **Markdown** `.md` | Como un PDF: títulos, tablas, código con colores, citas, avisos, emojis, imágenes y **diagramas mermaid dibujados** | Leer; `Editar fuente` para cambiar el texto y volver a verlo renderizado |
| **CSV** `.csv` `.tsv` | Hoja de cálculo | Editar celdas y guardar con el mismo separador |
| **JSON** `.json` | Árbol que se abre y se cierra | Leer; `Editar texto` para cambiarlo |
| **Imágenes** `.png` `.jpg` `.gif` | La imagen a color | Zoom y desplazamiento |
| **Texto y código** | Con números de línea | Editar y guardar conservando acentos y saltos de línea |

## Teclas

| Tecla | Qué hace |
| --- | --- |
| `Ctrl+S` | Guardar |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| `Ctrl+B`, `Ctrl+I`, `Ctrl+U` | Negrita, cursiva, subrayado |
| `Ctrl+C` | Copiar la selección |
| `Shift` + flechas o arrastrar | Seleccionar |
| Flechas, `RePág`, `AvPág`, rueda | Moverse, cambiar de página o diapositiva |
| `F2` | Editar la celda actual sin borrarla |

Todo también está en los botones de la barra superior.

## Tus archivos están protegidos

- **Copia antes de guardar.** Cada vez que guardas, la versión anterior queda en una carpeta `.respaldos` junto al archivo, con la fecha y la hora en el nombre.
- **No pisa cambios ajenos.** Si el archivo cambió en disco desde que lo abriste, no se guarda y te avisa.
- **Solo cambia lo que tocaste.** En un Word, los párrafos que no editaste quedan exactamente igual.
- **Sin archivos a medias.** Se escribe en un temporal y se reemplaza al final.

## Lo que todavía no hace

- Una terminal no dibuja tipos de letra ni tamaños reales: el tipo y el tamaño se guardan en el archivo y se ven en la barra, pero el texto se muestra con la letra de tu terminal. La letra grande se resalta en negrita y la pequeña se atenúa.
- En Word no se editan los párrafos con enlaces, imágenes, campos o control de cambios: se ven, pero quedan protegidos. Los cuadros de texto no se muestran.
- En Excel, las fórmulas que el mod no conoce conservan su último valor hasta abrir el archivo en Excel, que las recalcula. Conoce `SUMA`, `PROMEDIO`, `MIN`, `MAX`, `CONTAR`, `CONTARA`, `SI`, `Y`, `O`, `NO`, `REDONDEAR`, `ABS`, `ENTERO`, `RESIDUO`, `POTENCIA`, `RAIZ`, `LARGO`, `MAYUSC`, `MINUSC`, `CONCATENAR` y sus nombres en inglés.
- PowerPoint y PDF son de solo lectura.
- `Ver imagen` en un PDF necesita `pdftoppm`; sin él solo muestra la imagen más grande de las páginas escaneadas.

## Cómo está hecho

- `hooks/register.tsx`: el comando `/leer`, el panel, la herramienta `leer` de Claude, la nota en sus instrucciones y la apertura automática sobre `Read`, `Write`, `Edit` y `Bash`.
- `hooks/texto.ts` y `rutas.ts`: el documento como texto para Claude y los archivos que nombra un comando.
- `INSTALAR.md`: la guía que sigue Claude para instalarlo. `ADAPTAR.md`: la guía para adaptarlo.
- `ejemplos/`: archivos inventados para probarlo.
- `hooks/motor.ts`, `maqueta.ts`, `lienzo.ts`, `visor.tsx`: el dibujo, las páginas, las teclas y el ratón.
- `hooks/editor.ts` y `hoja.ts`: la edición de Word y Excel con sus fórmulas.
- `hooks/markdown.ts` y `mermaid.ts`: el Markdown y los diagramas.
- `puente/`: el programa en Go, solo con su biblioteca estándar, que abre y guarda los archivos. Va compilado en `bin/` para cada sistema.

Para recompilarlo (Go 1.26):

```bash
cd puente
for t in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  os=${t%/*}; arch=${t#*/}; ext=$([ "$os" = windows ] && echo .exe)
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w" -o ../bin/lector-$os-$arch$ext .
done
```

Para probarlo:

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

<details>
<summary>🇬🇧 In English</summary>

**Lector de archivos** is a Claude Code mod that opens documents in a terminal pane, looking like their original format: Word pages, Excel sheets with tabs and formulas, PowerPoint slides, PDF pages, Markdown rendered like a PDF (with mermaid diagrams drawn), CSV, JSON, images and text. You can edit Word, Excel, CSV and text files and save with Ctrl+S; a backup of the original goes to `.respaldos/`. Claude gets a `leer` tool that reads documents with their structure while showing them to you, and the viewer opens by itself whenever Claude reads, creates or changes a document. Everything runs locally, with no extra dependencies.

Install: ask Claude Code *"Install the lector-archivos mod from https://github.com/waldooCreator/claude-code-lector-archivos following its INSTALAR.md, for all my sessions"*. Then type `/reload-plugins` and use `/leer <path>`. Requires Claude Code 2.1.303 or newer. The UI is in Spanish.

</details>

## Licencia

MIT
