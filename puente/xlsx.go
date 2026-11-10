package main

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var paletaIndexada = strings.Fields(`000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333`)

// Formatos numéricos incorporados de Excel.
var formatosBase = map[int]string{
	0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00",
	14: "d/m/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "d/m/yyyy h:mm",
	37: "#,##0;-#,##0", 38: "#,##0;[Red]-#,##0", 39: "#,##0.00;-#,##0.00", 40: "#,##0.00;[Red]-#,##0.00", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss", 48: "##0.0E+0", 49: "@",
}

type xfX struct {
	formato string
	estilo  Estilo
	vacio   bool
}

type libroX struct {
	z         *archivoZip
	parte     string
	hojas     []hojaInfo
	compartir []string
	xfs       []xfX
	tema      []string
	f1904     bool
}

type hojaInfo struct {
	nombre, ruta, estado string
	esHoja               bool
}

func cargarLibro(z *archivoZip) (*libroX, error) {
	parte := z.parteRaiz("xl/workbook.xml")
	d, err := z.leer(parte)
	if err != nil {
		return nil, err
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return nil, err
	}
	rels, lista := z.leerRels(parte)
	x := &libroX{z: z, parte: parte}
	if pr := raiz.hijo("workbookPr"); pr != nil {
		v := pr.val("date1904")
		x.f1904 = v == "1" || v == "true"
	}
	for _, s := range raiz.hijo("sheets").hijosN("sheet") {
		h := hojaInfo{nombre: s.val("name"), estado: s.val("state")}
		if r, ok := rels[s.attrRel("id")]; ok && !r.externo {
			h.ruta = r.destino
			h.esHoja = strings.HasSuffix(r.tipo, "/worksheet")
		}
		x.hojas = append(x.hojas, h)
	}
	if len(x.hojas) == 0 {
		return nil, errors.New("el libro no tiene hojas")
	}
	dir := path.Dir(parte)
	rutaDe := func(suf, def string) string {
		if r, ok := relPorTipo(lista, suf); ok && !r.externo {
			return r.destino
		}
		return dir + "/" + def
	}
	x.cargarTema(z.leerOpc(rutaDe("/theme", "theme/theme1.xml")))
	x.cargarEstilos(z.leerOpc(rutaDe("/styles", "styles.xml")))
	x.cargarCompartidas(z.leerOpc(rutaDe("/sharedStrings", "sharedStrings.xml")))
	return x, nil
}

func (x *libroX) cargarCompartidas(d []byte) {
	if d == nil {
		return
	}
	dec := nuevoDecoder(normalizarXML(d))
	var b strings.Builder
	enT, enRPh := false, 0
	for {
		tok, err := dec.Token()
		if err != nil {
			return
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				b.Reset()
			case "t":
				enT = true
			case "rPh":
				enRPh++
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "si":
				x.compartir = append(x.compartir, b.String())
			case "t":
				enT = false
			case "rPh":
				enRPh--
			}
		case xml.CharData:
			if enT && enRPh == 0 {
				b.Write(t)
			}
		}
	}
}

func (x *libroX) cargarTema(d []byte) {
	if d == nil {
		return
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return
	}
	esq := raiz.buscar("clrScheme")
	if esq == nil {
		return
	}
	// El orden de Excel intercambia claro y oscuro frente al XML.
	for _, nom := range []string{"lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"} {
		c := ""
		if n := esq.hijo(nom); n != nil && len(n.hijos) > 0 {
			h := n.hijos[0]
			if v := h.val("val"); h.nom == "srgbClr" {
				c = v
			} else {
				c = h.val("lastClr")
			}
		}
		x.tema = append(x.tema, c)
	}
}

