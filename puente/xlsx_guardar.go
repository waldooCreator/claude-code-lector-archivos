package main

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type celdaPos struct {
	col, ini, fin int
	s             string
	tieneS, conR  bool
}

type filaPos struct {
	r, ini, fin, iniC, finC int
	auto                    bool
	celdas                  []celdaPos
}

type formulaPos struct {
	f, c, ini, fin int
	txt            string
}

type grupoComp struct {
	maestra *formulaPos
	deps    []formulaPos
}

type mapaHoja struct {
	raizPref                     string
	dimIni, dimFin               int
	dimRef                       string
	sdIni, sdFin, sdIniC, sdFinC int
	sdAuto                       bool
	filas                        []filaPos
	compartidas                  map[string]*grupoComp
}

// mapearHoja ubica por offsets la estructura de la hoja.
func mapearHoja(d []byte, filasCambio map[int]bool) (*mapaHoja, error) {
	dec := nuevoDecoder(d)
	m := &mapaHoja{dimIni: -1, sdIni: -1, compartidas: map[string]*grupoComp{}}
	prof, numFila, col := 0, -1, -1
	var fila *filaPos
	var celda *celdaPos
	var fPos *formulaPos
	var fT, fSi string
	celF, celC := -1, -1
	for {
		ini := int(dec.InputOffset())
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("hoja dañada: %v", err)
		}
		fin := int(dec.InputOffset())
		switch t := tok.(type) {
		case xml.StartElement:
			prof++
			at := func(nom string) (string, bool) {
				for _, a := range t.Attr {
					if a.Name.Local == nom && a.Name.Space == "" {
						return a.Value, true
					}
				}
				return "", false
			}
			switch {
			case prof == 1:
				m.raizPref = prefijoCrudo(d, ini)
			case prof == 2 && t.Name.Local == "dimension":
				m.dimIni, m.dimFin = ini, fin
				m.dimRef, _ = at("ref")
			case prof == 2 && t.Name.Local == "sheetData":
				m.sdIni, m.sdIniC = ini, fin
			case prof == 3 && t.Name.Local == "row":
				if v, ok := at("r"); ok {
					if n, err := strconv.Atoi(v); err == nil && n >= 1 {
						numFila = n - 1
					} else {
						numFila++
					}
				} else {
					numFila++
				}
				m.filas = append(m.filas, filaPos{r: numFila, ini: ini, iniC: fin})
				fila = &m.filas[len(m.filas)-1]
				col = -1
			case prof == 4 && t.Name.Local == "c" && fila != nil:
				celda = &celdaPos{ini: ini}
				if v, ok := at("r"); ok {
					if _, c, okr := partirRef(v); okr {
						col = c
						celda.conR = true
					} else {
						col++
					}
				} else {
					col++
				}
				celda.col = col
				celda.s, celda.tieneS = at("s")
				celF, celC = fila.r, col
			case prof == 5 && t.Name.Local == "f" && celda != nil:
				fT, _ = at("t")
				fSi, _ = at("si")
				if fT == "shared" && fSi != "" {
					fPos = &formulaPos{f: celF, c: celC, ini: ini}
				}
			}
		case xml.CharData:
			if fPos != nil {
				fPos.txt += string(t)
			}
		case xml.EndElement:
			switch {
			case prof == 2 && t.Name.Local == "sheetData":
				m.sdFinC, m.sdFin = ini, fin
				m.sdAuto = fin == m.sdIniC
			case prof == 3 && t.Name.Local == "row":
				fila.finC, fila.fin = ini, fin
				fila.auto = fin == fila.iniC
				fila = nil
			case prof == 4 && t.Name.Local == "c" && celda != nil:
				celda.fin = fin
				if filasCambio[fila.r] {
					fila.celdas = append(fila.celdas, *celda)
				}
				celda = nil
			case prof == 5 && t.Name.Local == "f" && fPos != nil:
				fPos.fin = fin
				g := m.compartidas[fSi]
				if g == nil {
					g = &grupoComp{}
					m.compartidas[fSi] = g
				}
				if strings.TrimSpace(fPos.txt) != "" {
					if g.maestra == nil {
						c := *fPos
						g.maestra = &c
					}
				} else {
					g.deps = append(g.deps, *fPos)
				}
				fPos = nil
			}
			prof--
		}
	}
	if m.sdIni < 0 {
		return nil, errors.New("la hoja no tiene sheetData")
	}
	return m, nil
}

type valorCelda struct {
	tipo    string // "", "n", "s", "b"
	num     string
	txt     string
	bol     bool
	formula *string
}

