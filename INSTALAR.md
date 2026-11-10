# Instalar el Lector de archivos (guía para Claude)

Esta guía es para **Claude Code**: la persona te pidió instalar este mod en su equipo. Síguela en orden, en su idioma, y dile en una frase qué vas a hacer antes de cada paso que cambie algo. Funciona en **Windows 10/11** y **Linux**. En macOS los binarios están incluidos, pero nadie los ha probado.

Al terminar, el mod queda activo en **todas** las sesiones de Claude Code de la persona, en cualquier carpeta. Además, el visor se abre solo cuando trabajas con documentos.

## 0. Antes de empezar

- Confirma con la persona que quiere instalarlo para todas sus sesiones (alcance `user`), porque cambia su configuración de Claude Code.
- Usa la herramienta de terminal que tengas: Bash o PowerShell. Abajo están los comandos de las dos.
- No la mandes a otra terminal: todos los comandos de esta guía los puedes ejecutar tú. Solo `/reload-plugins` lo tiene que escribir ella.

## 1. Versión de Claude Code

```
claude --version
```

Se necesita **2.1.303 o más reciente**, porque los mods con paneles son recientes. Si es más vieja, `claude update` y pídele a la persona que reinicie Claude Code antes de seguir.

## 2. Descargar el mod a una carpeta propia

El mod se instala **desde una carpeta clonada**, no directo desde GitHub: así lo puedes adaptar después, y cada cambio llega con `/reload-plugins`. Usa una carpeta fuera de OneDrive, porque la sincronización puede bloquear los archivos.

PowerShell (Windows):

```powershell
$destino = "$env:USERPROFILE\claude-mods\claude-code-lector-archivos"
if (Test-Path $destino) { git -C $destino pull } else { git clone https://github.com/waldooCreator/claude-code-lector-archivos $destino }
```

Bash (Linux, o Git Bash en Windows):

```bash
destino="$HOME/claude-mods/claude-code-lector-archivos"
[ -d "$destino" ] && git -C "$destino" pull || git clone https://github.com/waldooCreator/claude-code-lector-archivos "$destino"
```

Si la persona ya tiene la carpeta del mod, porque la copió o descomprimió un `.zip`, no clones: muévela a esa misma ubicación, o usa la ruta donde está si no está dentro de OneDrive.

En el resto de la guía, `<carpeta>` es esa ruta completa.

## 3. Comprobar que su programa arranca en este equipo

El mod lee y guarda los archivos con un programa propio que ya viene compilado en `bin/`. No hay que instalar Python, Node ni nada más. Pruébalo:

PowerShell:

```powershell
& "<carpeta>\bin\lector-windows-amd64.exe" abrir "<carpeta>\ejemplos\informe.docx"
```

Bash (Linux x64; en ARM usa `lector-linux-arm64`):

```bash
"<carpeta>/bin/lector-linux-amd64" abrir "<carpeta>/ejemplos/informe.docx"
```

Debe imprimir una línea JSON que empieza con `{"tipo":"docx"`. Si no:

| Síntoma | Qué hacer |
| --- | --- |
| Windows: «Acceso denegado», el `.exe` desapareció o Defender avisa de una amenaza | El programa no está firmado y a veces Defender lo bloquea por error. Explícaselo a la persona. Ella decide si lo permite en Seguridad de Windows → Protección contra virus → Historial de protección → Permitir, o si agrega `<carpeta>\bin` a las exclusiones. No lo hagas tú. |
| Windows: aviso de SmartScreen | Que la persona elija «Más información» → «Ejecutar de todas formas» una vez. |
| Linux: `Permission denied` | `chmod +x "<carpeta>"/bin/lector-*` |
| Linux: `cannot execute binary file` | Usaste el binario de otra arquitectura: revisa `uname -m`. |

## 4. Validar el mod

```
claude plugin validate "<carpeta>"
claude plugin test "<carpeta>"
```

Las dos deben terminar sin errores (`✔ Validation passed` y `0 fail`).

## 5. Instalarlo para todas las sesiones

```
claude plugin marketplace add "<carpeta>"
claude plugin install lector-archivos@lector-archivos --scope user
claude plugin list
```

En la lista debe aparecer `lector-archivos@lector-archivos` con `Scope: user`, `Status: enabled` y `Read from: <carpeta>`. Si avisa de opciones sin configurar, no pasa nada: todas tienen valores por defecto.

Si ya estaba instalado desde GitHub (sin carpeta), primero `claude plugin uninstall lector-archivos@lector-archivos` y luego repite este paso.

## 6. Activarlo y comprobarlo

1. Pídele a la persona que escriba `/reload-plugins` en esta sesión, o que abra una sesión nueva. Las sesiones nuevas lo cargan solas.
2. Después, llama tú a la herramienta `mcp__lector-archivos__diagnostico`, o pídele que escriba `/leer-diagnostico`. Todo debe salir con ✔.
3. Prueba final, con la terminal ancha (unas 110 columnas o más, o en pantalla completa): usa `mcp__lector-archivos__leer` sobre `<carpeta>/ejemplos/informe.docx`. El visor debe abrirse al lado de la conversación con el documento.

Cuéntale a la persona en 3 o 4 frases qué quedó: `/leer <ruta>` abre cualquier archivo; el visor se abre solo cuando trabajas con documentos; puede editar Word, Excel, CSV y texto y guardar con Ctrl+S; y queda una copia del original en `.respaldos/`.

## 7. Si algo falla en este equipo

Lee `ADAPTAR.md`, en la carpeta del mod: explica dónde está cada cosa y cómo adaptarla. Corrige en `<carpeta>`, valida con el paso 4 y pide `/reload-plugins`. Problemas conocidos:

- **El panel no aparece al abrir algo solo:** la terminal es angosta. Se abre con `/leer` o en pantalla completa. También se puede bajar el ancho con la opción «Ancho del panel».
- **Los documentos que creas con scripts no se abren solos:** revisa con el diagnóstico qué herramientas escucha. Si tu herramienta de terminal tiene otro nombre, agrégalo en `hooks/register.tsx` (receta en `ADAPTAR.md`).
- **`~` o `%USERPROFILE%` no se resuelven:** el diagnóstico muestra la carpeta personal; si sale vacía, usa rutas completas.

## Actualizar o quitar

- Actualizar: `git -C "<carpeta>" pull` y luego `/reload-plugins`. Si adaptaste algo, revisa primero `git -C "<carpeta>" status` para no pisarlo.
- Quitar: `claude plugin uninstall lector-archivos@lector-archivos` y `claude plugin marketplace remove lector-archivos`. La carpeta se puede borrar después.
