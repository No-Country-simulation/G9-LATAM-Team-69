// ===== EnergiAI — lógica del frontend =====
const API_URL = "/api/v1/onnx/prediction";
const TARIFA = 0.75; // $/kWh (tarifa de referencia del reto)
const API_ANALISIS = "/api/v1/analisis";
const EMAIL_KEY = "email_energiai"; // recuerda el email del usuario en el navegador

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

// Percentiles 0..100 del residual sobre el dataset (30.000 viviendas) — para el benchmarking.
const PCTL = [-123.7,-81.8,-67.3,-54.3,-49.8,-46.5,-44.0,-41.9,-39.8,-38.2,-36.4,-35.0,-33.5,-32.2,-31.0,-29.8,-28.6,-27.3,-26.3,-25.2,-24.2,-23.2,-22.2,-21.3,-20.3,-19.5,-18.6,-17.7,-16.9,-16.1,-15.2,-14.3,-13.4,-12.6,-11.8,-11.0,-10.1,-9.2,-8.4,-7.7,-6.9,-6.2,-5.3,-4.5,-3.6,-2.8,-1.9,-1.1,-0.3,0.4,1.2,2.0,2.8,3.7,4.4,5.2,6.1,6.9,7.7,8.6,9.4,10.2,11.1,11.8,12.6,13.5,14.3,15.1,15.9,16.7,17.6,18.4,19.2,20.0,20.8,21.7,22.6,23.4,24.3,25.2,26.1,27.0,28.0,28.9,29.9,31.0,32.0,33.1,34.2,35.4,36.6,37.8,39.2,40.6,42.1,43.9,46.0,48.1,50.8,54.3,61.7];

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

// Validación semántica: rangos razonables y coherencia entre campos.
function validarSemantica(p) {
    const nums = [p.consumo_kwh, p.personas, p.superficie_m2, p.cantidad_equipos, p.horas_alto_consumo];
    if (nums.some(v => isNaN(v))) return "Completa todos los campos con números válidos.";
    if (p.personas < 1 || p.personas > 20) return "El número de personas debe estar entre 1 y 20.";
    if (p.superficie_m2 < 5 || p.superficie_m2 > 2000) return "La superficie debe estar entre 5 y 2000 m².";
    if (p.consumo_kwh <= 0 || p.consumo_kwh > 5000) return "El consumo mensual debe estar entre 1 y 5000 kWh.";
    if (p.cantidad_equipos < 0 || p.cantidad_equipos > 100) return "La cantidad de equipos no parece válida (0 a 100).";
    if (p.horas_alto_consumo < 0 || p.horas_alto_consumo > 24) return "Las horas de alto consumo deben estar entre 0 y 24.";
    if (p.consumo_kwh / p.superficie_m2 > 30) return "El consumo es muy alto para esa superficie. Revisa los valores de kWh y m².";
    return null;
}

// Genera una URL que reproduce este análisis (para compartir).
function enlaceCompartir(p) {
    const params = new URLSearchParams({
        consumo_kwh: p.consumo_kwh, personas: p.personas, superficie_m2: p.superficie_m2,
        cantidad_equipos: p.cantidad_equipos, tipo_inmueble: p.tipo_inmueble,
        uso_horario_pico: p.uso_horario_pico ? 1 : 0, horas_alto_consumo: p.horas_alto_consumo,
        panel_solar: p.panel_solar ? 1 : 0
    });
    return location.origin + location.pathname + "?" + params.toString();
}

// Rellena el formulario desde los parámetros de la URL (para enlaces compartidos).
function rellenarFormulario(q) {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set("consumo_kwh", q.get("consumo_kwh"));
    set("personas", q.get("personas"));
    set("superficie_m2", q.get("superficie_m2"));
    set("cantidad_equipos", q.get("cantidad_equipos"));
    set("tipo_inmueble", q.get("tipo_inmueble"));
    set("horas_alto_consumo", q.get("horas_alto_consumo"));
    document.getElementById("uso_horario_pico").checked = q.get("uso_horario_pico") === "1";
    document.getElementById("panel_solar").checked = q.get("panel_solar") === "1";
}

