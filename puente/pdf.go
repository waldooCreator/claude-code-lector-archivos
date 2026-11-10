package main

import (
	"bytes"
	"compress/flate"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
)

// Lector de PDF: objetos, xref (tabla y streams), object streams y filtros.

type pdfRef struct{ n, g int }
type pdfNombre string
type pdfCadena []byte
type pdfOp string
type pdfDict map[string]any
type pdfStream struct {
	dict  pdfDict
	crudo []byte
}

type entradaXref struct{ tipo, a, b int }

type objStmCache struct {
	datos   []byte
	nums    []int
	offsets []int
}

type lectorPDF struct {
	d       []byte
	xref    map[int]entradaXref
	cache   map[int]any
	enCurso map[int]bool
	stms    map[int]*objStmCache
	trailer pdfDict
	fuentes map[int]*fuentePDF
	// Barridos completos hechos por objetos fuera de sitio.
	busquedas int
}

var errPdfCifrado = errors.New("el PDF está cifrado; no se puede abrir")

const maxFiltro = 256 * 1024 * 1024

// ---- Lexer ----

type lexPDF struct {
	d    []byte
	p    int
	refs bool
	prof int
}

func esEspacioPDF(c byte) bool {
	return c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32
}

func esDelimPDF(c byte) bool {
	switch c {
	case '(', ')', '<', '>', '[', ']', '{', '}', '/', '%':
		return true
	}
	return false
}

func (l *lexPDF) saltar() {
	for l.p < len(l.d) {
		c := l.d[l.p]
		if esEspacioPDF(c) {
			l.p++
			continue
		}
		if c == '%' {
			for l.p < len(l.d) && l.d[l.p] != '\n' && l.d[l.p] != '\r' {
				l.p++
			}
			continue
		}
		break
	}
}

// objeto lee el siguiente objeto; ok=false al terminar la entrada.
func (l *lexPDF) objeto() (any, bool) {
	l.saltar()
	if l.p >= len(l.d) {
		return nil, false
	}
	if l.prof > 200 {
		panic("PDF demasiado anidado")
	}
	c := l.d[l.p]
	switch {
	case c == '/':
		return l.nombre(), true
	case c == '(':
		return l.cadena(), true
	case c == '<':
		if l.p+1 < len(l.d) && l.d[l.p+1] == '<' {
			l.p += 2
			return l.dict(), true
		}
		return l.hex(), true
	case c == '>':
		if l.p+1 < len(l.d) && l.d[l.p+1] == '>' {
			l.p += 2
			return pdfOp(">>"), true
		}
		l.p++
		return pdfOp(">"), true
	case c == '[':
		l.p++
		l.prof++
		arr := []any{}
		for {
			v, ok := l.objeto()
			if !ok {
				break
			}
			if op, es := v.(pdfOp); es {
				if op == "]" {
					break
				}
				if op == "endobj" || op == "endstream" {
					break
				}
				continue
			}
			arr = append(arr, v)
		}
		l.prof--
		return arr, true
	case c == ']':
		l.p++
		return pdfOp("]"), true
	case c == '{' || c == '}' || c == ')':
		l.p++
		return pdfOp(string(c)), true
	}
	ini := l.p
	for l.p < len(l.d) && !esEspacioPDF(l.d[l.p]) && !esDelimPDF(l.d[l.p]) {
		l.p++
	}
	tok := string(l.d[ini:l.p])
	if v, ok := numeroPDF(tok); ok {
		if l.refs {
			if _, esEnt := v.(int); esEnt {
				if r, ok := l.intentarRef(v.(int)); ok {
					return r, true
				}
			}
		}
		return v, true
	}
	switch tok {
	case "true":
		return true, true
	case "false":
		return false, true
	case "null":
		return nil, true
	}
	return pdfOp(tok), true
}

func (l *lexPDF) intentarRef(n int) (pdfRef, bool) {
	guarda := l.p
	l.saltar()
	ini := l.p
	for l.p < len(l.d) && l.d[l.p] >= '0' && l.d[l.p] <= '9' {
		l.p++
	}
	if l.p > ini && l.p-ini <= 6 {
		g, _ := strconv.Atoi(string(l.d[ini:l.p]))
		l.saltar()
		if l.p < len(l.d) && l.d[l.p] == 'R' && (l.p+1 >= len(l.d) || esEspacioPDF(l.d[l.p+1]) || esDelimPDF(l.d[l.p+1])) {
			l.p++
			return pdfRef{n, g}, true
		}
	}
	l.p = guarda
	return pdfRef{}, false
}

