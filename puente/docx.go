package main

import (
	"errors"
	"fmt"
	"math"
	"path"
	"regexp"
	"strconv"
	"strings"
)

const (
	nsW1 = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsW2 = "http://purl.oclc.org/ooxml/wordprocessingml/main"
)

func enW(n *nodo) bool             { return n.esp == nsW1 || n.esp == nsW2 }
func esW(n *nodo, nom string) bool { return n.nom == nom && enW(n) }

// ---- Formato ----

// fmtR es el formato de carácter; nil significa "no definido aquí".
type fmtR struct {
	b, i, u, s, oculto *bool
	c, hl, shd, font   *string
	pt                 *float64
}

func (a *fmtR) aplicar(o fmtR) {
	if o.b != nil {
		a.b = o.b
	}
	if o.i != nil {
		a.i = o.i
	}
	if o.u != nil {
		a.u = o.u
	}
	if o.s != nil {
		a.s = o.s
	}
	if o.oculto != nil {
		a.oculto = o.oculto
	}
	if o.c != nil {
		a.c = o.c
	}
	if o.hl != nil {
		a.hl = o.hl
	}
	if o.shd != nil {
		a.shd = o.shd
	}
	if o.font != nil {
		a.font = o.font
	}
	if o.pt != nil {
		a.pt = o.pt
	}
}

func encendido(n *nodo) bool {
	v, ok := n.attr("val")
	if !ok {
		return true
	}
	v = strings.ToLower(v)
	return v != "0" && v != "false" && v != "off" && v != "none"
}

var coloresResaltado = map[string]string{
	"yellow": "#ffff00", "green": "#00ff00", "cyan": "#00ffff", "magenta": "#ff00ff",
	"blue": "#0000ff", "red": "#ff0000", "darkBlue": "#000080", "darkCyan": "#008080",
	"darkGreen": "#008000", "darkMagenta": "#800080", "darkRed": "#800000", "darkYellow": "#808000",
	"darkGray": "#808080", "lightGray": "#c0c0c0", "black": "#000000", "white": "#ffffff",
}

func hexColor(v string) string {
	v = strings.TrimPrefix(strings.ToLower(v), "#")
	if len(v) == 8 {
		v = v[2:]
	}
	if len(v) != 6 {
		return ""
	}
	for _, c := range v {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return ""
		}
	}
	return "#" + v
}

func ptrB(v bool) *bool { return &v }

func (c *ctxDocx) leerRPr(n *nodo) fmtR {
	var f fmtR
	if n == nil {
		return f
	}
	for _, h := range n.hijos {
		if !enW(h) {
			continue
		}
		switch h.nom {
		case "b":
			f.b = ptrB(encendido(h))
		case "i":
			f.i = ptrB(encendido(h))
		case "u":
			f.u = ptrB(encendido(h))
		case "strike", "dstrike":
			f.s = ptrB(encendido(h))
		case "vanish":
			f.oculto = ptrB(encendido(h))
		case "color":
			if v := h.val("val"); v != "" && !strings.EqualFold(v, "auto") {
				s := hexColor(v)
				f.c = &s
			}
		case "highlight":
			s := coloresResaltado[h.val("val")]
			f.hl = &s
		case "shd":
			if v := h.val("fill"); v != "" && !strings.EqualFold(v, "auto") {
				s := hexColor(v)
				f.shd = &s
			}
		case "rFonts":
			if s := c.fuenteDe(h); s != "" {
				f.font = &s
			}
		case "sz":
			if v, err := strconv.ParseFloat(h.val("val"), 64); err == nil {
				pt := v / 2
				f.pt = &pt
			}
		}
	}
	return f
}

func (c *ctxDocx) fuenteDe(rf *nodo) string {
	for _, a := range []string{"asciiTheme", "hAnsiTheme"} {
		if t := rf.val(a); t != "" {
			if strings.HasPrefix(t, "major") {
				return c.fuenteMayor
			}
			return c.fuenteMenor
		}
	}
	for _, a := range []string{"ascii", "hAnsi", "cs", "eastAsia"} {
		if v := rf.val(a); v != "" {
			return v
		}
	}
	return ""
}

// fmtP es el formato de párrafo relevante.
type fmtP struct {
	al          *string
	izq         *int
	numId, ilvl *int
	salto       *bool
}

func (a *fmtP) aplicar(o fmtP) {
	if o.al != nil {
		a.al = o.al
	}
	if o.izq != nil {
		a.izq = o.izq
	}
	if o.numId != nil {
		a.numId = o.numId
	}
	if o.ilvl != nil {
		a.ilvl = o.ilvl
	}
	if o.salto != nil {
		a.salto = o.salto
	}
}

