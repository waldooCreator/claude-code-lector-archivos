package main

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type parte struct{ nombre, cuerpo string }

func crearZip(t *testing.T, ruta string, partes []parte) {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, p := range partes {
		f, err := w.Create(p.nombre)
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte(p.cuerpo))
	}
	w.Close()
	if err := os.WriteFile(ruta, b.Bytes(), 0o640); err != nil {
		t.Fatal(err)
	}
}

func correr(t *testing.T, stdin string, args ...string) map[string]any {
	t.Helper()
	sal := ejecutar(args, strings.NewReader(stdin))
	if bytes.Count(sal, []byte("\n")) != 1 || !bytes.HasSuffix(sal, []byte("\n")) {
		t.Fatalf("la salida debe ser una línea: %q", sal)
	}
	var m map[string]any
	if err := json.Unmarshal(sal, &m); err != nil {
		t.Fatalf("JSON inválido: %v\n%s", err, sal)
	}
	return m
}

func abrirOk(t *testing.T, ruta string) map[string]any {
	t.Helper()
	m := correr(t, "", "abrir", ruta)
	if e, hay := m["error"]; hay {
		t.Fatalf("error al abrir %s: %v", ruta, e)
	}
	if len(m["firma"].(string)) != 64 {
		t.Fatalf("firma inválida: %v", m["firma"])
	}
	return m
}

func guardarOk(t *testing.T, ruta string, g map[string]any) map[string]any {
	t.Helper()
	b, _ := json.Marshal(g)
	m := correr(t, string(b), "guardar", ruta)
	if m["ok"] != true {
		t.Fatalf("guardar falló: %v", m)
	}
	if _, err := os.Stat(m["respaldo"].(string)); err != nil {
		t.Fatalf("no existe el respaldo: %v", err)
	}
	return m
}

func leerParteZip(t *testing.T, ruta, nombre string) []byte {
	t.Helper()
	d, err := os.ReadFile(ruta)
	if err != nil {
		t.Fatal(err)
	}
	z, err := abrirZip(d)
	if err != nil {
		t.Fatalf("zip inválido: %v", err)
	}
	b, err := z.leer(nombre)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// ---- DOCX ----

const nsDecl = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`

var parrafosDocx = []string{
	`<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Capítulo uno</w:t></w:r></w:p>`,
	`<w:p w:rsidR="00AA"><w:pPr><w:jc w:val="center"/></w:pPr><w:bookmarkStart w:id="1" w:name="m"/><w:r><w:rPr><w:color w:val="FF0000"/><w:b/></w:rPr><w:t xml:space="preserve">Hola </w:t></w:r><w:r><w:rPr><w:i/><w:highlight w:val="yellow"/></w:rPr><w:t>mundo</w:t><w:tab/><w:t>fin</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>`,
	`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Primero</w:t></w:r></w:p>`,
	`<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Sub</w:t></w:r></w:p>`,
	`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Segundo</w:t></w:r></w:p>`,
	`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Viñeta</w:t></w:r></w:p>`,
	`<w:p><w:r><w:t xml:space="preserve">Enlace: </w:t></w:r><w:hyperlink r:id="rId20"><w:r><w:t>sitio</w:t></w:r></w:hyperlink></w:p>`,
	`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="i" descr="foto"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId21"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
	`<w:p><w:r><w:t>Antes del salto</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>`,
	`<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Una cita</w:t></w:r></w:p>`,
}

func docxBase(cuerpoExtra string) []parte {
	cuerpo := strings.Join(parrafosDocx, "")
	tabla := `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
		`<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:val="clear" w:fill="00FF00"/></w:tcPr><w:p><w:r><w:t>Combinada</w:t></w:r></w:p></w:tc></w:tr>` +
		`<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Celda A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Celda B</w:t></w:r></w:p><w:p><w:r><w:t>Celda B2</w:t></w:r></w:p></w:tc></w:tr>` +
		`<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>Celda C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
	doc := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ` + nsDecl + `><w:body>` + cuerpo + tabla + `<w:p><w:r><w:t>Último</w:t></w:r></w:p>` + cuerpoExtra + `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
	styles := `<?xml version="1.0" encoding="UTF-8"?><w:styles ` + nsDecl + `><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
		`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="Título 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/></w:rPr></w:style>` +
		`<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style></w:styles>`
	numbering := `<?xml version="1.0" encoding="UTF-8"?><w:numbering ` + nsDecl + `>` +
		`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl></w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum>` +
		`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
	tema := `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="x"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
		`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
		`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
		`<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ejemplo.org/" TargetMode="External"/>` +
		`<Relationship Id="rId21" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`
	tipos := `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`
	raiz := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
	return []parte{{"[Content_Types].xml", tipos}, {"_rels/.rels", raiz}, {"word/document.xml", doc}, {"word/_rels/document.xml.rels", rels}, {"word/styles.xml", styles}, {"word/numbering.xml", numbering}, {"word/theme/theme1.xml", tema}, {"word/media/image1.png", string(pngPrueba(t0))}}
}

var t0 = struct{}{}

