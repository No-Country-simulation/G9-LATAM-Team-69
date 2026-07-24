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
import org.springframework.stereotype.Service;

import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.Map;

@Service
public class OnnxModelService {

  private static final double UMBRAL_EFICIENTE = -6.906;
  private static final double UMBRAL_MODERADO = 21.753;

  private static final double TARIFA_KWH = 0.75;

  @Value("${onnx.model.path:classpath:model/model.onnx}")
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
    float[] features = constructVector(request);
    double consumoEsperado = executeModel(features);

    double residuo = request.getConsumoKwh() - consumoEsperado;
    String categoria = classify(residuo);
    double desviacionPorcentual = (residuo / consumoEsperado) * 100.0;
    double costoEstimado = request.getConsumoKwh() * TARIFA_KWH;

    return new PredictionResponse(
        categoria, consumoEsperado, residuo, desviacionPorcentual, costoEstimado);
  }

  private float[] constructVector(PredictionRequest request) {

    float tipoInmueble = request.getTipoInmueble().equalsIgnoreCase("Departamento") ? 1.0f : 0.0f;
    return new float[] {
      request.getPersonas().floatValue(),
      request.getSuperficieM2().floatValue(),
      request.getCantidadEquipos().floatValue(),
      tipoInmueble
    };
  }

  private double executeModel(float[] features) {
    try (OnnxTensor tensor =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(features), new long[] {1, features.length})) {

      Map<String, OnnxTensor> inputs = Collections.singletonMap(inputName, tensor);

      try (OrtSession.Result result = session.run(inputs)) {

        Object value = result.get(0).getValue();
        if (value instanceof float[][] output) {
          return output[0][0];
        }
        throw new RuntimeException("Formato de salida no soportado");
      }
    } catch (OrtException e) {
      throw new RuntimeException("Error al ejecutar el modelo ONNX", e);
    }
  }

  private String classify(double residuo) {
    if (residuo <= UMBRAL_EFICIENTE) return "Eficiente";
    if (residuo <= UMBRAL_MODERADO) return "Moderado";
    return "Ineficiente";
  }
}