func numeroPDF(t string) (any, bool) {
	if t == "" {
		return nil, false
	}
	for i := 0; i < len(t); i++ {
		c := t[i]
		if !((c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.') {
			return nil, false
		}
	}
	if v, err := strconv.Atoi(t); err == nil {
		return v, true
	}
	if v, err := strconv.ParseFloat(t, 64); err == nil {
		return v, true
	}
	// Tolera formas como "--5" o "1.2.3".
	limpio := regexp.MustCompile(`^[+-]*`).ReplaceAllString(t, "")
	neg := t[0] == '-'
	if v, err := strconv.ParseFloat(limpio, 64); err == nil {
		if neg {
			v = -v
		}
		return v, true
	}
	return nil, false
}

func (l *lexPDF) nombre() pdfNombre {
	l.p++
	var b []byte
	for l.p < len(l.d) && !esEspacioPDF(l.d[l.p]) && !esDelimPDF(l.d[l.p]) {
		c := l.d[l.p]
		if c == '#' && l.p+2 < len(l.d) {
			if v, err := strconv.ParseUint(string(l.d[l.p+1:l.p+3]), 16, 8); err == nil {
				b = append(b, byte(v))
				l.p += 3
				continue
			}
		}
		b = append(b, c)
		l.p++
	}
	return pdfNombre(b)
}

func (l *lexPDF) cadena() pdfCadena {
	l.p++
	prof := 1
	r := pdfCadena{}
	for l.p < len(l.d) {
		c := l.d[l.p]
		l.p++
		switch c {
		case '(':
			prof++
			r = append(r, c)
		case ')':
			prof--
			if prof == 0 {
				return r
			}
			r = append(r, c)
		case '\\':
			if l.p >= len(l.d) {
				return r
			}
			e := l.d[l.p]
			l.p++
			switch e {
			case 'n':
				r = append(r, '\n')
			case 'r':
				r = append(r, '\r')
			case 't':
				r = append(r, '\t')
			case 'b':
				r = append(r, 8)
			case 'f':
				r = append(r, 12)
			case '\r':
				if l.p < len(l.d) && l.d[l.p] == '\n' {
					l.p++
				}
			case '\n':
			default:
				if e >= '0' && e <= '7' {
					v := int(e - '0')
					for i := 0; i < 2 && l.p < len(l.d) && l.d[l.p] >= '0' && l.d[l.p] <= '7'; i++ {
						v = v*8 + int(l.d[l.p]-'0')
						l.p++
					}
					r = append(r, byte(v))
				} else {
					r = append(r, e)
				}
			}
		default:
			r = append(r, c)
		}
	}
	return r
}

func (l *lexPDF) hex() pdfCadena {
	l.p++
	r := pdfCadena{}
	var alto byte
	mitad := false
	for l.p < len(l.d) {
		c := l.d[l.p]
		l.p++
		if c == '>' {
			break
		}
		var v byte
		switch {
		case c >= '0' && c <= '9':
			v = c - '0'
		case c >= 'a' && c <= 'f':
			v = c - 'a' + 10
		case c >= 'A' && c <= 'F':
			v = c - 'A' + 10
		default:
			continue
		}
		if mitad {
			r = append(r, alto<<4|v)
			mitad = false
		} else {
			alto, mitad = v, true
		}
	}
	if mitad {
		r = append(r, alto<<4)
	}
	return r
}

func (l *lexPDF) dict() pdfDict {
	d := pdfDict{}
	l.prof++
	defer func() { l.prof-- }()
	for {
		k, ok := l.objeto()
		if !ok {
			return d
		}
		if op, es := k.(pdfOp); es {
			if op == ">>" || op == "endobj" || op == "stream" {
				return d
			}
			continue
		}
		nom, es := k.(pdfNombre)
		if !es {
			continue
		}
		v, ok := l.objeto()
		if !ok {
			return d
		}
		if op, es := v.(pdfOp); es {
			if op == ">>" {
				return d
			}
			continue
		}
		d[string(nom)] = v
	}
}

// ---- Objetos ----

func abrirLectorPDF(d []byte) (*lectorPDF, error) {
	p := &lectorPDF{d: d, xref: map[int]entradaXref{}, cache: map[int]any{}, enCurso: map[int]bool{}, stms: map[int]*objStmCache{}, trailer: pdfDict{}, fuentes: map[int]*fuentePDF{}}
	bien := p.leerXrefs()
	if !bien || p.dict(p.dict(p.trailer["Root"])["Pages"]) == nil {
		p.reparar()
	}
	if p.trailer["Encrypt"] != nil {
		return nil, errPdfCifrado
	}
	if p.dict(p.dict(p.trailer["Root"])["Pages"]) == nil && !p.hayPaginas() {
		return nil, errors.New("el PDF está dañado: no se encontraron páginas")
	}
	return p, nil
}

var reStartxref = regexp.MustCompile(`startxref\s+(\d+)`)

func (p *lectorPDF) leerXrefs() (ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	ms := reStartxref.FindAllSubmatch(p.d, -1)
	if len(ms) == 0 {
		return false
	}
	off, _ := strconv.Atoi(string(ms[len(ms)-1][1]))
	vistos := map[int]bool{}
	cola := []int{off}
	for len(cola) > 0 {
		off = cola[0]
		cola = cola[1:]
		if vistos[off] || off < 0 || off >= len(p.d) {
			continue
		}
		vistos[off] = true
		l := &lexPDF{d: p.d, p: off}
		l.saltar()
		var dic pdfDict
		if bytes.HasPrefix(p.d[l.p:], []byte("xref")) {
			l.p += 4
			if dic = p.leerTablaXref(l); dic == nil {
				return false
			}
		} else {
			if dic = p.leerStreamXref(l); dic == nil {
				return false
			}
		}
		for k, v := range dic {
			if _, hay := p.trailer[k]; !hay {
				p.trailer[k] = v
			}
		}
		if v, ok := dic["XRefStm"].(int); ok {
			cola = append(cola, v)
		}
		if v, ok := dic["Prev"].(int); ok {
			cola = append(cola, v)
		}
	}
	return true
}

func (p *lectorPDF) leerTablaXref(l *lexPDF) pdfDict {
	for {
		v, ok := l.objeto()
		if !ok {
			return nil
		}
		if op, es := v.(pdfOp); es {
			if op == "trailer" {
				l.refs = true
				if d, ok := mustObjeto(l).(pdfDict); ok {
					return d
				}
				return nil
			}
			return nil
		}
		ini, ok1 := v.(int)
		cuenta, _ := mustObjeto(l).(int)
		if !ok1 {
			return nil
		}
		for i := 0; i < cuenta; i++ {
			a, ok1 := mustObjeto(l).(int)
			b, ok2 := mustObjeto(l).(int)
			t, ok3 := mustObjeto(l).(pdfOp)
			if !ok1 || !ok2 || !ok3 {
				return nil
			}
			if _, hay := p.xref[ini+i]; hay {
				continue
			}
			if t == "n" {
				p.xref[ini+i] = entradaXref{1, a, b}
			} else {
				p.xref[ini+i] = entradaXref{0, 0, 0}
			}
		}
	}
}

func mustObjeto(l *lexPDF) any {
	v, _ := l.objeto()
	return v
}

func (p *lectorPDF) leerStreamXref(l *lexPDF) pdfDict {
	v, ok := p.parsearEn(l.p, -1)
	if !ok {
		return nil
	}
	st, ok := v.(*pdfStream)
	if !ok {
		return nil
	}
	datos, _, err := p.decodificarStream(st)
	if err != nil {
		return nil
	}
	w := p.arr(st.dict["W"])
	if len(w) < 3 {
		return nil
	}
	a, _ := p.ent(w[0])
	b, _ := p.ent(w[1])
	c, _ := p.ent(w[2])
	tam := a + b + c
	if tam <= 0 {
		return nil
	}
	size, _ := p.ent(st.dict["Size"])
	idx := p.arr(st.dict["Index"])
	if len(idx) == 0 {
		idx = []any{0, size}
	}
	pos := 0
	leerCampo := func(n int, def int) int {
		if n == 0 {
			return def
		}
		v := 0
		for i := 0; i < n; i++ {
			v = v<<8 | int(datos[pos+i])
		}
		pos += n
		return v
	}
	for i := 0; i+1 < len(idx); i += 2 {
		ini, _ := p.ent(idx[i])
		cuenta, _ := p.ent(idx[i+1])
		for k := 0; k < cuenta && pos+tam <= len(datos); k++ {
			t := leerCampo(a, 1)
			x := leerCampo(b, 0)
			y := leerCampo(c, 0)
			// En archivos híbridos la tabla marca libres los objetos comprimidos.
			if e, hay := p.xref[ini+k]; !hay || e.tipo == 0 {
				p.xref[ini+k] = entradaXref{t, x, y}
			}
		}
	}
	return st.dict
}

// parsearEn lee "N G obj ..." en un offset; num<0 no comprueba el número.
func (p *lectorPDF) parsearEn(off, num int) (any, bool) {
	if off < 0 || off >= len(p.d) {
		return nil, false
	}
	l := &lexPDF{d: p.d, p: off}
	n, ok1 := mustObjeto(l).(int)
	_, ok2 := mustObjeto(l).(int)
	op, ok3 := mustObjeto(l).(pdfOp)
	if !ok1 || !ok2 || !ok3 || op != "obj" || (num >= 0 && n != num) {
		return nil, false
	}
	l.refs = true
	v, ok := l.objeto()
	if !ok {
		return nil, false
	}
	if dic, es := v.(pdfDict); es {
		l.saltar()
		if bytes.HasPrefix(l.d[l.p:], []byte("stream")) {
			l.p += 6
			if l.p < len(l.d) && l.d[l.p] == '\r' {
				l.p++
			}
			if l.p < len(l.d) && l.d[l.p] == '\n' {
				l.p++
			}
			return &pdfStream{dict: dic, crudo: p.datosStream(dic, l.p)}, true
		}
	}
	return v, true
}

func (p *lectorPDF) datosStream(dic pdfDict, ini int) []byte {
	if n, ok := p.ent(dic["Length"]); ok && n >= 0 && ini+n <= len(p.d) {
		cola := ini + n
		l := &lexPDF{d: p.d, p: cola}
		l.saltar()
		if bytes.HasPrefix(p.d[l.p:], []byte("endstream")) {
			return p.d[ini : ini+n]
		}
	}
	fin := bytes.Index(p.d[ini:], []byte("endstream"))
	if fin < 0 {
		return p.d[ini:]
	}
	r := p.d[ini : ini+fin]
	r = bytes.TrimSuffix(r, []byte("\n"))
	r = bytes.TrimSuffix(r, []byte("\r"))
	return r
}

func (p *lectorPDF) obj(n int) any {
	if v, ok := p.cache[n]; ok {
		return v
	}
	if p.enCurso[n] {
		return nil
	}
	e, ok := p.xref[n]
	if !ok || e.tipo == 0 {
		return nil
	}
	p.enCurso[n] = true
	defer delete(p.enCurso, n)
	var v any
	switch e.tipo {
	case 1:
		var okp bool
		v, okp = p.parsearEn(e.a, n)
		if !okp {
			if off := p.buscarObj(n); off >= 0 {
				v, _ = p.parsearEn(off, n)
			}
		}
	case 2:
		v = p.objDeStm(e.a, n, e.b)
	}
	p.cache[n] = v
	return v
}

func (p *lectorPDF) buscarObj(n int) int {
	if p.busquedas++; p.busquedas > 64 {
		return -1
	}
	re := regexp.MustCompile(`(?:^|[\r\n\s])` + strconv.Itoa(n) + `\s+\d+\s+obj\b`)
	loc := re.FindAllIndex(p.d, -1)
	if loc == nil {
		return -1
	}
	off := loc[len(loc)-1][0]
	for off < len(p.d) && esEspacioPDF(p.d[off]) {
		off++
	}
	return off
}

func (p *lectorPDF) objDeStm(stm, num, indice int) any {
	c := p.stms[stm]
	if c == nil {
		st, ok := p.obj(stm).(*pdfStream)
		if !ok {
			return nil
		}
		datos, _, err := p.decodificarStream(st)
		if err != nil {
			return nil
		}
		n, _ := p.ent(st.dict["N"])
		first, _ := p.ent(st.dict["First"])
		c = &objStmCache{datos: datos}
		l := &lexPDF{d: datos}
		for i := 0; i < n; i++ {
			a, ok1 := mustObjeto(l).(int)
			b, ok2 := mustObjeto(l).(int)
			if !ok1 || !ok2 {
				break
			}
			c.nums = append(c.nums, a)
			c.offsets = append(c.offsets, first+b)
		}
		p.stms[stm] = c
	}
	idx := indice
	if idx < 0 || idx >= len(c.nums) || c.nums[idx] != num {
		idx = -1
		for i, x := range c.nums {
			if x == num {
				idx = i
				break
			}
		}
		if idx < 0 {
			return nil
		}
	}
	if c.offsets[idx] >= len(c.datos) {
		return nil
	}
	l := &lexPDF{d: c.datos, p: c.offsets[idx], refs: true}
	v, _ := l.objeto()
	return v
}

// reparar reconstruye la xref barriendo todo el archivo.
func (p *lectorPDF) reparar() {
	p.xref = map[int]entradaXref{}
	p.cache = map[int]any{}
	p.stms = map[int]*objStmCache{}
	re := regexp.MustCompile(`(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+obj\b`)
	for _, m := range re.FindAllSubmatchIndex(p.d, -1) {
		n, _ := strconv.Atoi(string(p.d[m[2]:m[3]]))
		p.xref[n] = entradaXref{1, m[0], 0}
	}
	reT := regexp.MustCompile(`trailer`)
	for _, m := range reT.FindAllIndex(p.d, -1) {
		l := &lexPDF{d: p.d, p: m[1], refs: true}
		func() {
			defer func() { recover() }()
			if d, ok := mustObjeto(l).(pdfDict); ok {
				for k, v := range d {
					p.trailer[k] = v
				}
			}
		}()
	}
	nums := make([]int, 0, len(p.xref))
	for n := range p.xref {
		nums = append(nums, n)
	}
	for _, n := range nums {
		func() {
			defer func() { recover() }()
			st, ok := p.obj(n).(*pdfStream)
			if !ok {
				return
			}
			switch p.nom(st.dict["Type"]) {
			case "ObjStm":
				datos, _, err := p.decodificarStream(st)
				if err != nil {
					return
				}
				cuenta, _ := p.ent(st.dict["N"])
				l := &lexPDF{d: datos}
				for i := 0; i < cuenta; i++ {
					a, ok1 := mustObjeto(l).(int)
					_, ok2 := mustObjeto(l).(int)
					if !ok1 || !ok2 {
						break
					}
					if _, hay := p.xref[a]; !hay {
						p.xref[a] = entradaXref{2, n, i}
					}
				}
			case "XRef":
				for k, v := range st.dict {
					if k == "Root" || k == "Encrypt" || k == "Info" {
						p.trailer[k] = v
					}
				}
			}
		}()
	}
	if p.dict(p.dict(p.trailer["Root"])["Pages"]) == nil {
		for n := range p.xref {
			if d := p.dict(pdfRef{n, 0}); d != nil && p.nom(d["Type"]) == "Catalog" {
				p.trailer["Root"] = pdfRef{n, 0}
				if p.dict(d["Pages"]) != nil {
					break
				}
			}
		}
	}
}

func (p *lectorPDF) hayPaginas() bool {
	return len(p.paginasSueltas()) > 0
}

func (p *lectorPDF) paginasSueltas() []int {
	var r []int
	for n := range p.xref {
		if d := p.dict(pdfRef{n, 0}); d != nil && p.nom(d["Type"]) == "Page" {
			r = append(r, n)
		}
	}
	sortInts(r)
	return r
}

// ---- Accesores ----

func (p *lectorPDF) res(x any) any {
	for i := 0; i < 32; i++ {
		r, ok := x.(pdfRef)
		if !ok {
			return x
		}
		x = p.obj(r.n)
	}
	return nil
}

func (p *lectorPDF) dict(x any) pdfDict {
	switch v := p.res(x).(type) {
	case pdfDict:
		return v
	case *pdfStream:
		return v.dict
	}
	return nil
}

func (p *lectorPDF) arr(x any) []any {
	v, _ := p.res(x).([]any)
	return v
}

func (p *lectorPDF) nom(x any) string {
	v, _ := p.res(x).(pdfNombre)
	return string(v)
}

func (p *lectorPDF) ent(x any) (int, bool) {
	switch v := p.res(x).(type) {
	case int:
		return v, true
	case float64:
		return int(v), true
	}
	return 0, false
}

func (p *lectorPDF) num(x any) (float64, bool) {
	switch v := p.res(x).(type) {
	case int:
		return float64(v), true
	case float64:
		return v, true
	}
	return 0, false
}

// numeros lee un arreglo de números.
func (p *lectorPDF) numeros(x any) []float64 {
	a := p.arr(x)
	if a == nil {
		return nil
	}
	r := make([]float64, len(a))
	for i, v := range a {
		r[i], _ = p.num(v)
	}
	return r
}

// ---- Filtros ----

// decodificarStream aplica los filtros; se detiene en los de imagen y devuelve cuál quedó.
func (p *lectorPDF) decodificarStream(st *pdfStream) ([]byte, string, error) {
	datos := st.crudo
	var filtros []string
	switch f := p.res(st.dict["Filter"]).(type) {
	case pdfNombre:
		filtros = []string{string(f)}
	case []any:
		for _, x := range f {
			filtros = append(filtros, p.nom(x))
		}
	}
	var parms []any
	switch v := p.res(st.dict["DecodeParms"]).(type) {
	case pdfDict:
		parms = []any{v}
	case []any:
		parms = v
	}
	for i, f := range filtros {
		var dp pdfDict
		if i < len(parms) {
			dp = p.dict(parms[i])
		}
		var err error
		switch f {
		case "FlateDecode", "Fl":
			datos, err = inflar(datos)
			if err == nil {
				datos = p.predictor(datos, dp)
			}
		case "ASCIIHexDecode", "AHx":
			l := &lexPDF{d: append([]byte{'<'}, datos...)}
			datos = l.hex()
		case "ASCII85Decode", "A85":
			datos = ascii85(datos)
		case "RunLengthDecode", "RL":
			datos = runLength(datos)
		case "LZWDecode", "LZW":
			datos = p.predictor(lzw(datos), dp)
		case "DCTDecode", "DCT", "JPXDecode", "CCITTFaxDecode", "CCF", "JBIG2Decode":
			return datos, f, nil
		case "Crypt":
		default:
			return nil, "", fmt.Errorf("filtro no soportado: %s", f)
		}
		if err != nil {
			return nil, "", err
		}
	}
	return datos, "", nil
}

func inflar(d []byte) ([]byte, error) {
	var buf bytes.Buffer
	if zr, err := zlib.NewReader(bytes.NewReader(d)); err == nil {
		io.Copy(&buf, io.LimitReader(zr, maxFiltro))
		zr.Close()
		if buf.Len() > 0 {
			return buf.Bytes(), nil
		}
	}
	if len(d) > 2 {
		fr := flate.NewReader(bytes.NewReader(d[2:]))
		io.Copy(&buf, io.LimitReader(fr, maxFiltro))
		fr.Close()
		if buf.Len() > 0 {
			return buf.Bytes(), nil
		}
	}
	return nil, errors.New("stream dañado")
}

func (p *lectorPDF) predictor(d []byte, dp pdfDict) []byte {
	if dp == nil {
		return d
	}
	pred, _ := p.ent(dp["Predictor"])
	if pred <= 1 {
		return d
	}
	cols := 1
	if v, ok := p.ent(dp["Columns"]); ok {
		cols = v
	}
	colores := 1
	if v, ok := p.ent(dp["Colors"]); ok {
		colores = v
	}
	bits := 8
	if v, ok := p.ent(dp["BitsPerComponent"]); ok {
		bits = v
	}
	bpp := max(1, colores*bits/8)
	fila := (colores*bits*cols + 7) / 8
	if fila <= 0 {
		return d
	}
	if pred == 2 {
		if bits != 8 {
			return d
		}
		for i := 0; i+fila <= len(d); i += fila {
			for j := bpp; j < fila; j++ {
				d[i+j] += d[i+j-bpp]
			}
		}
		return d
	}
	salida := make([]byte, 0, len(d))
	prev := make([]byte, fila)
	act := make([]byte, fila)
	for i := 0; i < len(d); i += fila + 1 {
		t := d[i]
		n := copy(act, d[i+1:min(i+1+fila, len(d))])
		for j := n; j < fila; j++ {
			act[j] = 0
		}
		for j := range fila {
			var a, b, c byte
			if j >= bpp {
				a = act[j-bpp]
				c = prev[j-bpp]
			}
			b = prev[j]
			switch t {
			case 1:
				act[j] += a
			case 2:
				act[j] += b
			case 3:
				act[j] += byte((int(a) + int(b)) / 2)
			case 4:
				act[j] += paeth(a, b, c)
			}
		}
		salida = append(salida, act...)
		prev, act = act, prev
	}
	return salida
}

func paeth(a, b, c byte) byte {
	p := int(a) + int(b) - int(c)
	pa, pb, pc := abs(p-int(a)), abs(p-int(b)), abs(p-int(c))
	if pa <= pb && pa <= pc {
		return a
	}
	if pb <= pc {
		return b
	}
	return c
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func ascii85(d []byte) []byte {
	var r []byte
	var g [5]byte
	n := 0
	for _, c := range d {
		if c == '~' {
			break
		}
		if esEspacioPDF(c) {
			continue
		}
		if c == 'z' && n == 0 {
			r = append(r, 0, 0, 0, 0)
			continue
		}
		if c < '!' || c > 'u' {
			continue
		}
		g[n] = c - '!'
		n++
		if n == 5 {
			v := uint32(g[0])*52200625 + uint32(g[1])*614125 + uint32(g[2])*7225 + uint32(g[3])*85 + uint32(g[4])
			r = append(r, byte(v>>24), byte(v>>16), byte(v>>8), byte(v))
			n = 0
		}
	}
	if n > 1 {
		for i := n; i < 5; i++ {
			g[i] = 84
		}
		v := uint32(g[0])*52200625 + uint32(g[1])*614125 + uint32(g[2])*7225 + uint32(g[3])*85 + uint32(g[4])
		b := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
		r = append(r, b[:n-1]...)
	}
	return r
}

func runLength(d []byte) []byte {
	var r []byte
	for i := 0; i < len(d); {
		n := int(d[i])
		i++
		if n == 128 {
			break
		}
		if n < 128 {
			f := min(i+n+1, len(d))
			r = append(r, d[i:f]...)
			i = f
		} else if i < len(d) {
			r = append(r, bytes.Repeat([]byte{d[i]}, 257-n)...)
			i++
		}
	}
	return r
}

// lzw implementa la variante de PDF (early change = 1).
func lzw(d []byte) []byte {
	var out []byte
	type ent struct {
		prev int
		c    byte
		n    int
	}
	tabla := make([]ent, 4096)
	reset := func() int { return 258 }
	sig := reset()
	ancho := 9
	var acu uint32
	bits := 0
	previo := -1
	var escribir func(code int) byte
	buf := make([]byte, 0, 4096)
	escribir = func(code int) byte {
		buf = buf[:0]
		for code >= 258 {
			e := tabla[code]
			buf = append(buf, e.c)
			code = e.prev
		}
		buf = append(buf, byte(code))
		for i := len(buf) - 1; i >= 0; i-- {
			out = append(out, buf[i])
		}
		return buf[len(buf)-1]
	}
	for _, b := range d {
		acu = acu<<8 | uint32(b)
		bits += 8
		for bits >= ancho {
			bits -= ancho
			code := int(acu>>uint(bits)) & (1<<uint(ancho) - 1)
			if code == 256 {
				sig, ancho, previo = reset(), 9, -1
				continue
			}
			if code == 257 {
				return out
			}
			if previo < 0 {
				if code >= 256 {
					return out
				}
				out = append(out, byte(code))
				previo = code
				continue
			}
			if code > sig {
				return out
			}
			var primero byte
			if code < sig {
				primero = escribir(code)
			} else {
				primero = escribir(previo)
				out = append(out, primero)
			}
			if sig < 4096 {
				tabla[sig] = ent{prev: previo, c: primero}
				sig++
				switch sig {
				case 511:
					ancho = 10
				case 1023:
					ancho = 11
				case 2047:
					ancho = 12
				}
			}
			previo = code
		}
	}
	return out
}
