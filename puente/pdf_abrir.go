package main

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"math"
	"strings"
)

const maxPaginasPdf = 2000

type matPDF [6]float64

var identidadM = matPDF{1, 0, 0, 1, 0, 0}

// por: this × o (primero this, luego o).
func (a matPDF) por(b matPDF) matPDF {
	return matPDF{
		a[0]*b[0] + a[1]*b[2],
		a[0]*b[1] + a[1]*b[3],
		a[2]*b[0] + a[3]*b[2],
		a[2]*b[1] + a[3]*b[3],
		a[4]*b[0] + a[5]*b[2] + b[4],
		a[4]*b[1] + a[5]*b[3] + b[5],
	}
}

func (a matPDF) punto(x, y float64) (float64, float64) {
	return a[0]*x + a[2]*y + a[4], a[1]*x + a[3]*y + a[5]
}

type paginaInfo struct {
	dict     pdfDict
	recursos pdfDict
	media    []float64
	rotacion int
}

// paginas recorre el árbol con herencia de Resources, MediaBox y Rotate.
func (p *lectorPDF) paginas(limite int) []paginaInfo {
	var r []paginaInfo
	vistos := map[int]bool{}
	var rec func(x any, rec2 pdfDict, media []float64, rot int, prof int)
	rec = func(x any, res pdfDict, media []float64, rot int, prof int) {
		if prof > 64 || len(r) >= limite {
			return
		}
		if ref, ok := x.(pdfRef); ok {
			if vistos[ref.n] {
				return
			}
			vistos[ref.n] = true
		}
		d := p.dict(x)
		if d == nil {
			return
		}
		if v := p.dict(d["Resources"]); v != nil {
			res = v
		}
		if v := p.numeros(d["MediaBox"]); len(v) == 4 {
			media = v
		}
		if v, ok := p.ent(d["Rotate"]); ok {
			rot = v
		}
		kids := p.arr(d["Kids"])
		if p.nom(d["Type"]) == "Pages" || (kids != nil && d["Contents"] == nil) {
			for _, k := range kids {
				rec(k, res, media, rot, prof+1)
			}
			return
		}
		r = append(r, paginaInfo{dict: d, recursos: res, media: media, rotacion: rot})
	}
	raiz := p.dict(p.trailer["Root"])
	if raiz != nil {
		rec(raiz["Pages"], nil, []float64{0, 0, 612, 792}, 0, 0)
	}
	if len(r) == 0 {
		for _, n := range p.paginasSueltas() {
			if len(r) >= limite {
				break
			}
			rec(pdfRef{n, 0}, nil, []float64{0, 0, 612, 792}, 0, 0)
		}
	}
	return r
}

type fragmento struct {
	x, y, finX float64
	t          string
	pt         float64
	b, i       bool
	fuente     *fuentePDF
	horiz      bool
}

type imagenPDF struct {
	st   *pdfStream
	w, h int
}

type estadoGraf struct {
	ctm                      matPDF
	tc, tw, tz, tl, ts, tamF float64
	fuente                   *fuentePDF
}

type interprete struct {
	p          *lectorPDF
	frags      []fragmento
	imagenes   []imagenPDF
	hayImagen  bool
	pagina     func(x, y float64) (float64, float64)
	forms      map[*pdfStream]bool
	soloImagen bool
}

