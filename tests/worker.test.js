import test, { after } from "node:test";
import assert from "node:assert/strict";

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

async function run(source) {
  messages.length = 0;
  await workerScope.onmessage({ data: { type: "run", source } });
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
