# Roadmap — EnergiAI

Estado del proyecto y lo que queda por hacer. Marcado con ✅ (hecho) y ⬜ (pendiente).

## ✅ Estado actual (completado)

**Ciencia de Datos**
- ✅ EDA, limpieza y análisis de patrones
- ✅ Auditoría y manejo de *data leakage*
- ✅ Modelo A (consumo esperado por residual) + definición de categorías
- ✅ Clasificador supervisado (RandomForest vs Regresión Logística) con métricas
- ✅ Motor de recomendaciones por reglas
- ✅ Serialización a ONNX
- ✅ Explicabilidad (importancia de variables — sección 7b)

**Backend (API)**
- ✅ API REST con contrato de 8 campos (categoría, probabilidad, recomendaciones, costo)
- ✅ Probabilidad como confianza por distancia al umbral
- ✅ Validación de entrada (400) y manejo de errores
- ✅ Endpoint `/health`
- ✅ CORS por configuración
- ✅ Tests JUnit de coherencia de recomendaciones
- ✅ Documentación con Swagger/OpenAPI (estática)

**Frontend**
- ✅ Diseño responsive + modo oscuro
- ✅ Descripciones claras y números con su significado
- ✅ Simulador de ahorro
- ✅ Benchmarking vs hogares similares
- ✅ Historial de evolución (localStorage)
- ✅ Exportar a PDF
- ✅ Spinner de carga y mejoras de accesibilidad

**Infraestructura (OCI)**
- ✅ Modelo en Object Storage (consumido por PAR)
- ✅ API en Compute (systemd, permanente)
- ✅ HTTPS con Caddy + IP pública reservada

**Documentación**
- ✅ README, API, Ciencia de Datos, Despliegue, Changelog

---

## ⬜ Pendiente (roadmap)

### Prioridad 1 — Entrega (urgente)
- ⬜ **Subir todo a la branch de GitHub**: frontend nuevo, cambios de API (Fase 1), carpeta `docs/`, notebook actualizado y archivos de Swagger. Hoy están solo en el PC y en la VM.

### Prioridad 2 — Base de datos y funciones dependientes
*(La base de datos es el cimiento de las dos siguientes.)*
- ⬜ **Provisionar OCI Autonomous Database** (Always Free) — guía en `DESPLIEGUE_OCI` / notas.
- ⬜ **Cablear la API a la BD**: driver Oracle + JPA, entidad `Analisis`, repositorio, endpoints para guardar y listar análisis.
- ⬜ **Definir identidad de usuario** (id anónimo por dispositivo o email) para asociar el histórico.
- ⬜ **Comparación entre períodos**: histórico en servidor + gráfico de evolución real (multi-dispositivo).
- ⬜ **Bucle de retroalimentación**: detectar si el consumo bajó tras aplicar las recomendaciones.

### Prioridad 3 — Rigor del modelo (Ciencia de Datos)
- ⬜ **Regresión cuantílica**: bandas de consumo esperado + probabilidad calibrada (reemplaza el parche actual). Alto valor técnico.
- ⬜ **Arreglar `horas_alto_consumo`**: hoy es una variable derivada/simulada.
- ⬜ **Tarifa por país**: usar tarifa real por país en vez del $0,75 plano.
- ⬜ **Validación semántica de entradas** (detectar valores incoherentes).
- ⬜ **Aprovechar más variables** con señal (temperatura, estación) en el modelo/recomendaciones.

### Prioridad 4 — Producto / UX
- ⬜ **Desglose por equipos** (aparcado): madurar el análisis antes de implementarlo.
- ⬜ **Recomendaciones por estación/clima** usando `estación` y `temperatura`.
- ⬜ **Multi-idioma** (ES / EN / PT).
- ⬜ **Compartir informe por enlace** (el PDF ya existe).

### Prioridad 5 — Backend / DevOps
- ⬜ **Swagger dinámico** (springdoc) — hoy es estático; requiere verificar compatibilidad con Spring Boot 4.
- ⬜ **Dockerizar** la API (Dockerfile + docker-compose).
- ⬜ **CI/CD** con GitHub Actions (build + deploy automático).
- ⬜ **Dominio propio real** en vez de `nip.io`.

*(Descartado por el equipo: monitoreo de uptime.)*

---

## Sugerencia de orden

1. **Subir a GitHub** (bloquea la entrega).
2. **Base de datos** → desbloquea comparación entre períodos + bucle de retroalimentación (lo que más "producto real" demuestra).
3. **Regresión cuantílica** (rigor técnico, reemplaza el único parche).
4. El resto (producto y DevOps) según tiempo disponible.
