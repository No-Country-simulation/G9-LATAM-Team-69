// ===== EnergiAI — lógica del frontend =====
const API_URL = "/api/v1/onnx/prediction";
const TARIFA = 0.75; // $/kWh (tarifa de referencia del reto)
const HIST_KEY = "historial_energiai"; // clave de localStorage para el historial

// Coeficientes del Modelo A (LinearRegression sobre normalizadores) para estimar el consumo
// esperado en el navegador. Mismo cálculo que la API usa para el residual.
const MODELO_A = { personas: 34.728, superficie: 1.285, equipos: -0.193, depto: 0.383, base: 148.099 };

// Acciones del simulador de ahorro: cada una estima una REDUCCIÓN de consumo (%).
const ACCIONES = [
    { id: "equipos", label: "Reemplazar equipos por modelos eficientes", factor: 0.12 },
    { id: "led", label: "Cambiar la iluminación a LED", factor: 0.06 },
    { id: "habitos", label: "Redistribuir consumo y mejorar hábitos", factor: 0.08 },
    { id: "solar", label: "Instalar paneles solares (autoconsumo)", factor: 0.25 },
];

// Descripción en lenguaje claro de cada categoría.
const DESC_CAT = {
    Eficiente: "Consumes menos energía de la esperada para tu vivienda. ¡Bien hecho!",
    Moderado: "Tu consumo está dentro de lo esperado, con margen para mejorar.",
    Ineficiente: "Consumes más energía de la esperada para una vivienda como la tuya."
};

let charts = {};          // instancias de Chart.js
let estadoActual = null;  // { consumo, costo, payload }

// ---- Plugin: texto en el centro del doughnut ----
Chart.register({
    id: "centerText",
    afterDraw(chart) {
        const cfg = chart.config.options.plugins.centerText;
        if (!cfg) return;
        const { ctx, chartArea: { width, height, left, top } } = chart;
        ctx.save();
        ctx.font = "700 20px system-ui";
        ctx.fillStyle = cfg.color || "#233243";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(cfg.text, left + width / 2, top + height / 2);
        ctx.restore();
    }
});

// ---- Plugin: muestra el valor encima de cada barra ----
Chart.register({
    id: "barLabels",
    afterDatasetsDraw(chart) {
        if (chart.config.type !== "bar") return;
        const cfg = chart.config.options.plugins.barLabels;
        if (!cfg) return;
        const { ctx } = chart;
        chart.data.datasets.forEach((ds, i) => {
            chart.getDatasetMeta(i).data.forEach((bar, idx) => {
                const v = ds.data[idx];
                ctx.save();
                ctx.font = "700 14px system-ui";
                ctx.fillStyle = "#233243";
                ctx.textAlign = "center";
                ctx.fillText(cfg.money ? money(v) : Math.round(v), bar.x, bar.y - 6);
                ctx.restore();
            });
        });
    }
});

function money(n) { return "$" + Math.round(n).toLocaleString("es-CL"); }
function colorCategoria(cat) {
    return cat === "Eficiente" ? "#2E9E5B" : cat === "Moderado" ? "#E0A800" : "#D0473B";
}

document.addEventListener("DOMContentLoaded", () => {
    const vistaInicio = document.getElementById("vista-inicio");
    const vistaForm = document.getElementById("vista-formulario");
    const vistaRes = document.getElementById("vista-resultado");
    const form = document.getElementById("formAnalisis");
    const errorMsg = document.getElementById("errorMsg");

    const mostrar = (v) => {
        [vistaInicio, vistaForm, vistaRes].forEach(x => x.hidden = true);
        v.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    document.getElementById("btnComenzar").onclick = () => mostrar(vistaForm);
    document.getElementById("btnVolverInicio").onclick = () => mostrar(vistaInicio);
    document.getElementById("btnVolver").onclick = () => mostrar(vistaForm);
    document.getElementById("btnLimpiarHist").onclick = () => {
        localStorage.removeItem(HIST_KEY);
        renderHistorial();
    };

    // Explicación de horario punta
    document.getElementById("infoPicoBtn").onclick = () => {
        const box = document.getElementById("infoPico");
        box.hidden = !box.hidden;
    };

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorMsg.textContent = "";
        const d = new FormData(form);
        const payload = {
            consumo_kwh: parseFloat(d.get("consumo_kwh")),
            personas: parseInt(d.get("personas"), 10),
            superficie_m2: parseFloat(d.get("superficie_m2")),
            cantidad_equipos: parseInt(d.get("cantidad_equipos"), 10),
            tipo_inmueble: d.get("tipo_inmueble"),
            uso_horario_pico: d.get("uso_horario_pico") === "on",
            horas_alto_consumo: parseInt(d.get("horas_alto_consumo"), 10),
            panel_solar: d.get("panel_solar") === "on",
        };

        const btn = document.getElementById("btnCalcular");
        btn.disabled = true; btn.textContent = "Analizando...";
        try {
            const resp = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) throw new Error("Error del servidor (" + resp.status + ")");
            const data = await resp.json();
            renderResultado(data, payload);
            mostrar(vistaRes);
        } catch (err) {
            errorMsg.textContent = "No se pudo conectar con la API. " + err.message;
            console.error(err);
        } finally {
            btn.disabled = false; btn.textContent = "Analizar mi consumo";
        }
    });
});

