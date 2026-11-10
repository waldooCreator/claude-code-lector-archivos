package main

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Orden de los hijos de w:rPr según el esquema.
var ordenRPr = func() map[string]int {
	m := map[string]int{}
	for i, s := range strings.Fields(`rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath`) {
		m[s] = i
	}
	return m
}()

type hijoRPr struct {
	nom   string
	crudo []byte
}

func rangoCrudo(d []byte, n *nodo) []byte { return d[n.ini:n.fin] }

func guardarDocx(datos []byte, g *Guardado) ([]byte, error) {
	z, err := abrirZip(datos)
	if err != nil {
		return nil, err
	}
	c, err := cargarDocx(z)
	if err != nil {
		return nil, err
	}
	if !c.editable {
		return nil, errors.New("este documento no se puede editar sin riesgo")
	}
	vistos := map[int]bool{}
	borrar := map[*nodo]bool{}
	for _, ch := range g.Parrafos {
		if ch.Id < 0 || ch.Id >= len(c.parrafos) {
			return nil, fmt.Errorf("párrafo inexistente: %d", ch.Id)
		}
		if vistos[ch.Id] {
			return nil, fmt.Errorf("párrafo repetido: %d", ch.Id)
		}
		vistos[ch.Id] = true
		info := c.parrafos[ch.Id]
		if !c.parrafoEditable(info) {
			return nil, fmt.Errorf("el párrafo %d no se puede editar", ch.Id)
		}
		if len(ch.Nuevos) == 0 {
			borrar[info.n] = true
		}
	}
	vaciar := c.parrafosAVaciar(borrar)

	var eds []edicion
	netos := 0
	for _, ch := range g.Parrafos {
		info := c.parrafos[ch.Id]
		p := info.n
		if len(ch.Nuevos) == 0 && !vaciar[p] {
			eds = append(eds, edicion{p.ini, p.fin, nil})
			netos--
			continue
		}
		nuevos := ch.Nuevos
		if len(nuevos) == 0 {
			nuevos = []NuevoParrafo{{}}
		}
		eds = append(eds, edicion{p.ini, p.fin, c.reconstruir(p, nuevos)})
		netos += len(nuevos) - 1
	}
	nuevoDoc, err := aplicarEdiciones(c.datos, eds)
	if err != nil {
		return nil, err
	}

	// Comprobación final antes de tocar el disco.
	raiz, err := parsearXML(nuevoDoc)
	if err != nil {
		return nil, fmt.Errorf("el XML resultante no es válido; no se guardó: %v", err)
	}
	cuerpo := raiz.hijo("body")
	if cuerpo == nil || len(listarParrafos(cuerpo)) != len(c.parrafos)+netos {
		return nil, errors.New("el resultado no coincide con lo esperado; no se guardó")
	}
	salida, err := z.reempacar(map[string][]byte{c.parte: nuevoDoc}, nil)
	if err != nil {
		return nil, err
	}
	if err := verificarZip(salida); err != nil {
		return nil, err
	}
	return salida, nil
}

// parrafosAVaciar decide qué borrados deben dejar un párrafo vacío para que
// el documento siga siendo válido (celda sin párrafo, tabla final, salto de sección).
func (c *ctxDocx) parrafosAVaciar(borrar map[*nodo]bool) map[*nodo]bool {
	vaciar := map[*nodo]bool{}
	padres := map[*nodo]bool{}
	for p := range borrar {
		if p.camino("pPr", "sectPr") != nil {
			vaciar[p] = true
		}
		padres[p.padre] = true
	}
	for padre := range padres {
		esCelda := esW(padre, "tc")
		var bloques []*nodo
		for _, h := range padre.hijos {
			if enW(h) && (h.nom == "p" || h.nom == "tbl" || h.nom == "sdt" || h.nom == "customXml") {
				bloques = append(bloques, h)
			}
		}
		quedan := func() []*nodo {
			var r []*nodo
			for _, b := range bloques {
				if !borrar[b] || vaciar[b] {
					r = append(r, b)
				}
			}
			return r
		}
		// La celda necesita al menos un párrafo y, tras una tabla, uno al final.
		ultimoBorrado := func() *nodo {
			for i := len(bloques) - 1; i >= 0; i-- {
				if borrar[bloques[i]] && !vaciar[bloques[i]] {
					return bloques[i]
				}
			}
			return nil
		}
		r := quedan()
		sinPar := true
		for _, b := range r {
			if esW(b, "p") {
				sinPar = false
			}
		}
		if esCelda && sinPar {
			if u := ultimoBorrado(); u != nil {
				vaciar[u] = true
			}
			r = quedan()
		}
		if esCelda || esW(padre, "body") {
			if len(r) > 0 && esW(r[len(r)-1], "tbl") {
				if u := ultimoBorrado(); u != nil {
					vaciar[u] = true
				}
			}
		}
	}
	return vaciar
}

