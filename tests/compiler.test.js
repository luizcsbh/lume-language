import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { EXAMPLES } from "../src/examples.js";
import { compile as compilePackage, instantiate as instantiatePackage } from "../src/index.js";

function instantiate(source, host) {
  const output = compile(source);
  assert.equal(WebAssembly.validate(output.bytes), true, "o compilador deve gerar um módulo WASM válido");
  const defaultHost = {
    print_i32() {}, print_f64() {}, print_string() {}, print() {}, canvas_clear() {}, canvas_dot() {}, dom_value() {},
    dom_set_i32() {}, dom_set_f64() {}, dom_set_visible() {}, read_slider() { return 0; }, listen_click() {},
    memory_alloc_i32() { return 1; }, memory_load_i32() { return 0; }, memory_store_i32() {},
    memory_load_f64() { return 0; }, memory_store_f64() {}, memory_length() { return 0; }, memory_array_offset() { return 0; },
    array_allocate_i32() { return 1; }, array_allocate_f64() { return 1; }, array_allocate_ref() { return 1; }, memory_free() {},
  };
  return { output, instance: new WebAssembly.Instance(new WebAssembly.Module(output.bytes), { host: { ...defaultHost, ...host } }) };
}

test("API pública do pacote executa o exemplo Hello World com imports explícitos", async () => {
  const source = EXAMPLES.hello;
  const compiled = compilePackage(source);
  const printed = [];
  let instance;
  const result = await instantiatePackage(
    source,
    { host: {
      print_string(pointer) {
        const memory = instance.exports.memory;
        const address = pointer >>> 0;
        const length = new DataView(memory.buffer).getUint32(address - 4, true);
        printed.push(new TextDecoder().decode(new Uint8Array(memory.buffer, address, length)));
      },
      print(pointer, value) {
        const memory = instance.exports.memory;
        const address = pointer >>> 0;
        const length = new DataView(memory.buffer).getUint32(address - 4, true);
        printed.push(`${new TextDecoder().decode(new Uint8Array(memory.buffer, address, length))}${value}`);
      },
    } },
  );
  instance = result.instance;

  assert.equal(instance.exports.main(), 0);
  assert.deepEqual(printed, ["Olá, Lume!"]);
  assert.equal(WebAssembly.validate(result.output.bytes), true);
  assert.equal(WebAssembly.validate(compiled.bytes), true);
  assert.match(compiled.wat, /export "main"/);
  assert.match(compiled.wat, /import "host" "print" \(func \$print \(param i32\) \(param f64\)\)/);
});

test("compila módulos Lume com imports nomeados e caminhos relativos", async () => {
  const source = `import { somar as soma } from "./math/ops.lume";
fn main() -> i32 { return soma(19, 23); }`;
  const modules = {
    "math/ops.lume": `import { dobrar } from "../numbers.lume";
export fn somar(a: i32, b: i32) -> i32 { return dobrar(a) + b; }`,
    "numbers.lume": `export fn dobrar(value: i32) -> i32 { return value * 2; }`,
  };
  const output = compile(source, { modules });
  assert.equal(WebAssembly.validate(output.bytes), true);
  assert.deepEqual(output.functions, ["main"]);

  const { instance } = await instantiatePackage(source, { modules });
  assert.equal(instance.exports.main(), 61);
  assert.equal(instance.exports.somar, undefined);
  assert.match(output.wat, /call \$lume_m2_f0_dobrar/);
});

test("API pública executa arrays e structs com heap gerenciado e libera ao retornar", async () => {
  const source = `struct Size { width: f64, height: f64 }
fn main() -> i32 {
  let dimensions: array<f64> = [2.5, 4.0];
  let size: Size = Size { width: dimensions[0], height: dimensions[1] };
  print_f64(size.width * size.height);
  return dimensions.length;
}`;
  const printed = [];
  const runtime = await instantiatePackage(source, { host: { print_f64(value) { printed.push(value); } } });
  assert.equal(runtime.run(), 2);
  assert.deepEqual(printed, [10]);
  assert.throws(() => runtime.run(), /já foi liberada/);
  runtime.dispose();
});

test("mantém o heap após run enquanto callbacks de clique continuam ativos", async () => {
  const runtime = await instantiatePackage(
    "fn make() -> array<i32> { return [42]; } fn main() -> i32 { listen_click(); return 0; } fn on_click(x: i32, y: i32) -> i32 { return x + y; }",
    { host: { listen_click() {} } },
  );
  assert.equal(runtime.run(), 0);
  assert.ok(runtime.instance.exports.make() > 0);
  runtime.dispose();
  assert.throws(() => runtime.instance.exports.make(), /heap desta execução já foi liberado/);
});

