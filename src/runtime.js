import { compile } from "./compiler.js";

export async function instantiate(source, options = {}) {
  const host = options.host ?? {};
  if (typeof host !== "object" || host === null) {
    throw new TypeError("As importações host devem ser fornecidas como um objeto.");
  }

  const output = compile(source);
  const module = await WebAssembly.compile(output.bytes);
  const hostImports = {};

  for (const imported of WebAssembly.Module.imports(module)) {
    if (imported.module !== "host" || imported.kind !== "function") {
      throw new Error(`importação WebAssembly não suportada: ${imported.module}.${imported.name} (${imported.kind})`);
    }

    const implementation = Object.hasOwn(host, imported.name) ? host[imported.name] : undefined;
    if (implementation !== undefined && typeof implementation !== "function") {
      throw new TypeError(`a importação host "${imported.name}" deve ser uma função`);
    }

    hostImports[imported.name] = implementation ?? (() => {
      throw new Error(`o programa chamou a importação host "${imported.name}", mas nenhuma implementação foi fornecida`);
    });
  }

  const instance = new WebAssembly.Instance(module, { host: hostImports });
  return { instance, module, output };
}
