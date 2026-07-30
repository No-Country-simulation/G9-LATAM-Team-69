package com.bag.api_energy_model_test.service;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import com.bag.api_energy_model_test.dto.PredictionRequest;
import com.bag.api_energy_model_test.dto.PredictionResponse;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
public class OnnxModelService {

  private static final double TARIFA_KWH = 0.75; // $/kWh, tarifa de referencia del reto

  // --- Modelo A (LinearRegression sobre normalizadores) — coeficientes del notebook de DS.
  //     Se usan para el residual y derivar la 'probabilidad' como confianza calibrada. ---
  private static final double A_PERSONAS = 34.728;
  private static final double A_SUPERFICIE = 1.285;
  private static final double A_EQUIPOS = -0.193;
  private static final double A_TIPO_DEPTO = 0.383;
  private static final double A_INTERCEPTO = 148.099;
  // Umbrales del residual (percentiles 40 y 75 del entrenamiento)
  private static final double UMBRAL_EFICIENTE = -6.91;
  private static final double UMBRAL_MODERADO = 21.74;
  // Escala de la curva de confianza (kWh): mayor = confianza crece más despacio con la distancia
  private static final double ESCALA_CONFIANZA = 30.0;

  @Value("${onnx.model.path:https://objectstorage.sa-santiago-1.oraclecloud.com/p/Xy_nBCKh7MTQnoVaHK0TQh37BtkYwctssIjIO49vEs8369aN5afxA90QrP7ASHtm/n/axexzonjzvlk/b/pre_bucket_g9/o/}")
  private Resource modelResource;

  private OrtEnvironment env;
  private OrtSession session;
  private String inputName;

  @PostConstruct
  public void init() {
    try {
      env = OrtEnvironment.getEnvironment();
      byte[] modelBytes = modelResource.getInputStream().readAllBytes();
      session = env.createSession(modelBytes, new OrtSession.SessionOptions());
      inputName = session.getInputNames().iterator().next();
    } catch (Exception e) {
      throw new RuntimeException("Error al cargar el modelo ONNX", e);
    }
  }

  @PreDestroy
  public void close() throws OrtException {
    if (session != null) session.close();
    if (env != null) env.close();
  }

  public PredictionResponse predict(PredictionRequest request) {
    validar(request);

    float[] features = constructVector(request);
    String categoria = executeModel(features);        // etiqueta desde el clasificador ONNX
    double probabilidad = calcularConfianza(request);  // confianza calibrada (0.5 .. ~1.0)

    List<String> recomendaciones = generarRecomendaciones(request, categoria);
    double costoEstimado = redondear(request.getConsumoKwh() * TARIFA_KWH);

    return PredictionResponse.builder()
        .categoria(categoria)
        .probabilidad(redondear(probabilidad))
        .recomendaciones(recomendaciones)
        .costoEstimadoMensual(costoEstimado)
        .build();
  }

  /** Consumo esperado para la estructura de la vivienda (Modelo A). */
  private double consumoEsperado(PredictionRequest r) {
    double tipo = r.getTipoInmueble().equalsIgnoreCase("Departamento") ? 1.0 : 0.0;
    return A_PERSONAS * r.getPersonas()
        + A_SUPERFICIE * r.getSuperficieM2()
        + A_EQUIPOS * r.getCantidadEquipos()
        + A_TIPO_DEPTO * tipo
        + A_INTERCEPTO;
  }

  /**
   * Probabilidad = confianza según cuán lejos está el residual de la frontera entre categorías.
   * Justo en el umbral -> 0.5 (caso ambiguo); cuanto más claro el caso, más se acerca a 1.0.
   */
  private double calcularConfianza(PredictionRequest r) {
    double residual = r.getConsumoKwh() - consumoEsperado(r);
    double dist = Math.min(Math.abs(residual - UMBRAL_EFICIENTE),
                           Math.abs(residual - UMBRAL_MODERADO));
    return 0.5 + 0.5 * (1.0 - Math.exp(-dist / ESCALA_CONFIANZA));
  }