func pngPrueba(_ struct{}) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := range 4 {
		for x := range 4 {
			img.Set(x, y, color.NRGBA{255, 0, 0, 255})
		}
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func bloquesDe(m map[string]any) []map[string]any {
	var r []map[string]any
	for _, b := range m["bloques"].([]any) {
		r = append(r, b.(map[string]any))
	}
	return r
}

func parrafoPorId(bs []map[string]any, id int) map[string]any {
	for _, b := range bs {
		if b["k"] == "p" && int(b["id"].(float64)) == id {
			return b
		}
	}
	return nil
}

func textoRuns(p map[string]any) string {
	var s strings.Builder
	for _, r := range p["r"].([]any) {
		s.WriteString(r.(map[string]any)["t"].(string))
	}
	return s.String()
}

func TestDocxAbrir(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "a.docx")
	crearZip(t, ruta, docxBase(""))
	m := abrirOk(t, ruta)
	if m["tipo"] != "docx" || m["editable"] != true {
		t.Fatalf("cabecera: %v %v", m["tipo"], m["editable"])
	}
	if m["defFont"] != "Calibri" || m["defPt"] != 11.0 {
		t.Fatalf("defaults: %v %v", m["defFont"], m["defPt"])
	}
	bs := bloquesDe(m)
	p0 := parrafoPorId(bs, 0)
	if p0["est"] != "h1" {
		t.Fatalf("est: %v", p0["est"])
	}
	r0 := p0["r"].([]any)[0].(map[string]any)
	if r0["b"] != 1.0 || r0["font"] != "Arial" || r0["pt"] != 16.0 || r0["o"] != 0.0 {
		t.Fatalf("run: %v", r0)
	}
	p1 := parrafoPorId(bs, 1)
	if p1["al"] != "c" {
		t.Fatalf("al: %v", p1["al"])
	}
	rs := p1["r"].([]any)
	if len(rs) != 2 || rs[1].(map[string]any)["t"] != "mundo\tfin" || rs[1].(map[string]any)["o"] != 1.0 || rs[1].(map[string]any)["h"] != "#ffff00" {
		t.Fatalf("runs: %v", rs)
	}
	if rs[0].(map[string]any)["c"] != "#ff0000" {
		t.Fatalf("color: %v", rs[0])
	}
	for id, marca := range map[int]string{2: "1.", 3: "1.a)", 4: "2.", 5: "•"} {
		l := parrafoPorId(bs, id)["lista"].(map[string]any)
		if l["marca"] != marca {
			t.Fatalf("marca %d: %v", id, l)
		}
	}
	if parrafoPorId(bs, 2)["sang"] != 6.0 {
		t.Fatalf("sang: %v", parrafoPorId(bs, 2)["sang"])
	}
	p6 := parrafoPorId(bs, 6)
	if p6["ed"] != 0.0 {
		t.Fatalf("ed: %v", p6)
	}
	if rr := p6["r"].([]any); len(rr) != 2 || rr[1].(map[string]any)["href"] != "https://ejemplo.org/" {
		t.Fatalf("href: %v", rr)
	}
	if v, hay := p6["id"]; !hay || v != 6.0 {
		t.Fatalf("id: %v", v)
	}
	if _, hay := parrafoPorId(bs, 0)["ed"]; hay {
		t.Fatal("el párrafo normal no debe llevar ed")
	}
	var img, tabla map[string]any
	saltos := 0
	for _, b := range bs {
		switch b["k"] {
		case "img":
			img = b
		case "tabla":
			tabla = b
		case "salto":
			saltos++
		}
	}
	if img["src"] != "word/media/image1.png" || img["w"] != 914400.0 || img["alt"] != "foto" {
		t.Fatalf("img: %v", img)
	}
	if saltos != 1 {
		t.Fatalf("saltos: %d", saltos)
	}
	an := tabla["anchos"].([]any)
	if an[0] != 0.25 || an[1] != 0.75 {
		t.Fatalf("anchos: %v", an)
	}
	fs := tabla["filas"].([]any)
	c0 := fs[0].([]any)[0].(map[string]any)
	if c0["cs"] != 2.0 || c0["bg"] != "#00ff00" {
		t.Fatalf("celda: %v", c0)
	}
	if fs[2].([]any)[0].(map[string]any)["vm"] != 1.0 {
		t.Fatalf("vm: %v", fs[2])
	}
	// Los párrafos de tabla cuentan en el ordinal.
	if b := fs[1].([]any)[1].(map[string]any)["b"].([]any); int(b[1].(map[string]any)["id"].(float64)) != 13 {
		t.Fatalf("id en tabla: %v", b)
	}
	fuentes := fmt.Sprint(m["fuentes"])
	if !strings.Contains(fuentes, "Calibri") || !strings.Contains(fuentes, "Cambria") || !strings.Contains(fuentes, "Arial") {
		t.Fatalf("fuentes: %v", fuentes)
	}
}

func TestDocxGuardar(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "a.docx")
	crearZip(t, ruta, docxBase(""))
	m := abrirOk(t, ruta)
	firma := m["firma"].(string)

	cero, uno := 0, 1
	g := map[string]any{"tipo": "docx", "firma": firma, "parrafos": []any{
		map[string]any{"id": 1, "nuevos": []any{
			map[string]any{"r": []any{
				map[string]any{"t": "Editado <&> ", "b": 1, "o": cero},
				map[string]any{"t": "con tab\tysalto\nfin", "o": uno, "u": 1, "font": "Georgia", "pt": 14},
			}},
			map[string]any{"r": []any{map[string]any{"t": "Párrafo nuevo", "o": cero}}},
		}},
		map[string]any{"id": 9, "nuevos": []any{}},  // cita: se borra
		map[string]any{"id": 11, "nuevos": []any{}}, // Celda A: única de la celda
		map[string]any{"id": 13, "nuevos": []any{}}, // Celda B2: se borra
	}}
	r := guardarOk(t, ruta, g)
	if !strings.Contains(filepath.ToSlash(r["respaldo"].(string)), "/.respaldos/a-") {
		t.Fatalf("ruta de respaldo: %v", r["respaldo"])
	}
	doc := string(leerParteZip(t, ruta, "word/document.xml"))
	// Los párrafos no editados siguen idénticos, byte a byte.
	for _, i := range []int{0, 2, 3, 4, 5, 6, 7, 8} {
		if !strings.Contains(doc, parrafosDocx[i]) {
			t.Fatalf("el párrafo %d cambió", i)
		}
	}
	for _, s := range []string{
		`<w:p w:rsidR="00AA"><w:pPr><w:jc w:val="center"/></w:pPr><w:bookmarkStart w:id="1" w:name="m"/>`,
		`<w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">Editado &lt;&amp;&gt; </w:t>`,
		`<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/>`,
		`<w:sz w:val="28"/><w:szCs w:val="28"/><w:highlight w:val="yellow"/><w:u w:val="single"/>`,
		`<w:tab/>`, `<w:br/>`,
		`<w:bookmarkEnd w:id="1"/></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr>`,
		`Párrafo nuevo`,
	} {
		if !strings.Contains(doc, s) {
			t.Fatalf("falta %q en:\n%s", s, doc)
		}
	}
	if strings.Contains(doc, "Una cita") || strings.Contains(doc, "Celda B2") {
		t.Fatal("no se borró un párrafo")
	}
	// `i` ausente en el run nuevo: se quita de ese rPr.
	if strings.Contains(doc, `<w:i/><w:highlight`) {
		t.Fatal("no se quitó la cursiva")
	}
	// Celda A: queda con su w:p vacío.
	if strings.Contains(doc, "Celda A") {
		t.Fatal("Celda A debía quedar vacía")
	}
	if !strings.Contains(doc, `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p></w:p></w:tc>`) {
		t.Fatalf("Celda A sin párrafo:\n%s", doc)
	}
	// El zip conserva orden y los demás bytes.
	d, _ := os.ReadFile(ruta)
	z, err := abrirZip(d)
	if err != nil {
		t.Fatal(err)
	}
	if z.r.File[2].Name != "word/document.xml" || z.r.File[0].Name != "[Content_Types].xml" {
		t.Fatalf("orden del zip: %v", z.r.File[0].Name)
	}
	if err := verificarZip(d); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(leerParteZip(t, ruta, "word/styles.xml"), []byte(docxBase("")[4].cuerpo)) {
		t.Fatal("styles.xml cambió")
	}
	re := abrirOk(t, ruta)
	if re["firma"] != r["firma"] {
		t.Fatal("firma distinta tras guardar")
	}
	// El ordinal se renumera: el nuevo párrafo es el id 2.
	if p := parrafoPorId(bloquesDe(re), 2); textoRuns(p) != "Párrafo nuevo" {
		t.Fatalf("relectura: %v", p)
	}

	// Conflicto de firma.
	b, _ := json.Marshal(map[string]any{"tipo": "docx", "firma": firma, "parrafos": []any{}})
	c := correr(t, string(b), "guardar", ruta)
	if c["ok"] != false || c["conflicto"] != true || c["error"] != msgConflicto {
		t.Fatalf("conflicto: %v", c)
	}
}

