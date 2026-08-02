package com.bag.api_energy_model_test.service;

import com.bag.api_energy_model_test.dto.PredictionRequest;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Genera recomendaciones accionables a partir de las palancas de consumo y la categoría.
 *
 * Principios de diseño (Fase 1 de mejoras):
 *  - Sin recomendaciones "de relleno": solo se emite un consejo cuando la palanca realmente aplica.
 *  - Un perfil Eficiente recibe refuerzo positivo, no consejos correctivos que serían contradictorios.
 *  - La instalación de paneles solares NO es una palanca de hábito sino una inversión: se plantea
 *    solo para el peor perfil (Ineficiente) sin panel, y explícitamente como inversión de mediano plazo.
 */
@Component
public class RecomendacionEngine {

  private static final int UMBRAL_HORAS_ALTO = 9;
  private static final int UMBRAL_MUCHOS_EQUIPOS = 10;

  public List<String> generar(PredictionRequest r, String categoria) {
    List<String> recs = new ArrayList<>();

    boolean eficiente = "Eficiente".equals(categoria);
    boolean ineficiente = "Ineficiente".equals(categoria);
    boolean usoPico = Boolean.TRUE.equals(r.getUsoHorarioPico());
    boolean panelSolar = Boolean.TRUE.equals(r.getPanelSolar());
    int horas = r.getHorasAltoConsumo() != null ? r.getHorasAltoConsumo() : 0;
    int equipos = r.getCantidadEquipos() != null ? r.getCantidadEquipos() : 0;

    // Perfil eficiente: refuerzo positivo, sin correctivas.
    if (eficiente) {
      recs.add("Mantener los hábitos actuales de consumo eficiente");
      return recs;
    }

    // Palancas de hábito (accionables sin inversión): solo si la palanca aplica.
    if (usoPico) {
      recs.add("Reducir el uso de equipos durante los horarios pico");
    }
    if (horas >= UMBRAL_HORAS_ALTO) {
      recs.add("Distribuir las actividades de mayor consumo a lo largo del día");
    }
    if (equipos >= UMBRAL_MUCHOS_EQUIPOS) {
      recs.add("Evaluar los equipos de mayor consumo y priorizar reemplazos eficientes");
    }

    // Recomendación de inversión (marcada como tal): solo para el peor perfil y sin panel.
    if (ineficiente && !panelSolar) {
      recs.add("A mediano plazo, evaluar la instalación de paneles solares como inversión de autoconsumo");
    }

    // Si ninguna palanca aplicó, dar un consejo concreto y útil (no relleno genérico).
    if (recs.isEmpty()) {
      recs.add("Revisar el consumo en horas punta y priorizar equipos de bajo consumo");
    }
    return recs;
  }
}
