# Análisis Inteligente del Consumo Energético

**Hackathon ONE — Alura + Oracle · Equipo G9**

Sistema que analiza el consumo eléctrico de una vivienda, clasifica su perfil de eficiencia energética, genera recomendaciones accionables y estima el impacto financiero. El modelo se entrega en formato **ONNX** para su integración con una API REST en Java/Spring Boot desplegada sobre **Oracle Cloud Infrastructure (OCI)**.

---

## Tabla de contenidos

- [El problema](#el-problema)
- [Nuestro enfoque](#nuestro-enfoque)
- [El hallazgo diferencial: fuga de información](#el-hallazgo-diferencial-fuga-de-información)
- [Resultados](#resultados)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Instalación y uso](#instalación-y-uso)
- [Contrato de la API](#contrato-de-la-api)
- [Integración con Back-End](#integración-con-back-end)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Historial de versiones](#historial-de-versiones)

---

## El problema

Muchas personas reciben facturas de electricidad elevadas pero tienen poca visibilidad sobre qué hábitos impactan realmente en su gasto. El reto pedía construir un MVP capaz de analizar patrones de consumo, clasificar perfiles de eficiencia, generar recomendaciones y estimar costos.

El enunciado exige explícitamente que cada equipo **defina y justifique** sus propios criterios de eficiencia energética. Este repositorio documenta esa justificación con evidencia, no con afirmaciones.

## Nuestro enfoque

### La pregunta que define el diseño

La forma ingenua de clasificar eficiencia es fijar umbrales sobre el consumo: *"más de 400 kWh es ineficiente"*. Eso penaliza a las familias numerosas y premia a quien vive solo, sin medir nada sobre sus hábitos.

Nuestro sistema responde una pregunta distinta:

> **¿Consume esta vivienda más o menos de lo que consumiría un hogar como el suyo?**

Es el principio del *benchmarking* energético que emplean sistemas reales como ENERGY STAR.

### Arquitectura de dos capas

**Capa 1 — Motor de residuo.** Una regresión predice el **consumo esperado** de una vivienda a partir de sus características estructurales (personas, superficie, equipos, tipo de inmueble). La eficiencia se define como el **residuo**:

```
residuo = consumo_real − consumo_esperado
```

Esto elimina la circularidad: el modelo predice una magnitud **medida** (kWh reales), no una etiqueta que nosotros inventamos.

**Capa 2 — Atribución para recomendaciones.** Un segundo modelo interpretable explica ese residuo a partir de variables **discrecionales** (uso en horario punta, concentración de consumo, paneles solares). Las recomendaciones nacen de esos coeficientes, lo que garantiza por construcción que sean coherentes con la categoría asignada.

### Separación de variables: la decisión de diseño central

| Rol | Definición | Variables |
|---|---|---|
| **Target** | Magnitud medida, no inventada | `consumo_mes_kwh` |
| **Normalizadores** | Estructurales; el hogar no los elige a corto plazo | `personas`, `superficie_m2`, `cantidad_equipos`, `tipo_inmueble` |
| **Palancas** | Discrecionales; el hogar puede cambiarlas | `uso_horario_pico`, `horas_alto_consumo`, `panel_solar` |

Las palancas **nunca** entran al modelo de consumo esperado: contaminarían la definición de "esperado" con el comportamiento que precisamente se quiere evaluar.

## El hallazgo diferencial: fuga de información

Durante la auditoría del dataset detectamos **tres vías de fuga de información** que producían métricas falsamente perfectas:

| Vía | Relación exacta encontrada |
|---|---|
| Tramos horarios | `punta + valle + normal = consumo_mes_kwh` (diferencia ~1e-15) |
| Variables financieras | `gasto_mensual_clp = consumo_mes_kwh × valor_kwh_clp` (correlación 0.9999999) |
| Variables derivadas del target | `consumo/personas`, `consumo/superficie`, `gasto/personas` |

Además, la columna `eficiencia_energetica` incluida en el dataset **también tiene fuga**: es una función determinista de `porcentaje_led` (Baja = 60–70%, Media = 71–85%, Alta = 86–100%, sin solape). Un modelo entrenado sobre ella alcanza el 100% de accuracy leyendo una sola columna.

**Demostración reproducible** (sección 4 del notebook):

| Escenario | R² | MAE |
|---|---|---|
| Con las columnas filtradas | **1.000000** | ~10⁻¹² kWh |
| Sin ellas (variables legítimas) | 0.9083 | 21.22 kWh |

Un MAE del orden de 10⁻¹² es *precisión de máquina*. Ningún fenómeno real se predice con error cero: ese número solo es posible si el target es una combinación lineal exacta de las entradas.

Por eso descartamos esa etiqueta y construimos nuestro propio criterio, documentado y justificado.

## Resultados

### Modelo A — Consumo esperado

| Modelo | R² | MAE (kWh) | R² validación cruzada |
|---|---|---|---|
| **Regresión Lineal** (elegido) | **0.8804** | **23.40** | 0.8830 (±0.0014) |
| Random Forest | 0.8760 | 23.79 | 0.8782 (±0.0014) |
| Baseline (predecir la media) | −0.0002 | 68.35 | — |

Se eligió la Regresión Lineal por tres razones: mejor R², **extrapola correctamente** fuera del rango de entrenamiento (los modelos de árboles se quedan pegados a la hoja más cercana, algo problemático para una API pública) y produce un grafo ONNX mínimo.

**Coeficientes físicamente interpretables** — buena señal de que el modelo aprende estructura real y no ruido:

```
consumo_esperado = 147.901
                 + 34.735 × personas
                 +  1.288 × superficie_m2
                 -  0.211 × cantidad_equipos
                 +  0.453 × tipo_inmueble_cod
```

Cada persona adicional suma ~35 kWh/mes; cada m², ~1.3 kWh/mes.

### Modelo B — Atribución

R² = 0.2334 · MAE = 21.22 kWh. Reportamos esta métrica sin maquillar: las palancas disponibles explican una fracción real pero modesta del residuo, y `panel_solar` domina de forma abrumadora (coeficiente −13.83 frente a −0.07 y −0.03 de las conductuales). Es un hallazgo del dataset, no un defecto de implementación.

### Calidad del sistema

**Test de coherencia automatizado:** 5.000 combinaciones del espacio de entrada, **0 incoherencias**. Verifica que ninguna vivienda clasificada como `Eficiente` reciba recomendaciones de reducir consumo, que ninguna `Ineficiente` quede sin recomendaciones, y que la categoría sea siempre consistente con el signo del residuo.

Este test detectó y permitió corregir un bug real durante el desarrollo (18% de casos incoherentes en una versión anterior del motor de recomendaciones).

## Estructura del repositorio

```
.
├── README.md
├── requirements.txt
├── .gitignore
│
├── data/
│   └── consumo_energia_sudamerica.csv     # 30.000 viviendas, 5 países
│
├── notebooks/
│   ├── 01_analisis_energetico.ipynb       # ENTREGA PRINCIPAL
│   └── archivo/                            # versiones previas (trazabilidad)
│       ├── 00_exploracion_inicial.ipynb
│       └── 00_contrato_5_campos.ipynb
│
├── models/
│   ├── modelo_A.onnx                       # para Back-End (Java)
│   ├── modelo_A_consumo_esperado.pkl       # para Python (FastAPI)
│   ├── modelo_B_atribucion.pkl
│   └── esquema.json                        # constantes y metadatos
│
├── outputs/
│   ├── figuras/                            # 19 gráficos del análisis
│   └── ejemplos_analisis.json              # casos de prueba
│
└── docs/
    ├── ARQUITECTURA.md                     # decisiones de diseño y su justificación
    ├── BACKEND_ONNX.md                     # contrato ONNX y lógica para Java
    └── DICCIONARIO_DATOS.md                # rol de cada columna del dataset
```

## Instalación y uso

### Requisitos

Python 3.10 o superior.

```bash
git clone <url-del-repositorio>
cd <nombre-del-repositorio>

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

### Ejecutar el análisis

```bash
jupyter notebook notebooks/01_analisis_energetico.ipynb
```

El notebook corre de principio a fin con *Ejecutar todo*. Genera los modelos en `models/`, las 19 figuras en `outputs/figuras/` y los casos de prueba en `outputs/`.

> **En Google Colab:** sube `data/consumo_energia_sudamerica.csv` al panel de archivos y ajusta la ruta en la celda de carga. Las dependencias de ONNX se instalan desde el propio notebook.

### Usar el modelo entrenado

```python
import joblib
import numpy as np

modelo = joblib.load("models/modelo_A_consumo_esperado.pkl")

# Orden: personas, superficie_m2, cantidad_equipos, tipo_inmueble_cod
entrada = np.array([[4, 120, 10, 0.0]], dtype=np.float32)
consumo_esperado = modelo.predict(entrada)[0]

residuo = 420 - consumo_esperado
print(f"Esperado: {consumo_esperado:.1f} kWh | Residuo: {residuo:+.1f} kWh")
```

## Contrato de la API

### Entrada

```json
{
  "consumo_kwh": 420,
  "personas": 4,
  "superficie_m2": 120,
  "cantidad_equipos": 10,
  "tipo_inmueble": "Casa",
  "uso_horario_pico": true,
  "horas_alto_consumo": 8,
  "panel_solar": false
}
```

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| `consumo_kwh` | número | Sí | > 0, ≤ 10000 |
| `personas` | entero | Sí | ≥ 1, ≤ 20 |
| `superficie_m2` | número | Sí | > 0, ≤ 1000 |
| `cantidad_equipos` | entero | Sí | ≥ 1, ≤ 100 |
| `tipo_inmueble` | string | Sí | `"Casa"` o `"Departamento"` |
| `uso_horario_pico` | booleano | No (def. `false`) | — |
| `horas_alto_consumo` | número | No (def. `0`) | ≥ 0, ≤ 24 |
| `panel_solar` | booleano | No (def. `false`) | — |

> **`personas` y `superficie_m2` son obligatorios.** Se evaluó permitir su ausencia con imputación de la mediana y se descartó: produce un 19.6% de evaluaciones invertidas (`Eficiente` ↔ `Ineficiente`), con una coincidencia del 41.8% frente a un 34.5% esperable por azar. Si faltan, la API debe responder `400`.

### Salida

```json
{
  "categoria": "Eficiente",
  "consumo_esperado_kwh": 439.3,
  "residuo_kwh": -19.3,
  "desviacion_porcentual": -4.4,
  "recomendaciones": ["Mantener los hábitos actuales: consumes menos de lo esperado para un hogar como el tuyo"],
  "costo_estimado_mensual": 315.00
}
```

### Umbrales de clasificación

| Categoría | Condición |
|---|---|
| `Eficiente` | residuo ≤ **−6.906** kWh |
| `Moderado` | −6.906 < residuo ≤ **21.753** kWh |
| `Ineficiente` | residuo > **21.753** kWh |

## Integración con Back-End

El modelo se entrega en **ONNX** para su consumo desde Java sin dependencia de Python en producción.

- **Entrada:** tensor `float32` de forma `[N, 4]`, en el orden `personas`, `superficie_m2`, `cantidad_equipos`, `tipo_inmueble_cod`
- **Salida:** tensor `float32` de forma `[N, 1]` con el consumo esperado en kWh
- **Codificación:** `"Casa"` → `0.0`, `"Departamento"` → `1.0`

El modelo recibe **valores crudos**: no hay escalado ni codificación one-hot que replicar en Java.

La lógica de negocio (categorización, recomendaciones y costo) es aritmética simple y está documentada con código Java listo para copiar en [`docs/BACKEND_ONNX.md`](docs/BACKEND_ONNX.md).

### Despliegue en OCI

1. Subir `models/modelo_A.onnx` a **OCI Object Storage**.
2. La API lo descarga **al arrancar** (no en cada petición) y mantiene una única `OrtSession` reutilizable.
3. Si la descarga o la carga falla, responder `503 Service Unavailable` en lugar de arrancar en un estado inservible.

## Limitaciones conocidas

Las documentamos de forma proactiva porque forman parte de un análisis honesto.

**El dataset presenta indicios claros de generación sintética:** identidades matemáticas exactas entre columnas, cero valores nulos en 30.000 filas, y diferencias mínimas de consumo entre países, estaciones y perfiles de uso (todas las medias rondan los 410 kWh). La metodología es transferible a datos reales de medidor sin cambios estructurales, pero los coeficientes concretos deberían recalibrarse.

**Solo `personas` y `superficie_m2` muestran relación real con el consumo** (correlación 0.71 y 0.63). El resto de variables estructurales —conteos de electrodomésticos, temperatura, baños— tienen correlación cercana a cero en este dataset. Esto es casi con certeza un artefacto de la generación sintética: en datos reales, el aire acondicionado y la temperatura sí influyen físicamente en el consumo.

**El Modelo B explica solo el 23% del residuo.** El comportamiento humano tiene más grados de libertad que tres variables. Inflar esta métrica artificialmente sería menos defendible que aceptar la limitación.

**El dataset no tiene dimensión temporal.** Es una fotografía única por vivienda, por lo que el requisito opcional de "seguimiento a lo largo del tiempo" no puede demostrarse con estos datos. La arquitectura propuesta (persistir cada análisis con marca temporal) está descrita en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Historial de versiones

| Versión | Enfoque | Por qué se superó |
|---|---|---|
| v1 | Clasificación sobre la etiqueta original del dataset | Fuga de información: 100% de accuracy leyendo una sola columna |
| v2 | Índice de intensidad construido a mano | Circular: el target salía de las mismas variables de entrada |
| v3 | Clasificador sobre contrato de 5 campos | Circular por obligación del contrato; F1 0.83 vs baseline 0.19 |
| **v4** | **Motor de residuo sobre contrato ampliado** | **Actual. No circular: R² 0.88 sobre consumo real medido** |

Las versiones previas se conservan en `notebooks/archivo/` por trazabilidad metodológica.

---

## Documentación adicional

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — decisiones de diseño y su justificación con datos
- [`docs/BACKEND_ONNX.md`](docs/BACKEND_ONNX.md) — contrato ONNX, código Java y casos de prueba
- [`docs/DICCIONARIO_DATOS.md`](docs/DICCIONARIO_DATOS.md) — rol de cada columna y motivo de las exclusiones