func interpretarValor(c CambioCelda) (valorCelda, error) {
	v := valorCelda{formula: c.Formula}
	raw := strings.TrimSpace(string(c.V))
	if raw == "" || raw == "null" {
		return v, nil
	}
	switch raw[0] {
	case '"':
		v.tipo = "s"
		if err := json.Unmarshal(c.V, &v.txt); err != nil {
			return v, errors.New("valor de celda inválido")
		}
	case 't', 'f':
		v.tipo = "b"
		v.bol = raw == "true"
	default:
		if _, err := strconv.ParseFloat(raw, 64); err != nil {
			return v, errors.New("valor de celda inválido")
		}
		v.tipo, v.num = "n", raw
	}
	return v, nil
}

// xmlCelda genera el <c> nuevo conservando el estilo.
func xmlCelda(pref string, f, c int, s string, conS bool, v valorCelda) string {
	p := ""
	if pref != "" {
		p = pref + ":"
	}
	attrs := ` r="` + aRef(f, c) + `"`
	if conS {
		attrs += ` s="` + escaparXML(s) + `"`
	}
	formula := ""
	if v.formula != nil && *v.formula != "" {
		formula = "<" + p + "f>" + escaparXML(strings.TrimPrefix(*v.formula, "=")) + "</" + p + "f>"
	}
	vv := func(x string) string { return "<" + p + "v>" + escaparXML(x) + "</" + p + "v>" }
	abre := "<" + p + "c" + attrs
	cierra := "</" + p + "c>"
	switch v.tipo {
	case "n":
		return abre + ">" + formula + vv(v.num) + cierra
	case "b":
		x := "0"
		if v.bol {
			x = "1"
		}
		return abre + ` t="b">` + formula + vv(x) + cierra
	case "s":
		if formula != "" {
			return abre + ` t="str">` + formula + vv(v.txt) + cierra
		}
		return abre + ` t="inlineStr"><` + p + `is><` + p + `t xml:space="preserve">` + escaparXML(v.txt) + `</` + p + `t></` + p + `is>` + cierra
	}
	if formula != "" {
		return abre + ">" + formula + cierra
	}
	return abre + "/>"
}

var (
	reSpans = regexp.MustCompile(`\s+spans\s*=\s*("[^"]*"|'[^']*')`)
	reRef   = regexp.MustCompile(`\bref\s*=\s*("[^"]*"|'[^']*')`)
)

func guardarXlsx(datos []byte, g *Guardado) ([]byte, error) {
	z, err := abrirZip(datos)
	if err != nil {
		return nil, err
	}
	x, err := cargarLibro(z)
	if err != nil {
		return nil, err
	}
	porHoja := map[int][]CambioCelda{}
	for _, c := range g.Cambios {
		if c.Hoja < 0 || c.Hoja >= len(x.hojas) || !x.hojas[c.Hoja].esHoja {
			return nil, fmt.Errorf("hoja inexistente: %d", c.Hoja)
		}
		if c.F < 0 || c.F >= 1048576 || c.C < 0 || c.C >= 16384 {
			return nil, fmt.Errorf("celda fuera de rango: %d,%d", c.F, c.C)
		}
		porHoja[c.Hoja] = append(porHoja[c.Hoja], c)
	}
	cambios := map[string][]byte{}
	for ih, lista := range porHoja {
		ruta := x.hojas[ih].ruta
		d, err := z.leer(ruta)
		if err != nil {
			return nil, err
		}
		nuevo, err := editarHoja(d, lista)
		if err != nil {
			return nil, err
		}
		if err := comprobarXML(nuevo); err != nil {
			return nil, fmt.Errorf("el XML resultante no es válido; no se guardó: %v", err)
		}
		cambios[ruta] = nuevo
	}

	quitar := map[string]bool{}
	wb, err := z.leer(x.parte)
	if err != nil {
		return nil, err
	}
	nuevoWb, err := forzarRecalculo(wb)
	if err != nil {
		return nil, err
	}
	cambios[x.parte] = nuevoWb

	_, lista := z.leerRels(x.parte)
	if r, ok := relPorTipo(lista, "/calcChain"); ok && !r.externo {
		quitar[r.destino] = true
		relsRuta := rutaRels(x.parte)
		if rd := z.leerOpc(relsRuta); rd != nil {
			if n, err := quitarElementos(rd, func(h *nodo) bool {
				return h.nom == "Relationship" && strings.HasSuffix(h.val("Type"), "/calcChain")
			}); err == nil {
				cambios[relsRuta] = n
			} else {
				return nil, err
			}
		}
		if ct := z.leerOpc("[Content_Types].xml"); ct != nil {
			parte := "/" + r.destino
			if n, err := quitarElementos(ct, func(h *nodo) bool {
				return h.nom == "Override" && h.val("PartName") == parte
			}); err == nil {
				cambios["[Content_Types].xml"] = n
			} else {
				return nil, err
			}
		}
	} else if z.existe("xl/calcChain.xml") {
		// Sin relación, igual se quita la cadena huérfana.
		quitar["xl/calcChain.xml"] = true
		if ct := z.leerOpc("[Content_Types].xml"); ct != nil {
			n, err := quitarElementos(ct, func(h *nodo) bool {
				return h.nom == "Override" && h.val("PartName") == "/xl/calcChain.xml"
			})
			if err != nil {
				return nil, err
			}
			cambios["[Content_Types].xml"] = n
		}
	}

	salida, err := z.reempacar(cambios, quitar)
	if err != nil {
		return nil, err
	}
	if err := verificarZip(salida); err != nil {
		return nil, err
	}
	// Reabrirlo con el propio lector debe funcionar.
	if _, err := abrirXlsx(salida); err != nil {
		return nil, fmt.Errorf("el libro resultante no se pudo reabrir; no se guardó: %v", err)
	}
	return salida, nil
}

