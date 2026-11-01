import { compile } from "./compiler.js?v=lume-async-20261102-r1";
import { createMemoryHost } from "./memory-host.js";
import { MAX_DOM_OPERATIONS } from "./dom-contract.js?v=lume-dom-20261101-r1";
import { MemoryRepository } from "./memory-repository.js";
import { MemoryService } from "./memory-service.js";
import { createStringHost, decodeWasmString } from "./string-host.js";

const MAX_HOST_EFFECTS = 4096;
let compiledModule = null;
let activeInstance = null;
let activeMemoryService = null;
let sliderValue = 28;
let clickListening = false;
let domQueue = [];
let hostEffectCount = 0;
let executionToken = 0;
const activeAsyncTaskCancels = new Set();

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
function decodeString(pointer) {
  const memory = activeInstance?.exports?.memory;
  return decodeWasmString(memory, pointer);
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
function cancelPendingAsyncTasks() {
  for (const cancel of activeAsyncTaskCancels) cancel();
  activeAsyncTaskCancels.clear();
}
function createImports(memoryService, asyncTasks) {
  let nextAsyncHandle = 1;
  const stringHost = createStringHost(() => activeInstance?.exports?.memory);
  const taskFor = handle => {
    const task = asyncTasks.get(handle | 0);
    if (!task) throw new RangeError(`identificador de tarefa async inválido: ${handle | 0}`);
    return task;
  };
  const asyncHost = {
    async_status(handle) {
      const task = taskFor(handle);
      if (task.status < 0) throw task.error;
      return task.status;
    },
    async_get_i32(handle) {
      const task = taskFor(handle);
      if (task.status !== 1 || !Number.isInteger(task.value) || task.value < -2147483648 || task.value > 2147483647) {
        throw new TypeError("resultado async não é um i32 válido");
      }
      return task.value;
    },
    async_get_f64(handle) {
      const task = taskFor(handle);
      if (task.status !== 1 || typeof task.value !== "number") throw new TypeError("resultado async não é um f64 válido");
      return task.value;
    },
    async_get_bool(handle) {
      const task = taskFor(handle);
      if (task.status !== 1 || typeof task.value !== "boolean") throw new TypeError("resultado async não é um bool válido");
      return Number(task.value);
    },
    async_get_string(handle) {
      const task = taskFor(handle);
      if (task.status !== 1 || typeof task.value !== "string") throw new TypeError("resultado async não é uma string válida");
      return stringHost.allocateString(task.value);
    },
  };
  const hostImports = {
    ...createMemoryHost(memoryService),
    ...stringHost,
    ...asyncHost,
    print_i32(value) { consumeHostEffect(); post("output", { text: String(value | 0) }); },
    print_f64(value) { consumeHostEffect(); post("output", { text: Number(value).toString() }); },
    print_string(pointer) { consumeHostEffect(); post("output", { text: decodeString(pointer) }); },
    print(pointer, value) { consumeHostEffect(); post("output", { text: `${decodeString(pointer)}${Number(value).toString()}` }); },
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
    async_host_sleep_ms(milliseconds) {
      consumeHostEffect();
      if (!Number.isInteger(milliseconds) || milliseconds < 0) {
        throw new RangeError("sleep_ms exige uma duração i32 não negativa");
      }
      const handle = nextAsyncHandle++;
      const task = { status: 0, value: undefined, error: undefined, promise: null };
      let finish;
      let timer;
      task.promise = new Promise(resolve => {
        finish = () => {
          activeAsyncTaskCancels.delete(cancel);
          resolve();
        };
        timer = setTimeout(() => {
          task.status = 1;
          task.value = milliseconds;
          finish();
        }, milliseconds);
      });
      const cancel = () => {
        clearTimeout(timer);
        task.status = -1;
        task.error = new Error("execução async cancelada");
        finish();
      };
      activeAsyncTaskCancels.add(cancel);
      asyncTasks.set(handle, task);
      return handle;
    },
  };
  return {
    host: new Proxy(hostImports, {
      get(target, name) {
        if (typeof name === "string" && name.startsWith("async_host_") && !Object.hasOwn(target, name)) {
          const functionName = name.slice("async_host_".length);
          return () => { throw new Error(`a função host async "${functionName}" não está disponível no playground`); };
        }
        return target[name];
      },
    }),
  };
}
async function compileSource(source, modules, token) {
  const start = performance.now();
  const output = compile(source, { modules });
  const module = await WebAssembly.compile(output.bytes);
  if (token !== executionToken) return;
  compiledModule = module;
  post("compiled", {
    compileMs: performance.now() - start,
    bytes: output.bytes.byteLength,
    wat: output.wat,
    functions: output.functions,
    async: output.async,
    binary: output.bytes,
  });
}
function publishMemoryStats() {
  if (activeMemoryService) post("memory-stats", { stats: activeMemoryService.stats() });
}
async function execute(token) {
  if (!compiledModule) throw new Error("Compile o programa antes de executar.");
  closeMemory();
  domQueue = [];
  hostEffectCount = 0;
  clickListening = false;
  const memoryService = new MemoryService(new MemoryRepository());
  activeMemoryService = memoryService;
  const asyncTasks = new Map();
  const instance = new WebAssembly.Instance(compiledModule, createImports(memoryService, asyncTasks));
  activeInstance = instance;
  if (token !== executionToken) return;
  post("running");
  const started = performance.now();
  let result = instance.exports.main();
  if (instance.exports.__lume_async_state) {
    while (result === 0) {
      const handle = instance.exports.__lume_async_future.value | 0;
      const task = asyncTasks.get(handle);
      if (!task) throw new RangeError(`identificador de tarefa async inválido: ${handle}`);
      await task.promise;
      if (token !== executionToken) return;
      result = instance.exports.main();
    }
    result = instance.exports.__lume_async_result.value | 0;
    asyncTasks.clear();
  }
  if (token !== executionToken) return;
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
  const token = ++executionToken;
  cancelPendingAsyncTasks();
  activeInstance = null;
  clickListening = false;
  closeMemory();
  let phase = data.source !== undefined ? "compilação" : "execução";
  try {
    if (data.source !== undefined) await compileSource(data.source, data.modules, token);
    if (token !== executionToken) return;
    if (data.type === "run") { phase = "execução"; await execute(token); }
  } catch (error) {
    if (token !== executionToken) return;
    domQueue = [];
    if (phase === "execução") {
      clickListening = false;
      activeInstance = null;
      closeMemory();
    }
    post("error", { phase, message: error?.toString?.() || String(error) });
  }
};
