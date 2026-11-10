package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Tope de lectura de una parte de un zip (defensa ante bombas de compresión).
const limiteParte = 512 * 1024 * 1024

// Tope de profundidad del XML, para no agotar la pila.
const limiteProfundidad = 4000

func sha256Hex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func leerArchivo(ruta string) ([]byte, error) {
	d, err := os.ReadFile(ruta)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("no se encontró el archivo: %s", ruta)
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, fmt.Errorf("sin permiso para leer el archivo: %s", ruta)
		}
		return nil, fmt.Errorf("no se pudo leer el archivo: %v", err)
	}
	return d, nil
}

// ---- ZIP ----

type archivoZip struct {
	r         *zip.Reader
	porNombre map[string]*zip.File
}

func abrirZip(datos []byte) (*archivoZip, error) {
	r, err := zip.NewReader(bytes.NewReader(datos), int64(len(datos)))
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		return nil, errors.New("el archivo no es un documento válido (zip dañado)")
	}
	a := &archivoZip{r: r, porNombre: map[string]*zip.File{}}
	for _, f := range r.File {
		a.porNombre[f.Name] = f
	}
	return a, nil
}

func (a *archivoZip) existe(nombre string) bool {
	_, ok := a.porNombre[nombre]
	return ok
}

func (a *archivoZip) leer(nombre string) ([]byte, error) {
	f, ok := a.porNombre[nombre]
	if !ok {
		return nil, fmt.Errorf("el documento no contiene %s", nombre)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer %s: %v", nombre, err)
	}
	defer rc.Close()
	d, err := io.ReadAll(io.LimitReader(rc, limiteParte+1))
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer %s: %v", nombre, err)
	}
	if len(d) > limiteParte {
		return nil, fmt.Errorf("la parte %s es demasiado grande", nombre)
	}
	return d, nil
}

// leerOpc devuelve nil si la parte no existe o no se puede leer.
func (a *archivoZip) leerOpc(nombre string) []byte {
	if !a.existe(nombre) {
		return nil
	}
	d, err := a.leer(nombre)
	if err != nil {
		return nil
	}
	return d
}

// reempacar copia en crudo las entradas, cambia las indicadas y omite las quitadas.
func (a *archivoZip) reempacar(cambios map[string][]byte, quitar map[string]bool) ([]byte, error) {
	var sal bytes.Buffer
	w := zip.NewWriter(&sal)
	for _, f := range a.r.File {
		if quitar[f.Name] {
			continue
		}
		nuevo, cambia := cambios[f.Name]
		if !cambia {
			if err := w.Copy(f); err != nil {
				return nil, fmt.Errorf("no se pudo copiar %s: %v", f.Name, err)
			}
			continue
		}
		h := &zip.FileHeader{Name: f.Name, Method: f.Method, Comment: f.Comment, NonUTF8: f.NonUTF8, Modified: f.Modified, ExternalAttrs: f.ExternalAttrs, CreatorVersion: f.CreatorVersion}
		dst, err := w.CreateHeader(h)
		if err != nil {
			return nil, err
		}
		if _, err := dst.Write(nuevo); err != nil {
			return nil, err
		}
	}
	if a.r.Comment != "" {
		if err := w.SetComment(a.r.Comment); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return sal.Bytes(), nil
}

// verificarZip lee todas las entradas (comprueba CRC) del zip generado.
func verificarZip(datos []byte) error {
	r, err := zip.NewReader(bytes.NewReader(datos), int64(len(datos)))
	if err != nil {
		return fmt.Errorf("el zip generado no es válido: %v", err)
	}
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("el zip generado no es válido: %v", err)
		}
		_, err = io.Copy(io.Discard, rc)
		rc.Close()
		if err != nil {
			return fmt.Errorf("el zip generado no es válido en %s: %v", f.Name, err)
		}
	}
	return nil
}

// ---- Relaciones OPC ----

type relacion struct {
	id, tipo, destino string
	externo           bool
}

func rutaRels(parte string) string {
	return path.Join(path.Dir(parte), "_rels", path.Base(parte)+".rels")
}

func resolverDestino(parte, destino string) string {
	if strings.HasPrefix(destino, "/") {
		return strings.TrimPrefix(destino, "/")
	}
	return path.Join(path.Dir(parte), destino)
}

