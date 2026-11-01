import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { EXAMPLES } from "../src/examples.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { MemoryService } from "../src/memory-service.js";
import {
  AllocateI32Request,
  ArrayOffsetRequest,
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
      memory_load_f64: (handle, index) => service.loadF64(new LoadI32Request(handle, index)),
      memory_store_f64: (handle, index, value) => service.storeF64(new StoreI32Request(handle, index, value)),
      memory_length: (handle, stride) => service.length(new LoadI32Request(handle, stride)),
      memory_array_offset: (handle, index, stride) => service.arrayOffset(new ArrayOffsetRequest(handle, index, stride)),
      array_allocate_i32: cells => service.allocateArray(new AllocateI32Request(cells)),
      array_allocate_f64: cells => service.allocateArray(new AllocateI32Request(cells), 2),
      array_allocate_ref: cells => service.allocateArray(new AllocateI32Request(cells)),
      memory_free: handle => service.free(new FreeMemoryRequest(handle)),
    },
  };
}

const wasmDefaults = {
  print_i32() {}, print_f64() {}, print_string() {}, print() {}, canvas_clear() {}, canvas_dot() {}, dom_value() {},
  string_length() { return 0; }, string_byte_length() { return 0; }, string_equals() { return 0; },
  string_contains() { return 0; }, string_concat() { return 0; }, string_slice() { return 0; },
  dom_set_i32() {}, dom_set_f64() {}, dom_set_visible() {}, read_slider() { return 0; }, listen_click() {},
  memory_load_f64() { return 0; }, memory_store_f64() {}, memory_length() { return 0; }, memory_array_offset() { return 0; },
  array_allocate_i32() { return 1; }, array_allocate_f64() { return 1; }, array_allocate_ref() { return 1; },
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

test("gerencia arrays vazios e valores f64 no heap tipado", () => {
  const repository = new MemoryRepository({ initialBytes: 16, maxBytes: 64 });
  const empty = repository.allocateArray(0);
  assert.equal(repository.length(empty), 0);
  assert.throws(() => repository.loadI32(empty, 0), /fora dos limites/);

  const decimals = repository.allocateArray(2, 2);
  repository.storeF64(decimals, 0, 1.25);
  repository.storeF64(decimals, 2, -3.5);
  assert.equal(repository.length(decimals, 2), 2);
  assert.equal(repository.arrayOffset(decimals, 1, 2), 2);
  assert.equal(repository.loadF64(decimals, 0), 1.25);
  assert.equal(repository.loadF64(decimals, 2), -3.5);
  assert.throws(() => repository.storeF64(decimals, 3, 0), /fora dos limites/);
  assert.throws(() => repository.arrayOffset(decimals, -2147483648, 2), /fora dos limites/);
  assert.throws(() => repository.arrayOffset(decimals, 2, 2), /fora dos limites/);
  repository.storeF64(decimals, 0, Infinity);
  assert.equal(repository.loadF64(decimals, 0), Infinity);

  repository.free(empty);
  repository.free(decimals);
  assert.equal(repository.stats().usedBytes, 0);
  repository.close();
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
  const dots = [];
  const output = compile(EXAMPLES.memory);
  assert.equal(WebAssembly.validate(output.bytes), true);
  let instance;
  instance = new WebAssembly.Instance(new WebAssembly.Module(output.bytes), {
    host: {
      ...wasmDefaults,
      ...host,
      print(pointer, value) {
        const address = pointer >>> 0;
        const length = new DataView(instance.exports.memory.buffer).getUint32(address - 4, true);
        const text = new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, address, length));
        printed.push(`${text}${value}`);
      },
      canvas_dot(x, y, radius) { dots.push([x, y, radius]); },
    },
  });

  assert.equal(instance.exports.main(), 42);
  assert.deepEqual(printed, [
    "Memória (células i32): 3",
    "Lume (threads): 1",
    "JavaScript (threads): 1",
    "Soma guardada no heap: 42",
  ]);
  assert.deepEqual(dots, [
    [80, 100, 9], [106, 100, 9], [132, 100, 9],
    [80, 180, 9],
    [80, 260, 9],
  ]);
  assert.equal(service.stats().usedBytes, 0, "o exemplo libera o bloco após uso");
  service.close();
});

test("compila arrays tipados e structs com memória gerenciada", () => {
  const { service, host } = serviceFor();
  const printed = [];
  const source = `struct Point { x: i32, y: f64, label: string }
fn main() -> i32 {
  let numbers: array<i32> = [2, 3, 5];
  numbers[1] = 7;
  let decimals: array<f64> = array_f64(2);
  decimals[0] = 1.25;
  decimals[1] = 2.75;
  let point: Point = Point { x: numbers[1], y: decimals[0], label: "ok" };
  point.x = point.x + numbers.length;
  let points: array<Point> = array_ref(1);
  points[0] = point;
  print_f64(points[0].y);
  print(points[0].label);
  return points[0].x;
}`;
  const output = compile(source);
  assert.equal(WebAssembly.validate(output.bytes), true);
  let instance;
  instance = new WebAssembly.Instance(new WebAssembly.Module(output.bytes), {
    host: {
      ...wasmDefaults,
      ...host,
      print_f64(value) { printed.push(value); },
      print_string(pointer) {
        const address = pointer >>> 0;
        const length = new DataView(instance.exports.memory.buffer).getUint32(address - 4, true);
        printed.push(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, address, length)));
      },
    },
  });
  assert.equal(instance.exports.main(), 10);
  assert.deepEqual(printed, [1.25, "ok"]);
  assert.equal(service.stats().usedBytes, 48);
  service.close();
  assert.equal(service.stats().usedBytes, 0);
});
