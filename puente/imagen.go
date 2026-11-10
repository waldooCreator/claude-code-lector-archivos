package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Máximo de celdas para que el base64 quepa en stdout (12 bytes por celda).
const maxCeldasRaster = limiteDocumento * 3 / 4 / 12

// Máximo de píxeles de una imagen a decodificar.
const maxPixeles = 120_000_000

func abrirImagen(d []byte, ext string) (any, error) {
	res := DocImagen{Tipo: "imagen", Firma: sha256Hex(d)}
	if ext == ".bmp" || ext == ".webp" {
		res.Formato = strings.TrimPrefix(ext, ".")
		res.Aviso = "Este formato de imagen no se puede dibujar en la terminal."
		return res, nil
	}
	cfg, formato, err := image.DecodeConfig(bytes.NewReader(d))
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer la imagen: %s", formatoDe(d, ext))
	}
	res.W, res.H, res.Formato = cfg.Width, cfg.Height, formato
	return res, nil
}

// formatoDe nombra un formato por su firma o, si no, por la extensión.
func formatoDe(d []byte, ext string) string {
	s := d
	if len(s) > 512 {
		s = s[:512]
	}
	switch {
	case bytes.HasPrefix(s, []byte("\x89PNG")):
		return "PNG"
	case bytes.HasPrefix(s, []byte{0xFF, 0xD8}):
		return "JPEG"
	case bytes.HasPrefix(s, []byte("GIF8")):
		return "GIF"
	case len(s) >= 12 && string(s[:4]) == "RIFF" && string(s[8:12]) == "WEBP":
		return "WEBP"
	case bytes.HasPrefix(s, []byte("BM")):
		return "BMP"
	case bytes.HasPrefix(s, []byte("II*\x00")) || bytes.HasPrefix(s, []byte("MM\x00*")):
		return "TIFF"
	case len(s) >= 44 && string(s[40:44]) == " EMF":
		return "EMF"
	case bytes.HasPrefix(s, []byte{0xD7, 0xCD, 0xC6, 0x9A}) || bytes.HasPrefix(s, []byte{0x01, 0x00, 0x09, 0x00}):
		return "WMF"
	case bytes.Contains(s, []byte("<svg")):
		return "SVG"
	}
	if ext != "" {
		return strings.ToUpper(strings.TrimPrefix(ext, "."))
	}
	return "desconocido"
}

func decodificarImagen(d []byte, ext string) (image.Image, error) {
	f := formatoDe(d, "")
	if f != "PNG" && f != "JPEG" && f != "GIF" {
		return nil, fmt.Errorf("formato de imagen no soportado: %s", formatoDe(d, ext))
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(d))
	if err != nil {
		return nil, fmt.Errorf("imagen dañada (%s)", f)
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxPixeles {
		return nil, errors.New("la imagen es demasiado grande")
	}
	img, _, err := image.Decode(bytes.NewReader(d))
	if err != nil {
		return nil, fmt.Errorf("imagen dañada (%s)", f)
	}
	return img, nil
}

func raster(ruta, parte string, cols, filas int) (any, error) {
	d, err := leerArchivo(ruta)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(parte, "pdf:") {
		n, err := strconv.Atoi(strings.TrimPrefix(parte, "pdf:"))
		if err != nil || n < 0 {
			return nil, errors.New("número de página inválido")
		}
		return rasterPdf(ruta, d, n, cols, filas)
	}
	ext := strings.ToLower(filepath.Ext(ruta))
	if parte != "-" {
		z, err := abrirZip(d)
		if err != nil {
			return nil, err
		}
		if d, err = z.leer(parte); err != nil {
			return nil, err
		}
		ext = strings.ToLower(filepath.Ext(parte))
	}
	img, err := decodificarImagen(d, ext)
	if err != nil {
		return nil, err
	}
	return dibujar(img, cols, filas), nil
}

// dibujar escala con promedio de área y compone sobre blanco.
func dibujar(img image.Image, cols, filas int) Raster {
	b := img.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		panic("imagen vacía")
	}
	if cols*filas > maxCeldasRaster {
		f := math.Sqrt(float64(maxCeldasRaster) / float64(cols*filas))
		cols = max(1, int(float64(cols)*f))
		filas = max(1, int(float64(filas)*f))
	}
	escala := math.Min(float64(cols)/float64(b.Dx()), float64(filas*2)/float64(b.Dy()))
	an := min(cols, max(1, int(math.Round(float64(b.Dx())*escala))))
	al := min(filas*2, max(2, int(math.Round(float64(b.Dy())*escala))))
	if al%2 == 1 {
		al++
		if al > filas*2 {
			al -= 2
		}
	}
	al = max(2, al)

	// Todo a RGBA de 8 bits (premultiplicado).
	fuente := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(fuente, fuente.Bounds(), img, b.Min, draw.Src)

	pix := make([]uint32, an*al)
	fx := float64(b.Dx()) / float64(an)
	fy := float64(b.Dy()) / float64(al)
	for y := range al {
		y0, y1 := float64(y)*fy, float64(y+1)*fy
		for x := range an {
			x0, x1 := float64(x)*fx, float64(x+1)*fx
			pix[y*an+x] = promedioArea(fuente, x0, y0, x1, y1)
		}
	}

	cf := al / 2
	salida := make([]byte, 0, an*cf*12)
	for y := range cf {
		for x := range an {
			salida = binary.LittleEndian.AppendUint32(salida, 0x2580)
			salida = binary.LittleEndian.AppendUint32(salida, pix[(2*y)*an+x])
			salida = binary.LittleEndian.AppendUint32(salida, pix[(2*y+1)*an+x])
		}
	}
	return Raster{Cols: an, Filas: cf, Cells: base64.StdEncoding.EncodeToString(salida)}
}