// Construye un payload de análisis desde los parámetros de la URL.
function payloadDesdeQuery(q) {
    return {
        consumo_kwh: parseFloat(q.get("consumo_kwh")),
        personas: parseInt(q.get("personas"), 10),
        superficie_m2: parseFloat(q.get("superficie_m2")),
        cantidad_equipos: parseInt(q.get("cantidad_equipos"), 10),
        tipo_inmueble: q.get("tipo_inmueble"),
        uso_horario_pico: q.get("uso_horario_pico") === "1",
        horas_alto_consumo: parseInt(q.get("horas_alto_consumo"), 10),
        panel_solar: q.get("panel_solar") === "1",
    };
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
    // Prefill del email guardado en el navegador
    const emailGuardado = localStorage.getItem(EMAIL_KEY);
    if (emailGuardado) document.getElementById("email").value = emailGuardado;

    // Modo oscuro (recordado en el navegador)
    const btnTema = document.getElementById("btnTema");
    if (localStorage.getItem("tema_energiai") === "dark") {
        document.body.dataset.theme = "dark"; btnTema.textContent = "☀️";
    }
    btnTema.onclick = () => {
        const dark = document.body.dataset.theme === "dark";
        document.body.dataset.theme = dark ? "" : "dark";
        btnTema.textContent = dark ? "🌙" : "☀️";
        localStorage.setItem("tema_energiai", dark ? "light" : "dark");
    };

    // Exportar a PDF (diálogo de impresión → "Guardar como PDF")
    document.getElementById("btnPDF").onclick = () => window.print();

    // Compartir por enlace (copia una URL que reproduce este análisis)
    document.getElementById("btnCompartir").onclick = async () => {
        if (!estadoActual) return;
        const url = enlaceCompartir(estadoActual.payload);
        const b = document.getElementById("btnCompartir");
        const orig = b.textContent;
        try {
            await navigator.clipboard.writeText(url);
            b.textContent = "¡Enlace copiado!";
            setTimeout(() => (b.textContent = orig), 2000);
        } catch (e) {
            prompt("Copia este enlace:", url);
        }
    };

    // Si la URL trae parámetros de un análisis compartido, autollenar y analizar
    const q = new URLSearchParams(location.search);
    if (q.has("consumo_kwh")) {
        rellenarFormulario(q);
        ejecutarAnalisis(payloadDesdeQuery(q), false); // enlace compartido: solo ver, no guardar
    }

    // Explicación de horario punta
    document.getElementById("infoPicoBtn").onclick = () => {
        const box = document.getElementById("infoPico");
        box.hidden = !box.hidden;
    };

    // Ejecuta un análisis. guardar=false para enlaces compartidos (solo ver, no registrar).
    async function ejecutarAnalisis(payload, guardar = true) {
        errorMsg.textContent = "";
        const errSem = validarSemantica(payload);
        if (errSem) { mostrar(vistaForm); errorMsg.textContent = errSem; return; }

        const btn = document.getElementById("btnCalcular");
        const cargando = document.getElementById("cargando");
        btn.disabled = true; btn.textContent = "Analizando...";
        cargando.hidden = false;
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
            if (guardar) guardarYComparar(payload, data);
            else document.getElementById("seccionComparacion").hidden = true; // enlace: sin historial
        } catch (err) {
            mostrar(vistaForm);
            errorMsg.textContent = "No se pudo conectar con la API. " + err.message;
            console.error(err);
        } finally {
            btn.disabled = false; btn.textContent = "Analizar mi consumo";
            cargando.hidden = true;
        }
    }

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const d = new FormData(form);
        ejecutarAnalisis({
            consumo_kwh: parseFloat(d.get("consumo_kwh")),
            personas: parseInt(d.get("personas"), 10),
            superficie_m2: parseFloat(d.get("superficie_m2")),
            cantidad_equipos: parseInt(d.get("cantidad_equipos"), 10),
            tipo_inmueble: d.get("tipo_inmueble"),
            uso_horario_pico: d.get("uso_horario_pico") === "on",
            horas_alto_consumo: parseInt(d.get("horas_alto_consumo"), 10),
            panel_solar: d.get("panel_solar") === "on",
        });
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
    renderBenchmark(payload.consumo_kwh - esperado);

    // Simulador
    estadoActual = { consumo: payload.consumo_kwh, costo: data.costo_estimado_mensual, payload };
    construirSimulador(payload);

}