func (in *interprete) contenido(datos []byte, res pdfDict, gs estadoGraf, prof int) {
	if prof > 12 {
		return
	}
	l := &lexPDF{d: datos}
	var ops []any
	pila := []estadoGraf{}
	tm, tlm := identidadM, identidadM
	num := func(i int) float64 {
		if i < 0 || i >= len(ops) {
			return 0
		}
		v, _ := in.p.num(ops[i])
		return v
	}
	mostrar := func(s []byte) {
		if gs.fuente == nil {
			return
		}
		in.mostrar(s, &gs, &tm)
	}
	siguienteLinea := func(tx, ty float64) {
		tlm = matPDF{1, 0, 0, 1, tx, ty}.por(tlm)
		tm = tlm
	}
	for {
		v, ok := l.objeto()
		if !ok {
			return
		}
		op, esOp := v.(pdfOp)
		if !esOp {
			ops = append(ops, v)
			if len(ops) > 2048 {
				ops = ops[1024:]
			}
			continue
		}
		n := len(ops)
		switch op {
		case "q":
			if len(pila) < 512 {
				pila = append(pila, gs)
			}
		case "Q":
			if m := len(pila); m > 0 {
				gs = pila[m-1]
				pila = pila[:m-1]
			}
		case "cm":
			if n >= 6 {
				gs.ctm = matPDF{num(n - 6), num(n - 5), num(n - 4), num(n - 3), num(n - 2), num(n - 1)}.por(gs.ctm)
			}
		case "BT":
			tm, tlm = identidadM, identidadM
		case "ET":
		case "Tc":
			gs.tc = num(n - 1)
		case "Tw":
			gs.tw = num(n - 1)
		case "Tz":
			gs.tz = num(n-1) / 100
		case "TL":
			gs.tl = num(n - 1)
		case "Ts":
			gs.ts = num(n - 1)
		case "Tf":
			if n >= 2 {
				gs.tamF = num(n - 1)
				nom := in.p.nom(ops[n-2])
				if fx, ok := in.p.dict(res["Font"])[nom]; ok {
					gs.fuente = in.p.cargarFuente(fx)
				} else {
					gs.fuente = &fuentePDF{anchos: map[int]float64{}, anchoDefecto: 500, enc: baseWinAnsi()}
				}
			}
		case "Td":
			siguienteLinea(num(n-2), num(n-1))
		case "TD":
			gs.tl = -num(n - 1)
			siguienteLinea(num(n-2), num(n-1))
		case "Tm":
			if n >= 6 {
				tm = matPDF{num(n - 6), num(n - 5), num(n - 4), num(n - 3), num(n - 2), num(n - 1)}
				tlm = tm
			}
		case "T*":
			siguienteLinea(0, -gs.tl)
		case "Tj":
			if n >= 1 {
				if s, ok := in.p.res(ops[n-1]).(pdfCadena); ok {
					mostrar(s)
				}
			}
		case "'":
			siguienteLinea(0, -gs.tl)
			if n >= 1 {
				if s, ok := in.p.res(ops[n-1]).(pdfCadena); ok {
					mostrar(s)
				}
			}
		case "\"":
			if n >= 3 {
				gs.tw = num(n - 3)
				gs.tc = num(n - 2)
				siguienteLinea(0, -gs.tl)
				if s, ok := in.p.res(ops[n-1]).(pdfCadena); ok {
					mostrar(s)
				}
			}
		case "TJ":
			if n >= 1 {
				for _, x := range in.p.arr(ops[n-1]) {
					switch e := in.p.res(x).(type) {
					case pdfCadena:
						mostrar(e)
					case int:
						ajustarTJ(&tm, float64(e), &gs)
					case float64:
						ajustarTJ(&tm, e, &gs)
					}
				}
			}
		case "Do":
			if n >= 1 {
				in.xobjeto(in.p.nom(ops[n-1]), res, gs, prof)
			}
		case "BI":
			in.imagenEnLinea(l)
		}
		ops = ops[:0]
	}
}

func ajustarTJ(tm *matPDF, v float64, gs *estadoGraf) {
	tx := -v / 1000 * gs.tamF * gs.tz
	*tm = matPDF{1, 0, 0, 1, tx, 0}.por(*tm)
}

func (in *interprete) imagenEnLinea(l *lexPDF) {
	for {
		v, ok := l.objeto()
		if !ok {
			return
		}
		if op, es := v.(pdfOp); es && op == "ID" {
			break
		}
	}
	in.hayImagen = true
	ini := l.p
	for i := ini; i+1 < len(l.d); i++ {
		if l.d[i] == 'E' && l.d[i+1] == 'I' && (i == ini || esEspacioPDF(l.d[i-1])) && (i+2 >= len(l.d) || esEspacioPDF(l.d[i+2])) {
			l.p = i + 2
			return
		}
	}
	l.p = len(l.d)
}

