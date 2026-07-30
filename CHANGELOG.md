# Changelog

Cambios realizados sobre el código base para cumplir el contrato del reto y desplegar en la nube.

## Backend (API)

### `dto/PredictionResponse.java` — reescrito
Salida alineada al contrato del reto: `categoria`, `probabilidad`, `recomendaciones` (lista) y
`costo_estimado_mensual`. Se eliminaron los campos de regresión anteriores
(`consumo_esperado_kwh`, `consumo_real_kwh`, `desviacion_porcentual`).

### `service/OnnxModelService.java` — reescrito (cambio principal)
- Vector de entrada de **8 features** en el orden esperado por el clasificador.
- Lee del ONNX la **etiqueta** (salida string) en lugar de tratar la salida como regresión.
- **Probabilidad** calculada como confianza por distancia del residual al umbral (coeficientes del
  Modelo A + `ESCALA_CONFIANZA`), porque el `predict_proba` del clasificador salía saturado en 1.0.
- **Motor de recomendaciones** por reglas (portado del notebook).
- **Validación de entrada**: responde `400` si falta algún campo del contrato.
- Costo mensual = `consumo_kwh × 0.75`.

### `config/WebConfig.java`
Se agregó un origen de ejemplo a la lista de CORS (`allowedOrigins`). En el despliegue same-origin
la restricción se resuelve en el proxy (Caddy elimina la cabecera `Origin`).

### `resources/application.yaml`
`onnx.model.path` cambiado de `classpath:model/model.onnx` a la **URL de OCI Object Storage**
(Pre-Authenticated Request), para cargar el modelo desde la nube.

### `model.onnx`
Reemplazado por el **clasificador de 8 features** exportado desde el notebook.

## Frontend

### `main.html`
- Vista de resultado ampliada: muestra **probabilidad** y una **lista de recomendaciones**.
- Cada campo del formulario envuelto en `.campo` para que quede una fila por input.

### `JS/main.js`
- Renderiza probabilidad y recomendaciones (antes solo categoría y costo).
- `API_URL` cambiado a ruta **relativa** (`/api/v1/onnx/prediction`) para el despliegue same-origin.

### `CSS/main.css`
Reglas de layout del formulario (`#formAnalisis`, `.campo`, inputs a ancho completo).

## Infraestructura (archivos nuevos)

- `deploy/Caddyfile` — proxy inverso + HTTPS + servido del frontend estático.
- `deploy/energia-api.service` — servicio systemd para la API.

## Ciencia de Datos (archivo nuevo)

- `G9_DataScience_analisis_energetico.ipynb` — notebook con EDA, análisis de leakage, Modelo A
  (residual), comparación RandomForest vs Regresión Logística, recomendaciones y export a ONNX.
