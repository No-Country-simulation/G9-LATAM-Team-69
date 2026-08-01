package com.bag.api_energy_model_test.service;

import com.bag.api_energy_model_test.dto.PredictionRequest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests de coherencia del motor de recomendaciones (no requiere el modelo ONNX ni contexto Spring).
 * Portan el barrido de coherencia que estaba en el notebook de Ciencia de Datos.
 */
class RecomendacionEngineTest {

  private final RecomendacionEngine engine = new RecomendacionEngine();

  private PredictionRequest req(double consumo, int personas, double superficie, int equipos,
                                String tipo, boolean pico, int horas, boolean panel) {
    return new PredictionRequest(consumo, personas, superficie, equipos, tipo, pico, horas, panel);
  }

  private static final String REC_SOLAR =
      "A mediano plazo, evaluar la instalación de paneles solares como inversión de autoconsumo";

  @Test
  void nuncaDevuelveListaVacia() {
    for (String cat : List.of("Eficiente", "Moderado", "Ineficiente")) {
      for (boolean pico : new boolean[] {true, false}) {
        for (int horas : new int[] {4, 8, 11}) {
          for (int equipos : new int[] {4, 9, 13}) {
            for (boolean panel : new boolean[] {true, false}) {
              List<String> recs =
                  engine.generar(req(300, 3, 80, equipos, "Casa", pico, horas, panel), cat);
              assertFalse(recs.isEmpty(), "Recomendaciones vacías para categoría " + cat);
            }
          }
        }
      }
    }
  }

  @Test
  void eficienteSoloRecibeRefuerzoPositivo() {
    // Aunque tenga palancas "malas", un Eficiente no debe recibir correctivas.
    List<String> recs = engine.generar(req(150, 4, 90, 12, "Casa", true, 11, false), "Eficiente");
    assertEquals(1, recs.size());
    assertTrue(recs.get(0).toLowerCase().contains("mantener"));
    assertFalse(recs.contains(REC_SOLAR));
  }

  @Test
  void panelesSoloParaIneficienteSinPanel() {
    assertTrue(engine.generar(req(500, 3, 80, 10, "Casa", true, 10, false), "Ineficiente")
        .contains(REC_SOLAR), "Ineficiente sin panel debería recibir la recomendación de paneles");
    assertFalse(engine.generar(req(300, 3, 80, 10, "Casa", true, 10, false), "Moderado")
        .contains(REC_SOLAR), "Moderado no debería recibir la recomendación de paneles");
    assertFalse(engine.generar(req(500, 3, 80, 10, "Casa", true, 10, true), "Ineficiente")
        .contains(REC_SOLAR), "Con panel no debería recomendarse instalar paneles");
  }

  @Test
  void usoPicoDisparaSuRecomendacion() {
    List<String> recs = engine.generar(req(300, 3, 80, 5, "Casa", true, 4, true), "Moderado");
    assertTrue(recs.stream().anyMatch(s -> s.toLowerCase().contains("horarios pico")));
  }
}
