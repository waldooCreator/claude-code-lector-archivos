// El contrato entre el binario `lector` (puente/) y el mod: lo que `abrir`
// devuelve y lo que `guardar` recibe. Todo es JSON.

/** Un tramo de texto con el mismo formato. `o`: el run del original del que salió. */
export type Run = {
  t: string
  b?: 1
  i?: 1
  u?: 1
  s?: 1
  /** Color de letra y de resaltado, `#rrggbb`. */
  c?: string
  h?: string
  font?: string
  pt?: number
  o?: number
  href?: string
}

export type Parrafo = {
  k: 'p'
  /** Posición del `w:p` en el documento; los creados al editar llevan -1. */
  id: number
  r: Run[]
  est?: 'titulo' | 'subtitulo' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'cita' | 'codigo'
  al?: 'c' | 'r' | 'j'
  /** Sangría izquierda en columnas aproximadas. */
  sang?: number
  lista?: { marca: string; nivel: number }
  /** 0: lleva enlaces, imágenes o campos y no se edita en esta versión. */
  ed?: 0
}

export type Celda = { b: Bloque[]; bg?: string; cs?: number; vm?: 1 }

export type Bloque =
  | Parrafo
  | { k: 'tabla'; filas: Celda[][]; anchos?: number[] }
  | { k: 'img'; src: string; w: number; h: number; alt?: string }
  | { k: 'salto' }
  | { k: 'hr' }
  | { k: 'cod'; lang: string; texto: string }
  | { k: 'cita'; b: Bloque[]; tipo?: string }
  | { k: 'figura'; lineas: string[]; titulo?: string }

export type DocWord = {
  tipo: 'docx'
  bloques: Bloque[]
  fuentes: string[]
  defFont: string
  defPt: number
  aviso?: string
  /** false: el documento no se puede editar sin riesgo (prefijos XML raros). */
  editable: boolean
}

export type Estilo = { b?: 1; i?: 1; u?: 1; c?: string; bg?: string; al?: 'l' | 'c' | 'r' }

/** Una celda: fila y columna desde 0, valor, lo mostrado, fórmula sin `=`, estilo. */
export type CeldaHoja = [number, number, number | string | boolean | null, string?, string?, number?]

export type Hoja = {
  nombre: string
  filas: number
  cols: number
  celdas: CeldaHoja[]
  estilos: Estilo[]
  /** Ancho por columna en caracteres; los ausentes usan el de defecto. */
  anchos: Record<string, number>
  combinadas: [number, number, number, number][]
  congela?: [number, number]
  oculta?: 1
}

export type DocHoja = { tipo: 'xlsx' | 'csv'; hojas: Hoja[]; sep?: string; aviso?: string }

export type Forma = {
  x: number
  y: number
  w: number
  h: number
  tipo: 'texto' | 'img' | 'tabla' | 'forma'
  b?: Bloque[]
  bg?: string
  borde?: string
  src?: string
}

export type Diapositiva = { formas: Forma[]; notas?: string; bg?: string }

export type DocPptx = { tipo: 'pptx'; ancho: number; alto: number; diapositivas: Diapositiva[]; aviso?: string }

export type TextoPdf = { x: number; y: number; t: string; pt: number; b?: 1; i?: 1 }

export type PaginaPdf = { w: number; h: number; textos: TextoPdf[]; soloImagen?: 1 }

export type DocPdf = { tipo: 'pdf'; paginas: PaginaPdf[]; aviso?: string }

export type DocTexto = { tipo: 'texto'; texto: string; codificacion: string; aviso?: string }

export type DocImagen = { tipo: 'imagen'; w: number; h: number; formato: string; aviso?: string }

export type Documento = (DocWord | DocHoja | DocPptx | DocPdf | DocTexto | DocImagen) & {
  /** Huella del archivo al abrirlo: `guardar` se niega si cambió desde entonces. */
  firma: string
}

export type Raster = { cols: number; filas: number; cells: string }

export type Guardado =
  | { tipo: 'docx'; firma: string; parrafos: { id: number; nuevos: { r: Run[] }[] }[] }
  | { tipo: 'xlsx'; firma: string; cambios: { hoja: number; f: number; c: number; v: number | string | boolean | null; formula?: string }[] }
  | { tipo: 'csv'; firma: string; filas: string[][]; sep: string }
  | { tipo: 'texto'; firma: string; texto: string; codificacion: string }

export type RespuestaGuardar = { ok: true; respaldo: string; firma: string } | { ok: false; error: string; conflicto?: boolean }

/** Lo que el panel dibuja: filas de tramos `[texto, color, fondo, atributos]`. */
export type Tramo = [string, string, string, number?]
export type CuadroVisor = { filas: Tramo[][]; ack: number; ancho: number; alto: number }

declare module 'claude-code' {
  interface PluginState {
    'lector-archivos': {
      version: number
    }
  }
}