func atoiPtr(s string) *int {
	if v, err := strconv.Atoi(s); err == nil {
		return &v
	}
	return nil
}

func leerPPr(n *nodo) fmtP {
	var f fmtP
	if n == nil {
		return f
	}
	for _, h := range n.hijos {
		if !enW(h) {
			continue
		}
		switch h.nom {
		case "jc":
			s := ""
			switch h.val("val") {
			case "center":
				s = "c"
			case "right", "end":
				s = "r"
			case "both", "distribute":
				s = "j"
			}
			f.al = &s
		case "ind":
			v := h.val("left")
			if v == "" {
				v = h.val("start")
			}
			if p := atoiPtr(v); p != nil {
				f.izq = p
			}
		case "numPr":
			if id := h.hijo("numId"); id != nil {
				f.numId = atoiPtr(id.val("val"))
			}
			if lv := h.hijo("ilvl"); lv != nil {
				f.ilvl = atoiPtr(lv.val("val"))
			}
		case "pageBreakBefore":
			f.salto = ptrB(encendido(h))
		}
	}
	return f
}

type estiloW struct {
	id, nombre, tipo, base string
	r                      fmtR
	p                      fmtP
	rStyle                 string
	outline                *int
}

type nivelNum struct {
	formato, texto string
	inicio         int
	reinicio       *int
	pStyle         string
	izq            *int
	legal          bool
}

type numW struct {
	abstracto string
	niveles   map[int]*nivelNum
	inicios   map[int]int
	usados    map[int]bool
}

type contadores struct {
	val [9]int
	act [9]bool
}

type ctxDocx struct {
	z                        *archivoZip
	datos                    []byte
	raiz, cuerpo             *nodo
	parte                    string
	editable                 bool
	rels                     map[string]relacion
	estilos                  map[string]*estiloW
	estiloDef                string
	defR                     fmtR
	defP                     fmtP
	fuenteMayor, fuenteMenor string
	abstractos               map[string]map[int]*nivelNum
	nums                     map[string]*numW
	cont                     map[string]*contadores
	parrafos                 []*infoP
	indice                   map[*nodo]*infoP
	campos                   []*campoW
	fuentes                  map[string]bool
	ordenFuentes             []string
	aviso                    string
	memoR                    map[string]*fmtR
	memoP                    map[string]*fmtP
}

type infoP struct {
	n    *nodo
	id   int
	noEd bool
}

type campoW struct {
	enResultado bool
	instr       string
}

// listarParrafos cuenta los w:p del cuerpo; lo usan abrir y guardar por igual.
func listarParrafos(cuerpo *nodo) []*infoP {
	var r []*infoP
	var walk func(n *nodo, noEd bool)
	walk = func(n *nodo, noEd bool) {
		for _, h := range n.hijos {
			if !enW(h) {
				if h.nom == "AlternateContent" {
					if ch := h.hijo("Choice"); ch != nil {
						walk(ch, true)
					}
				}
				continue
			}
			switch h.nom {
			case "p":
				r = append(r, &infoP{n: h, id: len(r), noEd: noEd})
			case "txbxContent":
			case "sdt", "customXml", "ins", "moveTo", "del", "moveFrom":
				walk(h, true)
			default:
				walk(h, noEd)
			}
		}
	}
	walk(cuerpo, false)
	return r
}

// cargarDocx lee todas las partes necesarias del documento.
func cargarDocx(z *archivoZip) (*ctxDocx, error) {
	parte := z.parteRaiz("word/document.xml")
	datos, err := z.leer(parte)
	if err != nil {
		return nil, err
	}
	raiz, err := parsearXML(datos)
	if err != nil {
		return nil, err
	}
	cuerpo := raiz.hijo("body")
	if cuerpo == nil {
		return nil, errors.New("el documento no tiene cuerpo")
	}
	c := &ctxDocx{z: z, datos: datos, raiz: raiz, cuerpo: cuerpo, parte: parte, estilos: map[string]*estiloW{},
		abstractos: map[string]map[int]*nivelNum{}, nums: map[string]*numW{}, cont: map[string]*contadores{},
		fuentes: map[string]bool{}, memoR: map[string]*fmtR{}, memoP: map[string]*fmtP{}, indice: map[*nodo]*infoP{}}
	c.editable = prefijoCrudo(datos, raiz.ini) == "w" && validoUTF8(datos) && len(normalizarXML(datos)) == len(datos)

	var lista []relacion
	c.rels, lista = z.leerRels(parte)
	ruta := func(sufijo, defecto string) string {
		if r, ok := relPorTipo(lista, sufijo); ok && !r.externo {
			return r.destino
		}
		return defecto
	}
	dir := path.Dir(parte)
	c.cargarTema(z.leerOpc(ruta("/theme", dir+"/theme/theme1.xml")))
	c.cargarEstilos(z.leerOpc(ruta("/styles", dir+"/styles.xml")))
	c.cargarNumeracion(z.leerOpc(ruta("/numbering", dir+"/numbering.xml")))

	c.parrafos = listarParrafos(cuerpo)
	for _, p := range c.parrafos {
		c.indice[p.n] = p
	}
	return c, nil
}