// promedioArea promedia con cobertura fraccionaria un rectángulo de la fuente.
func promedioArea(f *image.RGBA, x0, y0, x1, y1 float64) uint32 {
	w, h := f.Rect.Dx(), f.Rect.Dy()
	var r, g, b, a, peso float64
	for y := max(0, int(y0)); y < min(h, int(math.Ceil(y1))); y++ {
		py := math.Min(float64(y+1), y1) - math.Max(float64(y), y0)
		if py <= 0 {
			continue
		}
		fila := f.Pix[y*f.Stride:]
		for x := max(0, int(x0)); x < min(w, int(math.Ceil(x1))); x++ {
			px := math.Min(float64(x+1), x1) - math.Max(float64(x), x0)
			if px <= 0 {
				continue
			}
			p := px * py
			c := fila[x*4 : x*4+4 : x*4+4]
			r += float64(c[0]) * p
			g += float64(c[1]) * p
			b += float64(c[2]) * p
			a += float64(c[3]) * p
			peso += p
		}
	}
	if peso == 0 {
		return 0xFFFFFF
	}
	r, g, b, a = r/peso, g/peso, b/peso, a/peso
	resto := 255 - a
	return uint32(limitar8(r+resto))<<16 | uint32(limitar8(g+resto))<<8 | uint32(limitar8(b+resto))
}

func limitar8(v float64) uint8 {
	return uint8(math.Max(0, math.Min(255, math.Round(v))))
}

// rasterConPdftoppm dibuja la página con pdftoppm; ok=false si no está o falla.
func rasterConPdftoppm(ruta string, pagina int, anchoPt, altoPt float64, cols, filas int) (image.Image, bool) {
	prog, err := exec.LookPath("pdftoppm")
	if err != nil || anchoPt <= 0 || altoPt <= 0 {
		return nil, false
	}
	abs, err := filepath.Abs(ruta)
	if err != nil {
		return nil, false
	}
	dir, err := os.MkdirTemp("", "lector-pdf-")
	if err != nil {
		return nil, false
	}
	defer os.RemoveAll(dir)
	// El doble de la resolución final, para que el promedio dé texto nítido.
	escala := math.Min(float64(cols)/anchoPt, float64(filas*2)/altoPt)
	dpi := int(math.Ceil(72 * escala * 2))
	dpi = max(20, min(dpi, 300))
	salida := filepath.Join(dir, "p")
	n := strconv.Itoa(pagina + 1)
	ctx, cancelar := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancelar()
	cmd := exec.CommandContext(ctx, prog, "-png", "-r", strconv.Itoa(dpi), "-f", n, "-l", n, "-singlefile", "--", abs, salida)
	if cmd.Run() != nil {
		// Algunas versiones no aceptan "--".
		cmd = exec.CommandContext(ctx, prog, "-png", "-r", strconv.Itoa(dpi), "-f", n, "-l", n, "-singlefile", abs, salida)
		if cmd.Run() != nil {
			return nil, false
		}
	}
	d, err := os.ReadFile(salida + ".png")
	if err != nil {
		return nil, false
	}
	img, _, err := image.Decode(bytes.NewReader(d))
	if err != nil {
		return nil, false
	}
	return img, true
}