func TestDocxNoEditable(t *testing.T) {
	dir := t.TempDir()
	ruta := filepath.Join(dir, "a.docx")
	crearZip(t, ruta, docxBase(""))
	m := abrirOk(t, ruta)
	g := map[string]any{"tipo": "docx", "firma": m["firma"], "parrafos": []any{map[string]any{"id": 6, "nuevos": []any{map[string]any{"r": []any{map[string]any{"t": "x"}}}}}}}
	b, _ := json.Marshal(g)
	if c := correr(t, string(b), "guardar", ruta); c["ok"] != false {
		t.Fatalf("debía rechazar ed:0: %v", c)
	}
	// No debe quedar respaldo si no se guardó.
	if _, err := os.Stat(filepath.Join(dir, ".respaldos")); err == nil {
		t.Fatal("hay respaldo de un guardado rechazado")
	}
	partes := docxBase("")
	partes[2].cuerpo = strings.NewReplacer("<w:", "<x:", "</w:", "</x:", "xmlns:w=", "xmlns:x=", " w:", " x:").Replace(partes[2].cuerpo)
	r2 := filepath.Join(dir, "b.docx")
	crearZip(t, r2, partes)
	if m := abrirOk(t, r2); m["editable"] != false {
		t.Fatal("prefijo distinto debe ser no editable")
	} else if len(bloquesDe(m)) < 5 {
		t.Fatal("con otro prefijo debe seguir mostrándose")
	}
}

func TestDocxSaltoDePagina(t *testing.T) {
	dir := t.TempDir()
	ruta := filepath.Join(dir, "a.docx")
	crearZip(t, ruta, docxBase(""))
	m := abrirOk(t, ruta)
	g := map[string]any{"tipo": "docx", "firma": m["firma"], "parrafos": []any{map[string]any{"id": 8, "nuevos": []any{map[string]any{"r": []any{map[string]any{"t": "Otro"}}}}}}}
	guardarOk(t, ruta, g)
	doc := string(leerParteZip(t, ruta, "word/document.xml"))
	if !strings.Contains(doc, `Otro</w:t></w:r><w:r><w:br w:type="page"/></w:r>`) {
		t.Fatalf("se perdió el salto de página:\n%s", doc)
	}
}

// ---- XLSX ----

func xlsxBase() []parte {
	tipos := `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`
	raiz := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
	wb := `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Oculta" sheetId="2" state="hidden" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>`
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>`
	sst := `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Nombre</t></si><si><r><t>Va</t></r><r><t>lor</t></r></si></sst>`
	estilos := `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/></font><font><b/><color rgb="FFFF0000"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0"/><xf numFmtId="4" fontId="0" fillId="0"/><xf numFmtId="9" fontId="0" fillId="0"/></cellXfs></styleSheet>`
	hoja := `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C5"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20.4" customWidth="1"/><col min="2" max="3" width="9.6" customWidth="1"/></cols><sheetData>` +
		`<row r="1" spans="1:3"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>1.5</v></c></row>` +
		`<row r="2" spans="1:3"><c r="A2"><v>1234.5</v></c><c r="B2" s="3"><v>1234.5</v></c><c r="C2" s="2"><v>45000</v></c></row>` +
		`<row r="3" spans="1:3"><c r="A3"><v>2</v></c><c r="B3" s="4"><v>0.25</v></c><c r="C3" t="b"><v>1</v></c></row>` +
		`<row r="4" spans="1:3"><c r="A4"><v>3</v></c><c r="B4"><f t="shared" ref="B4:B5" si="0">A4*$C$1+1</f><v>5.5</v></c><c r="C4" t="str"><f>"x"&amp;A4</f><v>x3</v></c></row>` +
		`<row r="5" spans="1:3"><c r="A5"><v>4</v></c><c r="B5"><f t="shared" si="0"/><v>7</v></c><c r="C5"/></row>` +
		`</sheetData><mergeCells count="1"><mergeCell ref="A7:C7"/></mergeCells></worksheet>`
	hoja2 := `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`
	cadena := `<?xml version="1.0" encoding="UTF-8"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B4" i="1"/></calcChain>`
	return []parte{{"[Content_Types].xml", tipos}, {"_rels/.rels", raiz}, {"xl/workbook.xml", wb}, {"xl/_rels/workbook.xml.rels", rels}, {"xl/worksheets/sheet1.xml", hoja}, {"xl/worksheets/sheet2.xml", hoja2}, {"xl/styles.xml", estilos}, {"xl/sharedStrings.xml", sst}, {"xl/calcChain.xml", cadena}}
}

func celdaEn(h map[string]any, f, c int) []any {
	for _, x := range h["celdas"].([]any) {
		t := x.([]any)
		if int(t[0].(float64)) == f && int(t[1].(float64)) == c {
			return t
		}
	}
	return nil
}

func TestXlsxAbrir(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "a.xlsx")
	crearZip(t, ruta, xlsxBase())
	m := abrirOk(t, ruta)
	if m["tipo"] != "xlsx" {
		t.Fatal(m["tipo"])
	}
	hs := m["hojas"].([]any)
	if len(hs) != 2 {
		t.Fatal(len(hs))
	}
	h := hs[0].(map[string]any)
	if h2 := hs[1].(map[string]any); h2["oculta"] != 1.0 || h2["nombre"] != "Oculta" {
		t.Fatalf("hoja2: %v", h2)
	}
	if h["nombre"] != "Datos" || h["filas"] != 5.0 || h["cols"] != 3.0 {
		t.Fatalf("hoja: %v %v %v", h["nombre"], h["filas"], h["cols"])
	}
	a := h["anchos"].(map[string]any)
	if a["0"] != 20.0 || a["1"] != 10.0 || a["2"] != 10.0 {
		t.Fatalf("anchos: %v", a)
	}
	if cg := h["congela"].([]any); cg[0] != 1.0 || cg[1] != 0.0 {
		t.Fatalf("congela: %v", cg)
	}
	if cb := h["combinadas"].([]any)[0].([]any); fmt.Sprint(cb) != "[6 0 6 2]" {
		t.Fatalf("combinadas: %v", cb)
	}
	a1 := celdaEn(h, 0, 0)
	if a1[2] != "Nombre" || len(a1) != 6 || a1[3] != nil || a1[4] != nil {
		t.Fatalf("A1: %v", a1)
	}
	est := h["estilos"].([]any)[int(a1[5].(float64))].(map[string]any)
	if est["b"] != 1.0 || est["c"] != "#ff0000" || est["bg"] != "#00ff00" || est["al"] != "c" {
		t.Fatalf("estilo: %v", est)
	}
	if b1 := celdaEn(h, 0, 1); b1[2] != "Valor" || len(b1) != 3 {
		t.Fatalf("B1: %v", b1)
	}
	if c1 := celdaEn(h, 0, 2); c1[2] != 1.5 || len(c1) != 3 {
		t.Fatalf("C1: %v", c1)
	}
	if b2 := celdaEn(h, 1, 1); b2[3] != "1,234.50" {
		t.Fatalf("B2: %v", b2)
	}
	if c2 := celdaEn(h, 1, 2); c2[2] != 45000.0 || c2[3] != "15/03/2023" {
		t.Fatalf("C2: %v", c2)
	}
	if b3 := celdaEn(h, 2, 1); b3[3] != "25%" {
		t.Fatalf("B3: %v", b3)
	}
	if c3 := celdaEn(h, 2, 2); c3[2] != true {
		t.Fatalf("C3: %v", c3)
	}
	if b4 := celdaEn(h, 3, 1); b4[4] != "A4*$C$1+1" || b4[3] != nil {
		t.Fatalf("B4: %v", b4)
	}
	if b5 := celdaEn(h, 4, 1); b5[4] != "A5*$C$1+1" {
		t.Fatalf("B5: %v", b5)
	}
	if c4 := celdaEn(h, 3, 2); c4[2] != "x3" || c4[4] != `"x"&A4` {
		t.Fatalf("C4: %v", c4)
	}
}