test("rejeita tipos de elemento e campos inválidos em arrays e structs", () => {
  assert.throws(() => compile("struct Point { x: i32 } fn main() -> i32 { let p: Point = Point { y: 1 }; return 0; }"), /campo “y” não existe/);
  assert.throws(() => compile("struct Point { x: i32 } fn main() -> i32 { let p: Point = Point {}; return 0; }"), /campo “x” não informado/);
  assert.throws(() => compile("fn main() -> i32 { let values: array<i32> = [true]; return 0; }"), /elemento 1 do array deve ser i32/);
  assert.throws(() => compile("fn main() -> i32 { let values: array<f64> = array_i32(2); return 0; }"), /cria array<i32>, não array<f64>/);
  assert.throws(() => compile("fn main() -> i32 { let values: array<Missing> = []; return 0; }"), /tipo “array<Missing>” não suportado/);
});

test("valida módulos ausentes, exports e caminhos relativos", () => {
  const source = 'import { soma } from "./math.lume"; fn main() -> i32 { return soma(1, 2); }';
  assert.throws(() => compile(source), /módulo “math\.lume” não foi fornecido/);
  assert.throws(() => compile(source, { modules: {
    "math.lume": "fn soma(a: i32, b: i32) -> i32 { return a + b; }",
  } }), /função “soma” não está exportada/);
  assert.throws(() => compile('import { soma } from "../math.lume"; fn main() -> i32 { return 0; }', {
    modules: { "math.lume": "export fn soma(a: i32, b: i32) -> i32 { return a + b; }" },
  }), /não pode sair da raiz/);
  assert.throws(() => compile('fn main() -> i32 { return 0; }', {
    modules: { "unused.lume": "export fn helper() -> i32 { return 1; }" },
  }), /foi fornecido, mas não é importado/);
  assert.throws(() => compile(source, { modules: {
    "math.lume": "export fn soma(a: i32, b: i32) -> i32 { return 1.5; }",
  } }), /math\.lume: linha 1, coluna/);
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

test("imprime strings UTF-8 com escapes, variáveis e parâmetros", () => {
  const printed = [];
  let instance;
  const output = compile("fn echo(text: string) -> string { return text; }\nfn main() -> i32 { let message: string = echo(\"Olá,\\nLume\\0!\"); print_string(message); print_string(\"\"); return 0; }");
  assert.equal(WebAssembly.validate(output.bytes), true);
  instance = instantiate("fn echo(text: string) -> string { return text; }\nfn main() -> i32 { let message: string = echo(\"Olá,\\nLume\\0!\"); print_string(message); print_string(\"\"); return 0; }", {
    print_string(pointer) {
      const memory = instance.exports.memory;
      const address = pointer >>> 0;
      const length = new DataView(memory.buffer).getUint32(address - 4, true);
      printed.push(new TextDecoder().decode(new Uint8Array(memory.buffer, address, length)));
    },
  }).instance;
  instance.exports.main();
  assert.deepEqual(printed, ["Olá,\nLume\0!", ""]);
  assert.throws(() => compile('fn main() -> i32 { print_string("\\q"); return 0; }'), /sequência de escape inválida/);
  assert.throws(() => compile('fn main() -> i32 { print_string("ab); return 0; }'), /texto entre aspas não foi fechado/);
});

test("print e print_string imprimem texto com ou sem números i32 e f64", () => {
  const printed = [];
  let instance;
  const source = 'fn main() -> i32 { let count: i32 = -42; let ratio: f64 = 3.5; print("count=", count); print_string("count=", count); print("ratio=", ratio); print_string("ratio=", ratio); print("texto"); print_string("texto"); return 0; }';
  const decodeOutput = (pointer, value) => {
    const memory = instance.exports.memory;
    const address = pointer >>> 0;
    const length = new DataView(memory.buffer).getUint32(address - 4, true);
    const text = new TextDecoder().decode(new Uint8Array(memory.buffer, address, length));
    printed.push(`${text}${value === undefined ? "" : Number(value).toString()}`);
  };
  const { output, instance: wasmInstance } = instantiate(source, {
    print: decodeOutput,
    print_string: decodeOutput,
  });
  instance = wasmInstance;
  assert.equal(WebAssembly.validate(output.bytes), true);
  instance.exports.main();
  assert.deepEqual(printed, ["count=-42", "count=-42", "ratio=3.5", "ratio=3.5", "texto", "texto"]);
  assert.match(output.wat, /f64\.convert_i32_s/);
  assert.throws(() => compile('fn main() -> i32 { print("count=", 1, 2); return 0; }'), /“print” espera um texto, com um número opcional/);
  assert.throws(() => compile('fn main() -> i32 { print_string("count=", 1, 2); return 0; }'), /“print_string” espera um texto, com um número opcional/);
  assert.throws(() => compile('fn main() -> i32 { print("count=", true); return 0; }'), /o segundo argumento de “print” deve ser i32 ou f64/);
  assert.throws(() => compile('fn main() -> i32 { print_string(42); return 0; }'), /o argumento de “print_string” deve ser string/);
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
