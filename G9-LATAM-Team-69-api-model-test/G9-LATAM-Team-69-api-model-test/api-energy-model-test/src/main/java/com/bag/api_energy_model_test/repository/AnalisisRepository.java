package com.bag.api_energy_model_test.repository;

import com.bag.api_energy_model_test.model.Analisis;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AnalisisRepository extends JpaRepository<Analisis, Long> {

  /** Historial de un usuario, en orden cronológico (para comparar períodos). */
  List<Analisis> findByEmailOrderByFechaAsc(String email);
}
