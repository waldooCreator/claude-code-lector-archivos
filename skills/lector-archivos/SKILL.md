---
name: lector-archivos
description: Cómo instalar, revisar, configurar o adaptar el mod Lector de archivos (visor y editor de Word, Excel, PowerPoint, PDF y Markdown dentro de Claude Code), sobre todo en Windows. Úsala cuando la persona pida instalarlo o actualizarlo, cuando el visor no abra un archivo o no aparezca, cuando quiera cambiar qué se abre solo, o cuando haya que corregir el mod en su equipo.
---

# Lector de archivos

El mod ya está instalado si tienes las herramientas `mcp__lector-archivos__leer` y `mcp__lector-archivos__diagnostico`.

1. **Primero, el diagnóstico.** Llama a `mcp__lector-archivos__diagnostico`. Te dice el sistema detectado, si su programa arranca (y por qué no, con la solución), la carpeta del mod, la carpeta personal y las opciones de apertura automática.
2. **Instalar o actualizar:** sigue `INSTALAR.md`, en la carpeta del mod. Si todavía no está instalado, clónalo de `https://github.com/waldooCreator/claude-code-lector-archivos` y lee ese archivo.
3. **Cambiar qué se abre solo, carpetas ignoradas o ancho del panel:** son opciones del mod. La persona las cambia en `/plugin` → `lector-archivos` → configurar, sin tocar código.
4. **Corregir o adaptar el código:** lee `ADAPTAR.md`, en la carpeta del mod (la que da el diagnóstico). Tiene el mapa de archivos, recetas y cómo probar. Edita solo esa carpeta, valida con `claude plugin validate <carpeta>` y `claude plugin test <carpeta>`, y pide a la persona `/reload-plugins`.
5. Si `claude plugin list` muestra el mod sin `Read from: <carpeta>`, está instalado como copia desde GitHub, y tus cambios en una carpeta no llegarán. Reinstálalo desde una carpeta clonada, como dice `INSTALAR.md`.

Reglas: nada a internet, nunca desactivar el antivirus por la persona (explícale y que ella decida), y siempre conservar los respaldos de `.respaldos/`.