// reconstruir genera el XML de un párrafo editado y sus adicionales.
func (c *ctxDocx) reconstruir(p *nodo, nuevos []NuevoParrafo) []byte {
	d := c.datos
	est := c.estiloParrafo(p)
	var apertura []byte
	if p.autoCierre() {
		tag := string(d[p.ini:p.iniC])
		apertura = []byte(strings.TrimSuffix(strings.TrimRight(tag, " \t\r\n>/"), " ") + ">")
	} else {
		apertura = d[p.ini:p.iniC]
	}
	var pPr, pPrSinSect []byte
	if n := p.hijo("pPr"); n != nil {
		pPr = rangoCrudo(d, n)
		pPrSinSect = pPr
		if sp := n.hijo("sectPr"); sp != nil {
			pPrSinSect = append(append([]byte{}, d[n.ini:sp.ini]...), d[sp.fin:n.fin]...)
		}
	}
	var marcasIni, marcasFin []byte
	var runs []*nodo
	saltoAntes, saltoDespues, vistoTexto := false, false, false
	for _, h := range p.hijos {
		switch h.nom {
		case "bookmarkStart":
			marcasIni = append(marcasIni, rangoCrudo(d, h)...)
		case "bookmarkEnd":
			marcasFin = append(marcasFin, rangoCrudo(d, h)...)
		case "r":
			runs = append(runs, h)
			for _, x := range h.hijos {
				switch {
				case x.nom == "t" && len(x.txt) > 0, x.nom == "tab":
					vistoTexto = true
				case x.nom == "br" && x.val("type") == "page":
					if vistoTexto {
						saltoDespues = true
					} else {
						saltoAntes = true
					}
				case x.nom == "br":
					vistoTexto = true
				}
			}
		}
	}
	const brPagina = `<w:r><w:br w:type="page"/></w:r>`

	var b bytes.Buffer
	b.Write(apertura)
	b.Write(pPr)
	b.Write(marcasIni)
	if saltoAntes {
		b.WriteString(brPagina)
	}
	c.escribirRuns(&b, nuevos[0], runs, est)
	if len(nuevos) == 1 && saltoDespues {
		b.WriteString(brPagina)
	}
	b.Write(marcasFin)
	b.WriteString("</w:p>")
	for i := 1; i < len(nuevos); i++ {
		b.WriteString("<w:p>")
		b.Write(pPrSinSect)
		c.escribirRuns(&b, nuevos[i], runs, est)
		if i == len(nuevos)-1 && saltoDespues {
			b.WriteString(brPagina)
		}
		b.WriteString("</w:p>")
	}
	return b.Bytes()
}

func (c *ctxDocx) escribirRuns(b *bytes.Buffer, np NuevoParrafo, runs []*nodo, est string) {
	for _, r := range np.R {
		if r.T == "" {
			continue
		}
		var orig *nodo
		if len(runs) > 0 {
			orig = runs[0]
			if r.O != nil && *r.O >= 0 && *r.O < len(runs) {
				orig = runs[*r.O]
			}
		}
		b.WriteString("<w:r>")
		var rPrO *nodo
		if orig != nil {
			rPrO = orig.hijo("rPr")
		}
		b.Write(c.rPrNuevo(rPrO, r, est))
		escribirTextoRun(b, r.T)
		b.WriteString("</w:r>")
	}
}