function consumoEsperado(p) {
    const depto = p.tipo_inmueble === "Departamento" ? 1 : 0;
    return MODELO_A.personas * p.personas + MODELO_A.superficie * p.superficie_m2
        + MODELO_A.equipos * p.cantidad_equipos + MODELO_A.depto * depto + MODELO_A.base;
}

function renderResultado(data, payload) {
    const cat = data.categoria;
    const color = colorCategoria(cat);
    const esperado = consumoEsperado(payload);
    const desv = ((payload.consumo_kwh - esperado) / esperado) * 100;

    // Badge + descripción clara + confianza
    const badge = document.getElementById("resBadge");
    badge.textContent = cat;
    badge.className = "badge " + cat.toLowerCase();
    document.getElementById("resDescCat").textContent = DESC_CAT[cat] || "";
    document.getElementById("resConfianzaTxt").textContent =
        "El modelo está " + Math.round(data.probabilidad * 100) + "% seguro de este resultado.";

    // Indicadores
    document.getElementById("indReal").textContent = Math.round(payload.consumo_kwh);
    document.getElementById("indEsperado").textContent = Math.round(esperado);
    const indDesv = document.getElementById("indDesviacion");
    indDesv.textContent = (desv >= 0 ? "+" : "") + Math.round(desv) + "%";
    indDesv.className = "ind-valor " + (desv > 0 ? "up" : "down");
    document.getElementById("indDesvTexto").textContent =
        desv > 0 ? "más de lo esperado" : "menos de lo esperado";

    // Frase explicativa en lenguaje claro
    const dabs = Math.abs(Math.round(desv));
    document.getElementById("resExplica").textContent = desv > 0
        ? `En palabras simples: tu hogar consume ${dabs}% más de lo que consumiría una vivienda típica de ${payload.personas} personas y ${Math.round(payload.superficie_m2)} m².`
        : `En palabras simples: tu hogar consume ${dabs}% menos de lo que consumiría una vivienda típica de ${payload.personas} personas y ${Math.round(payload.superficie_m2)} m². ¡Vas muy bien!`;

    // Costo
    document.getElementById("calcKwh").textContent = Math.round(payload.consumo_kwh);
    document.getElementById("resCosto").textContent = money(data.costo_estimado_mensual);
    document.getElementById("resCostoAnual").textContent = money(data.costo_estimado_mensual * 12);

    // Recomendaciones
    const ul = document.getElementById("resRecomendaciones");
    ul.innerHTML = "";
    (data.recomendaciones || []).forEach(r => {
        const li = document.createElement("li"); li.textContent = r; ul.appendChild(li);
    });

    // Gráficos
    Object.values(charts).forEach(c => c && c.destroy());
    charts = {};
    renderGaugeConfianza(data.probabilidad, color);
    renderChartConsumo(payload.consumo_kwh, esperado, color);

    // Simulador
    estadoActual = { consumo: payload.consumo_kwh, costo: data.costo_estimado_mensual, payload };
    construirSimulador(payload);

    // Historial en el navegador (localStorage)
    guardarHistorial(payload, data);
    renderHistorial();
}

// ---- Historial con localStorage ----
function leerHistorial() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); }
    catch (e) { return []; }
}