func TestFormatos(t *testing.T) {
	casos := []struct {
		v    float64
		f, s string
	}{
		{1234.567, "General", "1234.567"}, {0.1 + 0.2, "General", "0.3"}, {5, "0", "5"}, {2.5, "0", "3"}, {1.005, "0.00", "1.01"},
		{1234567.891, "#,##0.00", "1,234,567.89"}, {-1234.5, "#,##0", "-1,235"}, {0.256, "0%", "26%"}, {0.256, "0.0%", "25.6%"},
		{1234.5, `"$"#,##0.00`, "$1,234.50"}, {1234.5, `[$€-40A] #,##0.00`, "€ 1,234.50"}, {-5, "0;(0)", "(5)"},
		{45000, "d/m/yyyy", "15/3/2023"}, {45000, "yyyy-mm-dd", "2023-03-15"}, {45000.5, "h:mm", "12:00"}, {45000.75, "dd/mm/yyyy h:mm", "15/03/2023 18:00"},
		{0.0625, "mm:ss", "30:00"}, {0.25, "0\u00a0%", "25\u00a0%"}, {1500, `#,##0\ "€"`, "1,500 €"},
	}
	for _, c := range casos {
		if s, ok := aplicarFormato(c.v, c.f, false); !ok || s != c.s {
			t.Errorf("%v con %q: %q (%v), se esperaba %q", c.v, c.f, s, ok, c.s)
		}
	}
	// `mm:ss` de 0.0625 días: 1h 30m → minutos 30, segundos 0.
}

func TestTrasladarFormula(t *testing.T) {
	casos := [][3]string{{"A1+$B$2", "A2+$B$2", "1,0"}, {"SUM(A1:B2)*LOG10(C3)", "SUM(B2:C3)*LOG10(D4)", "1,1"}, {`"A1"&Hoja1!B1`, `"A1"&Hoja1!C1`, "0,1"}, {"SUM(A:A)", "SUM(B:B)", "0,1"}, {"SUM(1:1)", "SUM(3:3)", "2,0"}, {"'A1'!B2+TRUE", "'A1'!B3+TRUE", "1,0"}}
	for _, c := range casos {
		var f, co int
		fmt.Sscanf(c[2], "%d,%d", &f, &co)
		if s := trasladarFormula(c[0], f, co); s != c[1] {
			t.Errorf("%s: %s, se esperaba %s", c[0], s, c[1])
		}
	}
}

func TestXlsxGuardar(t *testing.T) {
	ruta := filepath.Join(t.TempDir(), "a.xlsx")
	crearZip(t, ruta, xlsxBase())
	m := abrirOk(t, ruta)
	formula := "A1+1"
	g := map[string]any{"tipo": "xlsx", "firma": m["firma"], "cambios": []any{
		map[string]any{"hoja": 0, "f": 0, "c": 0, "v": "Título <1>"},
		map[string]any{"hoja": 0, "f": 1, "c": 1, "v": 99.5},
		map[string]any{"hoja": 0, "f": 2, "c": 2, "v": false},
		map[string]any{"hoja": 0, "f": 2, "c": 4, "v": "nueva col"},
		map[string]any{"hoja": 0, "f": 9, "c": 0, "v": 7},
		map[string]any{"hoja": 0, "f": 3, "c": 1, "v": 100, "formula": formula},
		map[string]any{"hoja": 0, "f": 1, "c": 2, "v": nil},
		map[string]any{"hoja": 1, "f": 2, "c": 2, "v": "en hoja vacía"},
	}}
	r := guardarOk(t, ruta, g)
	s := string(leerParteZip(t, ruta, "xl/worksheets/sheet1.xml"))
	for _, x := range []string{
		`<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Título &lt;1&gt;</t></is></c>`,
		`<c r="B2" s="3"><v>99.5</v></c>`,
		`<c r="C3" t="b"><v>0</v></c>`,
		`<c r="E3" t="inlineStr"><is>`,
		`<row r="10"><c r="A10"><v>7</v></c></row>`,
		`<c r="B4"><f>A1+1</f><v>100</v></c>`,
		`<c r="C2" s="2"/>`,
		// La dependiente de la compartida queda explícita.
		`<c r="B5"><f>A5*$C$1+1</f><v>7</v></c>`,
		`<dimension ref="A1:E10"/>`,
		`<row r="3">`,
	} {
		if !strings.Contains(s, x) {
			t.Fatalf("falta %q en:\n%s", x, s)
		}
	}
	if strings.Contains(s, `<row r="3" spans`) {
		t.Fatal("spans debía quitarse al insertar")
	}
	if !strings.Contains(s, `<row r="2" spans="1:3">`) {
		t.Fatal("fila sin inserción no debía cambiar")
	}
	h2 := string(leerParteZip(t, ruta, "xl/worksheets/sheet2.xml"))
	if !strings.Contains(h2, `<sheetData><row r="3"><c r="C3" t="inlineStr">`) {
		t.Fatalf("hoja2:\n%s", h2)
	}
	wb := string(leerParteZip(t, ruta, "xl/workbook.xml"))
	if !strings.Contains(wb, `<calcPr calcId="191029" fullCalcOnLoad="1"/>`) {
		t.Fatalf("workbook: %s", wb)
	}
	d, _ := os.ReadFile(ruta)
	z, _ := abrirZip(d)
	if z.existe("xl/calcChain.xml") {
		t.Fatal("calcChain sigue")
	}
	if ct := string(leerParteZip(t, ruta, "[Content_Types].xml")); strings.Contains(ct, "calcChain") {
		t.Fatal("Override de calcChain sigue")
	}
	if rl := string(leerParteZip(t, ruta, "xl/_rels/workbook.xml.rels")); strings.Contains(rl, "calcChain") {
		t.Fatal("relación de calcChain sigue")
	}
	if !bytes.Equal(leerParteZip(t, ruta, "xl/sharedStrings.xml"), []byte(xlsxBase()[7].cuerpo)) {
		t.Fatal("sharedStrings cambió")
	}
	re := abrirOk(t, ruta)
	if re["firma"] != r["firma"] {
		t.Fatal("firma")
	}
	h := re["hojas"].([]any)[0].(map[string]any)
	if c := celdaEn(h, 0, 0); c[2] != "Título <1>" {
		t.Fatalf("A1: %v", c)
	}
	if c := celdaEn(h, 3, 1); c[4] != "A1+1" || c[2] != 100.0 {
		t.Fatalf("B4: %v", c)
	}
	if c := celdaEn(h, 4, 1); c[4] != "A5*$C$1+1" {
		t.Fatalf("B5: %v", c)
	}
}

// ---- CSV y texto ----

func TestCsv(t *testing.T) {
	dir := t.TempDir()
	ruta := filepath.Join(dir, "a.csv")
	orig := []byte("\xEF\xBB\xBFnombre;valor;nota\r\nAna;12;\"con ; y \"\"c\"\"\"\r\nLuis;3,5;007\r\n")
	os.WriteFile(ruta, orig, 0o600)
	m := abrirOk(t, ruta)
	if m["tipo"] != "csv" || m["sep"] != ";" {
		t.Fatalf("%v", m)
	}
	h := m["hojas"].([]any)[0].(map[string]any)
	if h["nombre"] != "a.csv" || h["filas"] != 3.0 || h["cols"] != 3.0 {
		t.Fatalf("%v", h)
	}
	if c := celdaEn(h, 1, 1); c[2] != 12.0 {
		t.Fatalf("%v", c)
	}
	if c := celdaEn(h, 2, 1); c[2] != "3,5" {
		t.Fatalf("coma decimal debe ser texto: %v", c)
	}
	if c := celdaEn(h, 2, 2); c[2] != "007" {
		t.Fatalf("%v", c)
	}
	if c := celdaEn(h, 1, 2); c[2] != `con ; y "c"` {
		t.Fatalf("%v", c)
	}
	g := map[string]any{"tipo": "csv", "firma": m["firma"], "sep": ";", "filas": [][]string{{"a", "b;c"}, {"", `d"e`}}}
	guardarOk(t, ruta, g)
	d, _ := os.ReadFile(ruta)
	if want := "\xEF\xBB\xBFa;\"b;c\"\r\n;\"d\"\"e\"\r\n"; string(d) != want {
		t.Fatalf("%q", d)
	}
	info, _ := os.Stat(ruta)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("permisos: %v", info.Mode())
	}
}