func escribirTextoRun(b *bytes.Buffer, t string) {
	var tramo strings.Builder
	volcar := func() {
		if tramo.Len() > 0 {
			b.WriteString(`<w:t xml:space="preserve">`)
			b.WriteString(escaparXML(tramo.String()))
			b.WriteString("</w:t>")
			tramo.Reset()
		}
	}
	for _, c := range aLF(t) {
		switch c {
		case '\t':
			volcar()
			b.WriteString("<w:tab/>")
		case '\n':
			volcar()
			b.WriteString("<w:br/>")
		default:
			tramo.WriteRune(c)
		}
	}
	volcar()
}

// rPrNuevo parte del rPr crudo del original y aplica solo lo pedido.
func (c *ctxDocx) rPrNuevo(rPr *nodo, r Run, est string) []byte {
	var hijos []hijoRPr
	if rPr != nil {
		for _, h := range rPr.hijos {
			nom := h.nom
			if !enW(h) {
				nom = "\x00" + nom
			}
			hijos = append(hijos, hijoRPr{nom, rangoCrudo(c.datos, h)})
		}
	}
	base := c.fmtBase(est, rPr)
	efectivo := c.fmtEfectivo(est, rPr)

	// Para no reescribir de más, solo se toca lo que difiere.
	busca := func(nom string) int {
		for i, h := range hijos {
			if h.nom == nom {
				return i
			}
		}
		return -1
	}
	quitar := func(nom string) {
		if i := busca(nom); i >= 0 {
			hijos = append(hijos[:i], hijos[i+1:]...)
		}
	}
	poner := func(nom, xml string) {
		quitar(nom)
		hijos = append(hijos, hijoRPr{nom, []byte(xml)})
	}
	alternar := func(nom string, quiere, baseOn bool, on, off string, encendidoDir func() bool) {
		i := busca(nom)
		if quiere {
			if i >= 0 && !encendidoDir() {
				poner(nom, on)
			} else if i < 0 && !baseOn {
				poner(nom, on)
			}
			return
		}
		if i >= 0 {
			quitar(nom)
		}
		if baseOn {
			poner(nom, off)
		}
	}
	dirOn := func(nom string) func() bool {
		return func() bool {
			if rPr == nil {
				return false
			}
			for _, h := range rPr.hijos {
				if esW(h, nom) {
					return encendido(h)
				}
			}
			return false
		}
	}
	on := func(p *bool) bool { return p != nil && *p }
	alternar("b", r.B != 0, on(base.b), `<w:b/>`, `<w:b w:val="0"/>`, dirOn("b"))
	alternar("i", r.I != 0, on(base.i), `<w:i/>`, `<w:i w:val="0"/>`, dirOn("i"))
	alternar("u", r.U != 0, on(base.u), `<w:u w:val="single"/>`, `<w:u w:val="none"/>`, dirOn("u"))

	if r.Font != "" && (efectivo.font == nil || *efectivo.font != r.Font) {
		v := escaparXML(r.Font)
		poner("rFonts", `<w:rFonts w:ascii="`+v+`" w:hAnsi="`+v+`" w:eastAsia="`+v+`" w:cs="`+v+`"/>`)
	}
	if r.Pt > 0 && (efectivo.pt == nil || math.Abs(*efectivo.pt-r.Pt) > 0.01) {
		v := strconv.Itoa(int(math.Round(r.Pt * 2)))
		poner("sz", `<w:sz w:val="`+v+`"/>`)
		poner("szCs", `<w:szCs w:val="`+v+`"/>`)
	}
	if len(hijos) == 0 {
		return nil
	}
	sort.SliceStable(hijos, func(i, j int) bool { return rango(hijos[i].nom) < rango(hijos[j].nom) })
	var b bytes.Buffer
	b.WriteString("<w:rPr>")
	for _, h := range hijos {
		b.Write(h.crudo)
	}
	b.WriteString("</w:rPr>")
	return b.Bytes()
}

func rango(nom string) int {
	if v, ok := ordenRPr[nom]; ok {
		return v
	}
	return 1000
}
