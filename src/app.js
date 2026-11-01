import { EXAMPLES } from "./examples.js?v=lume-memory-20261101-r1";
import { DOMRepository } from "./dom-repository.js?v=lume-dom-20261101-r1";
import { DOMService } from "./dom-service.js?v=lume-dom-20261101-r1";

const $ = selector => document.querySelector(selector);
const editor = $("#code-editor");
const syntaxLayer = $("#syntax-layer");
const lines = $("#line-numbers");
const canvas = $("#output-canvas");
const context = canvas.getContext("2d");
const output = $("#console-output");
const slider = $("#input-slider");
const domService = new DOMService(new DOMRepository(document));
let worker = null;
let lastCompiledSource = null;
let pendingSource = "";
let pointerReady = false;
let clickEnabled = false;
let domBridgeFailed = false;
let runStartedAt = 0;

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function highlight(source) {
  const tokenPattern = /(\/\/[^\n]*|\b(?:fn|let|return|if|else|while|true|false)\b|\b(?:i32|f64|bool)\b|\b(?:print_i32|print_f64|canvas_clear|canvas_dot|dom_value|dom_set_i32|dom_set_f64|dom_set_visible|read_slider|listen_click|memory_alloc_i32|memory_load_i32|memory_store_i32|memory_free)\b(?=\s*\()|\b[A-Za-z_]\w*(?=\s*\()|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|"[^"\n]*"|'[^'\n]*')/g;
  const renderToken = token => {
    let kind = "";
    if (token.startsWith("//")) kind = "comment";
    else if (token.startsWith('"') || token.startsWith("'")) kind = "string";
    else if (/^(fn|let|return|if|else|while|true|false)$/.test(token)) kind = "keyword";
    else if (/^(i32|f64|bool)$/.test(token)) kind = "type";
    else if (/^(print_i32|print_f64|canvas_clear|canvas_dot|dom_value|dom_set_i32|dom_set_f64|dom_set_visible|read_slider|listen_click|memory_alloc_i32|memory_load_i32|memory_store_i32|memory_free)$/.test(token)) kind = "builtin";
    else if (/^\d/.test(token)) kind = "number";
    else kind = "function";
    return `<span class="token-${kind}">${escapeHtml(token)}</span>`;
  };
  let html = "", cursor = 0, match;
  while ((match = tokenPattern.exec(source)) !== null) {
    html += escapeHtml(source.slice(cursor, match.index)) + renderToken(match[0]);
    cursor = match.index + match[0].length;
  }
  syntaxLayer.innerHTML = html + escapeHtml(source.slice(cursor)) + (source.endsWith("\n") ? " " : "");
  const count = Math.max(1, source.split("\n").length);
  lines.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  lines.scrollTop = editor.scrollTop;
}
function setStatus(text, state = "") {
  const label = $("#status-label");
  label.textContent = text;
  if (state) label.dataset.state = state; else delete label.dataset.state;
}
function addConsole(text, kind = "") {
  const placeholder = output.querySelector(".console-placeholder");
  if (placeholder) placeholder.remove();
  const entry = document.createElement("p");
  entry.className = `console-entry${kind ? ` is-${kind}` : ""}`;
  entry.textContent = text;
  output.append(entry);
  output.scrollTop = output.scrollHeight;
}
function setWasmState(text, ready = false) {
  $("#wasm-state-text").textContent = text;
  const dot = $("#wasm-state-dot");
  if (ready) dot.dataset.state = "ready"; else delete dot.dataset.state;
}
function clearCanvas() {
  context.fillStyle = "#111510";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#1b2119";
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    context.beginPath(); context.moveTo(x + 0.5, 0); context.lineTo(x + 0.5, canvas.height); context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    context.beginPath(); context.moveTo(0, y + 0.5); context.lineTo(canvas.width, y + 0.5); context.stroke();
  }
  $("#canvas-empty").hidden = true;
}
function canvasDot(x, y, radius) {
  const hue = (x * 0.35 + y * 0.2 + 75) % 130 + 48;
  context.save();
  context.fillStyle = `hsl(${hue}, 74%, 69%)`;
  context.shadowColor = `hsl(${hue}, 92%, 65%)`;
  context.shadowBlur = Math.min(24, Math.max(9, radius * 1.8));
  context.beginPath();
  context.arc(x, y, Math.max(1, Math.min(radius, 42)), 0, Math.PI * 2);
  context.fill();
  context.restore();
}
function formatMs(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
}
function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "? B";
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}
function stopWorker(showMessage = true) {
  if (worker) worker.terminate();
  worker = null;
  lastCompiledSource = null;
  clickEnabled = false;
  canvas.classList.remove("listening-for-click");
  $("#stop-button").disabled = true;
  if (showMessage) {
    setStatus("execução interrompida");
    addConsole("worker finalizado; a interface permanece responsiva", "info");
  }
}
function newWorker(action, source) {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.js?v=lume-memory-20261101-r1", import.meta.url), { type: "module" });
  pendingSource = source;
  pointerReady = false;
  clickEnabled = false;
  domBridgeFailed = false;
  canvas.classList.remove("listening-for-click");
  setStatus(action === "run" ? "compilando para executar…" : "compilando…", "busy");
  setWasmState("gerando módulo");
  $("#compile-button").disabled = true;
  $("#run-button").disabled = true;
  $("#stop-button").disabled = action !== "run";
  if (action === "run") {
    runStartedAt = performance.now();
    clearCanvas();
    $("#result-pill").hidden = true;
  }
  worker.onmessage = event => {
    const message = event.data || {};
    switch (message.type) {
      case "compiled":
        lastCompiledSource = pendingSource;
        $("#compile-time").textContent = formatMs(message.compileMs);
        $("#module-size").textContent = `${message.bytes} bytes`;
        $("#wat-output").textContent = message.wat;
        $("#wat-details").open = true;
        setWasmState(`módulo válido · ${message.bytes} B`, true);
        if (!$("#stop-button").disabled) setStatus("módulo pronto · iniciando…", "busy");
        else setStatus("módulo compilado");
        break;
      case "running":
        $("#stop-button").disabled = false;
        setStatus("executando em Web Worker…", "busy");
        break;
      case "output": addConsole(message.text); break;
      case "memory-stats": {
        const stats = message.stats;
        if (stats && Number.isFinite(stats.usedBytes) && Number.isFinite(stats.capacityBytes)) {
          addConsole(`heap Lume · ${formatBytes(stats.usedBytes)} usados / ${formatBytes(stats.capacityBytes)} reservados · ${stats.liveBlocks}/${stats.maxLiveBlocks} blocos · teto ${formatBytes(stats.maxBytes)}`, "info");
        }
        break;
      }
      case "canvas-clear": clearCanvas(); break;
      case "canvas-dot": canvasDot(message.x, message.y, message.radius); break;
      case "dom-batch":
        try {
          const applied = domService.applyBatch(message.operations);
          if (applied) addConsole(`${applied} operação(ões) DOM aplicadas em 1 lote, sem ler medidas do layout`, "info");
        } catch (error) {
          domBridgeFailed = true;
          clickEnabled = false;
          canvas.classList.remove("listening-for-click");
          addConsole(`ponte DOM recusou o lote: ${error?.message || String(error)}`, "error");
          setStatus("erro na ponte DOM", "error");
          setWasmState("lote DOM recusado");
        }
        break;
      case "listen-click":
        clickEnabled = true;
        canvas.classList.add("listening-for-click");
        addConsole("evento de clique conectado ao export on_click(x, y)", "info");
        break;
      case "done":
        $("#execution-time").textContent = formatMs(message.executionMs);
        $("#stop-button").disabled = message.clickListening !== true;
        if (!domBridgeFailed) setStatus(message.clickListening ? "execução concluída · listener ativo" : "execução concluída");
        addConsole(`main retornou ${message.returnValue | 0} · worker responsivo (${formatMs(performance.now() - runStartedAt)} na interface)`, "info");
        break;
      case "error":
        addConsole(`${message.phase}: ${message.message}`, "error");
        if (message.phase === "execução") {
          clickEnabled = false;
          canvas.classList.remove("listening-for-click");
        }
        setStatus(`erro de ${message.phase}`, "error");
        setWasmState("erro");
        $("#stop-button").disabled = true;
        break;
      default: break;
    }
  };
  worker.onerror = event => {
    addConsole(`erro no Web Worker: ${event.message || "falha desconhecida"}`, "error");
    clickEnabled = false;
    canvas.classList.remove("listening-for-click");
    setStatus("erro de execução", "error");
    $("#stop-button").disabled = true;
  };
  worker.postMessage({ type: "slider", value: Number(slider.value) });
  worker.postMessage({ type: action, source });
  $("#compile-button").disabled = false;
  $("#run-button").disabled = false;
}
function compileCurrent() {
  const source = editor.value;
  newWorker("compile", source);
}
function runCurrent() {
  const source = editor.value;
  output.replaceChildren();
  if (worker && lastCompiledSource === source) {
    clearCanvas();
    $("#result-pill").hidden = true;
    runStartedAt = performance.now();
    domBridgeFailed = false;
    $("#stop-button").disabled = false;
    setStatus("iniciando WASM…", "busy");
    worker.postMessage({ type: "slider", value: Number(slider.value) });
    worker.postMessage({ type: "run" });
    return;
  }
  newWorker("run", source);
}

