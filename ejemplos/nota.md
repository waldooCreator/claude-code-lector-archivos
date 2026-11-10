---
titulo: Manual
autor: Equipo
---

# Manual de ejemplo :rocket:

Texto con **negrita**, *cursiva*, `código` y un [enlace](https://ejemplo.org).

> [!WARNING]
> Esto es una advertencia.

## Lista y tareas

- Uno
  - Anidado
- [x] Hecho
- [ ] Pendiente

| Nombre | Valor |
|:-------|------:|
| Alfa   | 10    |
| Beta   | 20    |

```python
def hola():
    return "mundo"  # saludo
```

```mermaid
flowchart TD
  A[Inicio] --> B{Decisión}
  B -->|Sí| C[Fin]
  B -->|No| D[Reintentar]
  D --> B
```

```mermaid
sequenceDiagram
  Ana->>Luis: Hola
  Luis-->>Ana: ¿Qué tal?
```

![Foto](foto.png)
