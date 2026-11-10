package main

import (
	"errors"
	"path/filepath"
	"strconv"
	"strings"
)

const limiteCeldas = 150000

// partirCsv separa filas y campos con comillas estándar.
func partirCsv(s string, sep rune, maxFilas int) [][]string {
	var filas [][]string
	var fila []string
	var campo strings.Builder
	enComillas := false
	r := []rune(s)
	cerrarFila := func() {
		fila = append(fila, campo.String())
		campo.Reset()
		filas = append(filas, fila)
		fila = nil
	}
	for i := 0; i < len(r); i++ {
		c := r[i]
		if enComillas {
			if c == '"' {
				if i+1 < len(r) && r[i+1] == '"' {
					campo.WriteRune('"')
					i++
				} else {
					enComillas = false
				}
			} else {
				campo.WriteRune(c)
			}
			continue
		}
		switch {
		case c == '"' && campo.Len() == 0:
			enComillas = true
		case c == sep:
			fila = append(fila, campo.String())
			campo.Reset()
		case c == '\r' && i+1 < len(r) && r[i+1] == '\n':
		case c == '\n' || c == '\r':
			cerrarFila()
			if maxFilas > 0 && len(filas) >= maxFilas {
				return filas
			}
		default:
			campo.WriteRune(c)
		}
	}
	if campo.Len() > 0 || len(fila) > 0 {
		cerrarFila()
	}
	return filas
}

// detectarSep elige el separador más consistente entre las primeras líneas.
func detectarSep(s, ext string) rune {
	mejor := ','
	if ext == ".tsv" {
		mejor = '\t'
	}
	mejorPunt := 0
	for _, sep := range []rune{',', ';', '\t', '|'} {
		filas := partirCsv(recortarInicio(s), sep, 50)
		conteos := map[int]int{}
		for _, f := range filas {
			if len(f) > 1 {
				conteos[len(f)]++
			}
		}
		for n, veces := range conteos {
			if p := veces * 1000 * n / (n + 1); p > mejorPunt {
				mejorPunt, mejor = p, sep
			}
		}
	}
	return mejor
}

func recortarInicio(s string) string {
	if len(s) > 256*1024 {
		return strings.ToValidUTF8(s[:256*1024], "")
	}
	return s
}

// numeroPuro devuelve el número si la celda lo es y se puede convertir sin perder nada.
func numeroPuro(s string) (float64, bool) {
	if s == "" {
		return 0, false
	}
	t := strings.TrimPrefix(strings.TrimPrefix(s, "-"), "+")
	if t == "" || t[0] == '.' || t[len(t)-1] == '.' {
		return 0, false
	}
	digitos, puntos := 0, 0
	for _, c := range t {
		switch {
		case c >= '0' && c <= '9':
			digitos++
		case c == '.':
			puntos++
		default:
			return 0, false
		}
	}
	if puntos > 1 || digitos > 15 {
		return 0, false
	}
	// Con ceros a la izquierda es un identificador, no un número.
	if len(t) > 1 && t[0] == '0' && t[1] != '.' {
		return 0, false
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func abrirCsv(d []byte, ruta string) (any, error) {
	texto, _, err := decodificar(d)
	if err != nil {
		return nil, err
	}
	ext := strings.ToLower(filepath.Ext(ruta))
	sep := detectarSep(texto, ext)
	filas := partirCsv(texto, sep, 0)
	base := filepath.Base(ruta)
	h := Hoja{Nombre: base, Celdas: []CeldaHoja{}, Estilos: []Estilo{}, Anchos: map[string]int{}, Combinadas: [][4]int{}}
	doc := DocHoja{Tipo: "csv", Sep: string(sep), Firma: sha256Hex(d)}
	tam, recortado := 0, false
exterior:
	for f, fila := range filas {
		h.Filas = f + 1
		h.Cols = max(h.Cols, len(fila))
		for c, v := range fila {
			if v == "" {
				continue
			}
			cel := CeldaHoja{F: f, C: c, V: v}
			if n, ok := numeroPuro(v); ok {
				cel.V = n
				if strconv.FormatFloat(n, 'f', -1, 64) != v {
					cel.Mostrado = v
				}
			}
			b, _ := aJSON(cel)
			tam += len(b)
			if len(h.Celdas) >= limiteCeldas || tam > limiteDocumento-64*1024 {
				recortado = true
				break exterior
			}
			h.Celdas = append(h.Celdas, cel)
		}
	}
	if recortado {
		doc.Aviso = "El archivo es muy grande: solo se muestra el comienzo y no se puede guardar."
	}
	doc.Hojas = []Hoja{h}
	return doc, nil
}

func campoCsv(s, sep string) string {
	if strings.Contains(s, sep) || strings.ContainsAny(s, "\"\r\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

func guardarCsv(actual []byte, g *Guardado) ([]byte, error) {
	texto, cod, err := decodificar(actual)
	if err != nil {
		return nil, err
	}
	if g.Sep == "" {
		return nil, errors.New("falta el separador")
	}
	// Si `abrir` recortó el archivo, reescribirlo perdería el resto.
	if d, err := abrirCsv(actual, "x.csv"); err == nil && d.(DocHoja).Aviso != "" {
		return nil, errors.New("el archivo es demasiado grande para guardarlo desde el visor")
	}
	fl := "\n"
	if finLinea(texto) == "\r\n" {
		fl = "\r\n"
	}
	var b strings.Builder
	for i, fila := range g.Filas {
		if i > 0 {
			b.WriteString(fl)
		}
		for j, v := range fila {
			if j > 0 {
				b.WriteString(g.Sep)
			}
			b.WriteString(campoCsv(v, g.Sep))
		}
	}
	if strings.HasSuffix(texto, "\n") || strings.HasSuffix(texto, "\r") {
		b.WriteString(fl)
	}
	return codificar(b.String(), cod)
}
