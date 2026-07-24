package com.bag.api_energy_model_test.controller;

import com.bag.api_energy_model_test.dto.PredictionRequest;
import com.bag.api_energy_model_test.dto.PredictionResponse;
import com.bag.api_energy_model_test.service.OnnxModelService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/onnx")
public class OnnxModelController {

  private final OnnxModelService onnxModelService;

  @PostMapping("/prediction")
  public ResponseEntity<PredictionResponse> prediction(@RequestBody PredictionRequest request) {
    PredictionResponse response = onnxModelService.predict(request);
    return ResponseEntity.ok(response);
  }
}
