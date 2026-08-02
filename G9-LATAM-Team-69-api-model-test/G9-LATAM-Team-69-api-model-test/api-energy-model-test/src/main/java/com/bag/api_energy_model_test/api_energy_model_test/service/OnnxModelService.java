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
  // Distribución empírica del residual: percentiles 0..100 sobre 30.000 viviendas del dataset.
  // Enfoque cuantílico (homoscedástico) para ubicar el residual de forma calibrada por los datos.
  private static final double[] PCTL_RESIDUAL = {
    -123.7,-81.8,-67.3,-54.3,-49.8,-46.5,-44.0,-41.9,-39.8,-38.2,-36.4,-35.0,-33.5,-32.2,-31.0,
    -29.8,-28.6,-27.3,-26.3,-25.2,-24.2,-23.2,-22.2,-21.3,-20.3,-19.5,-18.6,-17.7,-16.9,-16.1,
    -15.2,-14.3,-13.4,-12.6,-11.8,-11.0,-10.1,-9.2,-8.4,-7.7,-6.9,-6.2,-5.3,-4.5,-3.6,-2.8,-1.9,
    -1.1,-0.3,0.4,1.2,2.0,2.8,3.7,4.4,5.2,6.1,6.9,7.7,8.6,9.4,10.2,11.1,11.8,12.6,13.5,14.3,15.1,
    15.9,16.7,17.6,18.4,19.2,20.0,20.8,21.7,22.6,23.4,24.3,25.2,26.1,27.0,28.0,28.9,29.9,31.0,
    32.0,33.1,34.2,35.4,36.6,37.8,39.2,40.6,42.1,43.9,46.0,48.1,50.8,54.3,61.7
  };
  // Escala (en puntos de percentil) para la confianza: mayor distancia a la frontera 40/75 = más confianza.
  private static final double ESCALA_PCTL = 20.0;

  @Value("${onnx.model.path:https://objectstorage.sa-santiago-1.oraclecloud.com/p/Xy_nBCKh7MTQnoVaHK0TQh37BtkYwctssIjIO49vEs8369aN5afxA90QrP7ASHtm/n/axexzonjzvlk/b/pre_bucket_g9/o/}")
  private Resource modelResource;

  private OrtEnvironment env;
  private OrtSession session;
  private String inputName;

  private final RecomendacionEngine recomendacionEngine;

  public OnnxModelService(RecomendacionEngine recomendacionEngine) {
    this.recomendacionEngine = recomendacionEngine;
  }

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

    List<String> recomendaciones = recomendacionEngine.generar(request, categoria);
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
   * Probabilidad = confianza basada en el PERCENTIL del residual dentro de la distribución
   * empírica (30.000 viviendas) — enfoque cuantílico. Cerca de la frontera 40/75 -> ~0.5;
   * lejos -> ~1.0. Reemplaza el parche por distancia en kWh con un valor calibrado por los datos.
   */
  private double calcularConfianza(PredictionRequest r) {
    double residual = r.getConsumoKwh() - consumoEsperado(r);
    double p = percentilResidual(residual);                       // 0..100
    double distFrontera = Math.min(Math.abs(p - 40), Math.abs(p - 75));
    return 0.5 + 0.5 * Math.min(1.0, distFrontera / ESCALA_PCTL);
  }

  /** Percentil (0..100) del residual en la distribución empírica, por interpolación lineal. */
  private double percentilResidual(double residual) {
    if (residual <= PCTL_RESIDUAL[0]) return 0;
    if (residual >= PCTL_RESIDUAL[100]) return 100;
    for (int i = 0; i < 100; i++) {
      if (residual >= PCTL_RESIDUAL[i] && residual <= PCTL_RESIDUAL[i + 1]) {
        double d = PCTL_RESIDUAL[i + 1] - PCTL_RESIDUAL[i];
        return i + (d != 0 ? (residual - PCTL_RESIDUAL[i]) / d : 0);
      }
    }
    return 50;
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

  private double redondear(double x) {
    return Math.round(x * 100.0) / 100.0;
  }
}
