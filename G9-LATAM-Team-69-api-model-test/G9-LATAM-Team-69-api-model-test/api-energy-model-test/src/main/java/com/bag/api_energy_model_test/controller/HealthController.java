package com.bag.api_energy_model_test.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Endpoint de salud para monitoreo y para generar tráfico que evite que OCI marque la
 * instancia como inactiva (un monitor externo puede hacer ping periódico a /api/v1/health).
 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {

  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("status", "UP");
  }
}