func TestTexto(t *testing.T) {
	dir := t.TempDir()
	casos := []struct {
		nombre string
		datos  []byte
		cod    string
		nuevo  string
		salida []byte
	}{
		{"a.md", []byte("hola\r\nmundo\r\n"), "utf-8", "uno\ndos\n", []byte("uno\r\ndos\r\n")},
		{"b.txt", []byte("\xEF\xBB\xBFñ\n"), "utf-8-bom", "é\n", []byte("\xEF\xBB\xBFé\n")},
		{"c.log", []byte("caf\xE9 \x80\n"), "latin1", "€ ñ\n", []byte("\x80 \xF1\n")},
		{"d.txt", []byte("\xFF\xFEh\x00i\x00\r\x00\n\x00"), "utf-16le", "ok\n", []byte("\xFF\xFEo\x00k\x00\r\x00\n\x00")},
		{"e.txt", []byte("\xFE\xFF\x00h\x00i"), "utf-16be", "x", []byte("\xFE\xFF\x00x")},
	}
	for _, c := range casos {
		ruta := filepath.Join(dir, c.nombre)
		os.WriteFile(ruta, c.datos, 0o644)
		m := abrirOk(t, ruta)
		if m["tipo"] != "texto" || m["codificacion"] != c.cod {
			t.Fatalf("%s: %v", c.nombre, m)
		}
		if strings.Contains(m["texto"].(string), "\r") {
			t.Fatalf("%s: debe llegar con LF", c.nombre)
		}
		guardarOk(t, ruta, map[string]any{"tipo": "texto", "firma": m["firma"], "texto": c.nuevo, "codificacion": c.cod})
		d, _ := os.ReadFile(ruta)
		if !bytes.Equal(d, c.salida) {
			t.Fatalf("%s: %q", c.nombre, d)
		}
	}
	// Binario.
	bin := filepath.Join(dir, "x.dat")
	os.WriteFile(bin, []byte("MZ\x00\x01"), 0o644)
	if m := correr(t, "", "abrir", bin); m["error"] != msgBinario {
		t.Fatalf("%v", m)
	}
	// Grande: aviso y no se deja guardar.
	gr := filepath.Join(dir, "g.txt")
	os.WriteFile(gr, bytes.Repeat([]byte("linea de texto\n"), 400000), 0o644)
	m := abrirOk(t, gr)
	if m["aviso"] == nil || len(m["texto"].(string)) > limiteTexto {
		t.Fatalf("aviso: %v %d", m["aviso"], len(m["texto"].(string)))
	}
	b, _ := json.Marshal(map[string]any{"tipo": "texto", "firma": m["firma"], "texto": "x", "codificacion": "utf-8"})
	if c := correr(t, string(b), "guardar", gr); c["ok"] != false {
		t.Fatalf("no debe guardar lo recortado: %v", c)
	}
	// Respaldos con el mismo sello no se pisan.
	r := filepath.Join(dir, "r.txt")
	os.WriteFile(r, []byte("a"), 0o644)
	vistos := map[string]bool{}
	for i := 0; i < 3; i++ {
		m := abrirOk(t, r)
		g := guardarOk(t, r, map[string]any{"tipo": "texto", "firma": m["firma"], "texto": fmt.Sprint("v", i), "codificacion": "utf-8"})
		vistos[g["respaldo"].(string)] = true
	}
	if len(vistos) != 3 {
		t.Fatalf("respaldos: %v", vistos)
	}
}

func TestErroresNoPanican(t *testing.T) {
	dir := t.TempDir()
	basura := bytes.Repeat([]byte{0xAA, 0x55, 0, 7, 'P', 'K'}, 500)
	for _, n := range []string{"a.docx", "a.xlsx", "a.pptx", "a.pdf", "a.png", "a.csv"} {
		r := filepath.Join(dir, n)
		os.WriteFile(r, basura, 0o644)
		m := correr(t, "", "abrir", r)
		if _, hay := m["error"]; !hay {
			t.Errorf("%s: debía dar error: %v", n, m)
		}
	}
	if m := correr(t, "", "abrir", filepath.Join(dir, "no.txt")); m["error"] == nil {
		t.Fatal("archivo inexistente")
	}
	if m := correr(t, "", "nada"); m["error"] == nil {
		t.Fatal("comando desconocido")
	}
	r := filepath.Join(dir, "z.docx")
	crearZip(t, r, []parte{{"word/document.xml", "<no-cierra>"}})
	if m := correr(t, "", "abrir", r); m["error"] == nil {
		t.Fatal("XML dañado")
	}
}

// ---- Imágenes ----

func celdasDe(t *testing.T, m map[string]any) (int, int, []uint32) {
	t.Helper()
	if e, hay := m["error"]; hay {
		t.Fatal(e)
	}
	b, err := base64.StdEncoding.DecodeString(m["cells"].(string))
	if err != nil {
		t.Fatal(err)
	}
	cols, filas := int(m["cols"].(float64)), int(m["filas"].(float64))
	if len(b) != cols*filas*12 {
		t.Fatalf("tamaño %d, %dx%d", len(b), cols, filas)
	}
	u := make([]uint32, len(b)/4)
	for i := range u {
		u[i] = binary.LittleEndian.Uint32(b[4*i:])
	}
	return cols, filas, u
}

