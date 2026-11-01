import { MEMORY_MAX_CELLS } from "./memory-contract.js";
import {
  AllocateI32Request,
  FreeMemoryRequest,
  LoadI32Request,
  StoreI32Request,
} from "./memory-requests.js";

export class MemoryService {
  #repository;

  constructor(repository) {
    const required = ["allocate", "loadI32", "storeI32", "free", "stats", "close"];
    if (!repository || required.some(method => typeof repository[method] !== "function")) {
      throw new TypeError("repositório de memória incompatível");
    }
    this.#repository = repository;
  }

  allocate(request) {
    if (!(request instanceof AllocateI32Request)) throw new TypeError("requisição de alocação não confiável");
    if (!Number.isSafeInteger(request.cells) || request.cells < 1 || request.cells > MEMORY_MAX_CELLS) {
      throw new RangeError("quantidade de células i32 inválida");
    }
    return this.#repository.allocate(request.cells);
  }

  load(request) {
    if (!(request instanceof LoadI32Request)) throw new TypeError("requisição de leitura não confiável");
    return this.#repository.loadI32(request.handle, request.index);
  }

  store(request) {
    if (!(request instanceof StoreI32Request)) throw new TypeError("requisição de escrita não confiável");
    this.#repository.storeI32(request.handle, request.index, request.value);
  }

  free(request) {
    if (!(request instanceof FreeMemoryRequest)) throw new TypeError("requisição de liberação não confiável");
    this.#repository.free(request.handle);
  }

  stats() { return this.#repository.stats(); }
  close() { this.#repository.close(); }
}
