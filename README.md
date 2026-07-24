# Análisis Inteligente del Consumo Energético — Ciencia de Datos

**Hackathon ONE — Alura + Oracle · Equipo G9**

Sistema que analiza el consumo eléctrico de una vivienda, clasifica su perfil de eficiencia energética, genera recomendaciones accionables y estima el impacto financiero. El modelo se entrega en formato **ONNX** para su integración con una API REST en Java/Spring Boot desplegada sobre **Oracle Cloud Infrastructure (OCI)**.

---

## Tabla de contenidos

- [El problema](#el-problema)
- [Nuestro enfoque](#nuestro-enfoque)
- [El hallazgo diferencial: fuga de información](#el-hallazgo-diferencial-fuga-de-información)
- [Resultados](#resultados)
- [Instalación y uso](#instalación-y-uso)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Contrato de la API](#contrato-de-la-api)
- [Integración con Back-End](#integración-con-back-end)
- [Despliegue en OCI](#despliegue-en-oci)
- [Diccionario de datos](#diccionario-de-datos)
- [Decisiones de diseño](#decisiones-de-diseño)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Trabajo futuro](#trabajo-futuro)

---

## El problema

Muchas personas reciben facturas de electricidad elevadas pero tienen poca visibilidad sobre qué hábitos impactan realmente en su gasto. El reto pedía construir un MVP capaz de analizar patrones de consumo, clasificar perfiles de eficiencia, generar recomendaciones y estimar costos.

El enunciado exige explícitamente que cada equipo **defina y justifique** sus propios criterios de eficiencia energética. Este documento recoge esa justificación con evidencia, no con afirmaciones.

---

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

Las palancas **nunca** entran al modelo de consumo esperado. Si lo hicieran, la definición de "esperado" quedaría contaminada con el comportamiento que precisamente se quiere evaluar: un hogar que usa mucho el horario punta tendría un consumo esperado más alto y dejaría de ser penalizado por ello. El sistema se volvería ciego a exactamente lo que debe detectar.

---

## El hallazgo diferencial: fuga de información

Durante la auditoría del dataset detectamos **tres vías de fuga de información** que producían métricas falsamente perfectas:

| Vía | Relación exacta encontrada |
|---|---|
| Tramos horarios | `punta + valle + normal = consumo_mes_kwh` (diferencia ~1e-15) |
| Variables financieras | `gasto_mensual_clp = consumo_mes_kwh × valor_kwh_clp` (correlación 0.9999999) |
| Variables derivadas del target | `consumo/personas`, `consumo/superficie`, `gasto/personas` |

Además, la columna `eficiencia_energetica` incluida en el dataset **también tiene fuga**: es una función determinista de `porcentaje_led` (Baja = 60–70%, Media = 71–85%, Alta = 86–100%, sin solape). Un modelo entrenado sobre ella alcanza el 100% de accuracy leyendo una sola columna, y al retirarla cae al 36% (nivel de azar con tres clases). El consumo mensual medio es prácticamente idéntico entre las tres clases: esa etiqueta no mide eficiencia energética, mide cuántas bombillas LED hay instaladas.

**Demostración reproducible** (incluida en el notebook):

| Escenario | R² | MAE |
|---|---|---|
| Con las columnas filtradas | **1.000000** | ~10⁻¹² kWh |
| Sin ellas (variables legítimas) | 0.9083 | 21.22 kWh |

Un MAE del orden de 10⁻¹² es *precisión de máquina*. Ningún fenómeno real se predice con error cero: ese número solo es posible si el target es una combinación lineal exacta de las entradas.

Por eso descartamos esa etiqueta y construimos nuestro propio criterio, documentado y justificado.

---

## Resultados

### Modelo A — Consumo esperado

| Modelo | R² | MAE (kWh) | R² validación cruzada |
|---|---|---|---|
| **Regresión Lineal** (elegido) | **0.8804** | **23.40** | 0.8830 (±0.0014) |
| Random Forest | 0.8760 | 23.79 | 0.8782 (±0.0014) |
| Baseline (predecir la media) | −0.0002 | 68.35 | — |

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

---

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

### Usar el modelo entrenado desde Python

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

---

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
│   └── 01_analisis_energetico.ipynb       # análisis completo, de EDA a serialización
│
├── models/
│   ├── modelo_A.onnx                       # para Back-End (Java)
│   ├── modelo_A_consumo_esperado.pkl       # para Python (FastAPI)
│   ├── modelo_B_atribucion.pkl
│   └── esquema.json                        # constantes y metadatos
│
└── outputs/
    ├── figuras/                            # 19 gráficos del análisis
    └── ejemplos_analisis.json              # casos de prueba
```

---

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

> **`personas` y `superficie_m2` son obligatorios.** Se evaluó permitir su ausencia con imputación de la mediana y se descartó: produce un 19.6% de evaluaciones invertidas (`Eficiente` ↔ `Ineficiente`). Si faltan, la API debe responder `400 Bad Request` — nunca un análisis de apariencia normal construido sobre una imputación sin sentido. El detalle está en [Decisiones de diseño](#4-por-qué-personas-y-superficie_m2-son-obligatorios).

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

Orden de claves: `categoria` → `consumo_esperado_kwh` → `residuo_kwh` → `desviacion_porcentual` → `recomendaciones` → `costo_estimado_mensual`.

`consumo_esperado_kwh` y `residuo_kwh` son el corazón del valor para el usuario final — conviene exponerlos, no ocultarlos.

### Umbrales de clasificación

Orden lógico: `Eficiente` → `Moderado` → `Ineficiente`

| Categoría | Condición |
|---|---|
| `Eficiente` | residuo ≤ **−6.906** kWh |
| `Moderado` | −6.906 < residuo ≤ **21.753** kWh |
| `Ineficiente` | residuo > **21.753** kWh |

---

## Integración con Back-End

### Artefactos

| Archivo | Uso |
|---|---|
| `models/modelo_A.onnx` | **Modelo para Java** — carga con ONNX Runtime |
| `models/modelo_A_consumo_esperado.pkl` | Alternativa para un microservicio Python (FastAPI) |
| `models/esquema.json` | Constantes y metadatos, JSON estricto válido |
| `outputs/ejemplos_analisis.json` | Casos entrada/salida para pruebas de integración |

### Contrato del ONNX

**El modelo recibe los valores crudos del contrato. No hay preprocesamiento que replicar.** Es una decisión de diseño deliberada: se eligió un modelo que no requiere escalado y se codificó `tipo_inmueble` como un número en lugar de usar One-Hot dentro de un `ColumnTransformer`.

**Entrada:**

- **Nombre del tensor:** `input`
- **Tipo:** `float32`
- **Forma:** `[N, 4]`

| Índice | Campo | Conversión |
|---|---|---|
| 0 | `personas` | valor directo |
| 1 | `superficie_m2` | valor directo |
| 2 | `cantidad_equipos` | valor directo |
| 3 | `tipo_inmueble` | `"Casa"` → `0.0f`, `"Departamento"` → `1.0f` |

> `consumo_kwh` **no** entra al modelo: es el valor real con el que se compara la predicción. Los tres campos opcionales tampoco: solo alimentan las recomendaciones.

**Salida:** un único tensor `float32` de forma `[N, 1]` con el **consumo esperado en kWh**. No emite clases ni probabilidades.

### Cálculo posterior en Java

```java
float consumoEsperado = salidaOnnx[0][0];
double residuo = consumoKwh - consumoEsperado;

// Cortes calibrados sobre el dataset de entrenamiento (percentiles 40 y 75 del residuo)
final double CORTE_EFICIENTE = -6.906;
final double CORTE_MODERADO  = 21.753;

String categoria;
if (residuo <= CORTE_EFICIENTE)      categoria = "Eficiente";
else if (residuo <= CORTE_MODERADO)  categoria = "Moderado";
else                                  categoria = "Ineficiente";

double desviacionPct = consumoEsperado > 0 ? (residuo / consumoEsperado) * 100.0 : 0.0;
double costoEstimado = Math.round(consumoKwh * 0.75 * 100.0) / 100.0;
```

### Alternativa sin ONNX

El Modelo A es una regresión lineal, así que si resulta más cómodo prescindir de ONNX Runtime basta con evaluar la fórmula directamente. Los coeficientes exactos están en `models/esquema.json` bajo `modelo_A.coeficientes`. Conviene mantener ONNX como ruta principal (permite cambiar de modelo sin tocar Java), pero esta fórmula sirve como verificación independiente durante la integración.

### Motor de recomendaciones en Java

**Regla estructural que no se puede romper:** si la categoría es `"Eficiente"`, se devuelve únicamente el mensaje de refuerzo y no se evalúa ninguna otra condición. Una vivienda que consume menos de lo esperado no puede recibir una recomendación de reducir. Esta garantía está validada con un test automatizado sobre 5.000 combinaciones.

```java
// Constantes de esquema.json -> modelo_B_para_java
private static final String[] PALANCAS = {"uso_horario_pico", "horas_alto_consumo", "panel_solar"};
private static final double[] COEF     = {-0.071798, -0.028888, -13.831660};
private static final double[] MEDIA    = { 0.273000,  9.239608,   0.052042};
private static final double[] DESV     = { 0.445501,  0.899404,   0.222111};
private static final double[] REF      = { 0.0,       8.5,        1.0};

private static final String[] TEXTOS = {
    "Reducir el uso de equipos durante los horarios pico",
    "Distribuir las actividades de mayor consumo a lo largo del día",
    "Evaluar la instalación de paneles solares"
};

public List<String> generarRecomendaciones(EntradaDTO e, String categoria) {

    if ("Eficiente".equals(categoria)) {
        return List.of("Mantener los hábitos actuales: consumes menos de lo esperado para un hogar como el tuyo");
    }

    double[] valores = {
        e.isUsoHorarioPico() ? 1.0 : 0.0,
        e.getHorasAltoConsumo(),
        e.isPanelSolar() ? 1.0 : 0.0
    };

    // contribución = -coef × (valor_estandarizado - referencia_estandarizada)
    // positiva  =>  esa palanca explica parte del exceso de consumo
    List<Map.Entry<String, Double>> contribuciones = new ArrayList<>();
    for (int i = 0; i < PALANCAS.length; i++) {
        double zValor = (valores[i] - MEDIA[i]) / DESV[i];
        double zRef   = (REF[i]     - MEDIA[i]) / DESV[i];
        contribuciones.add(Map.entry(TEXTOS[i], -COEF[i] * (zValor - zRef)));
    }

    return contribuciones.stream()
            .filter(x -> x.getValue() > 0.01)
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
            .limit(3)
            .map(Map.Entry::getKey)
            .collect(Collectors.toList());
}
```

### Casos de prueba de integración

Verificados contra el modelo entrenado. Si Java devuelve otra cosa, hay un error de integración (orden de features, codificación o cortes).

| # | Entrada | Esperado (kWh) | Residuo | Categoría | Costo |
|---|---|---|---|---|---|
| 1 | 420 kWh, 4 pers., 120 m², 10 eq., Casa, pico, 8 h | 439.3 | −19.3 | `Eficiente` | 315.00 |
| 2 | 210 kWh, 2 pers., 55 m², 6 eq., Depto., sin pico, 3 h | — | — | `Eficiente` | 157.50 |
| 3 | 620 kWh, 3 pers., 90 m², 18 eq., Casa, pico, 11 h | — | — | `Ineficiente` | 465.00 |

Los valores exactos están en `outputs/ejemplos_analisis.json`. El caso 1 es especialmente útil como prueba de humo: es el ejemplo canónico del enunciado, y bajo este contrato sale **Eficiente** (no `Ineficiente` como en el ejemplo ilustrativo del enunciado) porque 420 kWh está por debajo de lo esperable para ese hogar. Es el comportamiento correcto, no un error.

---

## Despliegue en OCI

1. Subir `models/modelo_A.onnx` a **OCI Object Storage**.
2. La API lo descarga **al arrancar**, no en cada petición, y mantiene una única `OrtSession` reutilizable.
3. Si la descarga o la carga falla, responder `503 Service Unavailable` en lugar de arrancar en un estado inservible.

La autenticación de OCI (archivo de configuración, claves, compartimento) suele llevar más tiempo del previsto; conviene resolverla antes que el resto del endpoint.

---

## Diccionario de datos

Dataset: `data/consumo_energia_sudamerica.csv` — 30.000 viviendas, 5 países, separador `;`, codificación `latin1`.

### Columnas utilizadas

| Columna | Rol | Tipo | Notas |
|---|---|---|---|
| `consumo_mes_kwh` | **Target** | float | Consumo mensual real. La única magnitud no discutible del sistema. |
| `personas` | Normalizador | int | Correlación con el consumo: **0.71**. La variable más predictiva del dataset. |
| `superficie_m2` | Normalizador | int | Correlación: **0.63**. Segunda más predictiva. |
| `equipos_electricos` | Normalizador | int | Correlación aislada ≈ 0. Se mantiene por completitud y porque el contrato ya lo expone. |
| `tipo_vivienda` | Normalizador | string | `Casa` o `Departamento`. Codificado como `0.0` / `1.0`. Diferencia de consumo entre ambos: 0.5 kWh (irrelevante). |
| `consumo_hora_punta_kwh` | Palanca (derivada) | float | **No se usa como magnitud.** Solo en forma de proporción. |
| `panel_solar` | Palanca | string | `Sí` / `No`. Palanca con mayor efecto medido: ~62 kWh/mes menos de red. |

### Variables derivadas

| Variable | Fórmula | Motivo |
|---|---|---|
| `uso_horario_pico` | `1.0` si el tramo punta es el de mayor consumo de los tres | El contrato lo expone como booleano |
| `horas_alto_consumo` | `clip(consumo_hora_punta / consumo_mes × 24, 0, 16)` | Proxy de horas equivalentes en punta. **No es una medición directa**: el dataset no registra horas. |
| `tipo_inmueble_cod` | `Casa` → `0.0`, `Departamento` → `1.0` | Codificación numérica para simplificar la conversión a ONNX |

### Columnas excluidas por fuga de información

Permiten reconstruir el target de forma exacta o casi exacta. Usarlas equivale a predecir el consumo con el consumo.

| Columna | Relación exacta detectada |
|---|---|
| `consumo_hora_punta_kwh` | Junto con las dos siguientes, suma exactamente `consumo_mes_kwh` (diferencia ~1e-15) |
| `consumo_hora_valle_kwh` | Ídem |
| `consumo_hora_normal_kwh` | Ídem |
| `gasto_mensual_clp` | `= consumo_mes_kwh × valor_kwh_clp` (diferencia exactamente 0) |
| `valor_kwh_clp` | Factor de la identidad anterior |
| `tarifa_clp_kwh_x100` | Variante escalada de la anterior |
| `eficiencia_energetica` | Función determinista de `porcentaje_led`, sin solape entre clases |

> Las tres columnas de tramos horarios sí se usan de forma **derivada**, como proporción del total. Una proporción no filtra la magnitud del target: saber que el 38% del consumo ocurre en punta no revela si el consumo total fue 200 o 600 kWh.

### Otras exclusiones

| Columna | Motivo |
|---|---|
| `refrigeradores`, `lavadora` | Constantes en las 30.000 filas — cero información |
| `id_vivienda` | Identificador, sin valor predictivo |
| `ciudad` | 20 valores únicos, redundante con `país` (5). Riesgo de sobreajuste sin aporte medible. |
| `recomendación` | Motor de reglas heredado del dataset; reemplazado por el motor de atribución |

### Disponibles pero sin aporte medido

Legítimas (sin fuga) y evaluadas mediante selección incremental, pero con aporte marginal al R² **exactamente cero**:

`baños`, `televisores`, `computadores`, `estufas_electricas`, `aires_acondicionados`, `temperatura_promedio`, `vehiculo_electrico`, `estación`, `perfil_uso`, `país`, `medidor_inteligente`, `porcentaje_led`

### Problemas de calidad detectados

| Problema | Detalle | Tratamiento |
|---|---|---|
| Mojibake de codificación | `SÃ­` en lugar de `Sí` | Corregido al cargar con `encoding="latin1"` y reemplazo explícito |
| Categoría corrupta | Valor `Sandy` en `recomendación`, probablemente `standby` mal codificado | Columna excluida del modelado |
| Moneda única | Todos los importes en pesos chilenos, incluidas viviendas de Perú, Argentina, Colombia y Uruguay | Columnas financieras excluidas por fuga |
| Desbalance geográfico | Chile representa aproximadamente el 50% de las filas | `país` no aporta señal (medias en torno a 410 kWh), no afecta al modelo |

---

## Decisiones de diseño

### 1. Qué significa "eficiencia"

**Opción A — Usar la etiqueta del dataset.** Descartada por fuga de información (ver sección anterior).

**Opción B — Construir un índice a mano.** Una fórmula que pondera consumo por equipo, horas de alto consumo y uso en punta. Funciona, pero es **circular**: el target se construye con las mismas variables que luego recibe el modelo, de modo que el clasificador solo aprende a reproducir nuestra propia fórmula.

**Opción C (elegida) — Residuo frente a viviendas comparables.**

| Criterio | Opción B (índice) | **Opción C (residuo)** |
|---|---|---|
| Target | Etiqueta construida por nosotros | Magnitud medida (kWh reales) |
| Circularidad | Sí, inevitable | **No** |
| Validación posible | Baseline de clase mayoritaria | **R² contra baseline de la media** |
| Mensaje al usuario | "Percentil de intensidad 78" | **"Consumes 12% más que hogares como el tuyo"** |
| Interpretabilidad | Pesos elegidos a mano | **+35 kWh por persona, +1.3 kWh por m²** |

### 2. Por qué se amplió el contrato de la API

El contrato original contemplaba cinco campos, ninguno de los cuales describe el tamaño del hogar, por lo que era imposible calcular un consumo esperado.

Antes de solicitar campos nuevos se midió cuánto aporta cada candidato, mediante selección incremental sobre el conjunto de test:

| Campo añadido | R² acumulado | Aporte marginal |
|---|---|---|
| `personas` | 0.4942 | **+0.4942** |
| `superficie_m2` | 0.8804 | **+0.3862** |
| televisores | 0.8805 | +0.0000 |
| estufas eléctricas | 0.8805 | +0.0000 |
| temperatura promedio | 0.8805 | −0.0000 |
| computadores | 0.8805 | −0.0000 |
| tipo de vivienda | 0.8805 | −0.0000 |
| aires acondicionados | 0.8805 | −0.0000 |

Dos campos aportan la totalidad del poder predictivo disponible. El resto aporta exactamente cero.

**Criterio de diseño:** cada campo adicional es fricción para la persona que rellena el formulario. Pedir dos campos con un retorno enorme es una negociación razonable; pedir diez sin retorno medible, no.

| Escenario del contrato | R² del consumo esperado | Error medio |
|---|---|---|
| Contrato original (5 campos) | −0.0014 | 68.4 kWh |
| + `personas` | 0.4909 | 50.4 kWh |
| **+ `personas` + `superficie_m2`** | **0.8759** | **23.8 kWh** |
| + todo lo demás | 0.8766 | 23.7 kWh |

### 3. Elección de algoritmo

Se eligió la Regresión Lineal sobre Random Forest por tres motivos:

1. **Mejor métrica**, aunque por poco margen.
2. **Extrapola correctamente.** Los modelos basados en árboles no extrapolan: ante valores fuera del rango visto en entrenamiento se quedan pegados a la hoja más cercana. Se verificó empíricamente con entradas extremas y el modelo lineal acertaba donde el Random Forest fallaba. Para una API pública, que puede recibir cualquier valor, esta propiedad importa más que unas centésimas de R².
3. **Grafo ONNX mínimo**, lo que reduce la superficie de fallo en la conversión y la integración.

### 4. Por qué `personas` y `superficie_m2` son obligatorios

La intuición inicial fue permitir su ausencia con una *degradación elegante*: imputar la mediana y devolver un análisis de menor precisión. Se probó y se descartó.

| Métrica del modo imputado | Resultado |
|---|---|
| Coincidencia con el análisis completo | 41.8% |
| Coincidencia esperable por azar | 34.5% |
| **Evaluaciones invertidas (Eficiente ↔ Ineficiente)** | **19.6%** |
| Correlación entre residuos | 0.34 |

Casi una de cada cinco viviendas recibiría el veredicto contrario al correcto. La razón es directa: `personas` y `superficie_m2` **son** el 88% de la señal, de modo que imputarlas no degrada la medición, la destruye.

### 5. Coherencia entre categoría y recomendaciones

En una versión anterior, el motor de recomendaciones evaluaba umbrales **independientes** de la categoría asignada. Un test automatizado sobre 4.000 combinaciones sintéticas reveló que **739 casos (18%)** eran incoherentes: viviendas clasificadas como `Eficiente` que recibían recomendaciones de reducir consumo.

**Causa raíz:** la categoría dependía de un índice combinado, mientras que las recomendaciones dependían de umbrales sueltos sobre variables individuales. Dos lógicas distintas para el mismo hogar.

**Corrección:** las recomendaciones se derivan ahora de los mismos componentes que determinan la categoría, con una regla estructural anterior a cualquier otra evaluación:

> Si la categoría es `Eficiente`, se devuelve únicamente refuerzo positivo. No se evalúa ninguna otra condición.

El notebook incluye un `assert` que recorre 5.000 combinaciones y falla visiblemente si alguien rompe la coherencia en el futuro. Resultado actual: 0 incoherencias.

### 6. Estrategia de serialización

**Solo el Modelo A se exporta a ONNX.** El Modelo B es una regresión lineal de tres coeficientes: reimplementarlo en Java es aritmética trivial, y entregar sus constantes en `esquema.json` es más simple y menos frágil que mantener un segundo archivo binario sincronizado.

El modelo recibe **valores crudos**: no requiere escalado ni codificación one-hot. La única conversión que debe hacer Java es `"Casa"` → `0.0` y `"Departamento"` → `1.0`. Esto evita el error clásico de tener que replicar en otro lenguaje las medias y desviaciones exactas de un `StandardScaler`.

---

## Limitaciones conocidas

Las documentamos de forma proactiva porque forman parte de un análisis honesto.

**El dataset presenta indicios claros de generación sintética:** identidades matemáticas exactas entre columnas sin el ruido de medición que tendría cualquier dato real, cero valores nulos en 30.000 filas, diferencias mínimas de consumo entre países, estaciones y perfiles de uso (todas las medias rondan los 410 kWh), y umbrales perfectamente limpios en la etiqueta original sin casos frontera. La metodología es transferible a datos reales de medidor sin cambios estructurales, pero los coeficientes concretos deberían recalibrarse.

**Solo `personas` y `superficie_m2` muestran relación real con el consumo** (correlación 0.71 y 0.63). El resto de variables estructurales tienen correlación cercana a cero. Esto es casi con certeza un artefacto de la generación sintética: en datos reales, el aire acondicionado y la temperatura ambiente **sí** influyen físicamente en el consumo eléctrico. El sistema debe diseñarse extensible para incorporarlas cuando se disponga de datos reales.

**El Modelo B explica solo el 23% del residuo.** El comportamiento humano tiene más grados de libertad que tres variables. Inflar esta métrica artificialmente sería menos defendible que aceptar la limitación.

**El dataset no tiene dimensión temporal.** Es una fotografía única por vivienda, por lo que el requisito opcional de "seguimiento a lo largo del tiempo" no puede demostrarse con estos datos.

---

## Trabajo futuro

Estas capas están diseñadas pero no implementadas, para mantener el foco de la entrega.

**Segmentación no supervisada.** Agrupar viviendas por forma de consumo (K-Means o mezcla de gaussianas) para descubrir perfiles naturales y usarlos como plantillas de recomendación por segmento, además de definir cohortes más finas que la regresión poblacional única.

**Detección de anomalías.** El residuo del Modelo A ya proporciona una señal de anomalía casi gratuita (umbral en desviaciones estándar). Un `IsolationForest` sobre el espacio completo de variables detectaría combinaciones atípicas que el residuo no captura.

**Seguimiento temporal.** Persistir cada análisis con `timestamp` e identificador de vivienda, de modo que el histórico se pueble con el uso real del producto. Complementariamente, un motor de simulación de ahorro ("si adoptas estas recomendaciones, tu consumo proyectado es X") ofrece comparación entre períodos hacia adelante, correctamente etiquetada como proyección y no como historial.
