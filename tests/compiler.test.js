import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { EXAMPLES } from "../src/examples.js";
import { compile as compilePackage, instantiate as instantiatePackage } from "../src/index.js";

function instantiate(source, host) {
  const output = compile(source);
  assert.equal(WebAssembly.validate(output.bytes), true, "o compilador deve gerar um módulo WASM válido");
  const defaultHost = {
    print_i32() {}, print_f64() {}, canvas_clear() {}, canvas_dot() {}, dom_value() {},
    dom_set_i32() {}, dom_set_f64() {}, dom_set_visible() {}, read_slider() { return 0; }, listen_click() {},
    memory_alloc_i32() { return 1; }, memory_load_i32() { return 0; }, memory_store_i32() {}, memory_free() {},
  };
  return { output, instance: new WebAssembly.Instance(new WebAssembly.Module(output.bytes), { host: { ...defaultHost, ...host } }) };
}

test("API pública do pacote executa o exemplo Hello World com imports explícitos", async () => {
  const source = "fn main() -> i32 { print_i32(42); return 0; }";
  const compiled = compilePackage(source);
  const printed = [];
  const { instance, output } = await instantiatePackage(
    source,
    { host: { print_i32(value) { printed.push(value); } } },
  );

  assert.equal(instance.exports.main(), 0);
  assert.deepEqual(printed, [42]);
  assert.equal(WebAssembly.validate(output.bytes), true);
  assert.equal(WebAssembly.validate(compiled.bytes), true);
  assert.match(compiled.wat, /export "main"/);
});

test("API pública falha explicitamente quando um import chamado não foi fornecido", async () => {
  const { instance } = await instantiatePackage(
    "fn main() -> i32 { canvas_clear(); return 0; }",
  );

  assert.throws(() => instance.exports.main(), /canvas_clear.*nenhuma implementação foi fornecida/);
});

test("compila e executa o exemplo de Canvas, DOM e entrada do slider", () => {
  const dots = [];
  const printed = [];
  let domValue = -1;
  const { output, instance } = instantiate(EXAMPLES.dots, {
    print_i32(value) { printed.push(value); }, print_f64() {},
    canvas_clear() {}, canvas_dot(x, y, radius) { dots.push([x, y, radius]); },
    dom_value(value) { domValue = value; }, read_slider() { return 7; }, listen_click() {},
  });
  assert.equal(instance.exports.main(), 7);
  assert.equal(dots.length, 7);
  assert.deepEqual(dots[0], [31, 19, 5]);
  assert.deepEqual(printed, [7]);
  assert.equal(domValue, 7);
  assert.match(output.wat, /i32\.mul/);
});

test("compila chamadas recursivas, if, i32, f64 e retorno", () => {
  const integers = [], decimals = [];
  const { instance } = instantiate(EXAMPLES.math, {
    print_i32(value) { integers.push(value); }, print_f64(value) { decimals.push(value); },
    canvas_clear() {}, canvas_dot() {}, dom_value() {}, read_slider() { return 0; }, listen_click() {},
  });
  assert.equal(instance.exports.main(), 6765);
  assert.deepEqual(integers, [6765]);
  assert.equal(decimals[0], 6.28);
});

test("expõe callback WASM para eventos de clique do navegador", () => {
  let clickReady = false;
  const dots = [];
  let shown = null;
  const { instance } = instantiate(EXAMPLES.click, {
    print_i32() {}, print_f64() {}, canvas_clear() {},
    canvas_dot(x, y, radius) { dots.push([x, y, radius]); },
    dom_value(value) { shown = value; }, read_slider() { return 0; },
    listen_click() { clickReady = true; },
  });
  assert.equal(instance.exports.main(), 0);
  assert.equal(clickReady, true);
  assert.equal(instance.exports.on_click(120, 45), 1);
  assert.deepEqual(dots, [[120, 45, 11]]);
  assert.equal(shown, 165);
});

test("retorna erros didáticos com localização para sintaxe e tipos inválidos", () => {
  assert.throws(() => compile("fn main() -> i32 {\n  return missing;\n}"), /linha 2, coluna/);
  assert.throws(() => compile("fn main() -> i32 { return 2.5; }"), /a função retorna i32, mas recebeu f64/);
  assert.throws(() => compile("fn main() -> i32 { let n: u8 = 1; return n; }"), /tipo “u8” não suportado/);
});

test("aceita comentários de bloco fechados no fim do arquivo e negação de i32", () => {
  const source = "fn main() -> i32 { let n: i32 = -7; return n; } /* comentário fechado */";
  const { instance } = instantiate(source, {
    print_i32() {}, print_f64() {}, canvas_clear() {}, canvas_dot() {},
    dom_value() {}, read_slider() { return 0; }, listen_click() {},
  });
  assert.equal(instance.exports.main(), -7);
  const minimum = instantiate("fn main() -> i32 { return -2147483648; }", {
    print_i32() {}, print_f64() {}, canvas_clear() {}, canvas_dot() {},
    dom_value() {}, read_slider() { return 0; }, listen_click() {},
  });
  assert.equal(minimum.instance.exports.main(), -2147483648);
  assert.throws(() => compile("fn main() -> i32 { return 2147483648; }"), /literal i32 fora do intervalo/);
  assert.throws(() => compile("fn main() -> i32 { return 0; } /* aberto"), /comentário de bloco não foi fechado/);
});