func TestRaster(t *testing.T) {
	dir := t.TempDir()
	img := image.NewNRGBA(image.Rect(0, 0, 40, 20))
	for y := range 20 {
		for x := range 40 {
			c := color.NRGBA{255, 0, 0, 255}
			if y >= 10 {
				c = color.NRGBA{0, 0, 255, 0} // transparente
			}
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	r := filepath.Join(dir, "a.png")
	os.WriteFile(r, b.Bytes(), 0o644)
	m := correr(t, "", "raster", r, "-", "20", "20")
	cols, filas, u := celdasDe(t, m)
	if cols != 20 || filas != 5 {
		t.Fatalf("%dx%d", cols, filas)
	}
	if u[0] != 0x2580 || u[1] != 0xFF0000 || u[2] != 0xFF0000 {
		t.Fatalf("primera celda: %x", u[:3])
	}
	if last := u[len(u)-3:]; last[1] != 0xFFFFFF || last[2] != 0xFFFFFF {
		t.Fatalf("transparencia: %x", last)
	}
	if a := abrirOk(t, r); a["tipo"] != "imagen" || a["w"] != 40.0 || a["formato"] != "png" {
		t.Fatalf("%v", a)
	}

	var j, g bytes.Buffer
	jpeg.Encode(&j, img, nil)
	pal := image.NewPaletted(img.Rect, color.Palette{color.White, color.Black})
	gif.Encode(&g, pal, nil)
	for n, d := range map[string][]byte{"j.jpg": j.Bytes(), "g.gif": g.Bytes()} {
		p := filepath.Join(dir, n)
		os.WriteFile(p, d, 0o644)
		c, _, _ := celdasDe(t, correr(t, "", "raster", p, "-", "10", "10"))
		if c != 10 {
			t.Fatalf("%s: cols %d", n, c)
		}
	}
	for n, sig := range map[string]string{"a.webp": "RIFF0000WEBPVP8 ", "a.bmp": "BM000000", "a.tiff": "II*\x000000"} {
		p := filepath.Join(dir, n)
		os.WriteFile(p, []byte(sig), 0o644)
		m := correr(t, "", "raster", p, "-", "10", "10")
		if !strings.HasPrefix(fmt.Sprint(m["error"]), "formato de imagen no soportado: ") {
			t.Fatalf("%s: %v", n, m)
		}
	}
	if m := abrirOk(t, filepath.Join(dir, "a.webp")); m["tipo"] != "imagen" || m["formato"] != "webp" || m["w"] != 0.0 || m["aviso"] == nil {
		t.Fatalf("%v", m)
	}

	// Parte interna de un docx.
	z := filepath.Join(dir, "a.docx")
	crearZip(t, z, docxBase(""))
	if c, f, _ := celdasDe(t, correr(t, "", "raster", z, "word/media/image1.png", "8", "8")); c != 8 || f != 4 {
		t.Fatalf("%dx%d", c, f)
	}
}

// ---- PPTX ----

func pptxBase() []parte {
	ns := `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
	rt := "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
	relsDe := func(items ...string) string {
		s := `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
		for i := 0; i+1 < len(items); i += 2 {
			s += fmt.Sprintf(`<Relationship Id="rId%d" Type="%s%s" Target="%s"/>`, i/2+1, rt, items[i], items[i+1])
		}
		return s + "</Relationships>"
	}
	pres := `<?xml version="1.0"?><p:presentation ` + ns + `><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst><p:sldSz cx="10000" cy="5000"/></p:presentation>`
	tema := `<?xml version="1.0"?><a:theme ` + ns + `><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
	master := `<?xml version="1.0"?><p:sldMaster ` + ns + `><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000" y="500"/><a:ext cx="8000" cy="1000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="228600"><a:buChar char="&#8226;"/><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`
	layout := `<?xml version="1.0"?><p:sldLayout ` + ns + `><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="c"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="8000" cy="2000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`
	slide := `<?xml version="1.0"?><p:sld ` + ns + `><p:cSld><p:spTree>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr/><a:t>Título</a:t></a:r></a:p></p:txBody></p:sp>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="3" name="c"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr i="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Punto</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Uno</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Dos</a:t></a:r></a:p></p:txBody></p:sp>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="4" name="r"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="500"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></p:spPr></p:sp>` +
		`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="5000" y="0"/><a:ext cx="2000" cy="1000"/><a:chOff x="0" y="0"/><a:chExt cx="1000" cy="500"/></a:xfrm></p:grpSpPr>` +
		`<p:pic><p:nvPicPr><p:cNvPr id="6" name="i"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="500" cy="200"/></a:xfrm></p:spPr></p:pic></p:grpSp>` +
		`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="4000"/><a:ext cx="4000" cy="1000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="1000"/><a:gridCol w="3000"/></a:tblGrid><a:tr h="100"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>c1</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>c2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
		`</p:spTree></p:cSld></p:sld>`
	notas := `<?xml version="1.0"?><p:notes ` + ns + `><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Notas del orador</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
	segunda := `<?xml version="1.0"?><p:sld ` + ns + `><p:cSld><p:spTree/></p:cSld></p:sld>`
	return []parte{
		{"ppt/presentation.xml", pres},
		{"ppt/_rels/presentation.xml.rels", relsDe("slide", "slides/slide2.xml", "slide", "slides/slide1.xml")},
		{"ppt/slides/slide1.xml", slide},
		{"ppt/slides/slide2.xml", segunda},
		{"ppt/slides/_rels/slide1.xml.rels", relsDe("slideLayout", "../slideLayouts/slideLayout1.xml", "notesSlide", "../notesSlides/notesSlide1.xml", "image", "../media/image1.png")},
		{"ppt/slides/_rels/slide2.xml.rels", relsDe("slideLayout", "../slideLayouts/slideLayout1.xml")},
		{"ppt/slideLayouts/slideLayout1.xml", layout},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsDe("slideMaster", "../slideMasters/slideMaster1.xml")},
		{"ppt/slideMasters/slideMaster1.xml", master},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", relsDe("theme", "../theme/theme1.xml")},
		{"ppt/theme/theme1.xml", tema},
		{"ppt/notesSlides/notesSlide1.xml", notas},
		{"ppt/media/image1.png", string(pngPrueba(t0))},
	}
}

func TestPptx(t *testing.T) {
	r := filepath.Join(t.TempDir(), "a.pptx")
	crearZip(t, r, pptxBase())
	m := abrirOk(t, r)
	if m["ancho"] != 10000.0 || m["alto"] != 5000.0 {
		t.Fatalf("%v", m)
	}
	ds := m["diapositivas"].([]any)
	// rId2 (slide1) va primero según sldIdLst.
	if len(ds) != 2 {
		t.Fatal(len(ds))
	}
	d := ds[0].(map[string]any)
	if d["notas"] != "Notas del orador" {
		t.Fatalf("notas: %v", d["notas"])
	}
	if d["bg"] != "#4472c4" {
		t.Fatalf("bg: %v", d["bg"])
	}
	fs := d["formas"].([]any)
	if len(fs) != 5 {
		t.Fatalf("formas: %d", len(fs))
	}
	tit := fs[0].(map[string]any)
	if tit["x"] != 0.1 || tit["y"] != 0.1 || tit["w"] != 0.8 || tit["tipo"] != "texto" {
		t.Fatalf("título: %v", tit)
	}
	p := tit["b"].([]any)[0].(map[string]any)
	if p["est"] != "titulo" || p["al"] != "c" {
		t.Fatalf("párrafo: %v", p)
	}
	rr := p["r"].([]any)[0].(map[string]any)
	if rr["b"] != 1.0 || rr["pt"] != 40.0 || rr["font"] != "Cambria" {
		t.Fatalf("run: %v", rr)
	}
	cuerpo := fs[1].(map[string]any)
	if cuerpo["y"] != 0.4 {
		t.Fatalf("cuerpo: %v", cuerpo)
	}
	ps := cuerpo["b"].([]any)
	if l := ps[0].(map[string]any)["lista"].(map[string]any); l["marca"] != "•" {
		t.Fatalf("viñeta: %v", l)
	}
	if ps[0].(map[string]any)["r"].([]any)[0].(map[string]any)["c"] != "#ff0000" {
		t.Fatalf("color: %v", ps[0])
	}
	if l := ps[2].(map[string]any)["lista"].(map[string]any); l["marca"] != "2." {
		t.Fatalf("numeración: %v", l)
	}
	f := fs[2].(map[string]any)
	if f["tipo"] != "forma" || f["bg"] != "#111111" || f["borde"] != "#00ff00" {
		t.Fatalf("forma: %v", f)
	}
	img := fs[3].(map[string]any)
	if img["tipo"] != "img" || img["src"] != "ppt/media/image1.png" || img["x"] != 0.52 || img["y"] != 0.04 || img["w"] != 0.1 {
		t.Fatalf("img: %v", img)
	}
	tab := fs[4].(map[string]any)
	if tab["tipo"] != "tabla" {
		t.Fatalf("tabla: %v", tab)
	}
	b0 := tab["b"].([]any)[0].(map[string]any)
	if b0["k"] != "tabla" || b0["anchos"].([]any)[1] != 0.75 {
		t.Fatalf("tabla: %v", b0)
	}
}