func quitarElementos(d []byte, cond func(*nodo) bool) ([]byte, error) {
	raiz, err := parsearXML(d)
	if err != nil {
		return nil, err
	}
	var eds []edicion
	for _, h := range raiz.hijos {
		if cond(h) {
			eds = append(eds, edicion{h.ini, h.fin, nil})
		}
	}
	return aplicarEdiciones(d, eds)
}

// forzarRecalculo añade fullCalcOnLoad a calcPr o crea el elemento.
func forzarRecalculo(d []byte) ([]byte, error) {
	raiz, err := parsearXML(d)
	if err != nil {
		return nil, err
	}
	pref := prefijoCrudo(d, raiz.ini)
	if c := raiz.hijo("calcPr"); c != nil {
		tag := string(d[c.ini:c.iniC])
		if strings.Contains(tag, "fullCalcOnLoad") {
			re := regexp.MustCompile(`fullCalcOnLoad\s*=\s*("[^"]*"|'[^']*')`)
			tag = re.ReplaceAllString(tag, `fullCalcOnLoad="1"`)
		} else {
			fin := strings.LastIndex(tag, "/>")
			if fin < 0 {
				fin = strings.LastIndex(tag, ">")
			}
			if fin < 0 {
				return nil, errors.New("calcPr inesperado")
			}
			tag = tag[:fin] + ` fullCalcOnLoad="1"` + tag[fin:]
		}
		return aplicarEdiciones(d, []edicion{{c.ini, c.iniC, []byte(tag)}})
	}
	nombre := "calcPr"
	if pref != "" {
		nombre = pref + ":calcPr"
	}
	var ancla *nodo
	for _, nom := range []string{"definedNames", "externalReferences", "functionGroups", "sheets"} {
		if n := raiz.hijo(nom); n != nil {
			ancla = n
			break
		}
	}
	if ancla == nil {
		return nil, errors.New("workbook.xml inesperado")
	}
	return aplicarEdiciones(d, []edicion{{ancla.fin, ancla.fin, []byte("<" + nombre + ` fullCalcOnLoad="1"/>`)}})
}