function guardarHistorial(payload, data) {
    const hist = leerHistorial();
    hist.push({
        fecha: new Date().toISOString(),
        consumo: payload.consumo_kwh,
        costo: data.costo_estimado_mensual,
        categoria: data.categoria
    });
    localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-12))); // conserva los últimos 12
}

function renderHistorial() {
    const hist = leerHistorial();
    const vacio = document.getElementById("histVacio");
    const canvas = document.getElementById("chartHistorial");
    if (charts.hist) { charts.hist.destroy(); charts.hist = null; }

    if (hist.length < 2) {
        vacio.hidden = false;
        canvas.style.display = "none";
        return;
    }
    vacio.hidden = true;
    canvas.style.display = "";

    const labels = hist.map(h => new Date(h.fecha).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }));
    charts.hist = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Costo mensual",
                data: hist.map(h => Math.round(h.costo)),
                borderColor: "#5AA469",
                backgroundColor: "rgba(90,164,105,.15)",
                fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: "#5AA469"
            }]
        },
        options: {
            responsive: true, plugins: { legend: { display: false } },
            scales: { y: { title: { display: true, text: "$ / mes" } } }
        }
    });
}

function renderGaugeConfianza(prob, color) {
    charts.conf = new Chart(document.getElementById("chartConfianza"), {
        type: "doughnut",
        data: { datasets: [{ data: [prob, 1 - prob], backgroundColor: [color, "#E9EFEA"], borderWidth: 0 }] },
        options: {
            cutout: "72%", responsive: false,
            plugins: {
                legend: { display: false }, tooltip: { enabled: false },
                centerText: { text: Math.round(prob * 100) + "%", color }
            }
        }
    });
}

function renderChartConsumo(real, esperado, color) {
    charts.consumo = new Chart(document.getElementById("chartConsumo"), {
        type: "bar",
        data: {
            labels: ["Tu consumo", "Esperado"],
            datasets: [{ data: [Math.round(real), Math.round(esperado)], backgroundColor: [color, "#C9D6CD"], borderRadius: 8 }]
        },
        options: {
            responsive: true, layout: { padding: { top: 22 } },
            plugins: { legend: { display: false }, barLabels: { money: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: "kWh/mes" } } }
        }
    });
}

function construirSimulador(payload) {
    const cont = document.getElementById("simOpciones");
    cont.innerHTML = "";
    const acciones = ACCIONES.filter(a => !(a.id === "solar" && payload.panel_solar));
    acciones.forEach(a => {
        const label = document.createElement("label");
        label.className = "sim-op";
        label.innerHTML = `<input type="checkbox" data-factor="${a.factor}">
            <span>${a.label}</span><span class="pct">-${Math.round(a.factor * 100)}%</span>`;
        label.querySelector("input").addEventListener("change", actualizarSimulador);
        cont.appendChild(label);
    });
    // gráfico inicial (sin acciones)
    charts.sim = new Chart(document.getElementById("chartSimulador"), {
        type: "bar",
        data: {
            labels: ["Actual", "Simulado"],
            datasets: [{ data: [estadoActual.costo, estadoActual.costo], backgroundColor: ["#C9D6CD", "#5AA469"], borderRadius: 8 }]
        },
        options: {
            responsive: true, layout: { padding: { top: 22 } },
            plugins: { legend: { display: false }, barLabels: { money: true } },
            scales: { y: { beginAtZero: true, title: { display: true, text: "$ / mes" } } }
        }
    });
    actualizarSimulador();
}

function actualizarSimulador() {
    const checks = document.querySelectorAll("#simOpciones input:checked");
    let factor = 1;
    checks.forEach(c => factor *= (1 - parseFloat(c.dataset.factor)));
    const nuevoConsumo = estadoActual.consumo * factor;
    const nuevoCosto = nuevoConsumo * TARIFA;
    const ahorroMes = estadoActual.costo - nuevoCosto;

    charts.sim.data.datasets[0].data = [Math.round(estadoActual.costo), Math.round(nuevoCosto)];
    charts.sim.update();

    document.getElementById("simNuevoCosto").textContent = money(nuevoCosto);
    document.getElementById("simAhorroMes").textContent = money(ahorroMes);
    document.getElementById("simAhorroAnual").textContent = money(ahorroMes * 12);
}