func (in *interprete) xobjeto(nom string, res pdfDict, gs estadoGraf, prof int) {
	xo := in.p.dict(res["XObject"])
	if xo == nil {
		return
	}
	st, ok := in.p.res(xo[nom]).(*pdfStream)
	if !ok {
		return
	}
	switch in.p.nom(st.dict["Subtype"]) {
	case "Image":
		in.hayImagen = true
		w, _ := in.p.ent(st.dict["Width"])
		h, _ := in.p.ent(st.dict["Height"])
		in.imagenes = append(in.imagenes, imagenPDF{st, w, h})
	case "Form":
		if in.forms[st] {
			return
		}
		in.forms[st] = true
		defer delete(in.forms, st)
		datos, _, err := in.p.decodificarStream(st)
		if err != nil {
			return
		}
		nuevo := gs
		if m := in.p.numeros(st.dict["Matrix"]); len(m) == 6 {
			nuevo.ctm = matPDF{m[0], m[1], m[2], m[3], m[4], m[5]}.por(gs.ctm)
		}
		r := in.p.dict(st.dict["Resources"])
		if r == nil {
			r = res
		}
		in.contenido(datos, r, nuevo, prof+1)
	}
}

func (in *interprete) mostrar(s []byte, gs *estadoGraf, tm *matPDF) {
	f := gs.fuente
	cods := f.codigos(s)
	if len(cods) == 0 {
		return
	}
	th := gs.tz
	var b strings.Builder
	x0, y0 := tm.por(gs.ctm).punto(0, gs.ts)
	m := tm.por(gs.ctm)
	escalaV := math.Hypot(m[2], m[3]) * math.Abs(gs.tamF)
	for _, c := range cods {
		b.WriteString(f.unicode(c))
		w := f.ancho(c) / 1000 * gs.tamF
		extra := gs.tc
		if c == 32 && !f.cid {
			extra += gs.tw
		}
		tx := (w + extra) * th
		*tm = matPDF{1, 0, 0, 1, tx, 0}.por(*tm)
	}
	x1, y1 := tm.por(gs.ctm).punto(0, gs.ts)
	ax, ay := in.pagina(x0, y0)
	bx, by := in.pagina(x1, y1)
	txt := b.String()
	if txt == "" {
		return
	}
	in.frags = append(in.frags, fragmento{x: ax, y: ay, finX: bx, t: txt, pt: escalaV, b: f.negrita, i: f.cursiva, fuente: f, horiz: math.Abs(by-ay) <= 0.05*math.Max(escalaV, 1) && bx >= ax})
}

func mismaFuente(a, b *fragmento) bool {
	return a.fuente == b.fuente || (a.fuente.nombre == b.fuente.nombre && a.b == b.b && a.i == b.i)
}

func redondear2(v float64) float64 { return math.Round(v*100) / 100 }

// agrupar fusiona los fragmentos contiguos de una misma línea y fuente.
func agrupar(frags []fragmento) []TextoPdf {
	salida := []TextoPdf{}
	var act *fragmento
	emitir := func() {
		if act != nil && strings.TrimSpace(act.t) != "" {
			t := TextoPdf{X: redondear2(act.x), Y: redondear2(act.y), T: act.t, Pt: redondear2(act.pt)}
			if act.b {
				t.B = 1
			}
			if act.i {
				t.I = 1
			}
			salida = append(salida, t)
		}
		act = nil
	}
	for i := range frags {
		f := frags[i]
		if act != nil && act.horiz && f.horiz && mismaFuente(act, &f) && math.Abs(act.pt-f.pt) < 0.1 && math.Abs(act.y-f.y) < 0.25*math.Max(f.pt, 1) {
			hueco := f.x - act.finX
			if hueco > -0.6*f.pt && hueco < 4*f.pt {
				if hueco > 0.25*f.pt && !strings.HasSuffix(act.t, " ") && !strings.HasPrefix(f.t, " ") {
					act.t += " "
				}
				act.t += f.t
				act.finX = f.finX
				continue
			}
		}
		emitir()
		c := f
		act = &c
	}
	emitir()
	return salida
}

