// lector: lee y guarda documentos para el mod lector-archivos.
// Salida siempre JSON en una línea por stdout; los errores también (código 0).
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
)

// Tope que impone el host a stdout.
const limiteSalida = 4 * 1024 * 1024

// Tope de trabajo para no acercarse al anterior.
const limiteDocumento = 3800 * 1024

func main() {
	os.Stdout.Write(ejecutar(os.Args[1:], os.Stdin))
}

// ejecutar corre un comando y devuelve la salida ya serializada. Nunca entra en pánico.
func ejecutar(args []string, stdin io.Reader) (salida []byte) {
	esGuardar := len(args) > 0 && args[0] == "guardar"
	defer func() {
		if r := recover(); r != nil {
			salida = salidaError(esGuardar, fmt.Sprintf("error interno al procesar el archivo: %v", r))
		}
	}()
	res, err := despachar(args, stdin)
	if err != nil {
		return salidaError(esGuardar, err.Error())
	}
	return serializar(res, esGuardar)
}

func despachar(args []string, stdin io.Reader) (any, error) {
	if len(args) == 0 {
		return nil, errors.New("falta el comando: abrir, raster o guardar")
	}
	switch args[0] {
	case "abrir":
		if len(args) != 2 {
			return nil, errors.New("uso: lector abrir <ruta>")
		}
		return abrir(args[1])
	case "raster":
		if len(args) != 5 {
			return nil, errors.New("uso: lector raster <ruta> <parte> <cols> <filas>")
		}
		cols, err1 := strconv.Atoi(args[3])
		filas, err2 := strconv.Atoi(args[4])
		if err1 != nil || err2 != nil || cols < 1 || filas < 1 {
			return nil, errors.New("cols y filas deben ser enteros positivos")
		}
		return raster(args[1], args[2], cols, filas)
	case "guardar":
		if len(args) != 2 {
			return nil, errors.New("uso: lector guardar <ruta> (JSON por stdin)")
		}
		return guardar(args[1], stdin)
	}
	return nil, fmt.Errorf("comando desconocido: %s", args[0])
}

func aJSON(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func serializar(v any, esGuardar bool) []byte {
	b, err := aJSON(v)
	if err != nil {
		return salidaError(esGuardar, "no se pudo serializar la respuesta: "+err.Error())
	}
	if len(b) > limiteSalida {
		return salidaError(esGuardar, "el documento es demasiado grande para mostrarlo")
	}
	return b
}

func salidaError(esGuardar bool, msg string) []byte {
	var v any = map[string]string{"error": msg}
	if esGuardar {
		v = RespuestaGuardar{Ok: false, Error: msg}
	}
	b, _ := aJSON(v)
	return b
}