test("compila a API DOM tipada e chama imports numa ordem coerente", () => {
  const calls = [];
  const source = "fn main() -> i32 { dom_set_i32(1, -9); dom_set_f64(2, 3.5); dom_set_visible(3, true); return 1; }";
  const { output, instance } = instantiate(source, {
    dom_set_i32(target, value) { calls.push(["i32", target, value]); },
    dom_set_f64(target, value) { calls.push(["f64", target, value]); },
    dom_set_visible(target, visible) { calls.push(["visible", target, visible]); },
  });
  assert.equal(instance.exports.main(), 1);
  assert.deepEqual(calls, [["i32", 1, -9], ["f64", 2, 3.5], ["visible", 3, 1]]);
  assert.match(output.wat, /import "host" "dom_set_visible"/);
});

test("rejeita tipos incorretos na API DOM durante a compilação", () => {
  assert.throws(() => compile("fn main() -> i32 { dom_set_i32(1, 2.5); return 0; }"), /argumento 2 de “dom_set_i32” deve ser i32, não f64/);
  assert.throws(() => compile("fn main() -> i32 { dom_set_f64(1, 2); return 0; }"), /argumento 2 de “dom_set_f64” deve ser f64, não i32/);
  assert.throws(() => compile("fn main() -> i32 { dom_set_visible(3, 1); return 0; }"), /argumento 2 de “dom_set_visible” deve ser bool, não i32/);
});

test("compila e tipa os imports de memória por handle", () => {
  const calls = [];
  const source = "fn main() -> i32 { let block: i32 = memory_alloc_i32(2); memory_store_i32(block, 0, 42); let value: i32 = memory_load_i32(block, 0); memory_free(block); return value; }";
  const { output, instance } = instantiate(source, {
    memory_alloc_i32(cells) { calls.push(["alloc", cells]); return 7; },
    memory_store_i32(handle, index, value) { calls.push(["store", handle, index, value]); },
    memory_load_i32(handle, index) { calls.push(["load", handle, index]); return 42; },
    memory_free(handle) { calls.push(["free", handle]); },
  });
  assert.equal(instance.exports.main(), 42);
  assert.deepEqual(calls, [["alloc", 2], ["store", 7, 0, 42], ["load", 7, 0], ["free", 7]]);
  assert.match(output.wat, /import "host" "memory_alloc_i32"/);
  assert.throws(() => compile("fn main() -> i32 { memory_store_i32(1, 0, 2.5); return 0; }"), /argumento 3 de “memory_store_i32” deve ser i32/);
});

test("limita tamanho de fonte e profundidade sintática com erro localizado", () => {
  assert.throws(() => compile("x".repeat(65_537)), /limite de 65536 unidades de código UTF-16/);
  const nested = `fn main() -> i32 { return ${"(".repeat(140)}1${")".repeat(140)}; }`;
  assert.throws(() => compile(nested), /profundidade sintática máxima de 128 \(linha \d+, coluna \d+\)/);
});

test("normaliza resultados de operadores lógicos para bool WASM 0/1", () => {
  const seen = [];
  const source = "fn main() -> i32 { dom_set_visible(3, 2 && 3); dom_set_visible(4, 2 || 4); return 0; }";
  const { instance } = instantiate(source, {
    dom_set_visible(target, visible) { seen.push([target, visible]); },
  });
  instance.exports.main();
  assert.deepEqual(seen, [[3, 1], [4, 1]]);
});


test("preserva traps definidos pelo WebAssembly para divisão e resto i32", () => {
  const zeroDivision = instantiate("fn main() -> i32 { return 1 / 0; }");
  assert.throws(() => zeroDivision.instance.exports.main(), WebAssembly.RuntimeError);

  const overflow = instantiate("fn main() -> i32 { let minimo: i32 = -2147483648; let menos_um: i32 = -1; return minimo / menos_um; }");
  assert.throws(() => overflow.instance.exports.main(), WebAssembly.RuntimeError);

  const remainder = instantiate("fn main() -> i32 { let minimo: i32 = -2147483648; let menos_um: i32 = -1; return minimo % menos_um; }");
  assert.equal(remainder.instance.exports.main(), 0);
});


test("trapa resto i32 por divisor zero", () => {
  const remainderByZero = instantiate("fn main() -> i32 { return 7 % 0; }");
  assert.throws(() => remainderByZero.instance.exports.main(), WebAssembly.RuntimeError);
});
