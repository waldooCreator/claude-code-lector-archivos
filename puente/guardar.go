package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const msgConflicto = "El archivo cambió en disco desde que lo abriste."

// guardar valida la firma, genera el contenido, respalda y escribe atómicamente.
func guardar(ruta string, stdin io.Reader) (any, error) {
	entrada, err := io.ReadAll(io.LimitReader(stdin, 256*1024*1024))
	if err != nil {
		return nil, errors.New("no se pudo leer la petición")
	}
	var g Guardado
	if err := json.Unmarshal(entrada, &g); err != nil {
		return nil, errors.New("la petición de guardar no es JSON válido")
	}
	if g.Firma == "" {
		return nil, errors.New("falta la firma del documento")
	}
	// Se escribe sobre el archivo real, no sobre un enlace. En Windows
	// EvalSymlinks falla en algunas unidades; entonces se usa la ruta dada.
	real, err := filepath.EvalSymlinks(ruta)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("no se encontró el archivo: %s", ruta)
		}
		real = ruta
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, fmt.Errorf("no se pudo acceder al archivo: %v", err)
	}
	actual, err := leerArchivo(real)
	if err != nil {
		return nil, err
	}
	if sha256Hex(actual) != g.Firma {
		return RespuestaGuardar{Ok: false, Error: msgConflicto, Conflicto: true}, nil
	}
	var nuevo []byte
	switch g.Tipo {
	case "docx":
		nuevo, err = guardarDocx(actual, &g)
	case "xlsx":
		nuevo, err = guardarXlsx(actual, &g)
	case "csv":
		nuevo, err = guardarCsv(actual, &g)
	case "texto":
		nuevo, err = guardarTexto(actual, &g)
	default:
		err = fmt.Errorf("tipo de documento no se puede guardar: %s", g.Tipo)
	}
	if err != nil {
		return nil, err
	}
	respaldo, err := crearRespaldo(real, actual, info.Mode().Perm())
	if err != nil {
		return nil, fmt.Errorf("no se pudo crear el respaldo; no se guardó nada: %v", err)
	}
	if err := escribirAtomico(real, nuevo, info.Mode().Perm()); err != nil {
		return nil, err
	}
	return RespuestaGuardar{Ok: true, Respaldo: respaldo, Firma: sha256Hex(nuevo)}, nil
}

// crearRespaldo copia el original a .respaldos sin sobrescribir nunca otro respaldo.
func crearRespaldo(ruta string, datos []byte, modo os.FileMode) (string, error) {
	dir := filepath.Join(filepath.Dir(ruta), ".respaldos")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := filepath.Base(ruta)
	ext := filepath.Ext(base)
	nombre := strings.TrimSuffix(base, ext)
	sello := time.Now().Format("20060102-150405")
	for i := 1; i < 10000; i++ {
		sufijo := ""
		if i > 1 {
			sufijo = fmt.Sprintf("-%d", i)
		}
		destino := filepath.Join(dir, nombre+"-"+sello+sufijo+ext)
		f, err := os.OpenFile(destino, os.O_WRONLY|os.O_CREATE|os.O_EXCL, modo)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, err = f.Write(datos)
		if err == nil {
			err = f.Sync()
		}
		if e := f.Close(); err == nil {
			err = e
		}
		if err != nil {
			os.Remove(destino)
			return "", err
		}
		return destino, nil
	}
	return "", errors.New("demasiados respaldos con el mismo sello")
}

// escribirAtomico escribe un temporal en la misma carpeta y lo renombra.
func escribirAtomico(ruta string, datos []byte, modo os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(ruta), ".lector-*.tmp")
	if err != nil {
		return fmt.Errorf("no se pudo escribir en la carpeta: %v", err)
	}
	tmp := f.Name()
	_, err = f.Write(datos)
	if err == nil {
		err = f.Sync()
	}
	if e := f.Close(); err == nil {
		err = e
	}
	if err == nil {
		err = os.Chmod(tmp, modo)
	}
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("no se pudo escribir el archivo: %v", err)
	}
	if err := os.Rename(tmp, ruta); err != nil {
		os.Remove(tmp)
		if runtime.GOOS == "windows" {
			return errors.New("El archivo está abierto en otro programa")
		}
		return fmt.Errorf("no se pudo reemplazar el archivo: %v", err)
	}
	return nil
}
