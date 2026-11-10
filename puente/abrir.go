package main

import (
	"path/filepath"
	"strings"
)

// abrir elige el lector según la extensión.
func abrir(ruta string) (any, error) {
	ext := strings.ToLower(filepath.Ext(ruta))
	switch ext {
	case ".docx", ".docm":
		return conDatos(ruta, abrirDocx)
	case ".xlsx", ".xlsm":
		return conDatos(ruta, abrirXlsx)
	case ".csv", ".tsv":
		return conDatos(ruta, func(d []byte) (any, error) { return abrirCsv(d, ruta) })
	case ".pptx":
		return conDatos(ruta, abrirPptx)
	case ".pdf":
		return conDatos(ruta, abrirPdf)
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp":
		return conDatos(ruta, func(d []byte) (any, error) { return abrirImagen(d, ext) })
	}
	return abrirTexto(ruta)
}

func conDatos(ruta string, f func([]byte) (any, error)) (any, error) {
	d, err := leerArchivo(ruta)
	if err != nil {
		return nil, err
	}
	return f(d)
}