// ---- Comparación entre períodos (desde la base de datos, por email) ----
function parseFecha(s) { return new Date((s || "").slice(0, 19)); }

async function guardarYComparar(payload, data) {
    document.getElementById("seccionComparacion").hidden = false; // uso normal: mostrar la sección
    const email = (document.getElementById("email").value || "").trim();
    if (!email) { renderComparacionVacia(); return; }
    localStorage.setItem(EMAIL_KEY, email);
    try {
        await fetch(API_ANALISIS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email,
                consumo_kwh: payload.consumo_kwh,
                costo_estimado_mensual: data.costo_estimado_mensual,
                categoria: data.categoria,
                probabilidad: data.probabilidad
            })
        });
    } catch (e) { console.error("No se pudo guardar el análisis:", e); }
    await renderComparacion(email);
}

function renderComparacionVacia() {
    document.getElementById("compVacio").hidden = false;
    document.getElementById("chartHistorial").style.display = "none";
    document.getElementById("compTabla").innerHTML = "";
    if (charts.hist) { charts.hist.destroy(); charts.hist = null; }
}

async function renderComparacion(email) {
    let lista = [];
    try {
        const r = await fetch(API_ANALISIS + "?email=" + encodeURIComponent(email));
        if (r.ok) lista = await r.json();
    } catch (e) { console.error("No se pudo leer el historial:", e); }

    if (charts.hist) { charts.hist.destroy(); charts.hist = null; }
    if (!lista.length) { renderComparacionVacia(); return; }

    document.getElementById("compVacio").hidden = true;
    const canvas = document.getElementById("chartHistorial");
    canvas.style.display = "";

    const labels = lista.map(a => parseFecha(a.fecha).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }));
    charts.hist = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Costo mensual",
                data: lista.map(a => Math.round(a.costo_estimado_mensual)),
                borderColor: "#5AA469", backgroundColor: "rgba(90,164,105,.15)",
                fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: "#5AA469"
            }]
        },
        options: {
            responsive: true, plugins: { legend: { display: false } },
            scales: { y: { title: { display: true, text: "$ / mes" } } }
        }
    });

    document.getElementById("compTabla").innerHTML = filasTabla(lista);
}

function filasTabla(lista) {
    let html = '<table class="comp-tabla"><thead><tr><th>Fecha</th><th>Categoría</th>'
        + '<th>Consumo</th><th>Costo</th><th>Variación</th></tr></thead><tbody>';
    lista.forEach((a, i) => {
        let varTxt = "—";
        if (i > 0) {
            const prev = lista[i - 1].consumo_kwh;
            const d = prev ? ((a.consumo_kwh - prev) / prev) * 100 : 0;
            const cls = d > 0 ? "var-up" : "var-down";
            varTxt = `<span class="${cls}">${d > 0 ? "+" : ""}${Math.round(d)}%</span>`;
        }
        html += `<tr><td>${parseFecha(a.fecha).toLocaleDateString("es-CL")}</td>`
            + `<td>${a.categoria}</td><td>${Math.round(a.consumo_kwh)} kWh</td>`
            + `<td>${money(a.costo_estimado_mensual)}</td><td>${varTxt}</td></tr>`;
    });
    return html + "</tbody></table>";
}

// ---- Benchmarking: percentil del residual vs el dataset ----
function percentil(r) {
    if (r <= PCTL[0]) return 0;
    if (r >= PCTL[100]) return 100;
    for (let i = 0; i < 100; i++) {
        if (r >= PCTL[i] && r <= PCTL[i + 1]) {
            const d = PCTL[i + 1] - PCTL[i];
            return i + (d ? (r - PCTL[i]) / d : 0);
        }
    }
    return 50;
}

function renderBenchmark(residual) {
    const p = percentil(residual);           // 0..100 (mayor = consume más)
    const masEficienteQue = Math.round(100 - p);
    const frase = document.getElementById("benchFrase");
    if (p <= 50) {
        frase.innerHTML = `Eres <b>más eficiente que el ${masEficienteQue}%</b> de las viviendas parecidas a la tuya. 👏`;
    } else {
        frase.innerHTML = `<b>Consumes más que el ${Math.round(p)}%</b> de las viviendas parecidas a la tuya. Hay margen para mejorar.`;
    }
    document.getElementById("benchMarker").style.left = Math.min(98, Math.max(2, p)) + "%";
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
