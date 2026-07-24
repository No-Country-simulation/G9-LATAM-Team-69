package com.bag.api_energy_model_test.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class PredictionRequest {

  @JsonProperty("consumo_kwh")
  private Double consumoKwh;

  private Integer personas;

  @JsonProperty("superficie_m2")
  private Double superficieM2;

  @JsonProperty("cantidad_equipos")
  private Integer cantidadEquipos;

  @JsonProperty("tipo_inmueble")
  private String tipoInmueble;

  @JsonProperty("uso_horario_pico")
  private Boolean usoHorarioPico;

  @JsonProperty("horas_alto_consumo")
  private Integer horasAltoConsumo;

  @JsonProperty("panel_solar")
  private Boolean panelSolar;
}