func (c *ctxDocx) cargarTema(d []byte) {
	if d == nil {
		return
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return
	}
	if lat := raiz.buscar("majorFont").hijo("latin"); lat != nil {
		c.fuenteMayor = lat.val("typeface")
	}
	if lat := raiz.buscar("minorFont").hijo("latin"); lat != nil {
		c.fuenteMenor = lat.val("typeface")
	}
}

func (c *ctxDocx) cargarEstilos(d []byte) {
	if d == nil {
		return
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return
	}
	if dd := raiz.hijo("docDefaults"); dd != nil {
		c.defR = c.leerRPr(dd.camino("rPrDefault", "rPr"))
		c.defP = leerPPr(dd.camino("pPrDefault", "pPr"))
	}
	for _, s := range raiz.hijosN("style") {
		e := &estiloW{id: s.val("styleId"), tipo: s.val("type")}
		if n := s.hijo("name"); n != nil {
			e.nombre = n.val("val")
		}
		if n := s.hijo("basedOn"); n != nil {
			e.base = n.val("val")
		}
		rpr := s.hijo("rPr")
		e.r = c.leerRPr(rpr)
		e.p = leerPPr(s.hijo("pPr"))
		if ol := s.camino("pPr", "outlineLvl"); ol != nil {
			e.outline = atoiPtr(ol.val("val"))
		}
		c.estilos[e.id] = e
		if e.tipo == "paragraph" && encendidoAttr(s, "default") {
			c.estiloDef = e.id
		}
	}
}

func encendidoAttr(n *nodo, a string) bool {
	v := n.val(a)
	return v == "1" || v == "true" || v == "on"
}

func (c *ctxDocx) rDeEstilo(id string, prof int) fmtR {
	if id == "" || prof > 32 {
		return fmtR{}
	}
	if m, ok := c.memoR[id]; ok {
		return *m
	}
	e := c.estilos[id]
	if e == nil {
		return fmtR{}
	}
	f := c.rDeEstilo(e.base, prof+1)
	f.aplicar(e.r)
	if prof == 0 {
		c.memoR[id] = &f
	}
	return f
}

func (c *ctxDocx) pDeEstilo(id string, prof int) fmtP {
	if id == "" || prof > 32 {
		return fmtP{}
	}
	if m, ok := c.memoP[id]; ok {
		return *m
	}
	e := c.estilos[id]
	if e == nil {
		return fmtP{}
	}
	f := c.pDeEstilo(e.base, prof+1)
	f.aplicar(e.p)
	if prof == 0 {
		c.memoP[id] = &f
	}
	return f
}

func sinAcentos(s string) string {
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ñ", "n", " ", "", "-", "", "_", "")
	return r.Replace(strings.ToLower(s))
}

// clasificarNombre traduce el nombre o id de un estilo a un `est`.
func clasificarNombre(s string) string {
	s = strings.TrimSuffix(sinAcentos(s), "(user)")
	switch s {
	case "title", "titulo", "ttulo", "titre", "titel":
		return "titulo"
	case "subtitle", "subtitulo", "subttulo", "soustitre", "untertitel":
		return "subtitulo"
	case "quote", "cita", "intensequote", "citadestacada", "citaintensa":
		return "cita"
	case "code", "codigo", "cdigo", "sourcecode", "htmlpreformatted", "htmlconformatoprevio":
		return "codigo"
	}
	for _, pre := range []string{"heading", "titulo", "ttulo", "encabezado", "titre", "uberschrift", "berschrift"} {
		if strings.HasPrefix(s, pre) && len(s) == len(pre)+1 {
			if d := s[len(pre)]; d >= '1' && d <= '6' {
				return "h" + string(d)
			}
		}
	}
	return ""
}

func (c *ctxDocx) estDe(id string) string {
	for i := 0; i < 32 && id != ""; i++ {
		e := c.estilos[id]
		if e == nil {
			return ""
		}
		if s := clasificarNombre(e.nombre); s != "" {
			return s
		}
		if s := clasificarNombre(e.id); s != "" {
			return s
		}
		if e.outline != nil && *e.outline >= 0 && *e.outline < 6 {
			return "h" + strconv.Itoa(*e.outline+1)
		}
		id = e.base
	}
	return ""
}

// ---- Numeración ----