func (p *lectorPDF) contenidoDe(d pdfDict) []byte {
	var b bytes.Buffer
	agregar := func(x any) {
		if st, ok := p.res(x).(*pdfStream); ok {
			if datos, _, err := p.decodificarStream(st); err == nil {
				b.Write(datos)
				b.WriteByte('\n')
			}
		}
	}
	switch c := p.res(d["Contents"]).(type) {
	case []any:
		for _, x := range c {
			agregar(x)
		}
	default:
		agregar(d["Contents"])
	}
	return b.Bytes()
}

// interpretar corre el contenido de una página en coordenadas de salida.
func (p *lectorPDF) interpretar(pg paginaInfo) (*interprete, float64, float64) {
	x0, y0 := math.Min(pg.media[0], pg.media[2]), math.Min(pg.media[1], pg.media[3])
	w, h := math.Abs(pg.media[2]-pg.media[0]), math.Abs(pg.media[3]-pg.media[1])
	rot := ((pg.rotacion % 360) + 360) % 360
	var tr func(x, y float64) (float64, float64)
	salW, salH := w, h
	switch rot {
	case 90:
		salW, salH = h, w
		tr = func(x, y float64) (float64, float64) { return y - y0, x - x0 }
	case 180:
		tr = func(x, y float64) (float64, float64) { return w - (x - x0), y - y0 }
	case 270:
		salW, salH = h, w
		tr = func(x, y float64) (float64, float64) { return h - (y - y0), w - (x - x0) }
	default:
		tr = func(x, y float64) (float64, float64) { return x - x0, h - (y - y0) }
	}
	in := &interprete{p: p, pagina: tr, forms: map[*pdfStream]bool{}}
	gs := estadoGraf{ctm: identidadM, tz: 1}
	res := pg.recursos
	if res == nil {
		res = pdfDict{}
	}
	in.contenido(p.contenidoDe(pg.dict), res, gs, 0)
	return in, salW, salH
}

func abrirPdf(d []byte) (any, error) {
	p, err := abrirLectorPDF(d)
	if err != nil {
		return nil, err
	}
	pags := p.paginas(maxPaginasPdf + 1)
	doc := DocPdf{Tipo: "pdf", Firma: sha256Hex(d), Paginas: []PaginaPdf{}}
	if len(pags) > maxPaginasPdf {
		pags = pags[:maxPaginasPdf]
		doc.Aviso = fmt.Sprintf("Solo se muestran las primeras %d páginas.", maxPaginasPdf)
	}
	tam := 0
	for i, pg := range pags {
		pagina := PaginaPdf{Textos: []TextoPdf{}}
		func() {
			defer func() {
				if r := recover(); r != nil {
					doc.Aviso = "Algunas páginas están dañadas y se omitió su contenido."
				}
			}()
			in, w, h := p.interpretar(pg)
			pagina.W, pagina.H = redondear2(w), redondear2(h)
			pagina.Textos = agrupar(in.frags)
			if len(pagina.Textos) == 0 && in.hayImagen {
				pagina.SoloImagen = 1
			}
		}()
		s, err := aJSON(pagina)
		if err != nil {
			return nil, err
		}
		tam += len(s)
		if tam > limiteDocumento-64*1024 {
			doc.Aviso = fmt.Sprintf("El PDF es muy grande: solo se muestran las primeras %d páginas.", i)
			break
		}
		doc.Paginas = append(doc.Paginas, pagina)
	}
	return doc, nil
}

// ---- Raster de página ----

const msgSinPdftoppm = "no se puede dibujar esta página sin pdftoppm"

