package com.bag.api_energy_model_test.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.util.List;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PredictionResponse {

  private String categoria;

  private double probabilidad;

  private List<String> recomendaciones;

  @JsonProperty("costo_estimado_mensual")
  private double costoEstimadoMensual;
}
