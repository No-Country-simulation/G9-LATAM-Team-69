# Ciencia de Datos — Metodología

Documenta cómo se definió, entrenó y sirvió el modelo. El notebook completo es
`G9_DataScience_analisis_energetico.ipynb`.

## 1. Dataset

`consumo_energia_sudamerica.csv` — construido por el equipo. **30.000 viviendas** de 5 países
(Perú, Argentina, Uruguay, Chile, Colombia), 32 columnas por vivienda (estructura, consumo,
reparto horario, equipamiento, variables financieras). Sin nulos ni duplicados.

## 2. El problema central: *data leakage*

Antes de modelar se auditó el dataset y se encontraron tres fugas de información que producirían
un modelo con precisión artificialmente perfecta pero inútil:

1. **Segmentos horarios**: `punta + valle + normal = consumo_mes` exactamente → son el objetivo disfrazado.
2. **Variables financieras**: `gasto = consumo × tarifa` exactamente → otra copia del objetivo.
3. **Etiqueta original inservible**: la columna `eficiencia_energetica` (Alta/Media/Baja) del
   dataset tiene un consumo por persona **casi idéntico** entre sus tres clases (≈152 kWh en las
   tres) → **no refleja eficiencia real**.

**Decisiones:** se excluyen las variables horarias segmentadas y las financieras del modelo, y se
**descarta la etiqueta original**. En su lugar, el equipo define su propia medida de eficiencia.

## 3. Definición de eficiencia: normalizadores vs palancas

Una casa de 5 personas siempre consume más que una de 2 — eso no la hace ineficiente. Por eso se
separan las variables:

- **Normalizadores** (estructura, no controlable a corto plazo): `personas`, `superficie_m2`,
  `cantidad_equipos`, `tipo_inmueble`. → Predicen el **consumo esperado**.
- **Palancas** (hábitos modificables): `uso_horario_pico`, `horas_alto_consumo`, `panel_solar`.
  → Explican el residual y alimentan las recomendaciones.

La eficiencia se define como el **residual** = consumo real − consumo esperado. Consumir *menos*
de lo esperado para tu estructura = eficiente.

## 4. Entrenamiento (dos etapas)

**Modelo A — consumo esperado.** `LinearRegression` sobre los 4 normalizadores. **R² ≈ 0.88**:
la estructura explica el 88 % de la variación del consumo. El residual se corta por percentiles
(≈40 y ≈75) para las tres categorías, con distribución 40 % / 35 % / 25 %. Validación: el consumo
por persona crece de forma monótona entre clases (Eficiente 142 → Moderado 155 → Ineficiente 166
kWh), a diferencia de la etiqueta original.

**Clasificador supervisado.** Sobre los 8 campos del contrato se comparan **Random Forest** vs
**Regresión Logística** (partición 80/20, validación cruzada de 5 pliegues), evaluando con
*accuracy*, *F1-macro* y matriz de confusión. El clasificador se exporta a **ONNX** con `skl2onnx`.

## 5. La probabilidad

Como la etiqueta se deriva de forma determinista del residual, las clases son casi perfectamente
separables y el `predict_proba` del clasificador se satura en 0/1 (probabilidad casi siempre 1.0),
lo cual es poco informativo.

**Solución adoptada en la API:** la probabilidad se calcula como una **confianza calibrada por la
distancia del residual a la frontera** entre categorías: 0.5 justo en el umbral (caso ambiguo),
subiendo suavemente hacia 1.0 cuanto más claro es el caso. Es una medida transparente y
explicable ("qué tan lejos está esta vivienda del límite entre categorías"). La categoría sigue
saliendo del clasificador ONNX; la probabilidad de esta fórmula, usando los coeficientes del
Modelo A y los umbrales del residual.

## 6. Recomendaciones

Motor de **reglas** sobre las palancas y la categoría (no un modelo): trazables y coherentes con
la clasificación. Ejemplos: si usa horario punta → desplazar carga; si tiene muchas horas de alto
consumo → distribuir actividades; si tiene muchos equipos → evaluar los de alto consumo. Se validó
con un barrido de miles de combinaciones que ninguna respuesta queda vacía ni contradice la categoría.

## 7. Estimación financiera

`costo_estimado_mensual = consumo_kwh × 0.75`, con la tarifa de referencia sugerida por el reto.

## 8. Serialización

El clasificador se exporta a `model.onnx` (con las probabilidades como tensor limpio, sin ZipMap).
El back-end Java lo carga con ONNX Runtime, enviando un vector de 8 *features* en este orden exacto:

```
[consumo_kwh, personas, superficie_m2, cantidad_equipos,
 tipo_inmueble_num, uso_horario_pico, horas_alto_consumo, panel_solar]
```

(`tipo_inmueble_num`: Departamento=1, Casa=0; booleanos como 1/0). Orden de clases del vector de
probabilidades (alfabético): `['Eficiente','Ineficiente','Moderado']`.

## 9. Cumplimiento de los entregables de Ciencia de Datos

| Entregable | Dónde |
|---|---|
| EDA (exploración y limpieza) | Notebook, secciones 2–3 |
| Análisis de patrones | Notebook, sección 3 |
| Transformación de variables | Notebook, secciones 4–5 |
| Modelos supervisados | Notebook, sección 7 |
| Evaluación con métricas | Notebook, sección 7 |
| Recomendaciones | Notebook, sección 8 · API |
| Serialización del modelo | Notebook, sección 12 (ONNX) |
| Manejo de leakage / criterios justificados | Notebook, secciones 4, 6 |