func (c *ctxDocx) leerNivel(l *nodo) *nivelNum {
	n := &nivelNum{inicio: 1}
	if x := l.hijo("start"); x != nil {
		if v, err := strconv.Atoi(x.val("val")); err == nil {
			n.inicio = v
		}
	}
	if x := l.hijo("numFmt"); x != nil {
		n.formato = x.val("val")
	}
	if x := l.hijo("lvlText"); x != nil {
		n.texto = x.val("val")
	}
	if x := l.hijo("lvlRestart"); x != nil {
		n.reinicio = atoiPtr(x.val("val"))
	}
	if x := l.hijo("pStyle"); x != nil {
		n.pStyle = x.val("val")
	}
	if x := l.hijo("isLgl"); x != nil {
		n.legal = encendido(x)
	}
	if ind := l.camino("pPr", "ind"); ind != nil {
		v := ind.val("left")
		if v == "" {
			v = ind.val("start")
		}
		n.izq = atoiPtr(v)
	}
	return n
}

func (c *ctxDocx) cargarNumeracion(d []byte) {
	if d == nil {
		return
	}
	raiz, err := parsearXML(d)
	if err != nil {
		return
	}
	for _, a := range raiz.hijosN("abstractNum") {
		niveles := map[int]*nivelNum{}
		for _, l := range a.hijosN("lvl") {
			if v := atoiPtr(l.val("ilvl")); v != nil {
				niveles[*v] = c.leerNivel(l)
			}
		}
		c.abstractos[a.val("abstractNumId")] = niveles
	}
	for _, nm := range raiz.hijosN("num") {
		n := &numW{niveles: map[int]*nivelNum{}, inicios: map[int]int{}, usados: map[int]bool{}}
		if x := nm.hijo("abstractNumId"); x != nil {
			n.abstracto = x.val("val")
		}
		for _, ov := range nm.hijosN("lvlOverride") {
			il := atoiPtr(ov.val("ilvl"))
			if il == nil {
				continue
			}
			if l := ov.hijo("lvl"); l != nil {
				n.niveles[*il] = c.leerNivel(l)
			}
			if s := ov.hijo("startOverride"); s != nil {
				if v := atoiPtr(s.val("val")); v != nil {
					n.inicios[*il] = *v
				}
			}
		}
		c.nums[nm.val("numId")] = n
	}
}

func (c *ctxDocx) nivelDe(num *numW, il int) *nivelNum {
	if l := num.niveles[il]; l != nil {
		return l
	}
	return c.abstractos[num.abstracto][il]
}

func romano(n int) string {
	if n <= 0 || n >= 4000 {
		return strconv.Itoa(n)
	}
	val := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	sim := []string{"m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"}
	var b strings.Builder
	for i, v := range val {
		for n >= v {
			b.WriteString(sim[i])
			n -= v
		}
	}
	return b.String()
}

func letra(n int) string {
	if n <= 0 {
		return strconv.Itoa(n)
	}
	return strings.Repeat(string(rune('a'+(n-1)%26)), (n-1)/26+1)
}

func formatoContador(v int, f string) string {
	switch f {
	case "lowerLetter":
		return letra(v)
	case "upperLetter":
		return strings.ToUpper(letra(v))
	case "lowerRoman":
		return romano(v)
	case "upperRoman":
		return strings.ToUpper(romano(v))
	case "decimalZero":
		if v < 10 {
			return "0" + strconv.Itoa(v)
		}
	}
	return strconv.Itoa(v)
}

var vinetas = []string{"•", "◦", "▪"}

// marcaLista avanza los contadores y devuelve la marca del párrafo.
func (c *ctxDocx) marcaLista(numId, il int) (string, int, *nivelNum) {
	num := c.nums[strconv.Itoa(numId)]
	if num == nil || il < 0 || il > 8 {
		return "", 0, nil
	}
	nv := c.nivelDe(num, il)
	if nv == nil {
		return "", 0, nil
	}
	cnt := c.cont[num.abstracto]
	if cnt == nil {
		cnt = &contadores{}
		c.cont[num.abstracto] = cnt
	}
	if ini, hay := num.inicios[il]; hay && !num.usados[il] {
		cnt.val[il] = ini
		cnt.act[il] = true
	} else if !cnt.act[il] {
		cnt.val[il] = nv.inicio
		cnt.act[il] = true
	} else {
		cnt.val[il]++
	}
	num.usados[il] = true
	for j := il + 1; j < 9; j++ {
		l := c.nivelDe(num, j)
		if l != nil && l.reinicio != nil && (*l.reinicio == 0 || il+1 > *l.reinicio) {
			continue
		}
		cnt.act[j] = false
	}
	switch nv.formato {
	case "bullet":
		return vinetas[il%3], il, nv
	case "none":
		return "", il, nv
	}
	var b strings.Builder
	t := nv.texto
	for i := 0; i < len(t); i++ {
		if t[i] == '%' && i+1 < len(t) && t[i+1] >= '1' && t[i+1] <= '9' {
			k := int(t[i+1] - '1')
			i++
			lk := c.nivelDe(num, k)
			v := cnt.val[k]
			if !cnt.act[k] && lk != nil {
				v = lk.inicio
			}
			f := "decimal"
			if lk != nil && !nv.legal {
				f = lk.formato
			}
			b.WriteString(formatoContador(v, f))
			continue
		}
		b.WriteByte(t[i])
	}
	return b.String(), il, nv
}

