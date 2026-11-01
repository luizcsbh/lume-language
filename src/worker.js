import { compile } from "./compiler.js?v=lume-memory-20261101-r1";
import { MAX_DOM_OPERATIONS } from "./dom-contract.js?v=lume-dom-20261101-r1";
import { MemoryRepository } from "./memory-repository.js";
import { MemoryService } from "./memory-service.js";
import {
  AllocateI32Request,
  FreeMemoryRequest,
  LoadI32Request,
  StoreI32Request,
} from "./memory-requests.js";

const MAX_HOST_EFFECTS = 4096;
let compiledModule = null;
let activeInstance = null;
let activeMemoryService = null;
let sliderValue = 28;
let clickListening = false;
let domQueue = [];
let hostEffectCount = 0;

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }
function closeMemory() {
  activeMemoryService?.close();
  activeMemoryService = null;
}
function reportRuntimeError(error) {
  post("error", { phase: "execução", message: error?.message || String(error) });
}
function consumeHostEffect() {
  hostEffectCount++;
  if (hostEffectCount > MAX_HOST_EFFECTS) {
    throw new RangeError(`execução excedeu o limite de ${MAX_HOST_EFFECTS} efeitos do host por chamada`);
  }
}
function queueDom(operation) {
  consumeHostEffect();
  if (domQueue.length >= MAX_DOM_OPERATIONS) {
    throw new RangeError(`lote DOM excede o limite de ${MAX_DOM_OPERATIONS} operações`);
  }
  domQueue.push(operation);
}
function flushDom() {
  if (domQueue.length === 0) return;
  const operations = domQueue;
  domQueue = [];
  post("dom-batch", { operations });
}
function createImports(memoryService) {
  return { host: {
    print_i32(value) { consumeHostEffect(); post("output", { text: String(value | 0) }); },
    print_f64(value) { consumeHostEffect(); post("output", { text: Number(value).toString() }); },
    canvas_clear() { consumeHostEffect(); post("canvas-clear"); },
    canvas_dot(x, y, radius) {
      consumeHostEffect();
      post("canvas-dot", { x: x | 0, y: y | 0, radius: radius | 0 });
    },
    dom_value(value) {
      const number = value | 0;
      queueDom({ type: "set_i32", target: 1, value: number });
      queueDom({ type: "set_visible", target: 3, visible: 1 });
    },
    dom_set_i32(target, value) {
      queueDom({ type: "set_i32", target: target | 0, value: value | 0 });
    },
    dom_set_f64(target, value) {
      queueDom({ type: "set_f64", target: target | 0, value: Number(value) });
    },
    dom_set_visible(target, visible) {
      queueDom({ type: "set_visible", target: target | 0, visible: Number(visible) });
    },
    read_slider() { return sliderValue | 0; },
    listen_click() {
      consumeHostEffect();
      if (clickListening) return;
      if (typeof activeInstance?.exports?.on_click !== "function") {
        throw new Error("listen_click() exige a função Lume on_click(x: i32, y: i32) -> i32.");
      }
      clickListening = true;
      post("listen-click");
    },
    memory_alloc_i32(cells) { return memoryService.allocate(new AllocateI32Request(cells)); },
    memory_load_i32(handle, index) { return memoryService.load(new LoadI32Request(handle, index)); },
    memory_store_i32(handle, index, value) { memoryService.store(new StoreI32Request(handle, index, value)); },
    memory_free(handle) { memoryService.free(new FreeMemoryRequest(handle)); },
  } };
}
async function compileSource(source) {
  const start = performance.now();
  const output = compile(source);
  const module = await WebAssembly.compile(output.bytes);
  compiledModule = module;
  post("compiled", {
    compileMs: performance.now() - start,
    bytes: output.bytes.byteLength,
    wat: output.wat,
    functions: output.functions,
    binary: output.bytes,
  });
}
function publishMemoryStats() {
  if (activeMemoryService) post("memory-stats", { stats: activeMemoryService.stats() });
}
function execute() {
  if (!compiledModule) throw new Error("Compile o programa antes de executar.");
  closeMemory();
  domQueue = [];
  hostEffectCount = 0;
  clickListening = false;
  const memoryService = new MemoryService(new MemoryRepository());
  activeMemoryService = memoryService;
  const instance = new WebAssembly.Instance(compiledModule, createImports(memoryService));
  activeInstance = instance;
  post("running");
  const started = performance.now();
  const result = instance.exports.main();
  flushDom();
  publishMemoryStats();
  if (!clickListening) closeMemory();
  post("done", { executionMs: performance.now() - started, returnValue: result, clickListening });
}
self.onmessage = async event => {
  const data = event.data || {};
  if (data.type === "slider") { sliderValue = Number(data.value) || 0; return; }
  if (data.type === "location") {
    try {
      const latitude = Number(data.latitude), longitude = Number(data.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error("As coordenadas recebidas estão fora do intervalo geográfico.");
      }
      const classify = activeInstance?.exports?.analyze_location;
      if (typeof classify !== "function") throw new Error("A função analyze_location não está exportada pelo programa Lume.");
      const quadrant = classify(latitude, longitude);
      post("location-analyzed", { latitude, longitude, accuracy: Number(data.accuracy), quadrant });
    } catch (error) { reportRuntimeError(error); }
    return;
  }
  if (data.type === "pointer") {
    try {
      if (clickListening && activeInstance?.exports?.on_click) {
        domQueue = [];
        hostEffectCount = 0;
        activeInstance.exports.on_click(data.x | 0, data.y | 0);
        flushDom();
        publishMemoryStats();
      }
    } catch (error) {
      domQueue = [];
      clickListening = false;
      activeInstance = null;
      closeMemory();
      reportRuntimeError(error);
    }
    return;
  }
  if (data.type !== "compile" && data.type !== "run") return;
  let phase = data.source !== undefined ? "compilação" : "execução";
  try {
    if (data.source !== undefined) await compileSource(data.source);
    if (data.type === "run") { phase = "execução"; execute(); }
  } catch (error) {
    domQueue = [];
    if (phase === "execução") {
      clickListening = false;
      activeInstance = null;
      closeMemory();
    }
    post("error", { phase, message: error?.toString?.() || String(error) });
  }
};
