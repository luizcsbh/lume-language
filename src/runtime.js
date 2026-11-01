import { compile } from "./compiler.js";
import { createMemoryHost } from "./memory-host.js";
import { MemoryRepository } from "./memory-repository.js";
import { MemoryService } from "./memory-service.js";
import { createStringHost, decodeWasmString } from "./string-host.js";

export async function instantiate(source, options = {}) {
  const host = options.host ?? {};
  if (typeof host !== "object" || host === null) {
    throw new TypeError("As importações host devem ser fornecidas como um objeto.");
  }

  const output = compile(source, { modules: options.modules });
  const module = await WebAssembly.compile(output.bytes);
  const hostImports = {};
  const memoryService = new MemoryService(new MemoryRepository());
  const hostAsyncFunctions = new Map(output.hostAsyncFunctions.map(fn => [fn.name, fn]));
  const asyncTasks = new Map();
  let nextAsyncHandle = 1;
  let instance;
  const stringHost = createStringHost(() => instance?.exports?.memory);
  const memoryHost = {
    ...createMemoryHost(memoryService),
    ...stringHost,
  };
  let clickListening = false;
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
      if (task.status !== 1) throw new Error("tarefa async ainda não foi concluída");
      if (!Number.isInteger(task.value) || task.value < -2147483648 || task.value > 2147483647) {
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

  try {
    for (const imported of WebAssembly.Module.imports(module)) {
      if (imported.module !== "host" || imported.kind !== "function") {
        throw new Error(`importação WebAssembly não suportada: ${imported.module}.${imported.name} (${imported.kind})`);
      }

      let implementation = Object.hasOwn(host, imported.name) ? host[imported.name] : memoryHost[imported.name];
      if (imported.name.startsWith("async_host_")) {
        const name = imported.name.slice("async_host_".length);
        const hostFunction = host[name];
        const declaration = hostAsyncFunctions.get(name);
        if (typeof hostFunction !== "function") {
          implementation = () => {
            throw new Error(`a função host async "${name}" não foi fornecida`);
          };
        } else {
          implementation = (...args) => {
            const handle = nextAsyncHandle++;
            const task = { status: 0, value: undefined, error: undefined, promise: null };
            const hostArgs = args.map((value, index) => declaration.params[index] === "string"
              ? decodeWasmString(instance?.exports?.memory, value)
              : value);
            task.promise = Promise.resolve()
              .then(() => hostFunction(...hostArgs))
              .then(
                value => { task.status = 1; task.value = value; },
                error => {
                  task.status = -1;
                  task.error = error instanceof Error ? error : new Error(String(error));
                },
              );
            asyncTasks.set(handle, task);
            return handle;
          };
        }
      } else if (Object.hasOwn(asyncHost, imported.name)) {
        implementation = asyncHost[imported.name];
      }
      if (implementation !== undefined && typeof implementation !== "function") {
        throw new TypeError(`a importação host "${imported.name}" deve ser uma função`);
      }

      hostImports[imported.name] = implementation ?? (() => {
        throw new Error(`o programa chamou a importação host "${imported.name}", mas nenhuma implementação foi fornecida`);
      });
      if (implementation && imported.name === "listen_click") {
        hostImports[imported.name] = (...args) => {
          const result = implementation(...args);
          clickListening = true;
          return result;
        };
      }
    }

    instance = new WebAssembly.Instance(module, { host: hostImports });
    let disposed = false;
    let runStarted = false;
    let cancelAsyncRun = null;
    const dispose = () => {
      if (disposed) return;
      memoryService.close();
      disposed = true;
      asyncTasks.clear();
      cancelAsyncRun?.(new Error("a instância Lume foi liberada durante uma operação async"));
      cancelAsyncRun = null;
    };
    const run = () => {
      if (disposed) throw new Error("a instância Lume já foi liberada");
      if (runStarted) throw new Error("main() já foi executada por esta instância");
      runStarted = true;
      try {
        const result = instance.exports.main();
        if (instance.exports.__lume_async_state) {
          return (async () => {
            const cancelled = new Promise((_, reject) => { cancelAsyncRun = reject; });
            try {
              let status = result;
              while (status === 0) {
                const task = taskFor(instance.exports.__lume_async_future.value);
                await Promise.race([task.promise, cancelled]);
                if (disposed) throw new Error("a instância Lume foi liberada durante uma operação async");
                status = instance.exports.main();
              }
              cancelAsyncRun = null;
              const asyncResult = instance.exports.__lume_async_result.value | 0;
              asyncTasks.clear();
              if (!clickListening) dispose();
              return asyncResult;
            } catch (error) {
              cancelAsyncRun = null;
              dispose();
              throw error;
            }
          })();
        }
        if (!clickListening) dispose();
        return result;
      } catch (error) {
        dispose();
        throw error;
      }
    };
    return { instance, module, output, run, dispose };
  } catch (error) {
    memoryService.close();
    throw error;
  }
}
