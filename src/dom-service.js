import { DOM_TARGETS, MAX_DOM_OPERATIONS } from "./dom-contract.js?v=lume-dom-20261101-r1";

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class DOMService {
  constructor(repository, { maxOperations = MAX_DOM_OPERATIONS } = {}) {
    if (!repository || typeof repository.applyBatch !== "function") {
      throw new TypeError("o serviço DOM precisa de um repositório compatível");
    }
    if (!Number.isInteger(maxOperations) || maxOperations < 1 || maxOperations > MAX_DOM_OPERATIONS) {
      throw new RangeError(`o limite do lote deve estar entre 1 e ${MAX_DOM_OPERATIONS}`);
    }
    this.repository = repository;
    this.maxOperations = maxOperations;
  }

  validateOperation(operation, index) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new TypeError(`operação DOM ${index + 1} inválida`);
    }
    const targetId = operation.target;
    const target = Number.isInteger(targetId) && own(DOM_TARGETS, targetId) ? DOM_TARGETS[targetId] : null;
    if (!target || !target.operations.includes(operation.type)) {
      throw new Error(`alvo ou capacidade DOM não permitidos na operação ${index + 1}`);
    }

    if (operation.type === "set_i32") {
      if (Object.keys(operation).sort().join(",") !== "target,type,value"
        || !Number.isInteger(operation.value) || operation.value < I32_MIN || operation.value > I32_MAX) {
        throw new TypeError(`valor i32 inválido na operação DOM ${index + 1}`);
      }
      return { type: operation.type, target: operation.target, value: operation.value };
    }
    if (operation.type === "set_f64") {
      if (Object.keys(operation).sort().join(",") !== "target,type,value"
        || typeof operation.value !== "number" || !Number.isFinite(operation.value)) {
        throw new TypeError(`valor f64 inválido na operação DOM ${index + 1}`);
      }
      return { type: operation.type, target: operation.target, value: operation.value };
    }
    if (operation.type === "set_visible") {
      if (Object.keys(operation).sort().join(",") !== "target,type,visible"
        || (operation.visible !== 0 && operation.visible !== 1)) {
        throw new TypeError(`visibilidade deve ser bool (0 ou 1) na operação DOM ${index + 1}`);
      }
      return { type: operation.type, target: operation.target, visible: operation.visible };
    }
    throw new Error(`operação DOM não suportada na posição ${index + 1}`);
  }

  applyBatch(operations) {
    if (!Array.isArray(operations)) throw new TypeError("lote DOM deve ser uma lista de operações");
    if (operations.length > this.maxOperations) {
      throw new RangeError(`lote DOM excede o limite de ${this.maxOperations} operações`);
    }
    const validated = operations.map((operation, index) => this.validateOperation(operation, index));
    return this.repository.applyBatch(validated);
  }
}