// leerRels devuelve las relaciones de una parte, por Id y en orden.
func (a *archivoZip) leerRels(parte string) (map[string]relacion, []relacion) {
	m := map[string]relacion{}
	var lista []relacion
	d := a.leerOpc(rutaRels(parte))
	if d == nil {
		return m, lista
	}
	raiz, err := parsearXML(d)
	if err != nil || raiz == nil {
		return m, lista
	}
	for _, h := range raiz.hijos {
		if h.nom != "Relationship" {
			continue
		}
		r := relacion{id: h.val("Id"), tipo: h.val("Type"), destino: h.val("Target"), externo: strings.EqualFold(h.val("TargetMode"), "External")}
		if !r.externo {
			r.destino = resolverDestino(parte, r.destino)
		}
		m[r.id] = r
		lista = append(lista, r)
	}
	return m, lista
}

func relPorTipo(lista []relacion, sufijo string) (relacion, bool) {
	for _, r := range lista {
		if strings.HasSuffix(r.tipo, sufijo) {
			return r, true
		}
	}
	return relacion{}, false
}

// parteRaiz localiza el documento principal desde _rels/.rels.
func (a *archivoZip) parteRaiz(porDefecto string) string {
	if a.existe(porDefecto) {
		return porDefecto
	}
	d := a.leerOpc("_rels/.rels")
	if d != nil {
		if raiz, err := parsearXML(d); err == nil && raiz != nil {
			for _, h := range raiz.hijos {
				if strings.HasSuffix(h.val("Type"), "/officeDocument") {
					return strings.TrimPrefix(h.val("Target"), "/")
				}
			}
		}
	}
	return porDefecto
}

// ---- XML con posiciones ----

type nodo struct {
	esp, nom string
	attrs    []xml.Attr
	hijos    []*nodo
	padre    *nodo
	txt      []byte
	ini, fin int // elemento completo
	iniC     int // tras la etiqueta de apertura
	finC     int // antes de la etiqueta de cierre
}

func (n *nodo) attr(local string) (string, bool) {
	for _, a := range n.attrs {
		if a.Name.Local == local && a.Name.Space != "xmlns" {
			return a.Value, true
		}
	}
	return "", false
}

func (n *nodo) val(local string) string {
	v, _ := n.attr(local)
	return v
}

// attrRel busca un atributo del espacio de relaciones (r:id, r:embed...).
func (n *nodo) attrRel(local string) string {
	for _, a := range n.attrs {
		if a.Name.Local == local && strings.Contains(a.Name.Space, "relationships") {
			return a.Value
		}
	}
	return ""
}

func (n *nodo) hijo(nom string) *nodo {
	if n == nil {
		return nil
	}
	for _, h := range n.hijos {
		if h.nom == nom {
			return h
		}
	}
	return nil
}

func (n *nodo) hijosN(nom string) []*nodo {
	if n == nil {
		return nil
	}
	var r []*nodo
	for _, h := range n.hijos {
		if h.nom == nom {
			r = append(r, h)
		}
	}
	return r
}

// camino baja por hijos sucesivos; nil si falta alguno.
func (n *nodo) camino(noms ...string) *nodo {
	for _, s := range noms {
		n = n.hijo(s)
	}
	return n
}

func (n *nodo) buscar(nom string) *nodo {
	if n == nil {
		return nil
	}
	for _, h := range n.hijos {
		if h.nom == nom {
			return h
		}
		if r := h.buscar(nom); r != nil {
			return r
		}
	}
	return nil
}

func (n *nodo) texto() string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	var rec func(m *nodo)
	rec = func(m *nodo) {
		b.Write(m.txt)
		for _, h := range m.hijos {
			rec(h)
		}
	}
	rec(n)
	return b.String()
}

func (n *nodo) autoCierre() bool {
	return n.fin == n.iniC
}

// normalizarXML pasa a UTF-8 las partes que llegan en UTF-16.
func normalizarXML(d []byte) []byte {
	if len(d) >= 2 && ((d[0] == 0xFF && d[1] == 0xFE) || (d[0] == 0xFE && d[1] == 0xFF)) {
		s := decodificarUTF16(d[2:], d[0] == 0xFF)
		return []byte(s)
	}
	return d
}

func lectorCharset(charset string, entrada io.Reader) (io.Reader, error) {
	switch strings.ToLower(charset) {
	case "utf-8", "utf8", "us-ascii", "ascii":
		return entrada, nil
	case "windows-1252", "cp1252", "iso-8859-1", "latin1", "latin-1":
		d, err := io.ReadAll(entrada)
		if err != nil {
			return nil, err
		}
		return strings.NewReader(decodificarLatin1(d)), nil
	case "utf-16", "utf-16le", "utf-16be":
		// Ya normalizado a UTF-8 al quitar el BOM.
		return entrada, nil
	}
	return nil, fmt.Errorf("codificación XML no soportada: %s", charset)
}

func nuevoDecoder(d []byte) *xml.Decoder {
	dec := xml.NewDecoder(bytes.NewReader(d))
	dec.CharsetReader = lectorCharset
	dec.Entity = xml.HTMLEntity
	return dec
}

