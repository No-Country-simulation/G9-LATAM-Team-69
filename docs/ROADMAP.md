# Roadmap — EnergiAI

Estado del proyecto y lo que queda por hacer. ✅ hecho · ⬜ pendiente.

## ✅ Completado

**Ciencia de Datos**
- ✅ EDA, limpieza y análisis de patrones
- ✅ Auditoría y manejo de *data leakage*
- ✅ Modelo A (consumo esperado por residual) + definición de categorías
- ✅ Clasificador supervisado (RandomForest vs Regresión Logística) con métricas
- ✅ Motor de recomendaciones por reglas
- ✅ Serialización a ONNX
- ✅ Explicabilidad (importancia de variables)
- ✅ Regresión cuantílica (banda de incertidumbre calibrada)

**Backend (API)**
- ✅ API REST con contrato de 8 campos
- ✅ **Probabilidad cuantílica**: percentil del residual sobre la distribución empírica (en la API)
- ✅ Validación de entrada (400) y manejo de errores
- ✅ Endpoint `/health`
- ✅ CORS por configuración · tests JUnit de coherencia
- ✅ **Swagger dinámico** (springdoc) en `/swagger-ui.html`
- ✅ Dockerfile + docker-compose

**Base de datos y comparación entre períodos**
- ✅ OCI Autonomous Database provisionada y conectada (JPA)
- ✅ Endpoints `POST/GET /api/v1/analisis` (guardar y listar por email)
- ✅ Historial persistente **multi-dispositivo** por email
- ✅ Comparación entre períodos (gráfico + tabla con variación %)

**Frontend**
- ✅ Responsive + modo oscuro · spinner · accesibilidad
- ✅ Descripciones claras y números con su significado
- ✅ Simulador de ahorro · benchmarking vs hogares similares
- ✅ Exportar a PDF · compartir análisis por enlace
- ✅ Validación semántica de entradas

**Infraestructura y documentación**
- ✅ Modelo en Object Storage · API en Compute (systemd) · HTTPS con Caddy · IP reservada
- ✅ README, API, Ciencia de Datos, Despliegue, Changelog, Roadmap

---

## ⬜ Pendiente (opcional)

**Modelo / datos**
- ⬜ Llevar la regresión cuantílica *heteroscedástica* (modelos GB) a la API vía ONNX (hoy la API usa la versión empírica homoscedástica; la GB está en el notebook)
- ⬜ Arreglar `horas_alto_consumo` (variable derivada/simulada)
- ⬜ Tarifa por país (en vez del $0,75 plano)
- ⬜ Usar temperatura/estación en el modelo y las recomendaciones

**Producto**
- ⬜ Bucle de retroalimentación explícito (hoy la variación % de la tabla ya lo insinúa)
- ⬜ Desglose de consumo por tipo de equipo (aparcado)
- ⬜ Botón "limpiar historial" (endpoint DELETE)
- ⬜ Login real (hoy la identificación es simple por email)
- ⬜ Multi-idioma (ES / EN / PT)

**DevOps**
- ⬜ CI/CD con GitHub Actions
- ⬜ Dominio propio en vez de `nip.io`

*(Descartado por el equipo: monitoreo de uptime.)*

---

## Cierre pendiente (no es mejora)

- ⬜ Subir la última tanda de cambios a GitHub (con la contraseña de la BD como placeholder).
