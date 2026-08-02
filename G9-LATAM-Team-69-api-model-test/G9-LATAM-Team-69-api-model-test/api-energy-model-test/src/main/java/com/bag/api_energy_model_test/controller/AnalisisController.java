package com.bag.api_energy_model_test.controller;

import com.bag.api_energy_model_test.model.Analisis;
import com.bag.api_energy_model_test.repository.AnalisisRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;

/** Guarda y lista análisis por email — base de la comparación entre períodos. */
@RestController
@RequestMapping("/api/v1/analisis")
public class AnalisisController {

  private final AnalisisRepository repo;

  public AnalisisController(AnalisisRepository repo) {
    this.repo = repo;
  }

  @PostMapping
  public Analisis guardar(@RequestBody Analisis analisis) {
    if (analisis.getEmail() == null || analisis.getEmail().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta el email del usuario");
    }
    analisis.setId(null);                     // que la BD genere el id
    analisis.setFecha(LocalDateTime.now());   // fecha del servidor
    return repo.save(analisis);
  }

  @GetMapping
  public List<Analisis> listar(@RequestParam String email) {
    return repo.findByEmailOrderByFechaAsc(email);
  }
}