// ---- PDF ----

func armarPdf(objetos []string, trailerExtra string) []byte {
	var b bytes.Buffer
	b.WriteString("%PDF-1.5\n")
	off := make([]int, len(objetos))
	for i, o := range objetos {
		off[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xr := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objetos)+1)
	for _, o := range off {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R %s >>\nstartxref\n%d\n%%%%EOF\n", len(objetos)+1, trailerExtra, xr)
	return b.Bytes()
}

func stream(d string) string {
	return fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(d), d)
}

func flateStream(d []byte, extra string) string {
	var b bytes.Buffer
	w := zlib.NewWriter(&b)
	w.Write(d)
	w.Close()
	return fmt.Sprintf("<< /Length %d /Filter /FlateDecode %s >>\nstream\n%s\nendstream", b.Len(), extra, b.String())
}

const cmapPrueba = `/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <0048> <0002> <00F1> endbfchar
1 beginbfrange <0010> <0012> <0061> endbfrange endcmap`

func pdfPrueba() []byte {
	contenido := `q BT /F1 12 Tf 72 700 Td (Hola) Tj ( mundo) Tj ET Q
BT /F1 12 Tf 72 680 Td [(Sepa) -2000 (rado)] TJ ET
BT /F2 18 Tf 72 650 Td (Negrita \343) Tj ET
BT /F3 10 Tf 1 0 0 1 72 600 Tm <000100020010001100120099> Tj ET
BT /F4 10 Tf 72 580 Td (\001x) Tj ET
q 2 0 0 2 10 10 cm /Fm1 Do Q`
	return armarPdf([]string{
		`<< /Type /Catalog /Pages 2 0 R >>`,
		`<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 11 0 R >> /XObject << /Fm1 9 0 R /Im1 12 0 R >> >> >>`,
		`<< /Type /Page /Parent 2 0 R /Contents 10 0 R >>`,
		`<< /Type /Page /Parent 2 0 R /Rotate 90 /Contents 14 0 R >>`,
		`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 32 /Widths [278] >>`,
		`<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Arial-BoldItalicMT /Encoding /WinAnsiEncoding >>`,
		`<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [<< /Subtype /CIDFontType2 /DW 500 >>] /ToUnicode 8 0 R >>`,
		stream(cmapPrueba),
		`<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length 39 /Resources << /Font << /F1 5 0 R >> >> >>
stream
BT /F1 10 Tf 5 5 Td (En forma) Tj ET   
endstream`,
		flateStream([]byte(contenido), ""),
		`<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Differences [1 /aacute] >> >>`,
		`<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Length 6 >>
stream
` + "\xff\x00\x00\x00\xff\x00" + `
endstream`,
		stream(`q 2 0 0 1 0 0 cm /Im1 Do Q`),
		stream(`BT /F1 12 Tf 100 200 Td (Girada) Tj ET`),
	}, "")
}

func textosDe(m map[string]any, i int) []map[string]any {
	var r []map[string]any
	for _, x := range m["paginas"].([]any)[i].(map[string]any)["textos"].([]any) {
		r = append(r, x.(map[string]any))
	}
	return r
}

func TestPdf(t *testing.T) {
	dir := t.TempDir()
	r := filepath.Join(dir, "a.pdf")
	os.WriteFile(r, pdfPrueba(), 0o644)
	m := abrirOk(t, r)
	ps := m["paginas"].([]any)
	if len(ps) != 2 {
		t.Fatalf("páginas: %d", len(ps))
	}
	p0 := ps[0].(map[string]any)
	if p0["w"] != 612.0 || p0["h"] != 792.0 {
		t.Fatalf("%v", p0)
	}
	txt := textosDe(m, 0)
	var todo []string
	for _, x := range txt {
		todo = append(todo, x["t"].(string))
	}
	s := strings.Join(todo, "|")
	for _, w := range []string{"Hola mundo", "Sepa", "rado", "Negrita ã", "Hñabc", "áx", "En forma"} {
		if !strings.Contains(s, w) {
			t.Fatalf("falta %q en %q", w, s)
		}
	}
	if strings.Contains(s, "Separado") {
		t.Fatalf("el hueco grande debía separar: %q", s)
	}
	if x := txt[0]; x["x"] != 72.0 || x["y"] != 92.0 || x["pt"] != 12.0 {
		t.Fatalf("posición: %v", x)
	}
	for _, x := range txt {
		if strings.HasPrefix(x["t"].(string), "Negrita") && (x["b"] != 1.0 || x["i"] != 1.0 || x["pt"] != 18.0) {
			t.Fatalf("negrita: %v", x)
		}
		if strings.HasPrefix(x["t"].(string), "En forma") && (x["x"] != 20.0 || x["pt"] != 20.0 || x["y"] != 772.0) {
			t.Fatalf("forma: %v", x)
		}
	}
	// Rotate 90: ancho y alto se intercambian; (100,200) → (200,100).
	p1 := ps[1].(map[string]any)
	if p1["w"] != 792.0 || p1["h"] != 612.0 {
		t.Fatalf("%v", p1)
	}
	g := textosDe(m, 1)[0]
	if g["t"] != "Girada" || g["x"] != 200.0 || g["y"] != 100.0 {
		t.Fatalf("rotada: %v", g)
	}
	// Solo imagen.
	if p1["soloImagen"] != nil {
		t.Fatal("con texto no es solo imagen")
	}
	// Raster con pdftoppm, o la imagen embebida si no está.
	c, f, _ := celdasDe(t, correr(t, "", "raster", r, "pdf:0", "40", "30"))
	if c > 40 || f > 30 || c < 1 {
		t.Fatalf("%dx%d", c, f)
	}
	if m := correr(t, "", "raster", r, "pdf:9", "10", "10"); m["error"] == nil {
		t.Fatal("página inexistente")
	}
}

func TestPdfImagenEmbebida(t *testing.T) {
	// Sin pdftoppm en el PATH se usa la imagen de la página.
	t.Setenv("PATH", t.TempDir())
	dir := t.TempDir()
	r := filepath.Join(dir, "a.pdf")
	imgObj := flateStream([]byte("\xff\x00\x00\x00\x00\xff"), `/Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB`)
	os.WriteFile(r, armarPdf([]string{
		`<< /Type /Catalog /Pages 2 0 R >>`,
		`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /I 4 0 R >> >> /Contents 5 0 R >>`,
		imgObj,
		stream(`q 100 0 0 100 0 0 cm /I Do Q`),
	}, ""), 0o644)
	m := abrirOk(t, r)
	if m["paginas"].([]any)[0].(map[string]any)["soloImagen"] != 1.0 {
		t.Fatalf("%v", m)
	}
	c, f, u := celdasDe(t, correr(t, "", "raster", r, "pdf:0", "2", "1"))
	if c != 2 || f != 1 || u[1] != 0xFF0000 || u[4] != 0x0000FF {
		t.Fatalf("%d %d %x", c, f, u)
	}
	// Sin imagen ni pdftoppm: error claro.
	r2 := filepath.Join(dir, "b.pdf")
	os.WriteFile(r2, pdfSoloTexto(), 0o644)
	if m := correr(t, "", "raster", r2, "pdf:0", "2", "1"); m["error"] != msgSinPdftoppm {
		t.Fatalf("%v", m)
	}
}

