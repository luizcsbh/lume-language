import { DOM_TARGETS } from "./dom-contract.js?v=lume-dom-20261101-r1";

export class DOMRepository {
  constructor(documentRef = document) {
    this.nodes = new Map();
    for (const [rawId, target] of Object.entries(DOM_TARGETS)) {
      const node = documentRef.getElementById(target.elementId);
      if (!node) throw new Error(`alvo DOM obrigatório #${target.elementId} não existe`);
      this.nodes.set(Number(rawId), node);
    }
  }

  applyBatch(operations) {
    for (const operation of operations) {
      const node = this.nodes.get(operation.target);
      switch (operation.type) {
        case "set_i32":
        case "set_f64":
          node.textContent = String(operation.value);
          break;
        case "set_visible":
          node.hidden = operation.visible === 0;
          break;
        default:
          throw new Error("operação DOM interna não reconhecida");
      }
    }
    return operations.length;
  }
}