func rgbAHsl(r, g, b float64) (float64, float64, float64) {
	mx, mn := math.Max(r, math.Max(g, b)), math.Min(r, math.Min(g, b))
	l := (mx + mn) / 2
	if mx == mn {
		return 0, 0, l
	}
	d := mx - mn
	s := d / (2 - mx - mn)
	if l <= 0.5 {
		s = d / (mx + mn)
	}
	var h float64
	switch mx {
	case r:
		h = (g - b) / d
		if g < b {
			h += 6
		}
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return h / 6, s, l
}

func hslARgb(h, s, l float64) (float64, float64, float64) {
	if s == 0 {
		return l, l, l
	}
	f := func(p, q, t float64) float64 {
		if t < 0 {
			t++
		}
		if t > 1 {
			t--
		}
		switch {
		case t < 1.0/6:
			return p + (q-p)*6*t
		case t < 0.5:
			return q
		case t < 2.0/3:
			return p + (q-p)*(2.0/3-t)*6
		}
		return p
	}
	q := l + s - l*s
	if l < 0.5 {
		q = l * (1 + s)
	}
	p := 2*l - q
	return f(p, q, h+1.0/3), f(p, q, h), f(p, q, h-1.0/3)
}

func desdeHex(c string) (float64, float64, float64) {
	v, _ := strconv.ParseUint(strings.TrimPrefix(c, "#"), 16, 32)
	return float64(v>>16&255) / 255, float64(v>>8&255) / 255, float64(v&255) / 255
}

func aHex(r, g, b float64) string {
	return fmt.Sprintf("#%02x%02x%02x", limitar8(r*255), limitar8(g*255), limitar8(b*255))
}

func aplicarTinte(c string, tinte float64) string {
	if tinte == 0 {
		return c
	}
	r, g, b := desdeHex(c)
	h, s, l := rgbAHsl(r, g, b)
	if tinte < 0 {
		l *= 1 + tinte
	} else {
		l = l*(1-tinte) + tinte
	}
	return aHex(hslARgb(h, s, l))
}

func (x *libroX) color(n *nodo) string {
	if n == nil {
		return ""
	}
	var base string
	if v := n.val("rgb"); v != "" {
		base = hexColor(v)
	} else if v, ok := n.attr("theme"); ok {
		i, _ := strconv.Atoi(v)
		if i >= 0 && i < len(x.tema) && x.tema[i] != "" {
			base = hexColor(x.tema[i])
		}
	} else if v, ok := n.attr("indexed"); ok {
		i, _ := strconv.Atoi(v)
		if i >= 0 && i < len(paletaIndexada) {
			base = hexColor(paletaIndexada[i])
		}
	}
	if base == "" {
		return ""
	}
	if v := n.val("tint"); v != "" {
		t, _ := strconv.ParseFloat(v, 64)
		base = aplicarTinte(base, t)
	}
	return base
}

func (x *libroX) cargarEstilos(d []byte) {
	if d == nil {
		return
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return
	}
	formatos := map[int]string{}
	for _, n := range raiz.hijo("numFmts").hijosN("numFmt") {
		id, _ := strconv.Atoi(n.val("numFmtId"))
		formatos[id] = n.val("formatCode")
	}
	type fuente struct {
		b, i, u bool
		c       string
	}
	var fuentes []fuente
	for _, f := range raiz.hijo("fonts").hijosN("font") {
		var nf fuente
		if b := f.hijo("b"); b != nil {
			nf.b = encendido(b)
		}
		if b := f.hijo("i"); b != nil {
			nf.i = encendido(b)
		}
		if b := f.hijo("u"); b != nil {
			nf.u = encendido(b)
		}
		nf.c = x.color(f.hijo("color"))
		fuentes = append(fuentes, nf)
	}
	var fondos []string
	for _, f := range raiz.hijo("fills").hijosN("fill") {
		bg := ""
		if p := f.hijo("patternFill"); p != nil && p.val("patternType") != "none" && p.val("patternType") != "gray125" {
			bg = x.color(p.hijo("fgColor"))
		}
		fondos = append(fondos, bg)
	}
	defC := ""
	if len(fuentes) > 0 {
		defC = fuentes[0].c
	}
	for _, xf := range raiz.hijo("cellXfs").hijosN("xf") {
		v := xfX{}
		id, _ := strconv.Atoi(xf.val("numFmtId"))
		if s, ok := formatos[id]; ok {
			v.formato = s
		} else {
			v.formato = formatosBase[id]
		}
		var e Estilo
		fid, _ := strconv.Atoi(xf.val("fontId"))
		if fid >= 0 && fid < len(fuentes) {
			f := fuentes[fid]
			if f.b {
				e.B = 1
			}
			if f.i {
				e.I = 1
			}
			if f.u {
				e.U = 1
			}
			if f.c != defC {
				e.C = f.c
			}
		}
		fi, _ := strconv.Atoi(xf.val("fillId"))
		if fi >= 0 && fi < len(fondos) {
			e.Bg = fondos[fi]
		}
		if a := xf.hijo("alignment"); a != nil {
			switch a.val("horizontal") {
			case "left":
				e.Al = "l"
			case "center", "centerContinuous":
				e.Al = "c"
			case "right":
				e.Al = "r"
			}
		}
		v.estilo = e
		v.vacio = e == Estilo{}
		x.xfs = append(x.xfs, v)
	}
}

// ---- Referencias ----

func nombreColumna(c int) string {
	s := ""
	for c++; c > 0; c = (c - 1) / 26 {
		s = string(rune('A'+(c-1)%26)) + s
	}
	return s
}

func aRef(f, c int) string { return nombreColumna(c) + strconv.Itoa(f+1) }

// partirRef convierte "AB12" en fila y columna desde 0.
func partirRef(r string) (int, int, bool) {
	i, c := 0, 0
	for i < len(r) && r[i] >= 'A' && r[i] <= 'Z' {
		c = c*26 + int(r[i]-'A') + 1
		i++
	}
	if i == 0 || i >= len(r) {
		return 0, 0, false
	}
	f, err := strconv.Atoi(r[i:])
	if err != nil || f < 1 {
		return 0, 0, false
	}
	return f - 1, c - 1, true
}

func partirRango(r string) (int, int, int, int, bool) {
	a, b, hay := strings.Cut(r, ":")
	if !hay {
		b = a
	}
	f1, c1, ok1 := partirRef(a)
	f2, c2, ok2 := partirRef(b)
	if !ok1 || !ok2 {
		return 0, 0, 0, 0, false
	}
	return f1, c1, f2, c2, true
}

func esLetraIdent(c byte) bool {
	return c == '_' || c == '.' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c >= 0x80
}

// trasladarFormula desplaza las referencias relativas de una fórmula compartida.
func trasladarFormula(f string, df, dc int) string {
	var b strings.Builder
	for i := 0; i < len(f); {
		c := f[i]
		if c == '"' || c == '\'' {
			j := i + 1
			for j < len(f) {
				if f[j] == c {
					if j+1 < len(f) && f[j+1] == c {
						j += 2
						continue
					}
					break
				}
				j++
			}
			j = min(j+1, len(f))
			b.WriteString(f[i:j])
			i = j
			continue
		}
		if c == '$' || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || c == '_' {
			if i > 0 && esLetraIdent(f[i-1]) {
				b.WriteByte(c)
				i++
				continue
			}
			if n, s := refEn(f, i, df, dc); n > 0 {
				b.WriteString(s)
				i += n
				continue
			}
			j := i
			for j < len(f) && (esLetraIdent(f[j]) || f[j] == '$') {
				j++
			}
			j = max(j, i+1)
			b.WriteString(f[i:j])
			i = j
			continue
		}
		b.WriteByte(c)
		i++
	}
	return b.String()
}

// refEn reconoce en f[i:] una celda, un rango de columnas o uno de filas.
func refEn(f string, i, df, dc int) (int, string) {
	col1, fila1, j := leerParteRef(f, i)
	if j == i {
		return 0, ""
	}
	if col1 != "" && fila1 != "" {
		if j < len(f) && (esLetraIdent(f[j]) || f[j] == '(') {
			return 0, ""
		}
		return j - i, moverCol(col1, dc) + moverFila(fila1, df)
	}
	// A:C o 1:3
	if j < len(f) && f[j] == ':' {
		col2, fila2, k := leerParteRef(f, j+1)
		if k > j+1 && (k >= len(f) || !esLetraIdent(f[k])) {
			if col1 != "" && col2 != "" && fila2 == "" {
				return k - i, moverCol(col1, dc) + ":" + moverCol(col2, dc)
			}
			if fila1 != "" && fila2 != "" && col2 == "" {
				return k - i, moverFila(fila1, df) + ":" + moverFila(fila2, df)
			}
		}
	}
	return 0, ""
}

// leerParteRef lee [$]LETRAS[$]DIGITOS; cada parte puede faltar.
func leerParteRef(f string, i int) (string, string, int) {
	j := i
	if j < len(f) && f[j] == '$' {
		j++
	}
	k := j
	for k < len(f) && f[k] >= 'A' && f[k] <= 'Z' {
		k++
	}
	col := ""
	if k > j && k-j <= 3 {
		col = f[i:k]
	} else {
		k = i
	}
	m := k
	if m < len(f) && f[m] == '$' {
		m++
	}
	n := m
	for n < len(f) && f[n] >= '0' && f[n] <= '9' {
		n++
	}
	fila := ""
	if n > m {
		fila = f[k:n]
		k = n
	}
	return col, fila, k
}

func moverCol(s string, d int) string {
	if strings.HasPrefix(s, "$") {
		return s
	}
	v := 0
	for _, c := range s {
		v = v*26 + int(c-'A') + 1
	}
	return nombreColumna(max(0, v-1+d))
}

func moverFila(s string, d int) string {
	if strings.HasPrefix(s, "$") {
		return s
	}
	v, _ := strconv.Atoi(s)
	return strconv.Itoa(max(1, v+d))
}

// ---- Formatos numéricos ----

func general(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e11 {
		return strconv.FormatFloat(v, 'f', 0, 64)
	}
	a := math.Abs(v)
	if a >= 1e11 || (a != 0 && a < 1e-9) {
		s := strconv.FormatFloat(v, 'E', 5, 64)
		m, e, _ := strings.Cut(s, "E")
		m = strings.TrimRight(strings.TrimRight(m, "0"), ".")
		signo := e[0]
		e = strings.TrimLeft(e[1:], "0")
		return m + "E" + string(signo) + e
	}
	digitos := int(math.Floor(math.Log10(a))) + 1
	dec := max(0, min(10-max(digitos, 0), 15))
	s := redondearDecimal(strconv.FormatFloat(v, 'f', -1, 64), dec)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// redondearDecimal redondea un decimal escrito, mitad hacia arriba.
func redondearDecimal(s string, dec int) string {
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	ent, frac, _ := strings.Cut(s, ".")
	if len(frac) <= dec {
		frac += strings.Repeat("0", dec-len(frac))
	} else {
		sube := frac[dec] >= '5'
		frac = frac[:dec]
		if sube {
			d := []byte(ent + frac)
			i := len(d) - 1
			for ; i >= 0; i-- {
				if d[i] == '9' {
					d[i] = '0'
				} else {
					d[i]++
					break
				}
			}
			t := string(d)
			if i < 0 {
				t = "1" + t
			}
			ent, frac = t[:len(t)-dec], t[len(t)-dec:]
		}
	}
	r := ent
	if dec > 0 {
		r += "." + frac
	}
	if neg && strings.Trim(r, "0.") != "" {
		r = "-" + r
	}
	return r
}

func partirSecciones(code string) []string {
	var r []string
	ini, enQ := 0, false
	for i := 0; i < len(code); i++ {
		switch code[i] {
		case '"':
			enQ = !enQ
		case '\\':
			i++
		case ';':
			if !enQ {
				r = append(r, code[ini:i])
				ini = i + 1
			}
		}
	}
	return append(r, code[ini:])
}

type itemFmt struct {
	lit string
	cod string // token de fecha
}

// aplicarFormato devuelve el texto mostrado; ok=false si el formato no está soportado.
func aplicarFormato(v float64, code string, f1904 bool) (string, bool) {
	if code == "" || strings.EqualFold(code, "General") {
		return general(v), true
	}
	secs := partirSecciones(code)
	sec := secs[0]
	signoManual := false
	a := v
	switch {
	case v < 0 && len(secs) >= 2:
		sec, a = secs[1], -v
	case v < 0:
		a, signoManual = -v, true
	case v == 0 && len(secs) >= 3:
		sec = secs[2]
	}
	if strings.EqualFold(strings.TrimSpace(sec), "General") {
		return general(v), true
	}
	if sec == "@" {
		return "", false
	}
	var items []itemFmt
	esFecha, ampm := false, false
	patron := ""
	var pre, suf strings.Builder
	nReg, pct := 0, 0
	transcurrido := ""
	lit := func(s string) {
		if patron != "" {
			suf.WriteString(s)
		} else {
			pre.WriteString(s)
		}
		items = append(items, itemFmt{lit: s})
	}
	for i := 0; i < len(sec); {
		c := sec[i]
		switch {
		case c == '"':
			j := i + 1
			for j < len(sec) && sec[j] != '"' {
				j++
			}
			lit(sec[i+1 : j])
			i = j + 1
		case c == '\\' && i+1 < len(sec):
			r, n := utf8.DecodeRuneInString(sec[i+1:])
			lit(string(r))
			i += 1 + n
		case c == '_' && i+1 < len(sec):
			_, n := utf8.DecodeRuneInString(sec[i+1:])
			lit(" ")
			i += 1 + n
		case c == '*' && i+1 < len(sec):
			_, n := utf8.DecodeRuneInString(sec[i+1:])
			i += 1 + n
		case c == '[':
			j := strings.IndexByte(sec[i:], ']')
			if j < 0 {
				return "", false
			}
			t := sec[i+1 : i+j]
			i += j + 1
			switch {
			case strings.HasPrefix(t, "$"):
				s, _, _ := strings.Cut(t[1:], "-")
				lit(s)
			case t != "" && strings.ContainsAny(t[:1], "<>="):
				return "", false
			case strings.Trim(strings.ToLower(t), "hms") == "":
				esFecha = true
				transcurrido = strings.ToLower(t)
			}
		case strings.HasPrefix(strings.ToUpper(sec[i:]), "AM/PM"):
			esFecha, ampm = true, true
			items = append(items, itemFmt{cod: "ampm"})
			i += 5
		case strings.ContainsRune("ymdhsYMDHS", rune(c)):
			esFecha = true
			j := i
			for j < len(sec) && strings.EqualFold(sec[j:j+1], sec[i:i+1]) {
				j++
			}
			items = append(items, itemFmt{cod: strings.ToLower(sec[i:j])})
			i = j
		case strings.ContainsRune("0#?.,", rune(c)):
			j := i
			for j < len(sec) && strings.ContainsRune("0#?.,", rune(sec[j])) {
				j++
			}
			nReg++
			patron = sec[i:j]
			items = append(items, itemFmt{lit: sec[i:j]})
			i = j
		case c == '%':
			pct++
			lit("%")
			i++
		case c == 'E' || c == 'e' || c == '/':
			if !esFecha {
				return "", false
			}
			lit(string(c))
			i++
		default:
			r, n := utf8.DecodeRuneInString(sec[i:])
			lit(string(r))
			i += n
		}
	}
	if esFecha {
		s, ok := formatearFecha(a, items, ampm, f1904, transcurrido)
		if signoManual {
			s = "-" + s
		}
		return s, ok
	}
	if nReg != 1 {
		return "", false
	}
	for range pct {
		a *= 100
	}
	s := formatearPatron(a, patron)
	if signoManual && strings.Trim(s, "0.,") != "" {
		s = "-" + s
	}
	if s == "" {
		return "", false
	}
	return pre.String() + s + suf.String(), true
}

func formatearPatron(a float64, patron string) string {
	ent, frac, _ := strings.Cut(patron, ".")
	for strings.HasSuffix(ent, ",") {
		ent = ent[:len(ent)-1]
		a /= 1000
	}
	miles := strings.Contains(ent, ",")
	dec := len(frac)
	s := redondearDecimal(strconv.FormatFloat(a, 'f', -1, 64), dec)
	e, f, _ := strings.Cut(s, ".")
	minEnt := strings.Count(ent, "0") + strings.Count(ent, "?")
	if e == "0" && minEnt == 0 {
		e = ""
	}
	for len(e) < minEnt {
		e = "0" + e
	}
	if miles && len(e) > 3 {
		var b strings.Builder
		for i, c := range e {
			if i > 0 && (len(e)-i)%3 == 0 {
				b.WriteByte(',')
			}
			b.WriteRune(c)
		}
		e = b.String()
	}
	req := strings.Count(frac, "0") + strings.Count(frac, "?")
	for len(f) > req && strings.HasSuffix(f, "0") {
		f = f[:len(f)-1]
	}
	if f != "" {
		return e + "." + f
	}
	if strings.Contains(patron, ".") && dec > 0 && req == 0 {
		return e + "."
	}
	return e
}

var mesesLargos = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
var diasLargos = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

// serialAFecha convierte un serial de Excel a fecha.
func serialAFecha(v float64, f1904 bool) (time.Time, bool) {
	if v < 0 || v > 2958465.99999 {
		return time.Time{}, false
	}
	dias := math.Floor(v)
	seg := math.Round((v - dias) * 86400)
	if seg >= 86400 {
		dias++
		seg = 0
	}
	var base time.Time
	if f1904 {
		base = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
	} else if dias < 60 {
		base = time.Date(1899, 12, 31, 0, 0, 0, 0, time.UTC)
	} else {
		base = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	}
	return base.AddDate(0, 0, int(dias)).Add(time.Duration(seg) * time.Second), true
}

func formatearFecha(v float64, items []itemFmt, ampm, f1904 bool, transcurrido string) (string, bool) {
	t, ok := serialAFecha(v, f1904)
	if !ok {
		return "", false
	}
	var b strings.Builder
	for i, it := range items {
		if it.cod == "" {
			b.WriteString(it.lit)
			continue
		}
		c := it.cod
		switch c[0] {
		case 'y':
			if len(c) <= 2 {
				fmt.Fprintf(&b, "%02d", t.Year()%100)
			} else {
				fmt.Fprintf(&b, "%04d", t.Year())
			}
		case 'd':
			switch len(c) {
			case 1:
				b.WriteString(strconv.Itoa(t.Day()))
			case 2:
				fmt.Fprintf(&b, "%02d", t.Day())
			case 3:
				b.WriteString(diasLargos[int(t.Weekday())][:3])
			default:
				b.WriteString(diasLargos[int(t.Weekday())])
			}
		case 'h':
			h := t.Hour()
			if transcurrido != "" {
				h = int(math.Floor(v*24 + 1e-9))
			} else if ampm {
				h %= 12
				if h == 0 {
					h = 12
				}
			}
			if len(c) >= 2 {
				fmt.Fprintf(&b, "%02d", h)
			} else {
				b.WriteString(strconv.Itoa(h))
			}
		case 's':
			if len(c) >= 2 {
				fmt.Fprintf(&b, "%02d", t.Second())
			} else {
				b.WriteString(strconv.Itoa(t.Second()))
			}
		case 'a':
			if t.Hour() < 12 {
				b.WriteString("a. m.")
			} else {
				b.WriteString("p. m.")
			}
		case 'm':
			if len(c) <= 2 && esMinuto(items, i) {
				if len(c) == 2 {
					fmt.Fprintf(&b, "%02d", t.Minute())
				} else {
					b.WriteString(strconv.Itoa(t.Minute()))
				}
				continue
			}
			switch len(c) {
			case 1:
				b.WriteString(strconv.Itoa(int(t.Month())))
			case 2:
				fmt.Fprintf(&b, "%02d", int(t.Month()))
			case 3:
				b.WriteString(mesesLargos[t.Month()-1][:3])
			case 5:
				b.WriteString(mesesLargos[t.Month()-1][:1])
			default:
				b.WriteString(mesesLargos[t.Month()-1])
			}
		}
	}
	return b.String(), true
}

// esMinuto: `m` es minutos si sigue a horas o precede a segundos.
func esMinuto(items []itemFmt, i int) bool {
	for j := i - 1; j >= 0; j-- {
		if items[j].cod != "" {
			if items[j].cod[0] == 'h' {
				return true
			}
			break
		}
	}
	for j := i + 1; j < len(items); j++ {
		if items[j].cod != "" {
			return items[j].cod[0] == 's'
		}
	}
	return false
}

// ---- Lectura de hojas ----

type cupoHoja struct {
	celdas, bytes int
	recortado     bool
}

func natural(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

type colInfo struct {
	min, max, ancho int
}

func (x *libroX) estiloLocal(h *Hoja, s int, mapa map[int]int, porEstilo map[Estilo]int) *int {
	if s < 0 || s >= len(x.xfs) || x.xfs[s].vacio {
		return nil
	}
	if i, ok := mapa[s]; ok {
		return &i
	}
	e := x.xfs[s].estilo
	i, ok := porEstilo[e]
	if !ok {
		i = len(h.Estilos)
		h.Estilos = append(h.Estilos, e)
		porEstilo[e] = i
	}
	mapa[s] = i
	return &i
}

type maestraF struct {
	f, c int
	txt  string
}

func (x *libroX) leerHoja(d []byte, h *Hoja, cupo *cupoHoja) error {
	dec := nuevoDecoder(normalizarXML(d))
	mapa, porEstilo := map[int]int{}, map[Estilo]int{}
	maestras := map[string]maestraF{}
	var cols []colInfo
	filaAct, colAct := -1, -1
	var (
		enCelda        bool
		tipo, ref      string
		sIdx           int
		valor, formula strings.Builder
		fT, fSi        string
		hayF, enV, enF bool
		enT, enIs      bool
		enRPh          int
		textoIs        strings.Builder
		hayV           bool
	)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("hoja dañada: %v", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			at := func(nom string) string {
				for _, a := range t.Attr {
					if a.Name.Local == nom {
						return a.Value
					}
				}
				return ""
			}
			switch t.Name.Local {
			case "pane":
				if e := at("state"); e == "frozen" || e == "frozenSplit" {
					yy, _ := strconv.Atoi(at("ySplit"))
					xx, _ := strconv.Atoi(at("xSplit"))
					if xx > 0 || yy > 0 {
						h.Congela = &[2]int{yy, xx}
					}
				}
			case "col":
				a, _ := strconv.Atoi(at("min"))
				b, _ := strconv.Atoi(at("max"))
				w, _ := strconv.ParseFloat(at("width"), 64)
				ancho := int(math.Round(w))
				if at("hidden") == "1" || at("hidden") == "true" {
					ancho = 0
				}
				if a >= 1 && b >= a {
					cols = append(cols, colInfo{a - 1, b - 1, ancho})
				}
			case "row":
				if v, err := strconv.Atoi(at("r")); err == nil && v >= 1 {
					filaAct = v - 1
				} else {
					filaAct++
				}
				colAct = -1
			case "c":
				enCelda = true
				tipo = at("t")
				ref = at("r")
				sIdx = -1
				if v, err := strconv.Atoi(at("s")); err == nil {
					sIdx = v
				}
				valor.Reset()
				formula.Reset()
				textoIs.Reset()
				hayF, hayV, fT, fSi = false, false, "", ""
				if f, c, ok := partirRef(ref); ok {
					filaAct, colAct = f, c
				} else {
					colAct++
				}
			case "f":
				if enCelda {
					hayF, enF = true, true
					fT, fSi = at("t"), at("si")
				}
			case "v":
				if enCelda {
					enV, hayV = true, true
				}
			case "is":
				enIs = true
			case "t":
				enT = enIs
			case "rPh":
				enRPh++
			case "mergeCell":
				if f1, c1, f2, c2, ok := partirRango(at("ref")); ok {
					h.Combinadas = append(h.Combinadas, [4]int{f1, c1, f2, c2})
				}
			}
		case xml.CharData:
			switch {
			case enV:
				valor.Write(t)
			case enF:
				formula.Write(t)
			case enT && enRPh == 0:
				textoIs.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v":
				enV = false
			case "f":
				enF = false
			case "t":
				enT = false
			case "is":
				enIs = false
			case "rPh":
				enRPh--
			case "c":
				enCelda = false
				x.cerrarCelda(h, cupo, filaAct, colAct, tipo, sIdx, valor.String(), textoIs.String(), hayV, hayF, formula.String(), fT, fSi, maestras, mapa, porEstilo)
			}
		}
	}
	for _, c := range cols {
		for i := c.min; i <= c.max && i < h.Cols && i < 16384; i++ {
			h.Anchos[strconv.Itoa(i)] = c.ancho
		}
	}
	return nil
}

func (x *libroX) cerrarCelda(h *Hoja, cupo *cupoHoja, f, c int, tipo string, sIdx int, val, is string, hayV, hayF bool, formula, fT, fSi string, maestras map[string]maestraF, mapa map[int]int, porEstilo map[Estilo]int) {
	if f < 0 || c < 0 {
		return
	}
	cel := CeldaHoja{F: f, C: c}
	if hayF && fT != "dataTable" {
		txt := strings.TrimPrefix(formula, "=")
		if fT == "shared" {
			if m, ok := maestras[fSi]; ok && txt == "" {
				txt = trasladarFormula(m.txt, f-m.f, c-m.c)
			} else if txt != "" {
				maestras[fSi] = maestraF{f, c, txt}
			}
		}
		cel.Formula = txt
	}
	switch tipo {
	case "s":
		if i, err := strconv.Atoi(strings.TrimSpace(val)); err == nil && i >= 0 && i < len(x.compartir) {
			cel.V = x.compartir[i]
		}
	case "str", "e":
		cel.V = val
	case "inlineStr":
		cel.V = is
	case "b":
		if hayV {
			v := strings.TrimSpace(val)
			cel.V = v == "1" || strings.EqualFold(v, "true")
			if cel.V == true {
				cel.Mostrado = "VERDADERO"
			} else {
				cel.Mostrado = "FALSO"
			}
		}
	default:
		s := strings.TrimSpace(val)
		if hayV && s != "" {
			n, err := strconv.ParseFloat(s, 64)
			if err != nil {
				cel.V = s
				break
			}
			cel.V = n
			formato := ""
			if sIdx >= 0 && sIdx < len(x.xfs) {
				formato = x.xfs[sIdx].formato
			}
			if m, ok := aplicarFormato(n, formato, x.f1904); ok && m != natural(n) {
				cel.Mostrado = m
			}
		}
	}
	cel.Estilo = x.estiloLocal(h, sIdx, mapa, porEstilo)
	if cel.V == nil && cel.Formula == "" {
		// Vacía: solo interesa si tiene fondo.
		if cel.Estilo == nil || h.Estilos[*cel.Estilo].Bg == "" {
			return
		}
	}
	if cupo.recortado {
		return
	}
	b, err := aJSON(cel)
	if err != nil {
		return
	}
	cupo.bytes += len(b)
	if cupo.celdas >= limiteCeldas || cupo.bytes > limiteDocumento-128*1024 {
		cupo.recortado = true
		return
	}
	cupo.celdas++
	h.Filas = max(h.Filas, f+1)
	h.Cols = max(h.Cols, c+1)
	h.Celdas = append(h.Celdas, cel)
}

func abrirXlsx(d []byte) (any, error) {
	z, err := abrirZip(d)
	if err != nil {
		return nil, err
	}
	x, err := cargarLibro(z)
	if err != nil {
		return nil, err
	}
	doc := DocHoja{Tipo: "xlsx", Hojas: []Hoja{}, Firma: sha256Hex(d)}
	cupo := &cupoHoja{}
	for _, hi := range x.hojas {
		h := Hoja{Nombre: hi.nombre, Celdas: []CeldaHoja{}, Estilos: []Estilo{}, Anchos: map[string]int{}, Combinadas: [][4]int{}}
		if hi.estado == "hidden" || hi.estado == "veryHidden" {
			h.Oculta = 1
		}
		if hi.esHoja {
			dat, err := z.leer(hi.ruta)
			if err != nil {
				return nil, err
			}
			if err := x.leerHoja(dat, &h, cupo); err != nil {
				return nil, err
			}
		}
		doc.Hojas = append(doc.Hojas, h)
	}
	if cupo.recortado {
		doc.Aviso = fmt.Sprintf("El libro es muy grande: solo se muestran las primeras %d celdas.", cupo.celdas)
	}
	return doc, nil
}