func pdfSoloTexto() []byte {
	return armarPdf([]string{
		`<< /Type /Catalog /Pages 2 0 R >>`,
		`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>`,
		stream(`BT ET`),
	}, "")
}

func TestPdfCifradoYDanado(t *testing.T) {
	dir := t.TempDir()
	r := filepath.Join(dir, "c.pdf")
	os.WriteFile(r, armarPdf([]string{`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [] >>`, `<< /Filter /Standard >>`}, "/Encrypt 3 0 R"), 0o644)
	if m := correr(t, "", "abrir", r); !strings.Contains(fmt.Sprint(m["error"]), "cifrado") {
		t.Fatalf("%v", m)
	}
	// Sin xref válida: se recupera barriendo el archivo.
	d := pdfPrueba()
	d = bytes.ReplaceAll(d, []byte("startxref"), []byte("startxxxx"))
	r2 := filepath.Join(dir, "d.pdf")
	os.WriteFile(r2, d, 0o644)
	m := abrirOk(t, r2)
	if len(m["paginas"].([]any)) != 2 {
		t.Fatalf("%v", m)
	}
	// Truncado.
	r3 := filepath.Join(dir, "e.pdf")
	os.WriteFile(r3, pdfPrueba()[:300], 0o644)
	sal := ejecutar([]string{"abrir", r3}, strings.NewReader(""))
	if !json.Valid(sal) {
		t.Fatalf("%s", sal)
	}
}

func TestPdfXrefStream(t *testing.T) {
	// Objetos en object stream y xref en stream con predictor PNG.
	var b bytes.Buffer
	b.WriteString("%PDF-1.5\n")
	offs := map[int]int{}
	escribir := func(n int, s string) {
		offs[n] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", n, s)
	}
	cuerpos := []string{`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R /Resources << /Font << /F 6 0 R >> >> >>`}
	var cab, datos strings.Builder
	for i, c := range cuerpos {
		fmt.Fprintf(&cab, "%d %d ", i+1, datos.Len())
		datos.WriteString(c + " ")
	}
	escribir(4, flateStream([]byte(cab.String()+datos.String()), fmt.Sprintf("/Type /ObjStm /N 3 /First %d", cab.Len())))
	escribir(5, flateStream([]byte(`BT /F 12 Tf 10 100 Td (Desde objstm) Tj ET`), ""))
	escribir(6, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`)
	xrefPos := b.Len()
	filas := [][4]byte{{0, 0, 0, 0}, {2, 0, 4, 0}, {2, 0, 4, 1}, {2, 0, 4, 2}}
	for _, n := range []int{4, 5, 6, 7} {
		o := offs[n]
		if n == 7 {
			o = xrefPos
		}
		filas = append(filas, [4]byte{1, byte(o >> 8), byte(o), 0})
	}
	var raw []byte
	prev := [4]byte{}
	for _, f := range filas {
		raw = append(raw, 2)
		for i := range f {
			raw = append(raw, f[i]-prev[i])
		}
		prev = f
	}
	fmt.Fprintf(&b, "7 0 obj\n%s\nendobj\nstartxref\n%d\n%%%%EOF\n", flateStream(raw, `/Type /XRef /Size 8 /W [1 2 1] /Root 1 0 R /DecodeParms << /Predictor 12 /Columns 4 >>`), xrefPos)
	r := filepath.Join(t.TempDir(), "x.pdf")
	os.WriteFile(r, b.Bytes(), 0o644)
	m := abrirOk(t, r)
	if textosDe(m, 0)[0]["t"] != "Desde objstm" {
		t.Fatalf("%v", m)
	}
}

// TestMutaciones: entradas dañadas nunca cuelgan ni rompen la salida JSON.
func TestMutaciones(t *testing.T) {
	dir := t.TempDir()
	generar := func(partes []parte) []byte {
		var b bytes.Buffer
		w := zip.NewWriter(&b)
		for _, p := range partes {
			f, _ := w.CreateHeader(&zip.FileHeader{Name: p.nombre, Method: zip.Store})
			f.Write([]byte(p.cuerpo))
		}
		w.Close()
		return b.Bytes()
	}
	bases := map[string][]byte{"a.pdf": pdfPrueba(), "a.docx": generar(docxBase("")), "a.xlsx": generar(xlsxBase()), "a.pptx": generar(pptxBase())}
	semilla := uint32(12345)
	azar := func(n int) int {
		semilla = semilla*1664525 + 1013904223
		return int(semilla>>8) % n
	}
	for nombre, base := range bases {
		ruta := filepath.Join(dir, nombre)
		for i := 0; i < 150; i++ {
			d := append([]byte{}, base...)
			for k := 0; k < 1+azar(12); k++ {
				d[azar(len(d))] = byte(azar(256))
			}
			if azar(5) == 0 {
				d = d[:azar(len(d))+1]
			}
			os.WriteFile(ruta, d, 0o644)
			args := []string{"abrir", ruta}
			if nombre == "a.pdf" && i%3 == 0 {
				args = []string{"raster", ruta, "pdf:0", "10", "10"}
			}
			if sal := ejecutar(args, strings.NewReader("")); !json.Valid(sal) {
				t.Fatalf("%s: salida inválida: %.200s", nombre, sal)
			}
		}
	}
}

// ---- Exportación para validar con LibreOffice ----

// TestExportarGuardados deja copias editadas en $LECTOR_SALIDA.
func TestExportarGuardados(t *testing.T) {
	dir := os.Getenv("LECTOR_SALIDA")
	if dir == "" {
		t.Skip("sin LECTOR_SALIDA")
	}
	dx := filepath.Join(dir, "editado.docx")
	crearZip(t, dx, docxBase(""))
	m := abrirOk(t, dx)
	guardarOk(t, dx, map[string]any{"tipo": "docx", "firma": m["firma"], "parrafos": []any{
		map[string]any{"id": 1, "nuevos": []any{
			map[string]any{"r": []any{map[string]any{"t": "TEXTOEDITADOUNO con ñ <&>", "b": 1, "o": 0}}},
			map[string]any{"r": []any{map[string]any{"t": "PARRAFOADICIONAL", "o": 0, "font": "Georgia", "pt": 14}}},
		}},
		map[string]any{"id": 9, "nuevos": []any{}},
		map[string]any{"id": 11, "nuevos": []any{}},
	}})
	xs := filepath.Join(dir, "editado.xlsx")
	crearZip(t, xs, xlsxBase())
	m = abrirOk(t, xs)
	guardarOk(t, xs, map[string]any{"tipo": "xlsx", "firma": m["firma"], "cambios": []any{
		map[string]any{"hoja": 0, "f": 0, "c": 0, "v": "CELDAEDITADA ñ"},
		map[string]any{"hoja": 0, "f": 9, "c": 1, "v": "FILANUEVA"},
		map[string]any{"hoja": 0, "f": 3, "c": 1, "v": 12345, "formula": "A1&\"\""},
		map[string]any{"hoja": 0, "f": 1, "c": 4, "v": 777.25},
	}})
}
