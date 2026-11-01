import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { LOCATION_PROGRAM } from "../src/location-program.js";

const host = {
  print_i32() {}, print_f64() {}, print_string() {}, print() {}, canvas_clear() {}, canvas_dot() {},
  dom_value() {}, dom_set_i32() {}, dom_set_f64() {}, dom_set_visible() {},
  read_slider() { return 0; }, listen_click() {},
  memory_alloc_i32() { return 1; }, memory_load_i32() { return 0; }, memory_store_i32() {},
  memory_load_f64() { return 0; }, memory_store_f64() {}, memory_length() { return 0; }, memory_array_offset() { return 0; },
  array_allocate_i32() { return 1; }, array_allocate_f64() { return 1; }, array_allocate_ref() { return 1; }, memory_free() {},
};

test("compila e classifica latitude/longitude nos quatro quadrantes em WASM", () => {
  const result = compile(LOCATION_PROGRAM);
  assert.equal(WebAssembly.validate(result.bytes), true);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(result.bytes), { host });
  assert.equal(instance.exports.analyze_location(40.7, 74.0), 0, "norte e leste");
  assert.equal(instance.exports.analyze_location(40.7, -74.0), 1, "norte e oeste");
  assert.equal(instance.exports.analyze_location(-33.9, 151.2), 2, "sul e leste");
  assert.equal(instance.exports.analyze_location(-23.5, -46.6), 3, "sul e oeste");
  assert.equal(instance.exports.analyze_location(0, 0), 0, "a linha do Equador e o meridiano zero contam como norte/leste");
});
