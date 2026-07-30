const API_URL = "http://localhost:8080/api/v1/onnx/prediction";

document.addEventListener("DOMContentLoaded", () => {
  const vistaInicio = document.getElementById("vista-inicio");
  const vistaFormulario = document.getElementById("vista-formulario");
  const vistaResultado = document.getElementById("vista-resultado");
  const btnComenzar = document.getElementById("btnComenzar");
  const btnVolver = document.getElementById("btnVolver");
  const form = document.getElementById("formAnalisis");
  const errorMsg = document.getElementById("errorMsg");

  btnComenzar.addEventListener("click", () => {
    vistaInicio.hidden = true;
    vistaFormulario.hidden = false;
  });

  btnVolver.addEventListener("click", () => {
    vistaResultado.hidden = true;
    vistaFormulario.hidden = false;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorMsg.textContent = "";

    const data = new FormData(form);
    const payload = {
      consumo_kwh: parseFloat(data.get("consumo_kwh")),
      personas: parseInt(data.get("personas"), 10),
      superficie_m2: parseFloat(data.get("superficie_m2")),
      cantidad_equipos: parseInt(data.get("cantidad_equipos"), 10),
      tipo_inmueble: data.get("tipo_inmueble"),
      uso_horario_pico: data.get("uso_horario_pico") === "on",
      horas_alto_consumo: parseInt(data.get("horas_alto_consumo"), 10),
      panel_solar: data.get("panel_solar") === "on",
    };

    const btnSubmit = form.querySelector("button[type='submit']");
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Calculando...";

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Error del servidor (${response.status})`);
      }

      const resultado = await response.json();

      document.getElementById("resCategoria").textContent = resultado.categoria;
      document.getElementById("resProbabilidad").textContent =
        "Confianza: " + Math.round(resultado.probabilidad * 100) + "%";
      document.getElementById("resCosto").textContent =
        "$" + resultado.costo_estimado_mensual.toFixed(2);

      const lista = document.getElementById("resRecomendaciones");
      lista.innerHTML = "";
      (resultado.recomendaciones || []).forEach((rec) => {
        const li = document.createElement("li");
        li.textContent = rec;
        lista.appendChild(li);
      });

      vistaFormulario.hidden = true;
      vistaResultado.hidden = false;
    } catch (error) {
      errorMsg.textContent =
        "No se pudo conectar con la API. Verificá que esté corriendo en " + API_URL + ".";
      console.error(error);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Calcular";
    }
  });
});
