import test from "node:test";
import assert from "node:assert/strict";
import { DOMService } from "../src/dom-service.js";
import { DOMRepository } from "../src/dom-repository.js";
import { MAX_DOM_OPERATIONS } from "../src/dom-contract.js";

function recordingRepository() {
  const batches = [];
  return { batches, applyBatch(operations) { batches.push(operations); return operations.length; } };
}

test("valida o lote inteiro antes de delegar alterações", () => {
  const repository = recordingRepository();
  const service = new DOMService(repository);
  const valid = { type: "set_i32", target: 1, value: 24 };
  assert.throws(() => service.applyBatch([
    valid,
    { type: "set_i32", target: 999, value: 88 },
  ]), /alvo ou capacidade DOM não permitidos/);
  assert.equal(repository.batches.length, 0);
});

test("aceita somente operação e capacidade permitidas por alvo", () => {
  const repository = recordingRepository();
  const service = new DOMService(repository);
  assert.equal(service.applyBatch([
    { type: "set_i32", target: 1, value: -12 },
    { type: "set_f64", target: 2, value: 3.5 },
    { type: "set_visible", target: 3, visible: 1 },
    { type: "set_visible", target: 4, visible: 0 },
  ]), 4);
  assert.equal(repository.batches.length, 1);
  assert.throws(() => service.applyBatch([{ type: "set_visible", target: 1, visible: 1 }]), /alvo ou capacidade DOM não permitidos/);
  assert.throws(() => service.applyBatch([{ type: "set_i32", target: 3, value: 1 }]), /alvo ou capacidade DOM não permitidos/);
});

test("recusa tipos, chaves extras e números inválidos sem delegar o lote", () => {
  const repository = recordingRepository();
  const service = new DOMService(repository);
  for (const operation of [
    { type: "set_i32", target: 1, value: 2147483648 },
    { type: "set_i32", target: 1, value: 1.2 },
    { type: "set_f64", target: 2, value: Number.NaN },
    { type: "set_visible", target: 3, visible: 2 },
    { type: "set_i32", target: 1, value: 1, selector: "body" },
  ]) {
    assert.throws(() => service.applyBatch([operation]));
  }
  assert.equal(repository.batches.length, 0);
});

test("limita lotes e impede exceder o teto global", () => {
  const repository = recordingRepository();
  assert.throws(() => new DOMService(repository, { maxOperations: MAX_DOM_OPERATIONS + 1 }), /limite do lote/);
  const service = new DOMService(repository, { maxOperations: 2 });
  const operation = { type: "set_i32", target: 1, value: 1 };
  assert.throws(() => service.applyBatch([operation, operation, operation]), /excede o limite de 2/);
  assert.equal(repository.batches.length, 0);
  assert.throws(() => new DOMService(repository).applyBatch(Array(MAX_DOM_OPERATIONS + 1).fill(operation)), /excede o limite de 4096/);
});

test("repositório escreve números com textContent e controla hidden nos nós registrados", () => {
  const nodes = new Map([
    ["result-value", { textContent: "", hidden: false }],
    ["input-value", { textContent: "", hidden: false }],
    ["result-pill", { textContent: "", hidden: true }],
    ["canvas-empty", { textContent: "", hidden: false }],
  ]);
  const documentRef = { getElementById(id) { return nodes.get(id) || null; } };
  const repository = new DOMRepository(documentRef);
  const service = new DOMService(repository);
  service.applyBatch([
    { type: "set_i32", target: 1, value: 7 },
    { type: "set_f64", target: 2, value: 3.25 },
    { type: "set_visible", target: 3, visible: 1 },
    { type: "set_visible", target: 4, visible: 0 },
  ]);
  assert.equal(nodes.get("result-value").textContent, "7");
  assert.equal(nodes.get("input-value").textContent, "3.25");
  assert.equal(nodes.get("result-pill").hidden, false);
  assert.equal(nodes.get("canvas-empty").hidden, true);
});

test("falha cedo se um elemento registrado não existe", () => {
  assert.throws(() => new DOMRepository({ getElementById() { return null; } }), /alvo DOM obrigatório/);
});
