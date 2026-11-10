package main

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type xfA struct{ ax, bx, ay, by float64 }

func (t xfA) punto(x, y float64) (float64, float64) { return t.ax*x + t.bx, t.ay*y + t.by }

type phInfo struct {
	tipo, idx string
	xf        *[4]float64
	lst       *nodo
}

type capaP struct {
	ruta   string
	raiz   *nodo
	rels   map[string]relacion
	lista  []relacion
	ph     []phInfo
	layout *capaP
	master *capaP
}

type ctxPptx struct {
	z              *archivoZip
	capas          map[string]*capaP
	colores        map[string]string
	mapaColor      map[string]string
	fMayor, fMenor string
	anchoS, altoS  float64
}

func (c *ctxPptx) capa(ruta string) *capaP {
	if v, ok := c.capas[ruta]; ok {
		return v
	}
	d := c.z.leerOpc(ruta)
	if d == nil {
		c.capas[ruta] = nil
		return nil
	}
	raiz, err := parsearXML(d)
	if err != nil {
		c.capas[ruta] = nil
		return nil
	}
	v := &capaP{ruta: ruta, raiz: raiz}
	c.capas[ruta] = v
	v.rels, v.lista = c.z.leerRels(ruta)
	var recoger func(n *nodo)
	recoger = func(n *nodo) {
		for _, h := range n.hijos {
			if h.nom == "grpSp" {
				recoger(h)
				continue
			}
			if h.nom != "sp" {
				continue
			}
			ph := h.camino("nvSpPr", "nvPr", "ph")
			if ph == nil {
				continue
			}
			info := phInfo{tipo: ph.val("type"), idx: ph.val("idx"), lst: h.camino("txBody", "lstStyle")}
			if xf := h.camino("spPr", "xfrm"); xf != nil {
				info.xf = leerXfrm(xf)
			}
			v.ph = append(v.ph, info)
		}
	}
	if arbol := raiz.camino("cSld", "spTree"); arbol != nil {
		recoger(arbol)
	}
	return v
}

func leerXfrm(xf *nodo) *[4]float64 {
	off, ext := xf.hijo("off"), xf.hijo("ext")
	if off == nil || ext == nil {
		return nil
	}
	return &[4]float64{numA(off.val("x")), numA(off.val("y")), numA(ext.val("cx")), numA(ext.val("cy"))}
}