func editarHoja(d []byte, lista []CambioCelda) ([]byte, error) {
	if len(normalizarXML(d)) != len(d) {
		return nil, errors.New("hoja con codificación no editable")
	}
	cambios := map[[2]int]valorCelda{}
	filasCambio := map[int]bool{}
	for _, c := range lista {
		v, err := interpretarValor(c)
		if err != nil {
			return nil, err
		}
		cambios[[2]int{c.F, c.C}] = v
		filasCambio[c.F] = true
	}
	m, err := mapearHoja(d, filasCambio)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(m.filas, func(i, j int) bool { return m.filas[i].r < m.filas[j].r })

	var eds []edicion
	escribir := func(f, c int, s string, conS bool) string {
		return xmlCelda(m.raizPref, f, c, s, conS, cambios[[2]int{f, c}])
	}
	porFila := map[int][]int{}
	for k := range cambios {
		porFila[k[0]] = append(porFila[k[0]], k[1])
	}
	indice := map[int]*filaPos{}
	for i := range m.filas {
		indice[m.filas[i].r] = &m.filas[i]
	}
	var ordenFilas []int
	for f := range porFila {
		sort.Ints(porFila[f])
		ordenFilas = append(ordenFilas, f)
	}
	sort.Ints(ordenFilas)
	var filasNuevas []string
	var posNuevas []int
	p := ""
	if m.raizPref != "" {
		p = m.raizPref + ":"
	}
	for _, f := range ordenFilas {
		cols := porFila[f]
		fp := indice[f]
		if fp == nil {
			var b strings.Builder
			b.WriteString("<" + p + `row r="` + strconv.Itoa(f+1) + `">`)
			for _, c := range cols {
				b.WriteString(escribir(f, c, "", false))
			}
			b.WriteString("</" + p + "row>")
			// Va antes de la primera fila mayor.
			pos := -1
			i := sort.Search(len(m.filas), func(i int) bool { return m.filas[i].r > f })
			if i < len(m.filas) {
				pos = m.filas[i].ini
			}
			filasNuevas = append(filasNuevas, b.String())
			posNuevas = append(posNuevas, pos)
			continue
		}
		apertura := string(d[fp.ini:fp.iniC])
		if fp.auto {
			var b strings.Builder
			tag := strings.TrimRight(apertura, " \t\r\n>/")
			b.WriteString(reSpans.ReplaceAllString(tag, "") + ">")
			for _, c := range cols {
				b.WriteString(escribir(f, c, "", false))
			}
			b.WriteString("</" + p + "row>")
			eds = append(eds, edicion{fp.ini, fp.fin, []byte(b.String())})
			continue
		}
		todasConR := true
		for _, cp := range fp.celdas {
			todasConR = todasConR && cp.conR
		}
		inserta := false
		for _, c := range cols {
			pos := -1
			for i := range fp.celdas {
				if fp.celdas[i].col == c {
					pos = i
					break
				}
			}
			if pos >= 0 {
				cp := fp.celdas[pos]
				eds = append(eds, edicion{cp.ini, cp.fin, []byte(escribir(f, c, cp.s, cp.tieneS))})
				continue
			}
			if !todasConR {
				return nil, fmt.Errorf("la fila %d no tiene referencias de celda; no se puede insertar", f+1)
			}
			inserta = true
			donde := fp.finC
			for i := range fp.celdas {
				if fp.celdas[i].col > c {
					donde = fp.celdas[i].ini
					break
				}
			}
			eds = append(eds, edicion{donde, donde, []byte(escribir(f, c, "", false))})
		}
		if inserta && reSpans.MatchString(apertura) {
			eds = append(eds, edicion{fp.ini, fp.iniC, []byte(reSpans.ReplaceAllString(apertura, ""))})
		}
	}

	if len(filasNuevas) > 0 {
		if m.sdAuto {
			tag := string(d[m.sdIni:m.sdFin])
			var b strings.Builder
			b.WriteString(strings.TrimRight(tag, " \t\r\n>/") + ">")
			for _, s := range filasNuevas {
				b.WriteString(s)
			}
			b.WriteString("</" + p + "sheetData>")
			eds = append(eds, edicion{m.sdIni, m.sdFin, []byte(b.String())})
		} else {
			for i, s := range filasNuevas {
				pos := posNuevas[i]
				if pos < 0 {
					pos = m.sdFinC
				}
				eds = append(eds, edicion{pos, pos, []byte(s)})
			}
		}
	}

	// Si se reemplaza la maestra de una fórmula compartida, sus dependientes
	// pasan a llevar su fórmula explícita.
	for _, g := range m.compartidas {
		if g.maestra == nil {
			continue
		}
		if _, cambia := cambios[[2]int{g.maestra.f, g.maestra.c}]; !cambia {
			continue
		}
		base := strings.TrimPrefix(g.maestra.txt, "=")
		for _, dep := range g.deps {
			if _, cambia := cambios[[2]int{dep.f, dep.c}]; cambia {
				continue
			}
			f := trasladarFormula(base, dep.f-g.maestra.f, dep.c-g.maestra.c)
			txt := "<" + p + "f>" + escaparXML(f) + "</" + p + "f>"
			eds = append(eds, edicion{dep.ini, dep.fin, []byte(txt)})
		}
	}

	if m.dimIni >= 0 {
		f1, c1, f2, c2, ok := partirRango(m.dimRef)
		if !ok {
			f1, c1, f2, c2 = 1<<30, 1<<30, -1, -1
		}
		for k, v := range cambios {
			if v.tipo == "" && v.formula == nil {
				continue
			}
			f1, c1 = min(f1, k[0]), min(c1, k[1])
			f2, c2 = max(f2, k[0]), max(c2, k[1])
		}
		if f2 >= 0 {
			nueva := aRef(f1, c1)
			if f1 != f2 || c1 != c2 {
				nueva += ":" + aRef(f2, c2)
			}
			tag := string(d[m.dimIni:m.dimFin])
			tag = reRef.ReplaceAllString(tag, `ref="`+nueva+`"`)
			eds = append(eds, edicion{m.dimIni, m.dimFin, []byte(tag)})
		}
	}
	return aplicarEdiciones(d, eds)
}
