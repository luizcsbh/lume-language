import { compile } from "./compiler.js";
import { createMemoryHost } from "./memory-host.js";
import { MemoryRepository } from "./memory-repository.js";
import { MemoryService } from "./memory-service.js";

export async function instantiate(source, options = {}) {
  const host = options.host ?? {};
  if (typeof host !== "object" || host === null) {
    throw new TypeError("As importações host devem ser fornecidas como um objeto.");
  }

  const output = compile(source, { modules: options.modules });
  const module = await WebAssembly.compile(output.bytes);
  const hostImports = {};
  const memoryService = new MemoryService(new MemoryRepository());
  const memoryHost = createMemoryHost(memoryService);
  let clickListening = false;

  try {
    for (const imported of WebAssembly.Module.imports(module)) {
      if (imported.module !== "host" || imported.kind !== "function") {
        throw new Error(`importação WebAssembly não suportada: ${imported.module}.${imported.name} (${imported.kind})`);
      }

      const implementation = Object.hasOwn(host, imported.name) ? host[imported.name] : memoryHost[imported.name];
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

    const instance = new WebAssembly.Instance(module, { host: hostImports });
    let disposed = false;
    let runStarted = false;
    const dispose = () => {
      if (disposed) return;
      memoryService.close();
      disposed = true;
    };
    const run = () => {
      if (disposed) throw new Error("a instância Lume já foi liberada");
      if (runStarted) throw new Error("main() já foi executada por esta instância");
      runStarted = true;
      try {
        const result = instance.exports.main();
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