let savedSource = "";
try { savedSource = localStorage.getItem("lume-source") || ""; } catch { /* armazenamento opcional */ }
editor.value = savedSource || EXAMPLES.dots;
highlight(editor.value);
clearCanvas();

editor.addEventListener("input", () => {
  highlight(editor.value);
  $("#unsaved-dot").hidden = false;
  try { localStorage.setItem("lume-source", editor.value); } catch { /* editor continua funcionando sem armazenamento */ }
});
editor.addEventListener("scroll", () => {
  syntaxLayer.scrollTop = editor.scrollTop;
  syntaxLayer.scrollLeft = editor.scrollLeft;
  lines.scrollTop = editor.scrollTop;
});
editor.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart, end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault(); runCurrent();
  }
});
$("#compile-button").addEventListener("click", compileCurrent);
$("#run-button").addEventListener("click", runCurrent);
$("#stop-button").addEventListener("click", () => stopWorker(true));
$("#clear-console").addEventListener("click", () => output.replaceChildren());
$("#example-select").addEventListener("change", event => {
  const source = EXAMPLES[event.target.value];
  if (!source) return;
  editor.value = source;
  highlight(source);
  $("#unsaved-dot").hidden = true;
  try { localStorage.setItem("lume-source", source); } catch { /* armazenamento opcional */ }
  setStatus("exemplo carregado");
});
slider.addEventListener("input", () => {
  $("#input-value").textContent = slider.value;
  worker?.postMessage({ type: "slider", value: Number(slider.value) });
});
canvas.addEventListener("click", event => {
  if (!clickEnabled || !worker) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((event.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.round((event.clientY - rect.top) * canvas.height / rect.height);
  worker.postMessage({ type: "pointer", x, y });
});
