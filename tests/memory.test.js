import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { EXAMPLES } from "../src/examples.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { MemoryService } from "../src/memory-service.js";
import {
  AllocateI32Request,
  FreeMemoryRequest,
  LoadI32Request,
  StoreI32Request,
} from "../src/memory-requests.js";

function serviceFor(repository = new MemoryRepository()) {
  const service = new MemoryService(repository);
  return {
    service,
    host: {
      memory_alloc_i32: cells => service.allocate(new AllocateI32Request(cells)),
      memory_load_i32: (handle, index) => service.load(new LoadI32Request(handle, index)),
      memory_store_i32: (handle, index, value) => service.store(new StoreI32Request(handle, index, value)),
      memory_free: handle => service.free(new FreeMemoryRequest(handle)),
    },
  };
}

const wasmDefaults = {
  print_i32() {}, print_f64() {}, canvas_clear() {}, canvas_dot() {}, dom_value() {},
  dom_set_i32() {}, dom_set_f64() {}, dom_set_visible() {}, read_slider() { return 0; }, listen_click() {},
};

test("cresce o heap sem perder conteúdo e invalida handles após free", () => {
  const repository = new MemoryRepository({ initialBytes: 16, maxBytes: 64 });
  const first = repository.allocate(4);
  repository.storeI32(first, 3, -2147483648);
  const second = repository.allocate(1);
  assert.equal(repository.loadI32(first, 3), -2147483648);
  assert.equal(repository.loadI32(second, 0), 0);
  assert.ok(repository.stats().capacityBytes >= 32);
  repository.free(first);
  assert.throws(() => repository.loadI32(first, 0), /já liberado/);
  const reused = repository.allocate(4);
  assert.notEqual(reused, first);
  assert.equal(repository.loadI32(reused, 3), 0, "bloco reutilizado começa zerado");
});

test("compacta blocos fragmentados sem alterar o conteúdo identificado pelos handles", () => {
  const repository = new MemoryRepository({ initialBytes: 24, maxBytes: 24 });
  const first = repository.allocate(2);
  const gapA = repository.allocate(1);
  const middle = repository.allocate(2);
  const gapB = repository.allocate(1);
  repository.storeI32(first, 1, 101);
  repository.storeI32(middle, 0, 303);
  repository.free(gapA);
  repository.free(gapB);
  const final = repository.allocate(2);
  assert.equal(repository.loadI32(first, 1), 101);
  assert.equal(repository.loadI32(middle, 0), 303);
  assert.equal(repository.loadI32(final, 0), 0);
  assert.equal(repository.stats().usedBytes, 24);
});

test("rejeita handle, índice, valor, limite de bytes e excesso de blocos", () => {
  const blockLimited = new MemoryRepository({ initialBytes: 8, maxBytes: 16, maxLiveBlocks: 1 });
  const blockHandle = blockLimited.allocate(1);
  assert.throws(() => blockLimited.allocate(1), /blocos vivos/);
  blockLimited.free(blockHandle);
  blockLimited.close();

  const repository = new MemoryRepository({ initialBytes: 8, maxBytes: 16 });
  const first = repository.allocate(1);
  assert.throws(() => repository.loadI32(first, -1), /fora dos limites/);
  assert.throws(() => repository.loadI32(first, 1), /fora dos limites/);
  assert.throws(() => repository.storeI32(first, 0, 2147483648), /i32 válido/);
  assert.throws(() => repository.free(0), /handle/);
  repository.free(first);
  const second = repository.allocate(4);
  assert.throws(() => repository.allocate(1), /sem espaço/);
  repository.close();
  repository.close();
  assert.equal(repository.stats().capacityBytes, 0);
  assert.throws(() => repository.allocate(1), /já foi liberado/);
  assert.notEqual(second, first);
});

test("rejeita tipos de requisição que não foram criados pelo módulo confiável", () => {
  const { service } = serviceFor();
  assert.throws(() => service.allocate({ cells: 1 }), /não confiável/);
  assert.throws(() => service.load({ handle: 1, index: 0 }), /não confiável/);
  assert.throws(() => service.store({ handle: 1, index: 0, value: 3 }), /não confiável/);
  assert.throws(() => service.free({ handle: 1 }), /não confiável/);
  service.close();
});

test("compila e executa o exemplo Lume de alocar, armazenar, ler e liberar i32", () => {
  const { service, host } = serviceFor();
  const printed = [];
  const output = compile(EXAMPLES.memory);
  assert.equal(WebAssembly.validate(output.bytes), true);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(output.bytes), {
    host: { ...wasmDefaults, ...host, print_i32(value) { printed.push(value); } },
  });
  assert.equal(instance.exports.main(), 42);
  assert.deepEqual(printed, [42]);
  assert.equal(service.stats().usedBytes, 0, "o exemplo libera o bloco após uso");
  service.close();
});
