# Documentación de la API

API REST del sistema de análisis de eficiencia energética (Spring Boot).

## Endpoint

```
POST /api/v1/onnx/prediction
Content-Type: application/json
```

- **Local:** `http://localhost:8080/api/v1/onnx/prediction`
- **Producción:** `https://129.151.116.82.nip.io/api/v1/onnx/prediction`

## Entrada (request body)

Contrato de **8 campos**. Todos son obligatorios; si falta alguno, la API responde **400**.

| Campo | Tipo | Descripción |
|---|---|---|
| `consumo_kwh` | número | Consumo mensual en kWh |
| `personas` | entero | Número de habitantes |
| `superficie_m2` | número | Superficie de la vivienda en m² |
| `cantidad_equipos` | entero | Cantidad de equipos eléctricos |
| `tipo_inmueble` | texto | `"Casa"` o `"Departamento"` |
| `uso_horario_pico` | booleano | Si consume de forma frecuente en horario punta |
| `horas_alto_consumo` | entero | Horas de alto consumo por día |
| `panel_solar` | booleano | Si la vivienda tiene panel solar |

### Ejemplo de entrada

```json
{
  "consumo_kwh": 420,
  "personas": 3,
  "superficie_m2": 80,
  "cantidad_equipos": 12,
  "tipo_inmueble": "Casa",
  "uso_horario_pico": true,
  "horas_alto_consumo": 10,
  "panel_solar": false
}
```

## Salida (response body)

| Campo | Tipo | Descripción |
|---|---|---|
| `categoria` | texto | `Eficiente`, `Moderado` o `Ineficiente` |
| `probabilidad` | número | Confianza de la clasificación (0.5 – 1.0) |
| `recomendaciones` | lista de texto | Consejos de mejora accionables |
| `costo_estimado_mensual` | número | Costo mensual estimado (`consumo_kwh × 0.75`) |

### Ejemplo de salida

```json
{
  "categoria": "Ineficiente",
  "probabilidad": 0.89,
  "recomendaciones": [
    "Reducir el uso de equipos durante los horarios pico",
    "Distribuir las actividades de mayor consumo a lo largo del día",
    "Evaluar equipos con alto consumo energético",
    "Evaluar la instalación de paneles solares para autoconsumo"
  ],
  "costo_estimado_mensual": 315.0
}
```

## Health check

```
GET /api/v1/health   →   {"status": "UP"}
```

Endpoint de salud para monitoreo (y para pings anti-inactividad que eviten que OCI reclame la VM).

## Persistencia de análisis (comparación entre períodos)

Guardan y consultan el historial por email, en **OCI Autonomous Database**.

**`POST /api/v1/analisis`** — guarda un análisis:
```json
{ "email": "tucorreo@ejemplo.com", "consumo_kwh": 420, "costo_estimado_mensual": 315,
  "categoria": "Ineficiente", "probabilidad": 0.89 }
```
Devuelve el objeto guardado con `id` y `fecha` (asignados por el servidor).

**`GET /api/v1/analisis?email=tucorreo@ejemplo.com`** — devuelve el historial del usuario en orden
cronológico, para comparar el consumo y el costo entre períodos.

> Identificación simple por email, sin autenticación. Adecuado para el MVP; un login real sería el
> siguiente nivel.

## Documentación interactiva

Swagger UI dinámico (autogenerado con springdoc) en **`/swagger-ui.html`**, y el contrato OpenAPI
en `/v3/api-docs`.

## Manejo de errores

| Código | Cuándo | Respuesta |
|---|---|---|
| `200` | Petición válida | JSON con el análisis |
| `400` | Falta uno o más campos obligatorios | Mensaje indicando qué campos faltan |
| `500` | Error interno (ej. modelo no disponible) | Mensaje de error |

## Notas de implementación

- La **categoría** proviene del clasificador ONNX (salida `label`).
- La **probabilidad** se calcula como una *confianza calibrada por el percentil del residual*
  dentro de la distribución empírica de 30.000 viviendas (enfoque cuantílico), no como el
  `predict_proba` crudo del clasificador. Se fundamenta en los datos, no en una constante fija.
- Las **recomendaciones** las genera `RecomendacionEngine` con reglas explicables sobre las
  variables de hábito. Un perfil **Eficiente** recibe solo refuerzo positivo (sin correctivas);
  la instalación de paneles solares se plantea únicamente para el perfil **Ineficiente** sin panel
  y de forma explícita como inversión de mediano plazo (no como hábito).
- La **tarifa** de referencia está fijada en `0.75` $/kWh, según sugiere el reto.

## CORS

Los orígenes permitidos se configuran en `WebConfig.java` (incluye el dominio de producción
`https://129.151.116.82.nip.io` y los de desarrollo local). Para un frontend en un dominio
distinto, agregar su URL a `allowedOrigins`.
