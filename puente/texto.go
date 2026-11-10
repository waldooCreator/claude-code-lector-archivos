package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Tope de texto que se entrega (medido como JSON).
const limiteTexto = 3500 * 1024

// Bytes del comienzo del archivo que se leen para decodificar.
const prefijoTexto = 8 * 1024 * 1024

const msgBinario = "archivo binario"

// decodificar detecta la codificación y devuelve el texto tal cual.
func decodificar(d []byte) (string, string, error) {
	switch {
	case bytes.HasPrefix(d, []byte{0xEF, 0xBB, 0xBF}):
		return string(d[3:]), "utf-8-bom", nil
	case bytes.HasPrefix(d, []byte{0xFF, 0xFE}):
		return decodificarUTF16(d[2:], true), "utf-16le", nil
	case bytes.HasPrefix(d, []byte{0xFE, 0xFF}):
		return decodificarUTF16(d[2:], false), "utf-16be", nil
	}
	if bytes.IndexByte(d, 0) >= 0 {
		return "", "", errors.New(msgBinario)
	}
	if validoUTF8(d) {
		return string(d), "utf-8", nil
	}
	return decodificarLatin1(d), "latin1", nil
}

func codificar(s, cod string) ([]byte, error) {
	switch cod {
	case "utf-8":
		return []byte(s), nil
	case "utf-8-bom":
		return append([]byte{0xEF, 0xBB, 0xBF}, s...), nil
	case "latin1":
		return codificarLatin1(s)
	case "utf-16le", "utf-16be":
		u := utf16.Encode([]rune(s))
		b := make([]byte, 0, 2+2*len(u))
		if cod == "utf-16le" {
			b = append(b, 0xFF, 0xFE)
		} else {
			b = append(b, 0xFE, 0xFF)
		}
		for _, x := range u {
			if cod == "utf-16le" {
				b = append(b, byte(x), byte(x>>8))
			} else {
				b = append(b, byte(x>>8), byte(x))
			}
		}
		return b, nil
	}
	return nil, fmt.Errorf("codificación desconocida: %s", cod)
}

func aLF(s string) string {
	if !strings.Contains(s, "\r") {
		return s
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

// finLinea detecta el salto dominante de un texto.
func finLinea(s string) string {
	crlf := strings.Count(s, "\r\n")
	lf := strings.Count(s, "\n") - crlf
	cr := strings.Count(s, "\r") - crlf
	switch {
	case crlf > 0 && crlf >= lf:
		return "\r\n"
	case lf == 0 && cr > 0:
		return "\r"
	}
	return "\n"
}

// recortarJSON corta el texto para que su forma JSON no pase del tope.
func recortarJSON(s string, tope int) (string, bool) {
	total := 0
	for i, r := range s {
		switch {
		case r == '"' || r == '\\' || r == '\n' || r == '\r' || r == '\t':
			total += 2
		case r < 0x20 || r == 0x2028 || r == 0x2029 || r == utf8.RuneError:
			total += 6
		default:
			total += utf8.RuneLen(r)
		}
		if total > tope {
			return s[:i], true
		}
	}
	return s, false
}

func abrirTexto(ruta string) (any, error) {
	f, err := os.Open(ruta)
	if err != nil {
		_, e := leerArchivo(ruta)
		return nil, e
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("la ruta es una carpeta")
	}
	h := sha256.New()
	var prefijo bytes.Buffer
	if _, err := io.CopyN(io.MultiWriter(h, &prefijo), f, prefijoTexto); err != nil && err != io.EOF {
		return nil, fmt.Errorf("no se pudo leer el archivo: %v", err)
	}
	if _, err := io.Copy(h, f); err != nil {
		return nil, fmt.Errorf("no se pudo leer el archivo: %v", err)
	}
	d := prefijo.Bytes()
	truncado := info.Size() > int64(len(d))
	if truncado {
		d = recortarCola(d)
	}
	texto, cod, err := decodificar(d)
	if err != nil {
		return nil, err
	}
	texto = aLF(texto)
	res := DocTexto{Tipo: "texto", Codificacion: cod, Firma: hex.EncodeToString(h.Sum(nil))}
	recortado := truncado
	var corto bool
	texto, corto = recortarJSON(texto, limiteTexto)
	recortado = recortado || corto
	res.Texto = texto
	if recortado {
		res.Aviso = "El archivo es muy grande: solo se muestra el comienzo y no se puede guardar."
	}
	return res, nil
}

// recortarCola quita un carácter incompleto al final de un prefijo.
func recortarCola(d []byte) []byte {
	if bytes.HasPrefix(d, []byte{0xFF, 0xFE}) || bytes.HasPrefix(d, []byte{0xFE, 0xFF}) {
		return d[:len(d)&^1]
	}
	for i := 0; i < 4 && i < len(d); i++ {
		c := d[len(d)-1-i]
		if c < 0x80 {
			return d
		}
		if utf8.RuneStart(c) {
			if !utf8.FullRune(d[len(d)-1-i:]) {
				return d[:len(d)-1-i]
			}
			return d
		}
	}
	return d
}

func guardarTexto(actual []byte, g *Guardado) ([]byte, error) {
	texto, cod, err := decodificar(actual)
	if err != nil {
		return nil, err
	}
	if _, corto := recortarJSON(aLF(texto), limiteTexto); corto {
		return nil, errors.New("el archivo es demasiado grande para guardarlo desde el visor")
	}
	if g.Codificacion != "" {
		cod = g.Codificacion
	}
	salida := aLF(g.Texto)
	if fl := finLinea(texto); fl != "\n" {
		salida = strings.ReplaceAll(salida, "\n", fl)
	}
	return codificar(salida, cod)
}
