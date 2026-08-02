package com.bag.api_energy_model_test.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/** Un análisis guardado, asociado al email del usuario (para el historial y la comparación). */
@Entity
@Table(name = "ANALISIS")
@Getter
@Setter
public class Analisis {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  private String email;

  private LocalDateTime fecha;

  @JsonProperty("consumo_kwh")
  private Double consumoKwh;

  @JsonProperty("costo_estimado_mensual")
  private Double costo;

  private String categoria;

  private Double probabilidad;
}
