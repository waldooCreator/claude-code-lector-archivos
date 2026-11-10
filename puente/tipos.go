package main

import (
	"encoding/json"
)

// Tipos del contrato JSON con el mod (types/index.d.ts).

type Run struct {
	T    string  `json:"t"`
	B    int     `json:"b,omitempty"`
	I    int     `json:"i,omitempty"`
	U    int     `json:"u,omitempty"`
	S    int     `json:"s,omitempty"`
	C    string  `json:"c,omitempty"`
	H    string  `json:"h,omitempty"`
	Font string  `json:"font,omitempty"`
	Pt   float64 `json:"pt,omitempty"`
	O    *int    `json:"o,omitempty"`
	Href string  `json:"href,omitempty"`
}

type Lista struct {
	Marca string `json:"marca"`
	Nivel int    `json:"nivel"`
}

type Parrafo struct {
	K     string `json:"k"`
	Id    int    `json:"id"`
	R     []Run  `json:"r"`
	Est   string `json:"est,omitempty"`
	Al    string `json:"al,omitempty"`
	Sang  int    `json:"sang,omitempty"`
	Lista *Lista `json:"lista,omitempty"`
	Ed    *int   `json:"ed,omitempty"`
}

// noEditable es el valor de `ed` para los párrafos de solo lectura.
var noEditable = func() *int { c := 0; return &c }()

type Celda struct {
	B  []any  `json:"b"`
	Bg string `json:"bg,omitempty"`
	Cs int    `json:"cs,omitempty"`
	Vm int    `json:"vm,omitempty"`
}

type BloqueTabla struct {
	K      string    `json:"k"`
	Filas  [][]Celda `json:"filas"`
	Anchos []float64 `json:"anchos,omitempty"`
}

type BloqueImg struct {
	K   string `json:"k"`
	Src string `json:"src"`
	W   int64  `json:"w"`
	H   int64  `json:"h"`
	Alt string `json:"alt,omitempty"`
}

type BloqueSalto struct {
	K string `json:"k"`
}

type DocWord struct {
	Tipo     string   `json:"tipo"`
	Bloques  []any    `json:"bloques"`
	Fuentes  []string `json:"fuentes"`
	DefFont  string   `json:"defFont"`
	DefPt    float64  `json:"defPt"`
	Aviso    string   `json:"aviso,omitempty"`
	Editable bool     `json:"editable"`
	Firma    string   `json:"firma"`
}

type Estilo struct {
	B  int    `json:"b,omitempty"`
	I  int    `json:"i,omitempty"`
	U  int    `json:"u,omitempty"`
	C  string `json:"c,omitempty"`
	Bg string `json:"bg,omitempty"`
	Al string `json:"al,omitempty"`
}

// CeldaHoja se serializa como tupla [f,c,v,mostrado?,formula?,estilo?].
type CeldaHoja struct {
	F, C     int
	V        any
	Mostrado string
	Formula  string
	Estilo   *int
}

func (c CeldaHoja) MarshalJSON() ([]byte, error) {
	t := []any{c.F, c.C, c.V, nil, nil, nil}
	n := 3
	if c.Mostrado != "" {
		t[3] = c.Mostrado
		n = 4
	}
	if c.Formula != "" {
		t[4] = c.Formula
		n = 5
	}
	if c.Estilo != nil {
		t[5] = *c.Estilo
		n = 6
	}
	return aJSONSinSalto(t[:n])
}

func aJSONSinSalto(v any) ([]byte, error) {
	b, err := aJSON(v)
	if err != nil {
		return nil, err
	}
	return b[:len(b)-1], nil
}

type Hoja struct {
	Nombre     string         `json:"nombre"`
	Filas      int            `json:"filas"`
	Cols       int            `json:"cols"`
	Celdas     []CeldaHoja    `json:"celdas"`
	Estilos    []Estilo       `json:"estilos"`
	Anchos     map[string]int `json:"anchos"`
	Combinadas [][4]int       `json:"combinadas"`
	Congela    *[2]int        `json:"congela,omitempty"`
	Oculta     int            `json:"oculta,omitempty"`
}

type DocHoja struct {
	Tipo  string `json:"tipo"`
	Hojas []Hoja `json:"hojas"`
	Sep   string `json:"sep,omitempty"`
	Aviso string `json:"aviso,omitempty"`
	Firma string `json:"firma"`
}

type Forma struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Tipo  string  `json:"tipo"`
	B     []any   `json:"b,omitempty"`
	Bg    string  `json:"bg,omitempty"`
	Borde string  `json:"borde,omitempty"`
	Src   string  `json:"src,omitempty"`
}

type Diapositiva struct {
	Formas []Forma `json:"formas"`
	Notas  string  `json:"notas,omitempty"`
	Bg     string  `json:"bg,omitempty"`
}

type DocPptx struct {
	Tipo         string        `json:"tipo"`
	Ancho        int64         `json:"ancho"`
	Alto         int64         `json:"alto"`
	Diapositivas []Diapositiva `json:"diapositivas"`
	Aviso        string        `json:"aviso,omitempty"`
	Firma        string        `json:"firma"`
}

type TextoPdf struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	T  string  `json:"t"`
	Pt float64 `json:"pt"`
	B  int     `json:"b,omitempty"`
	I  int     `json:"i,omitempty"`
}

type PaginaPdf struct {
	W          float64    `json:"w"`
	H          float64    `json:"h"`
	Textos     []TextoPdf `json:"textos"`
	SoloImagen int        `json:"soloImagen,omitempty"`
}

type DocPdf struct {
	Tipo    string      `json:"tipo"`
	Paginas []PaginaPdf `json:"paginas"`
	Aviso   string      `json:"aviso,omitempty"`
	Firma   string      `json:"firma"`
}

type DocTexto struct {
	Tipo         string `json:"tipo"`
	Texto        string `json:"texto"`
	Codificacion string `json:"codificacion"`
	Aviso        string `json:"aviso,omitempty"`
	Firma        string `json:"firma"`
}

type DocImagen struct {
	Tipo    string `json:"tipo"`
	W       int    `json:"w"`
	H       int    `json:"h"`
	Formato string `json:"formato"`
	Aviso   string `json:"aviso,omitempty"`
	Firma   string `json:"firma"`
}

type Raster struct {
	Cols  int    `json:"cols"`
	Filas int    `json:"filas"`
	Cells string `json:"cells"`
}

type NuevoParrafo struct {
	R []Run `json:"r"`
}

type CambioParrafo struct {
	Id     int            `json:"id"`
	Nuevos []NuevoParrafo `json:"nuevos"`
}

type CambioCelda struct {
	Hoja    int             `json:"hoja"`
	F       int             `json:"f"`
	C       int             `json:"c"`
	V       json.RawMessage `json:"v"`
	Formula *string         `json:"formula"`
}

type Guardado struct {
	Tipo         string          `json:"tipo"`
	Firma        string          `json:"firma"`
	Parrafos     []CambioParrafo `json:"parrafos"`
	Cambios      []CambioCelda   `json:"cambios"`
	Filas        [][]string      `json:"filas"`
	Sep          string          `json:"sep"`
	Texto        string          `json:"texto"`
	Codificacion string          `json:"codificacion"`
}

type RespuestaGuardar struct {
	Ok        bool   `json:"ok"`
	Respaldo  string `json:"respaldo,omitempty"`
	Firma     string `json:"firma,omitempty"`
	Error     string `json:"error,omitempty"`
	Conflicto bool   `json:"conflicto,omitempty"`
}