func numA(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func tipoNormal(t string) string {
	switch t {
	case "ctrTitle":
		return "title"
	case "subTitle", "obj", "":
		return "body"
	}
	return t
}

func buscarPh(l []phInfo, tipo, idx string) *phInfo {
	if idx != "" {
		for i := range l {
			if l[i].idx == idx {
				return &l[i]
			}
		}
	}
	for i := range l {
		if tipoNormal(l[i].tipo) == tipoNormal(tipo) {
			return &l[i]
		}
	}
	return nil
}

func (c *ctxPptx) tema(raiz *nodo) {
	if raiz == nil {
		return
	}
	if esq := raiz.buscar("clrScheme"); esq != nil {
		for _, h := range esq.hijos {
			if len(h.hijos) == 0 {
				continue
			}
			x := h.hijos[0]
			if v := x.val("val"); x.nom == "srgbClr" {
				c.colores[h.nom] = hexColor(v)
			} else if v := x.val("lastClr"); v != "" {
				c.colores[h.nom] = hexColor(v)
			}
		}
	}
	if f := raiz.buscar("majorFont").hijo("latin"); f != nil {
		c.fMayor = f.val("typeface")
	}
	if f := raiz.buscar("minorFont").hijo("latin"); f != nil {
		c.fMenor = f.val("typeface")
	}
}

var coloresPrest = map[string]string{"black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "blue": "#0000ff", "yellow": "#ffff00", "gray": "#808080", "grey": "#808080", "orange": "#ffa500"}

// color resuelve un nodo con un hijo de color y sus modificadores.
func (c *ctxPptx) color(n *nodo) string {
	if n == nil {
		return ""
	}
	base := ""
	var mods *nodo
	for _, h := range n.hijos {
		switch h.nom {
		case "srgbClr":
			base, mods = hexColor(h.val("val")), h
		case "schemeClr":
			base, mods = c.esquema(h.val("val")), h
		case "sysClr":
			base, mods = hexColor(h.val("lastClr")), h
		case "prstClr":
			base, mods = coloresPrest[h.val("val")], h
		}
		if mods != nil {
			break
		}
	}
	if base == "" || mods == nil {
		return base
	}
	r, g, b := desdeHex(base)
	hu, s, l := rgbAHsl(r, g, b)
	for _, m := range mods.hijos {
		v := numA(m.val("val")) / 100000
		switch m.nom {
		case "lumMod":
			l *= v
		case "lumOff":
			l += v
		case "tint":
			l = l*v + (1 - v)
		case "shade":
			l *= v
		}
	}
	l = math.Max(0, math.Min(1, l))
	return aHex(hslARgb(hu, s, l))
}

func (c *ctxPptx) esquema(v string) string {
	if m, ok := c.mapaColor[v]; ok {
		v = m
	}
	return c.colores[v]
}

// rellenoSolido devuelve el color de relleno (primer hijo reconocible).
func (c *ctxPptx) relleno(n *nodo) (string, bool) {
	if n == nil {
		return "", false
	}
	if s := n.hijo("solidFill"); s != nil {
		return c.color(s), true
	}
	if g := n.hijo("gradFill"); g != nil {
		if gs := g.camino("gsLst", "gs"); gs != nil {
			return c.color(gs), true
		}
		return "", true
	}
	if n.hijo("noFill") != nil {
		return "", true
	}
	return "", false
}

func (c *ctxPptx) resolverFuente(f string) string {
	switch {
	case f == "+mj-lt" || f == "+mj-ea" || f == "+mj-cs":
		return c.fMayor
	case strings.HasPrefix(f, "+"):
		return c.fMenor
	}
	return f
}

// ---- Texto ----

type fmtA struct {
	b, i, u      *bool
	c, font      string
	pt           float64
	al           string
	marL         float64
	bullet       string // "", "none", "char", "auto"
	bChar, bAuto string
	bFontSim     bool
	bInicio      int
}

func (c *ctxPptx) aplicarRPr(f *fmtA, n *nodo) {
	if n == nil {
		return
	}
	tog := func(nom string) *bool {
		if v, ok := n.attr(nom); ok {
			return ptrB(v == "1" || v == "true")
		}
		return nil
	}
	if p := tog("b"); p != nil {
		f.b = p
	}
	if p := tog("i"); p != nil {
		f.i = p
	}
	if v, ok := n.attr("u"); ok {
		f.u = ptrB(v != "none")
	}
	if v := n.val("sz"); v != "" {
		f.pt = numA(v) / 100
	}
	if s, ok := c.relleno(n); ok {
		f.c = s
	}
	if l := n.hijo("latin"); l != nil {
		f.font = c.resolverFuente(l.val("typeface"))
	}
}

func (c *ctxPptx) aplicarPPr(f *fmtA, n *nodo) {
	if n == nil {
		return
	}
	switch n.val("algn") {
	case "ctr":
		f.al = "c"
	case "r":
		f.al = "r"
	case "just", "dist":
		f.al = "j"
	case "l":
		f.al = ""
	}
	if v, ok := n.attr("marL"); ok {
		f.marL = numA(v)
	}
	if bf := n.hijo("buFont"); bf != nil {
		t := strings.ToLower(bf.val("typeface"))
		f.bFontSim = strings.Contains(t, "wingdings") || strings.Contains(t, "symbol") || strings.Contains(t, "webdings")
	}
	if n.hijo("buNone") != nil {
		f.bullet = "none"
	}
	if b := n.hijo("buChar"); b != nil {
		f.bullet, f.bChar = "char", b.val("char")
	}
	if b := n.hijo("buAutoNum"); b != nil {
		f.bullet, f.bAuto = "auto", b.val("type")
		f.bInicio = 1
		if s, err := strconv.Atoi(b.val("startAt")); err == nil {
			f.bInicio = s
		}
	}
	c.aplicarRPr(f, n.hijo("defRPr"))
}

func marcaAuto(tipo string, v int) string {
	cuerpo := strconv.Itoa(v)
	switch {
	case strings.HasPrefix(tipo, "alphaLc"):
		cuerpo = letra(v)
	case strings.HasPrefix(tipo, "alphaUc"):
		cuerpo = strings.ToUpper(letra(v))
	case strings.HasPrefix(tipo, "romanLc"):
		cuerpo = romano(v)
	case strings.HasPrefix(tipo, "romanUc"):
		cuerpo = strings.ToUpper(romano(v))
	}
	switch {
	case strings.HasSuffix(tipo, "ParenBoth"):
		return "(" + cuerpo + ")"
	case strings.HasSuffix(tipo, "ParenR"):
		return cuerpo + ")"
	case strings.HasSuffix(tipo, "Plain"):
		return cuerpo
	}
	return cuerpo + "."
}

// parrafos convierte un txBody en bloques aplicando la cascada de estilos.
func (c *ctxPptx) parrafos(body *nodo, capas []*nodo, titulo bool) []any {
	r := []any{}
	if body == nil {
		return r
	}
	conteos := map[int]int{}
	for _, p := range body.hijosN("p") {
		pPr := p.hijo("pPr")
		nivel := 0
		if pPr != nil {
			nivel, _ = strconv.Atoi(pPr.val("lvl"))
		}
		var base fmtA
		nomNivel := fmt.Sprintf("lvl%dpPr", nivel+1)
		for _, capa := range capas {
			if capa != nil {
				c.aplicarPPr(&base, capa.hijo(nomNivel))
			}
		}
		c.aplicarPPr(&base, pPr)

		par := Parrafo{K: "p", Id: -1, R: []Run{}, Ed: noEditable, Al: base.al}
		if titulo {
			par.Est = "titulo"
		}
		if base.marL > 0 {
			par.Sang = int(math.Round(base.marL / 76200))
		}
		for _, h := range p.hijos {
			switch h.nom {
			case "r", "fld":
				f := base
				c.aplicarRPr(&f, h.hijo("rPr"))
				par.R = append(par.R, runDe(h.hijo("t").texto(), f))
			case "br":
				f := base
				c.aplicarRPr(&f, h.hijo("rPr"))
				par.R = append(par.R, runDe("\n", f))
			}
		}
		tieneTexto := false
		for _, x := range par.R {
			if strings.TrimSpace(x.T) != "" {
				tieneTexto = true
			}
		}
		switch base.bullet {
		case "char":
			if tieneTexto {
				m := base.bChar
				if base.bFontSim || m == "" {
					m = vinetas[nivel%3]
				}
				par.Lista = &Lista{Marca: m, Nivel: nivel}
			}
			borrarNiveles(conteos, nivel-1)
		case "auto":
			if tieneTexto {
				if v, ok := conteos[nivel]; ok {
					conteos[nivel] = v + 1
				} else {
					conteos[nivel] = base.bInicio
				}
				borrarNiveles(conteos, nivel)
				par.Lista = &Lista{Marca: marcaAuto(base.bAuto, conteos[nivel]), Nivel: nivel}
			}
		default:
			borrarNiveles(conteos, nivel-1)
		}
		r = append(r, par)
	}
	return r
}

func borrarNiveles(m map[int]int, desde int) {
	for k := range m {
		if k > desde {
			delete(m, k)
		}
	}
}

func runDe(t string, f fmtA) Run {
	r := Run{T: t, C: f.c, Font: f.font, Pt: f.pt}
	if f.b != nil && *f.b {
		r.B = 1
	}
	if f.i != nil && *f.i {
		r.I = 1
	}
	if f.u != nil && *f.u {
		r.U = 1
	}
	return r
}

// ---- Formas ----

func fraccion(v, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(v/total*100000) / 100000
}

func (c *ctxPptx) cajaForma(sp *nodo, ph *nodo, capa *capaP, t xfA) ([4]float64, bool) {
	var xf *[4]float64
	if n := sp.camino("spPr", "xfrm"); n != nil {
		xf = leerXfrm(n)
	}
	if n := sp.camino("grpSpPr", "xfrm"); xf == nil && n != nil {
		xf = leerXfrm(n)
	}
	if n := sp.hijo("xfrm"); xf == nil && n != nil {
		xf = leerXfrm(n)
	}
	if xf == nil && ph != nil {
		tipo, idx := ph.val("type"), ph.val("idx")
		if capa.layout != nil {
			if inf := buscarPh(capa.layout.ph, tipo, idx); inf != nil && inf.xf != nil {
				xf = inf.xf
			}
		}
		if xf == nil && capa.master != nil {
			if inf := buscarPh(capa.master.ph, tipo, ""); inf != nil && inf.xf != nil {
				xf = inf.xf
			}
		}
	}
	if xf == nil {
		return [4]float64{}, false
	}
	x, y := t.punto(xf[0], xf[1])
	x2, y2 := t.punto(xf[0]+xf[2], xf[1]+xf[3])
	return [4]float64{x, y, x2 - x, y2 - y}, true
}

func (c *ctxPptx) formaDeCaja(caja [4]float64, tipo string) Forma {
	return Forma{X: fraccion(caja[0], c.anchoS), Y: fraccion(caja[1], c.altoS), W: fraccion(caja[2], c.anchoS), H: fraccion(caja[3], c.altoS), Tipo: tipo}
}

func (c *ctxPptx) capasTexto(capa *capaP, ph, sp *nodo) ([]*nodo, bool) {
	maestro := capa.master
	var capas []*nodo
	nombre := "otherStyle"
	titulo := false
	if ph != nil {
		tipo := ph.val("type")
		switch tipoNormal(tipo) {
		case "title":
			nombre, titulo = "titleStyle", true
		case "body":
			nombre = "bodyStyle"
		}
	}
	if maestro != nil {
		if tx := maestro.raiz.hijo("txStyles"); tx != nil {
			capas = append(capas, tx.hijo(nombre))
		}
		if ph != nil {
			if inf := buscarPh(maestro.ph, ph.val("type"), ""); inf != nil {
				capas = append(capas, inf.lst)
			}
		}
	}
	if ph != nil && capa.layout != nil {
		if inf := buscarPh(capa.layout.ph, ph.val("type"), ph.val("idx")); inf != nil {
			capas = append(capas, inf.lst)
		}
	}
	capas = append(capas, sp.camino("txBody", "lstStyle"))
	return capas, titulo
}

func tieneTextoVisible(bloques []any) bool {
	for _, b := range bloques {
		if p, ok := b.(Parrafo); ok {
			for _, r := range p.R {
				if strings.TrimSpace(r.T) != "" {
					return true
				}
			}
		}
	}
	return false
}

func (c *ctxPptx) refEstilo(sp *nodo, nom string) (string, bool) {
	ref := sp.camino("style", nom)
	if ref == nil {
		return "", false
	}
	if v, _ := strconv.Atoi(ref.val("idx")); v == 0 {
		return "", true
	}
	return c.color(ref), true
}

func (c *ctxPptx) forma(sp *nodo, capa *capaP, t xfA) (Forma, bool) {
	ph := sp.camino("nvSpPr", "nvPr", "ph")
	caja, ok := c.cajaForma(sp, ph, capa, t)
	if !ok {
		return Forma{}, false
	}
	spPr := sp.hijo("spPr")
	var bloques []any
	titulo := false
	if body := sp.hijo("txBody"); body != nil {
		var capas []*nodo
		capas, titulo = c.capasTexto(capa, ph, sp)
		bloques = c.parrafos(body, capas, titulo)
	}
	conTexto := tieneTextoVisible(bloques)

	if blip := spPr.camino("blipFill", "blip"); blip != nil {
		if r, ok := capa.rels[blip.attrRel("embed")]; ok && !r.externo {
			f := c.formaDeCaja(caja, "img")
			f.Src = r.destino
			f.B = bloques
			return f, true
		}
	}

	bg, hayBg := c.relleno(spPr)
	if !hayBg {
		bg, _ = c.refEstilo(sp, "fillRef")
	}
	borde := ""
	if ln := spPr.hijo("ln"); ln != nil {
		if s, ok := c.relleno(ln); ok {
			borde = s
		}
	} else if b, ok := c.refEstilo(sp, "lnRef"); ok {
		borde = b
	}

	esCuadro := sp.camino("nvSpPr", "cNvSpPr") != nil && sp.camino("nvSpPr", "cNvSpPr").val("txBox") == "1"
	var f Forma
	switch {
	case bg != "" || borde != "":
		if (ph != nil || esCuadro) && !conTexto {
			return Forma{}, false
		}
		f = c.formaDeCaja(caja, "forma")
		if ph != nil || esCuadro {
			f.Tipo = "texto"
		}
	case conTexto:
		f = c.formaDeCaja(caja, "texto")
	default:
		return Forma{}, false
	}
	f.B, f.Bg, f.Borde = bloques, bg, borde
	return f, true
}

func (c *ctxPptx) tabla(gf *nodo, capa *capaP, caja [4]float64) (Forma, bool) {
	t := gf.buscar("tbl")
	if t == nil {
		return Forma{}, false
	}
	res := BloqueTabla{K: "tabla", Filas: [][]Celda{}}
	var total float64
	var ws []float64
	for _, col := range t.hijo("tblGrid").hijosN("gridCol") {
		v := numA(col.val("w"))
		ws = append(ws, v)
		total += v
	}
	if total > 0 {
		for _, v := range ws {
			res.Anchos = append(res.Anchos, math.Round(v/total*10000)/10000)
		}
	}
	for _, tr := range t.hijosN("tr") {
		fila := []Celda{}
		for _, tc := range tr.hijosN("tc") {
			if tc.val("hMerge") == "1" {
				continue
			}
			cel := Celda{B: c.parrafos(tc.hijo("txBody"), nil, false)}
			if v, _ := strconv.Atoi(tc.val("gridSpan")); v > 1 {
				cel.Cs = v
			}
			if tc.val("vMerge") == "1" {
				cel.Vm = 1
			}
			if bg, ok := c.relleno(tc.hijo("tcPr")); ok {
				cel.Bg = bg
			}
			fila = append(fila, cel)
		}
		res.Filas = append(res.Filas, fila)
	}
	f := c.formaDeCaja(caja, "tabla")
	f.B = []any{res}
	return f, true
}

// arbol recorre un spTree aplicando las transformaciones de grupo.
func (c *ctxPptx) arbol(n *nodo, capa *capaP, t xfA, prof int, salida *[]Forma) {
	if prof > 32 {
		return
	}
	for _, h := range n.hijos {
		switch h.nom {
		case "AlternateContent":
			if ch := h.hijo("Choice"); ch != nil {
				c.arbol(ch, capa, t, prof+1, salida)
			}
		case "sp", "cxnSp":
			if f, ok := c.forma(h, capa, t); ok {
				*salida = append(*salida, f)
			}
		case "pic":
			caja, ok := c.cajaForma(h, h.camino("nvPicPr", "nvPr", "ph"), capa, t)
			if !ok {
				continue
			}
			blip := h.camino("blipFill", "blip")
			if blip == nil {
				continue
			}
			if r, ok := capa.rels[blip.attrRel("embed")]; ok && !r.externo {
				f := c.formaDeCaja(caja, "img")
				f.Src = r.destino
				*salida = append(*salida, f)
			}
		case "graphicFrame":
			caja, ok := c.cajaForma(h, h.camino("nvGraphicFramePr", "nvPr", "ph"), capa, t)
			if !ok {
				continue
			}
			if f, ok := c.tabla(h, capa, caja); ok {
				*salida = append(*salida, f)
			}
		case "grpSp":
			xf := h.camino("grpSpPr", "xfrm")
			nt := t
			if xf != nil {
				off, ext, chOff, chExt := xf.hijo("off"), xf.hijo("ext"), xf.hijo("chOff"), xf.hijo("chExt")
				if off != nil && ext != nil && chOff != nil && chExt != nil {
					ccx, ccy := numA(chExt.val("cx")), numA(chExt.val("cy"))
					sx, sy := 1.0, 1.0
					if ccx != 0 {
						sx = numA(ext.val("cx")) / ccx
					}
					if ccy != 0 {
						sy = numA(ext.val("cy")) / ccy
					}
					dx := numA(off.val("x")) - sx*numA(chOff.val("x"))
					dy := numA(off.val("y")) - sy*numA(chOff.val("y"))
					nt = xfA{t.ax * sx, t.ax*dx + t.bx, t.ay * sy, t.ay*dy + t.by}
				}
			}
			c.arbol(h, capa, nt, prof+1, salida)
		}
	}
}

func (c *ctxPptx) fondo(capa *capaP) string {
	if capa == nil {
		return ""
	}
	bg := capa.raiz.camino("cSld", "bg")
	if bg == nil {
		return ""
	}
	if pr := bg.hijo("bgPr"); pr != nil {
		s, _ := c.relleno(pr)
		return s
	}
	if ref := bg.hijo("bgRef"); ref != nil {
		return c.color(ref)
	}
	return ""
}

func (c *ctxPptx) notas(capa *capaP) string {
	r, ok := relPorTipo(capa.lista, "/notesSlide")
	if !ok || r.externo {
		return ""
	}
	n := c.capa(r.destino)
	if n == nil {
		return ""
	}
	arbol := n.raiz.camino("cSld", "spTree")
	var ls []string
	for _, sp := range arbol.hijosN("sp") {
		ph := sp.camino("nvSpPr", "nvPr", "ph")
		if ph == nil || ph.val("type") != "body" {
			continue
		}
		for _, p := range sp.camino("txBody").hijosN("p") {
			var b strings.Builder
			for _, x := range p.hijos {
				switch x.nom {
				case "r", "fld":
					b.WriteString(x.hijo("t").texto())
				case "br":
					b.WriteByte('\n')
				}
			}
			ls = append(ls, b.String())
		}
	}
	return strings.TrimRight(strings.Join(ls, "\n"), "\n")
}

func abrirPptx(d []byte) (any, error) {
	z, err := abrirZip(d)
	if err != nil {
		return nil, err
	}
	parte := z.parteRaiz("ppt/presentation.xml")
	dat, err := z.leer(parte)
	if err != nil {
		return nil, err
	}
	raiz, err := parsearXML(dat)
	if err != nil {
		return nil, err
	}
	rels, _ := z.leerRels(parte)
	c := &ctxPptx{z: z, capas: map[string]*capaP{}, colores: map[string]string{}, mapaColor: map[string]string{}}
	sz := raiz.hijo("sldSz")
	if sz == nil {
		return nil, errors.New("la presentación no indica su tamaño")
	}
	c.anchoS, c.altoS = numA(sz.val("cx")), numA(sz.val("cy"))
	doc := DocPptx{Tipo: "pptx", Ancho: int64(c.anchoS), Alto: int64(c.altoS), Firma: sha256Hex(d), Diapositivas: []Diapositiva{}}

	temaCargado := false
	tam := 0
	for _, id := range raiz.hijo("sldIdLst").hijosN("sldId") {
		r, ok := rels[id.attrRel("id")]
		if !ok || r.externo {
			continue
		}
		capa := c.capa(r.destino)
		if capa == nil {
			continue
		}
		if rl, ok := relPorTipo(capa.lista, "/slideLayout"); ok {
			capa.layout = c.capa(rl.destino)
		}
		if capa.layout != nil {
			if rm, ok := relPorTipo(capa.layout.lista, "/slideMaster"); ok {
				capa.master = c.capa(rm.destino)
			}
		}
		if !temaCargado && capa.master != nil {
			if rt, ok := relPorTipo(capa.master.lista, "/theme"); ok {
				if td := z.leerOpc(rt.destino); td != nil {
					if tr, err := parsearXML(td); err == nil {
						c.tema(tr)
					}
				}
			}
			if cm := capa.master.raiz.hijo("clrMap"); cm != nil {
				for _, a := range cm.attrs {
					c.mapaColor[a.Name.Local] = a.Value
				}
			}
			temaCargado = true
		}
		dia := Diapositiva{Formas: []Forma{}}
		if arbol := capa.raiz.camino("cSld", "spTree"); arbol != nil {
			c.arbol(arbol, capa, xfA{1, 0, 1, 0}, 0, &dia.Formas)
		}
		dia.Notas = c.notas(capa)
		dia.Bg = c.fondo(capa)
		if dia.Bg == "" {
			dia.Bg = c.fondo(capa.layout)
		}
		if dia.Bg == "" {
			dia.Bg = c.fondo(capa.master)
		}
		s, err := aJSON(dia)
		if err != nil {
			return nil, err
		}
		tam += len(s)
		if tam > limiteDocumento-64*1024 {
			doc.Aviso = fmt.Sprintf("La presentación es muy grande: solo se muestran las primeras %d diapositivas.", len(doc.Diapositivas))
			break
		}
		doc.Diapositivas = append(doc.Diapositivas, dia)
	}
	return doc, nil
}