// parsearXML construye el árbol con los offsets de bytes de cada elemento.
func parsearXML(datos []byte) (*nodo, error) {
	datos = normalizarXML(datos)
	dec := nuevoDecoder(datos)
	var raiz, actual *nodo
	prof := 0
	for {
		ini := int(dec.InputOffset())
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("XML dañado: %v", err)
		}
		fin := int(dec.InputOffset())
		switch t := tok.(type) {
		case xml.StartElement:
			prof++
			if prof > limiteProfundidad {
				return nil, errors.New("XML demasiado anidado")
			}
			n := &nodo{esp: t.Name.Space, nom: t.Name.Local, attrs: t.Copy().Attr, ini: ini, iniC: fin, padre: actual}
			if actual != nil {
				actual.hijos = append(actual.hijos, n)
			} else if raiz == nil {
				raiz = n
			}
			actual = n
		case xml.EndElement:
			if actual == nil {
				return nil, errors.New("XML dañado")
			}
			actual.finC = ini
			actual.fin = fin
			actual = actual.padre
			prof--
		case xml.CharData:
			if actual != nil {
				actual.txt = append(actual.txt, t...)
			}
		}
	}
	if actual != nil || raiz == nil {
		return nil, errors.New("XML incompleto")
	}
	return raiz, nil
}

// prefijoCrudo devuelve el prefijo real de la etiqueta que empieza en `ini`.
func prefijoCrudo(datos []byte, ini int) string {
	i := ini + 1
	j := i
	for j < len(datos) && !strings.ContainsRune(" \t\r\n/>", rune(datos[j])) {
		if datos[j] == ':' {
			return string(datos[i:j])
		}
		j++
	}
	return ""
}

// ---- Ediciones por rangos de bytes ----

type edicion struct {
	ini, fin int
	txt      []byte
}

func aplicarEdiciones(datos []byte, eds []edicion) ([]byte, error) {
	sort.SliceStable(eds, func(i, j int) bool { return eds[i].ini < eds[j].ini })
	var b bytes.Buffer
	pos := 0
	for _, e := range eds {
		if e.ini < pos || e.fin < e.ini || e.fin > len(datos) {
			return nil, errors.New("ediciones solapadas: documento inesperado")
		}
		b.Write(datos[pos:e.ini])
		b.Write(e.txt)
		pos = e.fin
	}
	b.Write(datos[pos:])
	return b.Bytes(), nil
}

// comprobarXML verifica que el XML esté bien formado.
func comprobarXML(d []byte) error {
	_, err := parsearXML(d)
	return err
}

// escaparXML escapa texto o atributo y descarta caracteres ilegales en XML 1.0.
func escaparXML(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '&':
			b.WriteString("&amp;")
		case r == '<':
			b.WriteString("&lt;")
		case r == '>':
			b.WriteString("&gt;")
		case r == '"':
			b.WriteString("&quot;")
		case r == '\t' || r == '\n' || r == '\r':
			b.WriteRune(r)
		case r < 0x20 || r == 0xFFFE || r == 0xFFFF:
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ---- Decodificación básica ----

func decodificarUTF16(d []byte, le bool) string {
	n := len(d) / 2
	u := make([]uint16, n)
	for i := range n {
		if le {
			u[i] = uint16(d[2*i]) | uint16(d[2*i+1])<<8
		} else {
			u[i] = uint16(d[2*i])<<8 | uint16(d[2*i+1])
		}
	}
	return string(utf16.Decode(u))
}

// Windows-1252 en 0x80..0x9F; los huecos conservan su valor para ida y vuelta.
var tabla1252 = [32]rune{0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178}

func decodificarLatin1(d []byte) string {
	var b strings.Builder
	b.Grow(len(d) + len(d)/8)
	for _, c := range d {
		if c >= 0x80 && c < 0xA0 {
			b.WriteRune(tabla1252[c-0x80])
		} else {
			b.WriteRune(rune(c))
		}
	}
	return b.String()
}

func codificarLatin1(s string) ([]byte, error) {
	r := make([]byte, 0, len(s))
	for _, c := range s {
		if c < 0x80 || (c >= 0xA0 && c <= 0xFF) {
			r = append(r, byte(c))
			continue
		}
		ok := false
		for i, t := range tabla1252 {
			if t == c {
				r = append(r, byte(0x80+i))
				ok = true
				break
			}
		}
		if !ok {
			return nil, fmt.Errorf("el carácter %q no se puede guardar en codificación latin1", string(c))
		}
	}
	return r, nil
}

func validoUTF8(d []byte) bool {
	return utf8.Valid(d)
}
