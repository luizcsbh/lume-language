import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../src/examples.js";

const messages = [];
const workerScope = {
  postMessage(message) { messages.push(message); },
};
const previousSelf = globalThis.self;
globalThis.self = workerScope;
await import(new URL("../src/worker.js?worker-tests", import.meta.url));

after(() => {
  if (previousSelf === undefined) delete globalThis.self;
  else globalThis.self = previousSelf;
});

async function run(source, modules) {
  messages.length = 0;
  await workerScope.onmessage({ data: { type: "run", source, modules } });
  return [...messages];
}

const clickFunction = "fn on_click(x: i32, y: i32) -> i32 { return x + y; }";

test("registra o listener de clique uma única vez e mantém o callback disponível", async () => {
  const source = `${clickFunction}\nfn main() -> i32 { listen_click(); listen_click(); return 0; }`;
  const result = await run(source);
  assert.equal(result.filter(message => message.type === "listen-click").length, 1);
  const done = result.find(message => message.type === "done");
  assert.ok(done);
  assert.equal(done.clickListening, true);
  assert.equal(result.some(message => message.type === "error"), false);
});

test("imprime strings UTF-8 no console pelo Worker", async () => {
  const result = await run('fn main() -> i32 { print_string("Lume: olá\\n"); return 0; }');
  assert.ok(result.some(message => message.type === "output" && message.text === "Lume: olá\n"));
  assert.equal(result.some(message => message.type === "error"), false);
});

test("compila e executa imports de módulos no Worker", async () => {
  const result = await run(
    'import { answer } from "./answer.lume"; fn main() -> i32 { return answer(); }',
    { "answer.lume": "export fn answer() -> i32 { return 42; }" },
  );
  assert.equal(result.find(message => message.type === "done")?.returnValue, 42);
  assert.equal(result.some(message => message.type === "error"), false);
});

test("executa o exemplo visual de arrays e structs no heap do Worker", async () => {
  const result = await run(EXAMPLES.arrays);
  assert.equal(result.find(message => message.type === "done")?.returnValue, 42);
  assert.deepEqual(result.filter(message => message.type === "output").map(message => message.text), [
    "Quantidade de valores: 3",
    "4",
  ]);
  assert.equal(result.find(message => message.type === "memory-stats")?.stats.usedBytes, 44);
  assert.equal(result.some(message => message.type === "error"), false);
});

test("reporta índices fora dos limites como falha de execução", async () => {
  const result = await run("fn main() -> i32 { let values: array<i32> = [1]; return values[1]; }");
  assert.equal(result.some(message => message.type === "done"), false);
  assert.match(result.find(message => message.type === "error")?.message ?? "", /índice fora dos limites/);
});

test("rejeita índice f64 negativo antes de calcular o deslocamento físico", async () => {
  const result = await run("fn main() -> i32 { let values: array<f64> = [1.5]; print_f64(values[-2147483648]); return 0; }");
  assert.equal(result.some(message => message.type === "done"), false);
  assert.match(result.find(message => message.type === "error")?.message ?? "", /índice fora dos limites/);
  assert.equal(result.some(message => message.type === "output"), false);
});

test("print concatena texto com números inteiros e decimais em uma linha", async () => {
  const result = await run('fn main() -> i32 { print("contagem=", -12); print_string("contagem=", -12); print("razão=", 2.5); print_string("razão=", 2.5); return 0; }');
  assert.deepEqual(result.filter(message => message.type === "output").map(message => message.text), ["contagem=-12", "contagem=-12", "razão=2.5", "razão=2.5"]);
  assert.equal(result.some(message => message.type === "error"), false);
});

test("contabiliza listen_click no teto de efeitos mesmo quando a notificação é idempotente", async () => {
  const source = `${clickFunction}\nfn main() -> i32 { let i: i32 = 0; while i < 5000 { listen_click(); i = i + 1; } return 0; }`;
  const result = await run(source);
  assert.equal(result.filter(message => message.type === "listen-click").length, 1);
  assert.equal(result.some(message => message.type === "done"), false);
  assert.match(result.find(message => message.type === "error")?.message || "", /limite de 4096 efeitos do host/);
});

test("rejeita listener sem export on_click e não anuncia clique ativo", async () => {
  const result = await run("fn main() -> i32 { listen_click(); return 0; }");
  assert.equal(result.some(message => message.type === "listen-click"), false);
  assert.equal(result.some(message => message.type === "done"), false);
  assert.match(result.find(message => message.type === "error")?.message || "", /exige a função Lume on_click/);
});