func rasterPdf(ruta string, d []byte, n, cols, filas int) (any, error) {
	p, err := abrirLectorPDF(d)
	if err != nil {
		return nil, err
	}
	pags := p.paginas(n + 1)
	if n >= len(pags) {
		return nil, fmt.Errorf("el PDF no tiene la página %d", n)
	}
	pg := pags[n]
	in, w, h := p.interpretar(pg)
	if img, ok := rasterConPdftoppm(ruta, n, w, h, cols, filas); ok {
		return dibujar(img, cols, filas), nil
	}
	img, err := p.imagenMayor(in.imagenes)
	if err != nil {
		return nil, err
	}
	return dibujar(img, cols, filas), nil
}

func (p *lectorPDF) imagenMayor(ims []imagenPDF) (image.Image, error) {
	sinImagen := errors.New(msgSinPdftoppm)
	if len(ims) == 0 {
		return nil, sinImagen
	}
	mejor := ims[0]
	for _, i := range ims {
		if i.w*i.h > mejor.w*mejor.h {
			mejor = i
		}
	}
	if int64(mejor.w)*int64(mejor.h) > maxPixeles {
		return nil, errors.New("la imagen es demasiado grande")
	}
	datos, filtro, err := p.decodificarStream(mejor.st)
	if err != nil {
		return nil, sinImagen
	}
	switch filtro {
	case "DCTDecode", "DCT":
		img, err := decodificarImagen(datos, ".jpg")
		if err != nil {
			return nil, sinImagen
		}
		return img, nil
	case "":
	default:
		return nil, sinImagen
	}
	return p.imagenCruda(mejor, datos)
}

// imagenCruda arma una imagen RGB o de grises a partir de muestras sin comprimir.
func (p *lectorPDF) imagenCruda(im imagenPDF, datos []byte) (image.Image, error) {
	sinImagen := errors.New(msgSinPdftoppm)
	bits, _ := p.ent(im.st.dict["BitsPerComponent"])
	if bits == 0 {
		bits = 8
	}
	cs := p.res(im.st.dict["ColorSpace"])
	componentes := 0
	var paleta []byte
	switch v := cs.(type) {
	case pdfNombre:
		switch v {
		case "DeviceRGB", "RGB", "CalRGB":
			componentes = 3
		case "DeviceGray", "G", "CalGray":
			componentes = 1
		}
	case []any:
		if len(v) == 0 {
			break
		}
		switch p.nom(v[0]) {
		case "ICCBased":
			if len(v) > 1 {
				if n, ok := p.ent(p.dict(v[1])["N"]); ok && (n == 1 || n == 3) {
					componentes = n
				}
			}
		case "CalRGB":
			componentes = 3
		case "CalGray":
			componentes = 1
		case "Indexed", "I":
			if len(v) >= 4 && bits == 8 {
				switch t := p.res(v[3]).(type) {
				case pdfCadena:
					paleta = t
				case *pdfStream:
					paleta, _, _ = p.decodificarStream(t)
				}
				componentes = 1
			}
		}
	}
	if componentes == 0 || (bits != 8 && !(bits == 1 && componentes == 1)) {
		return nil, sinImagen
	}
	img := image.NewRGBA(image.Rect(0, 0, im.w, im.h))
	if bits == 1 {
		fila := (im.w + 7) / 8
		for y := range im.h {
			for x := range im.w {
				i := y*fila + x/8
				if i >= len(datos) {
					continue
				}
				v := uint8(0)
				if datos[i]&(0x80>>uint(x%8)) != 0 {
					v = 255
				}
				img.SetRGBA(x, y, color.RGBA{v, v, v, 255})
			}
		}
		return img, nil
	}
	fila := im.w * componentes
	for y := range im.h {
		for x := range im.w {
			i := y*fila + x*componentes
			if i+componentes > len(datos) {
				continue
			}
			var c color.RGBA
			switch {
			case paleta != nil:
				j := int(datos[i]) * 3
				if j+3 <= len(paleta) {
					c = color.RGBA{paleta[j], paleta[j+1], paleta[j+2], 255}
				}
			case componentes == 3:
				c = color.RGBA{datos[i], datos[i+1], datos[i+2], 255}
			default:
				c = color.RGBA{datos[i], datos[i], datos[i], 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img, nil
}