// ---- Editabilidad ----

// estiloParrafo devuelve el estilo efectivo de un w:p.
func (c *ctxDocx) estiloParrafo(p *nodo) string {
	if s := p.camino("pPr", "pStyle"); s != nil {
		return s.val("val")
	}
	return c.estiloDef
}

func (c *ctxDocx) fmtBase(pEst string, rPr *nodo) fmtR {
	f := c.defR
	f.aplicar(c.rDeEstilo(pEst, 0))
	if rPr != nil {
		if rs := rPr.hijo("rStyle"); rs != nil {
			f.aplicar(c.rDeEstilo(rs.val("val"), 0))
		}
	}
	return f
}

func (c *ctxDocx) fmtEfectivo(pEst string, rPr *nodo) fmtR {
	f := c.fmtBase(pEst, rPr)
	f.aplicar(c.leerRPr(rPr))
	return f
}

func tieneCambiosRPr(rPr *nodo) bool {
	if rPr == nil {
		return false
	}
	for _, h := range rPr.hijos {
		switch h.nom {
		case "rPrChange", "ins", "del", "moveFrom", "moveTo":
			return true
		}
	}
	return false
}

// parrafoEditable: mismo criterio al abrir y al guardar.
func (c *ctxDocx) parrafoEditable(p *infoP) bool {
	if p.noEd {
		return false
	}
	est := c.estiloParrafo(p.n)
	for _, h := range p.n.hijos {
		if !enW(h) {
			return false
		}
		switch h.nom {
		case "pPr":
			if h.hijo("pPrChange") != nil || tieneCambiosRPr(h.hijo("rPr")) {
				return false
			}
		case "bookmarkStart", "bookmarkEnd", "proofErr":
		case "r":
			if !c.runEditable(h, est) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (c *ctxDocx) runEditable(r *nodo, est string) bool {
	for _, h := range r.hijos {
		if !enW(h) {
			return false
		}
		switch h.nom {
		case "rPr":
			if tieneCambiosRPr(h) {
				return false
			}
		case "t", "tab", "lastRenderedPageBreak":
		case "br":
			if h.val("type") == "column" {
				return false
			}
		default:
			return false
		}
	}
	if f := c.fmtEfectivo(est, r.hijo("rPr")); f.oculto != nil && *f.oculto {
		return false
	}
	return true
}

// ---- Lectura de bloques ----

type estadoPar struct {
	est          string
	runs         []Run
	sigO         int
	saltoAntes   bool
	saltoDespues bool
	imagenes     []any
	href         string
	hayTxbx      bool
}

func (s *estadoPar) marcarSalto() {
	for _, r := range s.runs {
		if r.T != "" {
			s.saltoDespues = true
			return
		}
	}
	s.saltoAntes = true
}

func (c *ctxDocx) notarFuente(f string) {
	if f != "" && !c.fuentes[f] {
		c.fuentes[f] = true
		c.ordenFuentes = append(c.ordenFuentes, f)
	}
}

func (c *ctxDocx) campoVisible() bool {
	for _, f := range c.campos {
		if !f.enResultado {
			return false
		}
	}
	return true
}

var reHyperlink = regexp.MustCompile(`HYPERLINK\s+"([^"]*)"`)

func (c *ctxDocx) hrefCampo() string {
	for i := len(c.campos) - 1; i >= 0; i-- {
		if m := reHyperlink.FindStringSubmatch(c.campos[i].instr); m != nil {
			return m[1]
		}
	}
	return ""
}

func (c *ctxDocx) bloques(cont *nodo) []any {
	r := []any{}
	for _, h := range cont.hijos {
		if !enW(h) {
			if h.nom == "AlternateContent" {
				if ch := h.hijo("Choice"); ch != nil {
					r = append(r, c.bloques(ch)...)
				}
			}
			continue
		}
		switch h.nom {
		case "p":
			r = append(r, c.parrafo(h)...)
		case "tbl":
			r = append(r, c.tabla(h))
		case "sdt":
			if sc := h.hijo("sdtContent"); sc != nil {
				r = append(r, c.bloques(sc)...)
			}
		case "customXml", "ins", "moveTo", "sdtContent", "smartTag":
			r = append(r, c.bloques(h)...)
		}
	}
	return quitarSaltosDobles(r)
}

func quitarSaltosDobles(b []any) []any {
	r := b[:0]
	previoSalto := false
	for _, x := range b {
		_, esSalto := x.(BloqueSalto)
		if esSalto && previoSalto {
			continue
		}
		previoSalto = esSalto
		r = append(r, x)
	}
	return r
}

func (c *ctxDocx) parrafo(p *nodo) []any {
	info := c.indice[p]
	id := -1
	if info != nil {
		id = info.id
	}
	est := c.estiloParrafo(p)
	st := &estadoPar{est: est}
	c.inline(p, st)

	par := Parrafo{K: "p", Id: id, R: st.runs}
	if par.R == nil {
		par.R = []Run{}
	}
	pPr := p.hijo("pPr")
	ef := c.defP
	ef.aplicar(c.pDeEstilo(est, 0))
	directo := leerPPr(pPr)
	ef.aplicar(directo)

	par.Est = c.estDe(est)
	if ef.al != nil {
		par.Al = *ef.al
	}
	izq := ef.izq

	numId := ef.numId
	if numId != nil && *numId != 0 {
		il := 0
		if ef.ilvl != nil {
			il = *ef.ilvl
		} else if num := c.nums[strconv.Itoa(*numId)]; num != nil {
			for k, l := range c.abstractos[num.abstracto] {
				if l.pStyle != "" && l.pStyle == est {
					il = k
				}
			}
		}
		if marca, nivel, nv := c.marcaLista(*numId, il); nv != nil {
			if marca != "" {
				par.Lista = &Lista{Marca: marca, Nivel: nivel}
			}
			if nv.izq != nil && directo.izq == nil {
				izq = nv.izq
			}
		}
	}
	if izq != nil && *izq > 0 {
		par.Sang = int(math.Round(float64(*izq) / 120))
	}
	if info == nil || !c.parrafoEditable(info) {
		par.Ed = noEditable
	}
	if st.hayTxbx {
		c.aviso = "Este documento tiene cuadros de texto que no se muestran."
	}

	r := []any{}
	if (ef.salto != nil && *ef.salto) || st.saltoAntes {
		r = append(r, BloqueSalto{K: "salto"})
	}
	r = append(r, par)
	r = append(r, st.imagenes...)
	if st.saltoDespues {
		r = append(r, BloqueSalto{K: "salto"})
	}
	return r
}

// inline recorre el contenido en línea de un párrafo o contenedor.
func (c *ctxDocx) inline(n *nodo, st *estadoPar) {
	for _, h := range n.hijos {
		if !enW(h) {
			switch h.nom {
			case "AlternateContent":
				c.imagenesDe(h, st)
			case "oMath", "oMathPara":
				if s := textoMath(h); s != "" {
					st.runs = append(st.runs, Run{T: s})
				}
			}
			continue
		}
		switch h.nom {
		case "r":
			c.run(h, st)
		case "hyperlink":
			previo := st.href
			if id := h.attrRel("id"); id != "" {
				if rel, ok := c.rels[id]; ok {
					st.href = rel.destino
				}
			} else if a := h.val("anchor"); a != "" {
				st.href = "#" + a
			}
			c.inline(h, st)
			st.href = previo
		case "fldSimple":
			previo := st.href
			if m := reHyperlink.FindStringSubmatch(h.val("instr")); m != nil {
				st.href = m[1]
			}
			c.inline(h, st)
			st.href = previo
		case "ins", "moveTo", "smartTag", "customXml", "dir", "bdo":
			c.inline(h, st)
		case "sdt":
			if sc := h.hijo("sdtContent"); sc != nil {
				c.inline(sc, st)
			}
		}
	}
}

func textoMath(n *nodo) string {
	var b strings.Builder
	var rec func(m *nodo)
	rec = func(m *nodo) {
		if m.nom == "t" {
			b.Write(m.txt)
		}
		for _, h := range m.hijos {
			rec(h)
		}
	}
	rec(n)
	return b.String()
}

func (c *ctxDocx) run(r *nodo, st *estadoPar) {
	o := st.sigO
	st.sigO++
	rPr := r.hijo("rPr")
	f := c.fmtEfectivo(st.est, rPr)
	oculto := f.oculto != nil && *f.oculto
	var b strings.Builder
	soloControl := false
	for _, h := range r.hijos {
		if !enW(h) {
			if h.nom == "AlternateContent" {
				c.imagenesDe(h, st)
				soloControl = true
			}
			continue
		}
		visible := c.campoVisible() && !oculto
		switch h.nom {
		case "t":
			if visible {
				b.Write(h.txt)
			}
		case "tab", "ptab":
			if visible {
				b.WriteByte('\t')
			}
		case "br":
			if h.val("type") == "page" {
				if b.Len() > 0 {
					st.saltoDespues = true
				} else {
					st.marcarSalto()
				}
			} else if visible {
				b.WriteByte('\n')
			}
		case "cr":
			if visible {
				b.WriteByte('\n')
			}
		case "lastRenderedPageBreak":
			if b.Len() > 0 {
				st.saltoDespues = true
			} else {
				st.marcarSalto()
			}
		case "noBreakHyphen":
			if visible {
				b.WriteRune(0x2011)
			}
		case "sym":
			if visible {
				if v, err := strconv.ParseInt(h.val("char"), 16, 32); err == nil {
					if v >= 0xF000 && v <= 0xF0FF {
						v -= 0xF000
					}
					b.WriteRune(rune(v))
				}
			}
		case "footnoteReference", "endnoteReference":
			if visible {
				b.WriteString("[" + h.val("id") + "]")
			}
		case "fldChar":
			soloControl = true
			switch h.val("fldCharType") {
			case "begin":
				c.campos = append(c.campos, &campoW{})
			case "separate":
				if n := len(c.campos); n > 0 {
					c.campos[n-1].enResultado = true
				}
			case "end":
				if n := len(c.campos); n > 0 {
					c.campos = c.campos[:n-1]
				}
			}
		case "instrText":
			soloControl = true
			if n := len(c.campos); n > 0 {
				c.campos[n-1].instr += string(h.txt)
			}
		case "drawing", "pict", "object":
			c.imagenesDe(h, st)
			soloControl = true
		}
	}
	if b.Len() == 0 && soloControl {
		return
	}
	if b.Len() == 0 && oculto {
		return
	}
	run := Run{T: b.String(), O: new(int)}
	*run.O = o
	if f.b != nil && *f.b {
		run.B = 1
	}
	if f.i != nil && *f.i {
		run.I = 1
	}
	if f.u != nil && *f.u {
		run.U = 1
	}
	if f.s != nil && *f.s {
		run.S = 1
	}
	if f.c != nil {
		run.C = *f.c
	}
	if f.hl != nil && *f.hl != "" {
		run.H = *f.hl
	} else if f.shd != nil && *f.shd != "" {
		run.H = *f.shd
	}
	defF, defP := c.valoresDef()
	if f.font != nil && *f.font != "" {
		c.notarFuente(*f.font)
		if *f.font != defF {
			run.Font = *f.font
		}
	}
	if f.pt != nil && *f.pt != defP {
		run.Pt = *f.pt
	}
	run.Href = st.href
	if run.Href == "" {
		run.Href = c.hrefCampo()
	}
	st.runs = append(st.runs, run)
}

// imagenesDe recoge imágenes de un drawing/pict; ignora cuadros de texto.
func (c *ctxDocx) imagenesDe(n *nodo, st *estadoPar) {
	var rec func(m *nodo)
	rec = func(m *nodo) {
		switch m.nom {
		case "AlternateContent":
			antes := len(st.imagenes)
			if ch := m.hijo("Choice"); ch != nil {
				rec(ch)
			}
			if len(st.imagenes) == antes {
				if fb := m.hijo("Fallback"); fb != nil {
					rec(fb)
				}
			}
			return
		case "txbxContent":
			st.hayTxbx = true
			return
		case "inline", "anchor":
			if blip := m.buscar("blip"); blip != nil {
				if src := c.destinoImagen(blip.attrRel("embed")); src != "" {
					img := BloqueImg{K: "img", Src: src}
					if ex := m.hijo("extent"); ex != nil {
						img.W, _ = strconv.ParseInt(ex.val("cx"), 10, 64)
						img.H, _ = strconv.ParseInt(ex.val("cy"), 10, 64)
					}
					if dp := m.hijo("docPr"); dp != nil {
						img.Alt = dp.val("descr")
					}
					st.imagenes = append(st.imagenes, img)
				}
			}
		case "shape":
			if id := m.hijo("imagedata"); id != nil {
				if src := c.destinoImagen(id.attrRel("id")); src != "" {
					w, h := medidasVml(m.val("style"))
					st.imagenes = append(st.imagenes, BloqueImg{K: "img", Src: src, W: w, H: h, Alt: id.val("title")})
				}
			}
		}
		for _, h := range m.hijos {
			rec(h)
		}
	}
	rec(n)
}

func (c *ctxDocx) destinoImagen(id string) string {
	if id == "" {
		return ""
	}
	if r, ok := c.rels[id]; ok && !r.externo {
		return r.destino
	}
	return ""
}

var (
	reVmlAncho = regexp.MustCompile(`(?i)width:\s*([0-9.]+)`)
	reVmlAlto  = regexp.MustCompile(`(?i)height:\s*([0-9.]+)`)
)

func medidasVml(st string) (int64, int64) {
	var w, h float64
	if m := reVmlAncho.FindStringSubmatch(st); m != nil {
		w, _ = strconv.ParseFloat(m[1], 64)
	}
	if m := reVmlAlto.FindStringSubmatch(st); m != nil {
		h, _ = strconv.ParseFloat(m[1], 64)
	}
	return int64(w * 12700), int64(h * 12700)
}

// filasTabla y celdasFila atraviesan los contenedores (sdt, ins...).
func filasTabla(n *nodo, r *[]*nodo, nom string) {
	for _, h := range n.hijos {
		if !enW(h) {
			continue
		}
		switch h.nom {
		case nom:
			*r = append(*r, h)
		case "sdt", "sdtContent", "customXml", "ins":
			filasTabla(h, r, nom)
		}
	}
}

func (c *ctxDocx) tabla(t *nodo) BloqueTabla {
	res := BloqueTabla{K: "tabla", Filas: [][]Celda{}}
	if g := t.hijo("tblGrid"); g != nil {
		var ws []float64
		total := 0.0
		for _, col := range g.hijosN("gridCol") {
			v, _ := strconv.ParseFloat(col.val("w"), 64)
			ws = append(ws, v)
			total += v
		}
		if total > 0 {
			for _, v := range ws {
				res.Anchos = append(res.Anchos, math.Round(v/total*10000)/10000)
			}
		}
	}
	var trs []*nodo
	filasTabla(t, &trs, "tr")
	for _, tr := range trs {
		fila := []Celda{}
		antes, despues := 0, 0
		if pr := tr.hijo("trPr"); pr != nil {
			if g := pr.hijo("gridBefore"); g != nil {
				antes, _ = strconv.Atoi(g.val("val"))
			}
			if g := pr.hijo("gridAfter"); g != nil {
				despues, _ = strconv.Atoi(g.val("val"))
			}
		}
		if antes > 0 {
			fila = append(fila, Celda{B: []any{}, Cs: antes})
		}
		var tcs []*nodo
		filasTabla(tr, &tcs, "tc")
		for _, tc := range tcs {
			cel := Celda{B: c.bloques(tc)}
			if pr := tc.hijo("tcPr"); pr != nil {
				if g := pr.hijo("gridSpan"); g != nil {
					if v, _ := strconv.Atoi(g.val("val")); v > 1 {
						cel.Cs = v
					}
				}
				if vm := pr.hijo("vMerge"); vm != nil && vm.val("val") != "restart" {
					cel.Vm = 1
				}
				if sh := pr.hijo("shd"); sh != nil {
					if v := sh.val("fill"); v != "" && !strings.EqualFold(v, "auto") {
						cel.Bg = hexColor(v)
					}
				}
			}
			fila = append(fila, cel)
		}
		if despues > 0 {
			fila = append(fila, Celda{B: []any{}, Cs: despues})
		}
		res.Filas = append(res.Filas, fila)
	}
	return res
}

func (c *ctxDocx) valoresDef() (string, float64) {
	f := c.defR
	f.aplicar(c.rDeEstilo(c.estiloDef, 0))
	fuente := "Times New Roman"
	if f.font != nil && *f.font != "" {
		fuente = *f.font
	}
	pt := 10.0
	if f.pt != nil {
		pt = *f.pt
	}
	return fuente, pt
}

func abrirDocx(d []byte) (any, error) {
	z, err := abrirZip(d)
	if err != nil {
		return nil, err
	}
	c, err := cargarDocx(z)
	if err != nil {
		return nil, err
	}
	bloques := c.bloques(c.cuerpo)
	defF, defP := c.valoresDef()
	doc := DocWord{Tipo: "docx", Firma: sha256Hex(d), DefFont: defF, DefPt: defP, Editable: c.editable, Aviso: c.aviso}

	lista := []string{defF}
	vistos := map[string]bool{defF: true}
	for _, f := range append([]string{c.fuenteMayor, c.fuenteMenor}, c.ordenFuentes...) {
		if f != "" && !vistos[f] {
			vistos[f] = true
			lista = append(lista, f)
		}
	}
	doc.Fuentes = lista

	// Recorta si el JSON no cabría.
	tam := 0
	for i, b := range bloques {
		s, err := aJSON(b)
		if err != nil {
			return nil, err
		}
		tam += len(s)
		if tam > limiteDocumento-64*1024 {
			bloques = bloques[:i]
			doc.Aviso = fmt.Sprintf("El documento es muy grande: solo se muestran los primeros %d bloques.", i)
			break
		}
	}
	doc.Bloques = bloques
	return doc, nil
}
