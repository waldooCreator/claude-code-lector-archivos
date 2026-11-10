package main

import (
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

func sortInts(r []int) { sort.Ints(r) }

// fuentePDF traduce códigos a Unicode y conoce los anchos.
type fuentePDF struct {
	nombre       string
	cid          bool
	toUni        map[uint32]string
	enc          [256]string
	anchos       map[int]float64
	anchoDefecto float64
	negrita      bool
	cursiva      bool
	identidad    bool
}

// Windows-1252 coincide con WinAnsi.
func baseWinAnsi() [256]string {
	var t [256]string
	for i := 0x20; i < 256; i++ {
		switch {
		case i >= 0x80 && i < 0xA0:
			t[i] = string(tabla1252[i-0x80])
		case i != 0x7F:
			t[i] = string(rune(i))
		}
	}
	return t
}

var tablaMac = []rune("ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ")

func baseMac() [256]string {
	var t [256]string
	for i := 0x20; i < 0x7F; i++ {
		t[i] = string(rune(i))
	}
	for i, r := range tablaMac {
		if 0x80+i < 256 {
			t[0x80+i] = string(r)
		}
	}
	return t
}

func baseEstandar() [256]string {
	var t [256]string
	for i := 0x20; i < 0x7F; i++ {
		t[i] = string(rune(i))
	}
	t[0x27], t[0x60] = "’", "‘"
	alto := map[int]string{0xA1: "¡", 0xA2: "¢", 0xA3: "£", 0xA4: "⁄", 0xA5: "¥", 0xA6: "ƒ", 0xA7: "§", 0xA8: "¤", 0xA9: "'", 0xAA: "“", 0xAB: "«", 0xAC: "‹", 0xAD: "›", 0xAE: "ﬁ", 0xAF: "ﬂ", 0xB1: "–", 0xB2: "†", 0xB3: "‡", 0xB4: "·", 0xB6: "¶", 0xB7: "•", 0xB8: "‚", 0xB9: "„", 0xBA: "”", 0xBB: "»", 0xBC: "…", 0xBD: "‰", 0xBF: "¿", 0xC1: "`", 0xC2: "´", 0xC3: "ˆ", 0xC4: "˜", 0xC5: "¯", 0xC6: "˘", 0xC7: "˙", 0xC8: "¨", 0xCA: "˚", 0xCB: "¸", 0xCD: "˝", 0xCE: "˛", 0xCF: "ˇ", 0xD0: "—", 0xE1: "Æ", 0xE3: "ª", 0xE8: "Ł", 0xE9: "Ø", 0xEA: "Œ", 0xEB: "º", 0xF1: "æ", 0xF5: "ı", 0xF8: "ł", 0xF9: "ø", 0xFA: "œ", 0xFB: "ß"}
	for k, v := range alto {
		t[k] = v
	}
	return t
}

// Nombres de glifo comunes (subconjunto de Adobe Glyph List).
var glifos = map[string]string{
	"space": " ", "exclam": "!", "quotedbl": "\"", "numbersign": "#", "dollar": "$", "percent": "%", "ampersand": "&", "quotesingle": "'", "quoteright": "’", "parenleft": "(", "parenright": ")", "asterisk": "*", "plus": "+", "comma": ",", "hyphen": "-", "minus": "−", "period": ".", "slash": "/",
	"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
	"colon": ":", "semicolon": ";", "less": "<", "equal": "=", "greater": ">", "question": "?", "at": "@", "bracketleft": "[", "backslash": "\\", "bracketright": "]", "asciicircum": "^", "underscore": "_", "grave": "`", "quoteleft": "‘", "braceleft": "{", "bar": "|", "braceright": "}", "asciitilde": "~",
	"exclamdown": "¡", "cent": "¢", "sterling": "£", "currency": "¤", "yen": "¥", "brokenbar": "¦", "section": "§", "dieresis": "¨", "copyright": "©", "ordfeminine": "ª", "guillemotleft": "«", "logicalnot": "¬", "registered": "®", "macron": "¯", "degree": "°", "plusminus": "±", "twosuperior": "²", "threesuperior": "³", "acute": "´", "mu": "µ", "paragraph": "¶", "periodcentered": "·", "cedilla": "¸", "onesuperior": "¹", "ordmasculine": "º", "guillemotright": "»", "onequarter": "¼", "onehalf": "½", "threequarters": "¾", "questiondown": "¿",
	"multiply": "×", "divide": "÷", "germandbls": "ß", "AE": "Æ", "ae": "æ", "OE": "Œ", "oe": "œ", "Oslash": "Ø", "oslash": "ø", "Eth": "Ð", "eth": "ð", "Thorn": "Þ", "thorn": "þ", "dotlessi": "ı", "fi": "fi", "fl": "fl", "ff": "ff", "ffi": "ffi", "ffl": "ffl",
	"bullet": "•", "endash": "–", "emdash": "—", "ellipsis": "…", "dagger": "†", "daggerdbl": "‡", "perthousand": "‰", "quotedblleft": "“", "quotedblright": "”", "quotesinglbase": "‚", "quotedblbase": "„", "guilsinglleft": "‹", "guilsinglright": "›", "fraction": "⁄", "Euro": "€", "trademark": "™", "florin": "ƒ", "circumflex": "ˆ", "tilde": "˜", "caron": "ˇ", "breve": "˘", "dotaccent": "˙", "ring": "˚", "hungarumlaut": "˝", "ogonek": "˛", "nbspace": " ", "sfthyphen": "­",
}

// Combinaciones letra + acento.
var acentos = map[string]map[string]string{
	"acute":      {"a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú", "y": "ý", "A": "Á", "E": "É", "I": "Í", "O": "Ó", "U": "Ú", "Y": "Ý", "c": "ć", "C": "Ć", "n": "ń", "N": "Ń", "s": "ś", "S": "Ś", "z": "ź", "Z": "Ź"},
	"grave":      {"a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù", "A": "À", "E": "È", "I": "Ì", "O": "Ò", "U": "Ù"},
	"circumflex": {"a": "â", "e": "ê", "i": "î", "o": "ô", "u": "û", "A": "Â", "E": "Ê", "I": "Î", "O": "Ô", "U": "Û"},
	"dieresis":   {"a": "ä", "e": "ë", "i": "ï", "o": "ö", "u": "ü", "y": "ÿ", "A": "Ä", "E": "Ë", "I": "Ï", "O": "Ö", "U": "Ü", "Y": "Ÿ"},
	"tilde":      {"a": "ã", "n": "ñ", "o": "õ", "A": "Ã", "N": "Ñ", "O": "Õ"},
	"ring":       {"a": "å", "A": "Å", "u": "ů", "U": "Ů"},
	"cedilla":    {"c": "ç", "C": "Ç"},
	"caron":      {"c": "č", "C": "Č", "s": "š", "S": "Š", "z": "ž", "Z": "Ž", "e": "ě", "E": "Ě", "r": "ř", "R": "Ř", "n": "ň", "N": "Ň"},
}

func glifoAUnicode(nom string) string {
	if nom == "" || nom == ".notdef" {
		return ""
	}
	if s, ok := glifos[nom]; ok {
		return s
	}
	if len(nom) == 1 {
		return nom
	}
	for acento, m := range acentos {
		if strings.HasSuffix(nom, acento) {
			if s, ok := m[strings.TrimSuffix(nom, acento)]; ok {
				return s
			}
		}
	}
	if strings.HasPrefix(nom, "uni") && len(nom) >= 7 {
		if v, err := strconv.ParseUint(nom[3:7], 16, 32); err == nil {
			return string(rune(v))
		}
	}
	if strings.HasPrefix(nom, "u") && len(nom) >= 5 {
		if v, err := strconv.ParseUint(nom[1:], 16, 32); err == nil {
			return string(rune(v))
		}
	}
	if i := strings.IndexByte(nom, '.'); i > 0 {
		return glifoAUnicode(nom[:i])
	}
	return ""
}

func utf16BE(b []byte) string {
	if len(b)%2 == 1 {
		return string(b)
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	return string(utf16.Decode(u))
}

func codigoDe(b []byte) uint32 {
	var v uint32
	for _, c := range b {
		v = v<<8 | uint32(c)
	}
	return v
}

// parsearCMap interpreta los bfchar y bfrange de un ToUnicode.
func parsearCMap(d []byte) map[uint32]string {
	m := map[uint32]string{}
	l := &lexPDF{d: d}
	const maxEntradas = 200000
	for len(m) < maxEntradas {
		v, ok := l.objeto()
		if !ok {
			break
		}
		op, es := v.(pdfOp)
		if !es {
			continue
		}
		switch op {
		case "beginbfchar":
			for {
				a, ok := l.objeto()
				if !ok {
					return m
				}
				if o, es := a.(pdfOp); es && o == "endbfchar" {
					break
				}
				sa, okA := a.(pdfCadena)
				b, _ := l.objeto()
				sb, okB := b.(pdfCadena)
				if okA && okB {
					m[codigoDe(sa)] = utf16BE(sb)
				}
			}
		case "beginbfrange":
			for {
				a, ok := l.objeto()
				if !ok {
					return m
				}
				if o, es := a.(pdfOp); es && o == "endbfrange" {
					break
				}
				sa, okA := a.(pdfCadena)
				b, _ := l.objeto()
				sb, okB := b.(pdfCadena)
				c, _ := l.objeto()
				if !okA || !okB {
					continue
				}
				lo, hi := codigoDe(sa), codigoDe(sb)
				if hi < lo || hi-lo > 65535 {
					continue
				}
				switch dst := c.(type) {
				case pdfCadena:
					base := []byte(dst)
					for k := lo; k <= hi && len(m) < maxEntradas; k++ {
						rel := append([]byte{}, base...)
						if len(rel) >= 2 {
							v := uint32(rel[len(rel)-2])<<8 | uint32(rel[len(rel)-1])
							v += k - lo
							rel[len(rel)-2], rel[len(rel)-1] = byte(v>>8), byte(v)
						} else if len(rel) == 1 {
							rel[0] += byte(k - lo)
						}
						m[k] = utf16BE(rel)
					}
				case []any:
					for i, x := range dst {
						if s, ok := x.(pdfCadena); ok && uint32(i) <= hi-lo {
							m[lo+uint32(i)] = utf16BE(s)
						}
					}
				}
			}
		}
	}
	return m
}

func quitarSubconjunto(n string) string {
	if len(n) > 7 && n[6] == '+' {
		return n[7:]
	}
	return n
}

// cargarFuente construye la fuente; se guarda en caché si viene por referencia.
func (p *lectorPDF) cargarFuente(x any) *fuentePDF {
	r, esRef := x.(pdfRef)
	if esRef {
		if f, ok := p.fuentes[r.n]; ok {
			return f
		}
	}
	d := p.dict(x)
	f := &fuentePDF{anchos: map[int]float64{}, anchoDefecto: 500}
	if d == nil {
		return f
	}
	sub := p.nom(d["Subtype"])
	f.nombre = quitarSubconjunto(p.nom(d["BaseFont"]))
	desc := p.dict(d["FontDescriptor"])
	if sub == "Type0" {
		f.cid = true
		f.anchoDefecto = 1000
		f.identidad = strings.HasPrefix(p.nom(d["Encoding"]), "Identity") || p.nom(d["Encoding"]) == ""
		if arr := p.arr(d["DescendantFonts"]); len(arr) > 0 {
			hijo := p.dict(arr[0])
			if hijo != nil {
				if v, ok := p.num(hijo["DW"]); ok {
					f.anchoDefecto = v
				}
				p.leerW(f, hijo["W"])
				if desc == nil {
					desc = p.dict(hijo["FontDescriptor"])
				}
			}
		}
	} else {
		if ch, ok := p.ent(d["FirstChar"]); ok {
			for i, w := range p.numeros(d["Widths"]) {
				f.anchos[ch+i] = w
			}
		}
		if desc != nil {
			if v, ok := p.num(desc["MissingWidth"]); ok && v > 0 {
				f.anchoDefecto = v
			}
		}
		p.cargarCodificacion(f, d, sub)
		// En Type3 los anchos van en espacio de glifo, según FontMatrix.
		if m := p.numeros(d["FontMatrix"]); sub == "Type3" && len(m) >= 1 && m[0] != 0 {
			for k, w := range f.anchos {
				f.anchos[k] = w * m[0] * 1000
			}
		}
	}
	if st, ok := p.res(d["ToUnicode"]).(*pdfStream); ok {
		if datos, _, err := p.decodificarStream(st); err == nil {
			f.toUni = parsearCMap(datos)
		}
	}
	nombre := f.nombre
	if desc != nil {
		if n := p.nom(desc["FontName"]); n != "" {
			nombre = quitarSubconjunto(n)
		}
		if v, ok := p.ent(desc["Flags"]); ok {
			if v&64 != 0 {
				f.cursiva = true
			}
			if v&(1<<18) != 0 {
				f.negrita = true
			}
		}
	}
	bajo := strings.ToLower(nombre)
	if strings.Contains(bajo, "bold") || strings.Contains(bajo, "black") {
		f.negrita = true
	}
	if strings.Contains(bajo, "italic") || strings.Contains(bajo, "oblique") {
		f.cursiva = true
	}
	if esRef {
		p.fuentes[r.n] = f
	}
	return f
}

func (p *lectorPDF) leerW(f *fuentePDF, x any) {
	a := p.arr(x)
	for i := 0; i < len(a); {
		c, ok := p.ent(a[i])
		if !ok || i+1 >= len(a) {
			return
		}
		switch sig := p.res(a[i+1]).(type) {
		case []any:
			for k, w := range sig {
				f.anchos[c+k], _ = p.num(w)
			}
			i += 2
		default:
			if i+2 >= len(a) {
				return
			}
			fin, _ := p.ent(a[i+1])
			w, _ := p.num(a[i+2])
			if fin-c < 70000 {
				for k := c; k <= fin; k++ {
					f.anchos[k] = w
				}
			}
			i += 3
		}
	}
}

func (p *lectorPDF) cargarCodificacion(f *fuentePDF, d pdfDict, sub string) {
	base := ""
	var dif []any
	switch e := p.res(d["Encoding"]).(type) {
	case pdfNombre:
		base = string(e)
	case pdfDict:
		base = p.nom(e["BaseEncoding"])
		dif = p.arr(e["Differences"])
	}
	switch base {
	case "WinAnsiEncoding":
		f.enc = baseWinAnsi()
	case "MacRomanEncoding":
		f.enc = baseMac()
	case "StandardEncoding":
		f.enc = baseEstandar()
	default:
		if sub == "TrueType" {
			f.enc = baseWinAnsi()
		} else {
			f.enc = baseEstandar()
		}
	}
	cod := 0
	for _, x := range dif {
		switch v := p.res(x).(type) {
		case int:
			cod = v
		case pdfNombre:
			if cod >= 0 && cod < 256 {
				f.enc[cod] = glifoAUnicode(string(v))
			}
			cod++
		}
	}
}

// unicode devuelve el texto de un código.
func (f *fuentePDF) unicode(c uint32) string {
	if s, ok := f.toUni[c]; ok {
		return s
	}
	if f.cid {
		if f.identidad {
			return "�"
		}
		return string(rune(c))
	}
	if c < 256 {
		return f.enc[c]
	}
	return ""
}

func (f *fuentePDF) ancho(c uint32) float64 {
	if w, ok := f.anchos[int(c)]; ok {
		return w
	}
	return f.anchoDefecto
}

// codigos parte una cadena en los códigos de la fuente.
func (f *fuentePDF) codigos(s []byte) []uint32 {
	if f.cid {
		r := make([]uint32, 0, len(s)/2)
		for i := 0; i+1 < len(s); i += 2 {
			r = append(r, uint32(s[i])<<8|uint32(s[i+1]))
		}
		return r
	}
	r := make([]uint32, len(s))
	for i, c := range s {
		r[i] = uint32(c)
	}
	return r
}
