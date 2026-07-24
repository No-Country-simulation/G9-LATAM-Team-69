package com.bag.api_energy_model_test.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PredictionResponse {

  private String categoria;

  @JsonProperty("consumo_esperado_kwh")
  private double consumoEsperadoKwh;

  @JsonProperty("consumo_real_kwh")
  private double residuoKwh;

  @JsonProperty("desviacion_porcentual")
  private double desviacionPorcentual;

  @JsonProperty("costo_estimado_mensual")
  private double costoEstimadoMensual;
}