  /** Valida que lleguen los 8 campos del contrato; si falta alguno responde 400. */
  private void validar(PredictionRequest r) {
    List<String> faltan = new ArrayList<>();
    if (r.getConsumoKwh() == null) faltan.add("consumo_kwh");
    if (r.getPersonas() == null) faltan.add("personas");
    if (r.getSuperficieM2() == null) faltan.add("superficie_m2");
    if (r.getCantidadEquipos() == null) faltan.add("cantidad_equipos");
    if (r.getTipoInmueble() == null) faltan.add("tipo_inmueble");
    if (r.getUsoHorarioPico() == null) faltan.add("uso_horario_pico");
    if (r.getHorasAltoConsumo() == null) faltan.add("horas_alto_consumo");
    if (r.getPanelSolar() == null) faltan.add("panel_solar");
    if (!faltan.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Faltan campos obligatorios: " + String.join(", ", faltan));
    }
  }

  /**
   * Orden EXACTO esperado por el modelo ONNX (clasificador de 8 features):
   * [consumo_kwh, personas, superficie_m2, cantidad_equipos, tipo_inmueble_num,
   *  uso_horario_pico, horas_alto_consumo, panel_solar]
   */
  private float[] constructVector(PredictionRequest request) {
    float tipoInmueble =
        request.getTipoInmueble().equalsIgnoreCase("Departamento") ? 1.0f : 0.0f;
    float usoPico = Boolean.TRUE.equals(request.getUsoHorarioPico()) ? 1.0f : 0.0f;
    float panelSolar = Boolean.TRUE.equals(request.getPanelSolar()) ? 1.0f : 0.0f;

    return new float[] {
      request.getConsumoKwh().floatValue(),
      request.getPersonas().floatValue(),
      request.getSuperficieM2().floatValue(),
      request.getCantidadEquipos().floatValue(),
      tipoInmueble,
      usoPico,
      request.getHorasAltoConsumo().floatValue(),
      panelSolar
    };
  }

  /** Ejecuta el clasificador ONNX y devuelve la categoría (salida 0 = etiqueta String). */
  private String executeModel(float[] features) {
    try (OnnxTensor tensor =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(features), new long[] {1, features.length})) {

      Map<String, OnnxTensor> inputs = Collections.singletonMap(inputName, tensor);

      try (OrtSession.Result result = session.run(inputs)) {
        String[] labels = (String[]) result.get(0).getValue();
        return labels[0];
      }
    } catch (OrtException e) {
      throw new RuntimeException("Error al ejecutar el modelo ONNX", e);
    }
  }

  /** Reglas de recomendación (portadas del notebook de Ciencia de Datos). */
  private List<String> generarRecomendaciones(PredictionRequest r, String categoria) {
    List<String> recs = new ArrayList<>();
    boolean usoPico = Boolean.TRUE.equals(r.getUsoHorarioPico());
    boolean panelSolar = Boolean.TRUE.equals(r.getPanelSolar());

    if (usoPico) {
      recs.add("Reducir el uso de equipos durante los horarios pico");
    }
    if (r.getHorasAltoConsumo() >= 9) {
      recs.add("Distribuir las actividades de mayor consumo a lo largo del día");
    }
    if (r.getCantidadEquipos() >= 10) {
      recs.add("Evaluar equipos con alto consumo energético");
    }
    if (!panelSolar && !"Eficiente".equals(categoria)) {
      recs.add("Evaluar la instalación de paneles solares para autoconsumo");
    }
    if ("Eficiente".equals(categoria) && recs.isEmpty()) {
      recs.add("Mantener los hábitos actuales de consumo eficiente");
    }
    if (recs.isEmpty()) {
      recs.add("Monitorear el consumo con un medidor inteligente");
    }
    return recs;
  }

  private double redondear(double x) {
    return Math.round(x * 100.0) / 100.0;
  }
}
