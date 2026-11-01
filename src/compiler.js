import { STANDARD_MODULES } from "./stdlib.js";

const BUILTINS = [
  { name: "print_i32", params: ["i32"], result: null },
  { name: "print_f64", params: ["f64"], result: null },
  { name: "print_string", params: ["string"], result: null },
  { name: "print", params: ["string", "f64"], result: null },
  { name: "string_length", params: ["string"], result: "i32" },
  { name: "string_byte_length", params: ["string"], result: "i32" },
  { name: "string_equals", params: ["string", "string"], result: "bool" },
  { name: "string_contains", params: ["string", "string"], result: "bool" },
  { name: "string_concat", params: ["string", "string"], result: "string" },
  { name: "string_slice", params: ["string", "i32", "i32"], result: "string" },
  { name: "canvas_clear", params: [], result: null },
  { name: "canvas_dot", params: ["i32", "i32", "i32"], result: null },
  { name: "dom_value", params: ["i32"], result: null },
  { name: "dom_set_i32", params: ["i32", "i32"], result: null },
  { name: "dom_set_f64", params: ["i32", "f64"], result: null },
  { name: "dom_set_visible", params: ["i32", "bool"], result: null },
  { name: "read_slider", params: [], result: "i32" },
  { name: "listen_click", params: [], result: null },
  { name: "memory_alloc_i32", params: ["i32"], result: "i32" },
  { name: "memory_load_i32", params: ["i32", "i32"], result: "i32" },
  { name: "memory_store_i32", params: ["i32", "i32", "i32"], result: null },
  { name: "memory_load_f64", params: ["i32", "i32"], result: "f64" },
  { name: "memory_store_f64", params: ["i32", "i32", "f64"], result: null },
  { name: "memory_length", params: ["i32", "i32"], result: "i32" },
  { name: "memory_array_offset", params: ["i32", "i32", "i32"], result: "i32" },
  { name: "array_allocate_i32", params: ["i32"], result: "i32" },
  { name: "array_allocate_f64", params: ["i32"], result: "i32" },
  { name: "array_allocate_ref", params: ["i32"], result: "i32" },
  { name: "memory_free", params: ["i32"], result: null },
];
const ASYNC_BUILTINS = [
  { name: "async_status", params: ["i32"], result: "i32" },
  { name: "async_get_i32", params: ["i32"], result: "i32" },
  { name: "async_get_f64", params: ["i32"], result: "f64" },
  { name: "async_get_bool", params: ["i32"], result: "bool" },
  { name: "async_get_string", params: ["i32"], result: "string" },
];
const TYPES = new Set(["i32", "f64", "bool", "string"]);
const WASM_TYPE = { i32: 0x7f, f64: 0x7c, bool: 0x7f, string: 0x7f };
const ARRAY_CONSTRUCTORS = new Map([
  ["array_i32", "i32"], ["array_f64", "f64"], ["array_bool", "bool"], ["array_string", "string"],
  ["array_ref", "ref"],
]);
const INTRINSICS = new Map([
  ["intrinsic_abs_f64", [0x99, "f64.abs"]],
  ["intrinsic_ceil_f64", [0x9b, "f64.ceil"]],
  ["intrinsic_floor_f64", [0x9c, "f64.floor"]],
  ["intrinsic_trunc_f64", [0x9d, "f64.trunc"]],
  ["intrinsic_round_f64", [0x9e, "f64.nearest"]],
  ["intrinsic_sqrt_f64", [0x9f, "f64.sqrt"]],
]);
const KEYWORDS = new Set(["fn", "let", "return", "if", "else", "while", "true", "false", "import", "from", "as", "export", "struct", "async", "await", "host"]);
export const MAX_LUME_SOURCE_UNITS = 65_536;
export const MAX_LUME_PARSE_DEPTH = 128;
export const MAX_WASM_MEMORY_PAGES = 256;

export class LumeError extends Error {
  constructor(message, token = { line: 1, column: 1 }) {
    super(message);
    this.name = "LumeError";
    this.line = token.line;
    this.column = token.column;
  }
  toString() {
    const module = this.modulePath ? `${this.modulePath}: ` : "";
    return `${this.message} (${module}linha ${this.line}, coluna ${this.column})`;
  }
}

class Lexer {
  constructor(source) { this.source = source; this.index = 0; this.line = 1; this.column = 1; this.tokens = []; }
  peek(offset = 0) { return this.source[this.index + offset] ?? ""; }
  advance() {
    const char = this.source[this.index++];
    if (char === "\n") { this.line++; this.column = 1; } else this.column++;
    return char;
  }
  add(kind, value, line, column) { this.tokens.push({ kind, value, line, column }); }
  string(line, column, quote) {
    this.advance();
    let value = "";
    while (this.index < this.source.length) {
      const char = this.peek();
      if (char === quote) {
        this.advance();
        this.add("string", value, line, column);
        return;
      }
      if (char === "\n" || char === "\r") {
        throw new LumeError("texto entre aspas não foi fechado", { line, column });
      }
      if (char !== "\\") {
        value += this.advance();
        continue;
      }
      this.advance();
      const escaped = this.peek();
      const escapes = { "0": "\0", "'": "'", '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" };
      if (!Object.hasOwn(escapes, escaped)) {
        throw new LumeError(`sequência de escape inválida “\\${escaped}”`, { line: this.line, column: this.column });
      }
      this.advance();
      value += escapes[escaped];
    }
    throw new LumeError("texto entre aspas não foi fechado", { line, column });
  }
  tokenize() {
    while (this.index < this.source.length) {
      const char = this.peek();
      if (/\s/.test(char)) { this.advance(); continue; }
      if (char === "/" && this.peek(1) === "/") {
        while (this.index < this.source.length && this.advance() !== "\n") {}
        continue;
      }
      if (char === "/" && this.peek(1) === "*") {
        const line = this.line, column = this.column;
        this.advance(); this.advance();
        let closed = false;
        while (this.index < this.source.length) {
          if (this.peek() === "*" && this.peek(1) === "/") { this.advance(); this.advance(); closed = true; break; }
          this.advance();
        }
        if (!closed) throw new LumeError("comentário de bloco não foi fechado", { line, column });
        continue;
      }
      const line = this.line, column = this.column;
      if (/[A-Za-z_]/.test(char)) {
        let value = "";
        while (/[A-Za-z0-9_]/.test(this.peek())) value += this.advance();
        this.add(KEYWORDS.has(value) ? "keyword" : "identifier", value, line, column);
        continue;
      }
      if (/[0-9]/.test(char)) {
        let value = "";
        while (/[0-9]/.test(this.peek())) value += this.advance();
        if (this.peek() === "." && /[0-9]/.test(this.peek(1))) {
          value += this.advance();
          while (/[0-9]/.test(this.peek())) value += this.advance();
        }
        if (/[eE]/.test(this.peek())) {
          value += this.advance();
          if (/[+-]/.test(this.peek())) value += this.advance();
          if (!/[0-9]/.test(this.peek())) throw new LumeError("expoente numérico incompleto", { line, column });
          while (/[0-9]/.test(this.peek())) value += this.advance();
        }
        this.add("number", value, line, column);
        continue;
      }
      const pair = char + this.peek(1);
      if (["->", "==", "!=", "<=", ">=", "&&", "||"].includes(pair)) {
        this.advance(); this.advance(); this.add("symbol", pair, line, column); continue;
      }
      if ("+-*/%<>=!(){}:;,[].".includes(char)) {
        this.advance(); this.add("symbol", char, line, column); continue;
      }
      if (char === '"' || char === "'") { this.string(line, column, char); continue; }
      throw new LumeError(`caractere inesperado “${char}”`, { line, column });
    }
    this.tokens.push({ kind: "eof", value: "<fim>", line: this.line, column: this.column });
    return this.tokens;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
    this.depth = 0;
    this.structNames = new Set();
  }
  withDepth(token, parse) {
    this.depth++;
    if (this.depth > MAX_LUME_PARSE_DEPTH) {
      this.depth--;
      throw new LumeError(`programa excede a profundidade sintática máxima de ${MAX_LUME_PARSE_DEPTH}`, token);
    }
    try { return parse(); } finally { this.depth--; }
  }
  current() { return this.tokens[this.position]; }
  previous() { return this.tokens[this.position - 1]; }
  at(value) { return this.current().value === value; }
  match(value) { if (!this.at(value)) return false; this.position++; return true; }
  expect(value, message = `esperado “${value}”`) {
    if (!this.at(value)) throw new LumeError(message, this.current());
    return this.tokens[this.position++];
  }
  expectName(message = "esperado um nome") {
    if (this.current().kind !== "identifier") throw new LumeError(message, this.current());
    return this.tokens[this.position++];
  }
  parseType() {
    return this.withDepth(this.current(), () => {
      const token = this.expectName("esperado tipo i32, f64, bool ou string");
      if (token.value === "array") {
        this.expect("<", "esperado < depois de array");
        const elementType = this.parseType();
        this.expect(">", "esperado > depois do tipo do array");
        return `array<${elementType}>`;
      }
      return token.value;
    });
  }
  parse() {
    const functions = [];
    const imports = [];
    const structs = [];
    const hostAsyncFunctions = [];
    let declarationsStarted = false;
    let functionsStarted = false;
    while (this.current().kind !== "eof") {
      if (this.match("import")) {
        if (declarationsStarted) throw new LumeError("imports devem aparecer antes dos tipos e funções", this.previous());
        imports.push(this.importDeclaration());
      } else if (this.match("struct")) {
        if (functionsStarted) throw new LumeError("structs devem ser declaradas antes das funções", this.previous());
        declarationsStarted = true;
        const declaration = this.structDeclaration();
        if (this.structNames.has(declaration.name)) throw new LumeError(`struct “${declaration.name}” declarada mais de uma vez`, declaration.token);
        this.structNames.add(declaration.name);
        structs.push(declaration);
      } else if (this.match("host")) {
        if (functionsStarted) throw new LumeError("declarações host async devem aparecer antes das funções", this.previous());
        declarationsStarted = true;
        hostAsyncFunctions.push(this.hostAsyncDeclaration());
      } else {
        declarationsStarted = true;
        functionsStarted = true;
        const exported = this.match("export");
        const asynchronous = this.match("async");
        functions.push(this.functionDeclaration(exported, asynchronous));
      }
    }
    if (!functions.length) throw new LumeError("escreva pelo menos uma função, por exemplo fn main() -> i32 { return 0; }");
    return { functions, imports, structs, hostAsyncFunctions };
  }
  structDeclaration() {
    const name = this.expectName("esperado o nome da struct");
    this.expect("{", "esperado { depois do nome da struct");
    const fields = [];
    const fieldNames = new Set();
    while (!this.at("}") && this.current().kind !== "eof") {
      const field = this.expectName("esperado o nome do campo");
      if (fieldNames.has(field.value)) throw new LumeError(`campo “${field.value}” duplicado`, field);
      fieldNames.add(field.value);
      this.expect(":", "informe o tipo do campo depois de :");
      fields.push({ name: field.value, type: this.parseType(), token: field });
      if (!this.match(",")) break;
    }
    if (!fields.length) throw new LumeError("uma struct deve declarar pelo menos um campo", name);
    this.expect("}", "struct não foi fechada com }");
    return { name: name.value, token: name, fields };
  }
  importDeclaration() {
    const token = this.previous();
    this.expect("{", "esperado { depois de import");
    const names = [];
    if (this.at("}")) throw new LumeError("informe pelo menos uma função no import", this.current());
    do {
      const imported = this.expectName("esperado o nome de uma função importada");
      const local = this.match("as") ? this.expectName("esperado um alias depois de as") : imported;
      names.push({ imported: imported.value, local: local.value, token: imported });
    } while (this.match(","));
    this.expect("}");
    this.expect("from", "esperado from depois dos nomes importados");
    if (this.current().kind !== "string") throw new LumeError("esperado o caminho do módulo entre aspas", this.current());
    const path = this.tokens[this.position++];
    this.expect(";", "termine o import com ;");
    return { path: path.value, names, token };
  }
  hostAsyncDeclaration() {
    const token = this.previous();
    this.expect("async", "declarações host devem usar “host async fn”");
    const signature = this.functionSignature();
    this.expect(";", "termine a declaração host com ;");
    return { ...signature, token, exported: false, host: true };
  }
  functionSignature() {
    this.expect("fn", "cada declaração deve começar com fn");
    const name = this.expectName("esperado o nome da função");
    this.expect("(");
    const params = [];
    if (!this.at(")")) {
      do {
        const param = this.expectName("esperado o nome do parâmetro");
        this.expect(":", "informe o tipo do parâmetro após :");
        params.push({ name: param.value, type: this.parseType(), token: param });
      } while (this.match(","));
    }
    this.expect(")");
    let result = "i32";
    if (this.match("->")) result = this.parseType();
    return { name: name.value, token: name, params, result };
  }
  functionDeclaration(exported = false, asynchronous = false) {
    const signature = this.functionSignature();
    const body = this.block();
    return { ...signature, body, exported, asynchronous };
  }
  block() {
    const opening = this.expect("{", "esperado um bloco entre chaves");
    return this.withDepth(opening, () => {
      const statements = [];
      while (!this.at("}") && this.current().kind !== "eof") statements.push(this.statement());
      this.expect("}", "bloco não foi fechado com }");
      return { kind: "block", statements };
    });
  }
  statement() {
    if (this.at("{")) return this.block();
    if (this.match("let")) {
      const token = this.expectName("esperado o nome da variável");
      this.expect(":", "variáveis devem declarar o tipo, por exemplo let total: i32 = 0;");
      const type = this.parseType();
      this.expect("=", "esperado = depois da declaração da variável");
      const value = this.expression();
      this.expect(";", "termine a declaração com ;");
      return { kind: "let", name: token.value, type, value, token };
    }
    if (this.match("return")) {
      const token = this.previous();
      if (this.at(";")) throw new LumeError("esta versão exige um valor de retorno", this.current());
      const value = this.expression();
      this.expect(";", "termine o retorno com ;");
      return { kind: "return", value, token };
    }
    if (this.match("if")) {
      const token = this.previous();
      const condition = this.parenthesizedExpression();
      const thenBranch = this.block();
      const elseBranch = this.match("else") ? (this.at("if") ? this.statement() : this.block()) : null;
      return { kind: "if", condition, thenBranch, elseBranch, token };
    }
    if (this.match("while")) {
      const token = this.previous();
      const condition = this.parenthesizedExpression();
      return { kind: "while", condition, body: this.block(), token };
    }
    const value = this.expression();
    if (this.match("=")) {
      const assigned = this.expression();
      this.expect(";", "termine a atribuição com ;");
      return { kind: "assign_target", target: value, value: assigned, token: value.token };
    }
    this.expect(";", "termine a instrução com ;");
    return { kind: "expression", value };
  }
  parenthesizedExpression() {
    if (!this.match("(")) return this.expression();
    const value = this.expression(); this.expect(")"); return value;
  }
  expression(min = 1) {
    let left = this.prefix();
    const precedences = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
    while ((precedences[this.current().value] || 0) >= min) {
      const operator = this.tokens[this.position++];
      const right = this.expression(precedences[operator.value] + 1);
      left = { kind: "binary", operator: operator.value, left, right, token: operator };
    }
    return left;
  }
  prefix() { return this.withDepth(this.current(), () => this.parsePrefix()); }
  parsePrefix() {
    if (this.match("await")) {
      const token = this.previous();
      return this.postfix({ kind: "await", value: this.prefix(), token });
    }
    if (this.at("!") || this.at("-")) {
      const token = this.tokens[this.position++];
      return { kind: "unary", operator: token.value, value: this.prefix(), token };
    }
    if (this.match("(")) { const value = this.expression(); this.expect(")"); return this.postfix(value); }
    const token = this.current();
    if (token.kind === "number") {
      this.position++;
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new LumeError("literal numérico fora do intervalo", token);
      return this.postfix({ kind: "number", value, type: /[.eE]/.test(token.value) ? "f64" : "i32", token });
    }
    if (token.kind === "string") {
      this.position++;
      return this.postfix({ kind: "string", value: token.value, token });
    }
    if (this.match("true")) return this.postfix({ kind: "bool", value: 1, type: "bool", token });
    if (this.match("false")) return this.postfix({ kind: "bool", value: 0, type: "bool", token });
    if (token.kind === "identifier") {
      this.position++;
      if (this.structNames.has(token.value) && this.match("{")) {
        const fields = [];
        if (!this.at("}")) {
          do {
            const field = this.expectName("esperado o nome de um campo da struct");
            this.expect(":", "esperado : depois do campo da struct");
            fields.push({ name: field.value, value: this.expression(), token: field });
          } while (this.match(","));
        }
        this.expect("}", "literal de struct não foi fechado com }");
        return this.postfix({ kind: "struct_literal", name: token.value, fields, token });
      }
      if (!this.match("(")) return this.postfix({ kind: "variable", name: token.value, token });
      const args = [];
      if (!this.at(")")) do { args.push(this.expression()); } while (this.match(","));
      this.expect(")", "esperado ) depois dos argumentos");
      return this.postfix({ kind: "call", name: token.value, args, token });
    }
    if (this.match("[")) {
      const token = this.previous();
      const elements = [];
      if (!this.at("]")) {
        do { elements.push(this.expression()); } while (this.match(","));
      }
      this.expect("]", "literal de array não foi fechado com ]");
      return this.postfix({ kind: "array_literal", elements, token });
    }
    throw new LumeError("esperada uma expressão (número, variável, chamada de função ou condição)", token);
  }
  postfix(expression) {
    let value = expression;
    while (true) {
      if (this.match("[")) {
        const token = this.previous();
        const index = this.expression();
        this.expect("]", "esperado ] depois do índice");
        value = { kind: "index", object: value, index, token };
      } else if (this.match(".")) {
        const token = this.expectName("esperado o nome do campo depois de .");
        value = { kind: "field", object: value, name: token.value, token };
      } else {
        return value;
      }
    }
  }
}

function uleb(value) {
  const out = [];
  let number = value >>> 0;
  do { let byte = number & 0x7f; number >>>= 7; if (number) byte |= 0x80; out.push(byte); } while (number);
  return out;
}
function sleb(value) {
  const out = [];
  let number = value | 0;
  while (true) {
    let byte = number & 0x7f;
    number >>= 7;
    const done = (number === 0 && (byte & 0x40) === 0) || (number === -1 && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}
function vector(items) { return [...uleb(items.length), ...items.flat()]; }
function wasmName(name) { const bytes = [...new TextEncoder().encode(name)]; return [...uleb(bytes.length), ...bytes]; }
function section(id, payload) { return [id, ...uleb(payload.length), ...payload]; }
function signature(params, result) { return `${params.join(",")}>${result || ""}`; }
const watType = type => type === "f64" ? "f64" : "i32";
const wasmTypeCode = type => type === "f64" ? WASM_TYPE.f64 : WASM_TYPE.i32;
const asyncGetter = type => `async_get_${type}`;

class FunctionEmitter {
  constructor(fn, functions, functionIndices, strings, functionBindings, structs, asyncContext = null) {
    this.fn = fn; this.functions = functions; this.functionIndices = functionIndices;
    this.functionBindings = functionBindings;
    this.structs = structs;
    this.strings = strings;
    this.asyncContext = asyncContext;
    this.code = []; this.wat = []; this.locals = []; this.scopes = [new Map()];
    fn.params.forEach((param, index) => this.scopes[0].set(param.name, { index, type: param.type, token: param.token }));
    for (const [name, variable] of asyncContext?.priorVariables ?? []) this.scopes[0].set(name, variable);
    this.paramCount = fn.params.length;
  }
  emit(opcode, text) { this.code.push(opcode); this.wat.push(text); }
  globalGet(index) { this.emit(0x23, `global.get $g${index}`); this.code.push(...uleb(index)); }
  globalSet(index) { this.emit(0x24, `global.set $g${index}`); this.code.push(...uleb(index)); }
  setVariable(variable) {
    if (variable.globalIndex !== undefined) this.globalSet(variable.globalIndex);
    else { this.emit(0x21, `local.set $l${variable.index}_${variable.name}`); this.code.push(...uleb(variable.index)); }
  }
  call(name) {
    const functionIndex = this.functionIndices.get(name);
    this.emit(0x10, `call $${name}`);
    this.code.push(...uleb(functionIndex));
  }
  temporary(type = "i32") {
    const index = this.paramCount + this.locals.length;
    this.locals.push({ name: `temp${index}`, type });
    return index;
  }
  arrayAllocator(elementType) {
    if (elementType === "f64") return "array_allocate_f64";
    if (isManagedType(elementType, this.structs)) return "array_allocate_ref";
    return "array_allocate_i32";
  }
  arrayStorageType(elementType) {
    return elementType === "f64" ? "f64" : "i32";
  }
  emitMemoryLoad(type) { this.call(type === "f64" ? "memory_load_f64" : "memory_load_i32"); }
  emitMemoryStore(type) { this.call(type === "f64" ? "memory_store_f64" : "memory_store_i32"); }
  emitArrayAddress(elementType) {
    const index = this.temporary();
    this.emit(0x21, `local.set $l${index}_temp${index}`); this.code.push(...uleb(index));
    const handle = this.temporary();
    this.emit(0x22, `local.tee $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    this.emit(0x20, `local.get $l${index}_temp${index}`); this.code.push(...uleb(index));
    this.constant("i32", storageWidth(elementType));
    this.call("memory_array_offset");
    const offset = this.temporary();
    this.emit(0x21, `local.set $l${offset}_temp${offset}`); this.code.push(...uleb(offset));
    this.emit(0x20, `local.get $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    this.emit(0x20, `local.get $l${offset}_temp${offset}`); this.code.push(...uleb(offset));
  }
  constant(type, value) {
    if (type === "f64") {
      this.emit(0x44, `f64.const ${Number(value)}`);
      const buffer = new ArrayBuffer(8); new DataView(buffer).setFloat64(0, Number(value), true);
      this.code.push(...new Uint8Array(buffer));
      return;
    }
    const integer = Math.trunc(Number(value));
    if (!Number.isFinite(integer) || integer < -2147483648 || integer > 2147483647) throw new LumeError("literal i32 fora do intervalo de -2147483648 a 2147483647", this.fn.token);
    this.emit(0x41, `i32.const ${integer}`); this.code.push(...sleb(integer));
  }
  lookup(name, token) {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      if (this.scopes[index].has(name)) return this.scopes[index].get(name);
    }
    throw new LumeError(`variável “${name}” não foi declarada`, token);
  }
  enterScope() { this.scopes.push(new Map()); }
  leaveScope() { this.scopes.pop(); }
  compileBlock(block, ownScope = true) {
    if (ownScope) this.enterScope();
    for (const statement of block.statements) this.compileStatement(statement);
    if (ownScope) this.leaveScope();
  }
  compileStatement(node) {
    switch (node.kind) {
      case "block": this.compileBlock(node); break;
      case "let": {
        if (!isKnownType(node.type, this.structs)) throw new LumeError(`tipo “${node.type}” não suportado`, node.token);
        const valueType = this.compileExpression(node.value, node.type);
        if (valueType !== node.type) throw new LumeError(`a variável “${node.name}” é ${node.type}, mas recebeu ${valueType}`, node.token);
        if (this.scopes[this.scopes.length - 1].has(node.name)) throw new LumeError(`variável “${node.name}” já existe neste bloco`, node.token);
        const globalIndex = this.asyncContext?.localGlobals.get(node);
        const variable = globalIndex === undefined
          ? { index: this.paramCount + this.locals.length, type: node.type, token: node.token }
          : { globalIndex, type: node.type, token: node.token, name: node.name };
        if (globalIndex === undefined) this.locals.push({ name: node.name, type: node.type });
        this.scopes[this.scopes.length - 1].set(node.name, variable);
        this.setVariable(variable); break;
      }
      case "assign": {
        const variable = this.lookup(node.name, node.token);
        const valueType = this.compileExpression(node.value);
        if (valueType !== variable.type) throw new LumeError(`não é possível atribuir ${valueType} à variável ${variable.type} “${node.name}”`, node.token);
        this.setVariable({ ...variable, name: node.name }); break;
      }
      case "assign_target": {
        this.compileAssignment(node);
        break;
      }
      case "return": {
        if (this.asyncContext) {
          const type = this.compileExpression(node.value, this.fn.result);
          if (type !== this.fn.result) throw new LumeError(`a função retorna ${this.fn.result}, mas recebeu ${type}`, node.token);
          this.globalSet(this.asyncContext.resultGlobal);
          this.constant("i32", this.asyncContext.doneState);
          this.globalSet(this.asyncContext.stateGlobal);
          this.constant("i32", 1);
          this.emit(0x0f, "return");
          break;
        }
        const type = this.compileExpression(node.value, this.fn.result);
        if (type !== this.fn.result) throw new LumeError(`a função retorna ${this.fn.result}, mas recebeu ${type}`, node.token);
        this.emit(0x0f, "return"); break;
      }
      case "async_start": {
        this.compileHostAsyncCall(node.call);
        this.globalSet(this.asyncContext.futureGlobal);
        this.constant("i32", node.nextState);
        this.globalSet(this.asyncContext.stateGlobal);
        this.constant("i32", 0);
        this.emit(0x0f, "return");
        break;
      }
      case "async_resume":
      case "async_resume_return": {
        this.globalGet(this.asyncContext.futureGlobal);
        this.call("async_status");
        this.emit(0x45, "i32.eqz");
        this.emit(0x04, "if"); this.code.push(0x40);
        this.constant("i32", 0);
        this.emit(0x0f, "return");
        this.emit(0x0b, "end");
        this.globalGet(this.asyncContext.futureGlobal);
        this.call(asyncGetter(node.type));
        if (node.kind === "async_resume_return") {
          this.globalSet(this.asyncContext.resultGlobal);
          this.constant("i32", this.asyncContext.doneState);
          this.globalSet(this.asyncContext.stateGlobal);
          this.constant("i32", 1);
          this.emit(0x0f, "return");
        } else if (node.declaration) {
          if (this.scopes[this.scopes.length - 1].has(node.name)) {
            throw new LumeError(`variável “${node.name}” já existe neste bloco`, node.token);
          }
          const variable = {
            globalIndex: this.asyncContext.localGlobals.get(node.declaration),
            type: node.type,
            token: node.token,
            name: node.name,
          };
          if (variable.globalIndex === undefined) throw new LumeError("estado async inválido para declaração local", node.token);
          this.globalSet(variable.globalIndex);
          this.scopes[this.scopes.length - 1].set(node.name, variable);
        } else {
          const variable = this.lookup(node.name, node.token);
          if (variable.type !== node.type) throw new LumeError("tipo incompatível ao retomar await", node.token);
          this.setVariable({ ...variable, name: node.name });
        }
        break;
      }
      case "if": {
        const type = this.compileExpression(node.condition);
        if (type !== "i32" && type !== "bool") throw new LumeError("a condição do if deve ser i32 ou bool", node.token);
        this.emit(0x04, "if"); this.code.push(0x40);
        this.compileBlock(node.thenBranch);
        if (node.elseBranch) { this.emit(0x05, "else"); if (node.elseBranch.kind === "block") this.compileBlock(node.elseBranch); else this.compileStatement(node.elseBranch); }
        this.emit(0x0b, "end"); break;
      }
      case "while": {
        const loopDepth = this.wat.length;
        this.emit(0x02, "block"); this.code.push(0x40);
        this.emit(0x03, "loop"); this.code.push(0x40);
        const type = this.compileExpression(node.condition);
        if (type !== "i32" && type !== "bool") throw new LumeError("a condição do while deve ser i32 ou bool", node.token);
        this.emit(0x45, "i32.eqz");
        this.emit(0x0d, "br 1"); this.code.push(...uleb(1));
        this.compileBlock(node.body);
        this.emit(0x0c, "br 0"); this.code.push(...uleb(0));
        this.emit(0x0b, "end"); this.emit(0x0b, "end");
        void loopDepth; break;
      }
      case "expression": {
        const type = this.compileExpression(node.value);
        if (type) this.emit(0x1a, "drop");
        break;
      }
      default: throw new LumeError("instrução não suportada", node.token);
    }
  }
  compileExpression(node, expectedType = null) {
    switch (node.kind) {
      case "number": this.constant(node.type, node.value); return node.type;
      case "string": this.constant("i32", this.strings.intern(node.value)); return "string";
      case "bool": this.constant("i32", node.value); return "bool";
      case "variable": {
        const variable = this.lookup(node.name, node.token);
        if (variable.globalIndex !== undefined) this.globalGet(variable.globalIndex);
        else { this.emit(0x20, `local.get $l${variable.index}_${node.name}`); this.code.push(...uleb(variable.index)); }
        return variable.type;
      }
      case "await": throw new LumeError("await só pode ser usado diretamente em uma declaração, atribuição ou return de async fn main", node.token);
      case "unary": {
        if (node.operator === "-" && node.value.kind === "number" && node.value.type === "i32" && node.value.value === 2147483648) {
          this.constant("i32", -2147483648);
          return "i32";
        }
        const type = this.compileExpression(node.value);
        if (node.operator === "-") {
          if (type === "f64") { this.emit(0x9a, "f64.neg"); }
          else if (type === "i32") { this.emit(0x41, "i32.const -1"); this.code.push(...sleb(-1)); this.emit(0x6c, "i32.mul"); }
          else throw new LumeError("o operador - exige um número", node.token);
          return type;
        }
        if (type !== "i32" && type !== "bool") throw new LumeError("o operador ! exige i32 ou bool", node.token);
        this.emit(0x45, "i32.eqz"); return "bool";
      }
      case "call": return this.compileCall(node, expectedType);
      case "binary": return this.compileBinary(node);
      case "array_literal": return this.compileArrayLiteral(node, expectedType);
      case "struct_literal": return this.compileStructLiteral(node);
      case "index": return this.compileIndex(node);
      case "field": return this.compileField(node);
      default: throw new LumeError("expressão não suportada", node.token);
    }
  }
  compileArrayLiteral(node, expectedType) {
    const elementType = arrayElementType(expectedType ?? "");
    if (!elementType) throw new LumeError("arrays literais precisam de um tipo explícito, por exemplo let xs: array<i32> = [1, 2];", node.token);
    if (!isKnownType(elementType, this.structs)) throw new LumeError(`tipo de elemento “${elementType}” não suportado`, node.token);
    const allocator = this.arrayAllocator(elementType);
    this.constant("i32", node.elements.length);
    this.call(allocator);
    const handle = this.temporary();
    this.emit(0x21, `local.set $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    node.elements.forEach((element, index) => {
      this.emit(0x20, `local.get $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
      this.constant("i32", index * storageWidth(elementType));
      const actual = this.compileExpression(element, elementType);
      if (actual !== elementType) throw new LumeError(`elemento ${index + 1} do array deve ser ${elementType}, não ${actual}`, element.token);
      this.emitMemoryStore(elementType);
    });
    this.emit(0x20, `local.get $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    return expectedType;
  }
  compileStructLiteral(node) {
    const struct = this.structs.get(node.name);
    if (!struct) throw new LumeError(`struct “${node.name}” não existe`, node.token);
    const values = new Map();
    for (const field of node.fields) {
      if (!struct.fields.has(field.name)) throw new LumeError(`campo “${field.name}” não existe na struct “${node.name}”`, field.token);
      if (values.has(field.name)) throw new LumeError(`campo “${field.name}” informado mais de uma vez`, field.token);
      values.set(field.name, field);
    }
    for (const field of struct.fields.values()) {
      if (!values.has(field.name)) throw new LumeError(`campo “${field.name}” não informado na struct “${node.name}”`, node.token);
    }
    this.constant("i32", struct.size);
    this.call("memory_alloc_i32");
    const handle = this.temporary();
    this.emit(0x21, `local.set $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    for (const field of struct.fields.values()) {
      const value = values.get(field.name);
      this.emit(0x20, `local.get $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
      this.constant("i32", field.offset);
      const actual = this.compileExpression(value.value, field.type);
      if (actual !== field.type) throw new LumeError(`campo “${field.name}” deve ser ${field.type}, não ${actual}`, value.token);
      this.emitMemoryStore(field.type);
    }
    this.emit(0x20, `local.get $l${handle}_temp${handle}`); this.code.push(...uleb(handle));
    return node.name;
  }
  compileIndex(node) {
    const objectType = this.compileExpression(node.object);
    const elementType = arrayElementType(objectType);
    if (!elementType) throw new LumeError(`tipo “${objectType}” não pode ser indexado`, node.token);
    const indexType = this.compileExpression(node.index);
    if (indexType !== "i32") throw new LumeError("o índice do array deve ser i32", node.token);
    this.emitArrayAddress(elementType);
    this.emitMemoryLoad(elementType);
    return elementType;
  }
  compileField(node) {
    const objectType = this.compileExpression(node.object);
    const elementType = arrayElementType(objectType);
    if (elementType && node.name === "length") {
      this.constant("i32", storageWidth(elementType));
      this.call("memory_length");
      return "i32";
    }
    const struct = this.structs.get(objectType);
    const field = struct?.fields.get(node.name);
    if (!field) throw new LumeError(`campo “${node.name}” não existe no tipo “${objectType}”`, node.token);
    this.constant("i32", field.offset);
    this.emitMemoryLoad(field.type);
    return field.type;
  }
  compileAssignment(node) {
    if (node.target.kind === "variable") {
      const variable = this.lookup(node.target.name, node.target.token);
      const actual = this.compileExpression(node.value, variable.type);
      if (actual !== variable.type) throw new LumeError(`não é possível atribuir ${actual} à variável ${variable.type} “${node.target.name}”`, node.token);
      this.setVariable({ ...variable, name: node.target.name });
      return;
    }
    if (node.target.kind === "index") {
      const objectType = this.compileExpression(node.target.object);
      const elementType = arrayElementType(objectType);
      if (!elementType) throw new LumeError(`tipo “${objectType}” não pode ser indexado`, node.target.token);
      const indexType = this.compileExpression(node.target.index);
      if (indexType !== "i32") throw new LumeError("o índice do array deve ser i32", node.target.token);
      this.emitArrayAddress(elementType);
      const valueType = this.compileExpression(node.value, elementType);
      if (valueType !== elementType) throw new LumeError(`elemento do array deve ser ${elementType}, não ${valueType}`, node.token);
      this.emitMemoryStore(elementType);
      return;
    }
    if (node.target.kind === "field") {
      const objectType = this.compileExpression(node.target.object);
      const field = this.structs.get(objectType)?.fields.get(node.target.name);
      if (!field) throw new LumeError(`campo “${node.target.name}” não existe no tipo “${objectType}”`, node.target.token);
      this.constant("i32", field.offset);
      const valueType = this.compileExpression(node.value, field.type);
      if (valueType !== field.type) throw new LumeError(`campo “${node.target.name}” deve ser ${field.type}, não ${valueType}`, node.token);
      this.emitMemoryStore(field.type);
      return;
    }
    throw new LumeError("o destino da atribuição deve ser uma variável, campo ou elemento de array", node.token);
  }
  compileHostAsyncCall(node) {
    const target = this.asyncContext.hostAsyncFunctions.get(node.name);
    if (!target) throw new LumeError(`“${node.name}” não é uma função host async declarada`, node.token);
    if (node.args.length !== target.params.length) {
      throw new LumeError(`“${node.name}” espera ${target.params.length} argumento(s), mas recebeu ${node.args.length}`, node.token);
    }
    node.args.forEach((arg, index) => {
      const expected = target.params[index].type;
      const actual = this.compileExpression(arg, expected);
      if (actual !== expected) throw new LumeError(`argumento ${index + 1} de “${node.name}” deve ser ${expected}, não ${actual}`, node.token);
    });
    this.call(`async_host_${node.name}`);
  }
  compileCall(node, expectedType = null) {
    if (INTRINSICS.has(node.name)) {
      if (node.args.length !== 1) throw new LumeError(`“${node.name}” espera um argumento f64`, node.token);
      const actual = this.compileExpression(node.args[0], "f64");
      if (actual !== "f64") throw new LumeError(`o argumento de “${node.name}” deve ser f64, não ${actual}`, node.token);
      const [opcode, instruction] = INTRINSICS.get(node.name);
      this.emit(opcode, instruction);
      return "f64";
    }
    if (ARRAY_CONSTRUCTORS.has(node.name)) {
      if (node.args.length !== 1) throw new LumeError(`“${node.name}” espera o tamanho do array`, node.token);
      const elementType = ARRAY_CONSTRUCTORS.get(node.name);
      const expectedElement = arrayElementType(expectedType ?? "");
      const actualElement = elementType === "ref" ? expectedElement : elementType;
      if (elementType === "ref" && (!actualElement || !isManagedType(actualElement, this.structs))) {
        throw new LumeError("array_ref exige um tipo gerenciado explícito, por exemplo array_ref(4) em uma variável array<Ponto>", node.token);
      }
      if (expectedElement && elementType !== "ref" && expectedElement !== elementType) {
        throw new LumeError(`“${node.name}” cria array<${elementType}>, não array<${expectedElement}>`, node.token);
      }
      const sizeType = this.compileExpression(node.args[0]);
      if (sizeType !== "i32") throw new LumeError("o tamanho do array deve ser i32", node.args[0].token);
      this.call(this.arrayAllocator(actualElement));
      return `array<${actualElement}>`;
    }
    if (node.name === "print" || node.name === "print_string") {
      if (node.args.length === 1) {
        const textType = this.compileExpression(node.args[0]);
        if (textType !== "string") throw new LumeError(`o argumento de “${node.name}” deve ser string, não ${textType}`, node.token);
        const functionIndex = this.functionIndices.get("print_string");
        this.emit(0x10, "call $print_string"); this.code.push(...uleb(functionIndex));
        return null;
      }
      if (node.args.length !== 2) throw new LumeError(`“${node.name}” espera um texto, com um número opcional`, node.token);
      const textType = this.compileExpression(node.args[0]);
      if (textType !== "string") throw new LumeError(`o primeiro argumento de “${node.name}” deve ser string, não ${textType}`, node.token);
      const numberType = this.compileExpression(node.args[1]);
      if (numberType !== "i32" && numberType !== "f64") {
        throw new LumeError(`o segundo argumento de “${node.name}” deve ser i32 ou f64, não ${numberType}`, node.token);
      }
      if (numberType === "i32") this.emit(0xb7, "f64.convert_i32_s");
      const functionIndex = this.functionIndices.get("print");
      this.emit(0x10, "call $print"); this.code.push(...uleb(functionIndex));
      return null;
    }
    const functionName = this.functionBindings.get(node.name) ?? node.name;
    const target = BUILTINS.find(item => item.name === functionName) || this.functions.get(functionName);
    if (!target) throw new LumeError(`função “${node.name}” não existe`, node.token);
    if (node.args.length !== target.params.length) throw new LumeError(`“${node.name}” espera ${target.params.length} argumento(s), mas recebeu ${node.args.length}`, node.token);
    node.args.forEach((arg, index) => {
      const parameter = target.params[index];
      const expected = typeof parameter === "string" ? parameter : parameter.type;
      const actual = this.compileExpression(arg, expected);
      if (actual !== expected) throw new LumeError(`argumento ${index + 1} de “${node.name}” deve ser ${expected}, não ${actual}`, node.token);
    });
    const functionIndex = this.functionIndices.get(functionName);
    this.emit(0x10, `call $${target.wasmName ?? functionName}`); this.code.push(...uleb(functionIndex));
    return target.result;
  }
  compileBinary(node) {
    const left = this.compileExpression(node.left), right = this.compileExpression(node.right), op = node.operator;
    if (left !== right) throw new LumeError(`tipos incompatíveis: ${left} e ${right}`, node.token);
    if (op === "&&" || op === "||") {
      if (left !== "bool" && left !== "i32") throw new LumeError(`o operador ${op} exige valores bool ou i32`, node.token);
      this.emit(op === "&&" ? 0x71 : 0x72, op === "&&" ? "i32.and" : "i32.or");
      this.emit(0x45, "i32.eqz"); this.emit(0x45, "i32.eqz");
      return "bool";
    }
    const isComparison = ["==", "!=", "<", "<=", ">", ">="].includes(op);
    if (left === "bool" && !(op === "==" || op === "!=")) throw new LumeError("bool só pode usar == ou !=", node.token);
    if (left !== "i32" && left !== "f64" && left !== "bool") throw new LumeError("tipo incompatível para esta operação", node.token);
    const table = left === "f64"
      ? { "+":[0xa0,"f64.add"], "-":[0xa1,"f64.sub"], "*":[0xa2,"f64.mul"], "/":[0xa3,"f64.div"], "==":[0x61,"f64.eq"], "!=":[0x62,"f64.ne"], "<":[0x63,"f64.lt"], ">": [0x64,"f64.gt"], "<=":[0x65,"f64.le"], ">=":[0x66,"f64.ge"] }
      : { "+":[0x6a,"i32.add"], "-":[0x6b,"i32.sub"], "*":[0x6c,"i32.mul"], "/":[0x6d,"i32.div_s"], "%":[0x6f,"i32.rem_s"], "==":[0x46,"i32.eq"], "!=":[0x47,"i32.ne"], "<":[0x48,"i32.lt_s"], ">": [0x4a,"i32.gt_s"], "<=":[0x4c,"i32.le_s"], ">=":[0x4e,"i32.ge_s"] };
    const instruction = table[op];
    if (!instruction) throw new LumeError(`operador ${op} não está disponível para ${left}`, node.token);
    this.emit(instruction[0], instruction[1]); return isComparison ? "bool" : left;
  }
  compileAsyncDispatcher(plan) {
    for (let index = 0; index < plan.segmentFunctions.length; index++) {
      this.globalGet(plan.stateGlobal);
      this.constant("i32", index);
      this.emit(0x46, "i32.eq");
      this.emit(0x04, "if"); this.code.push(0x40);
      this.call(plan.segmentFunctions[index].wasmName);
      this.emit(0x0f, "return");
      this.emit(0x0b, "end");
    }
    this.globalGet(plan.stateGlobal);
    this.constant("i32", plan.doneState);
    this.emit(0x46, "i32.eq");
    this.emit(0x04, "if"); this.code.push(0x40);
    this.constant("i32", 1);
    this.emit(0x0f, "return");
    this.emit(0x0b, "end");
    this.emit(0x00, "unreachable");
  }
  finish() {
    if (this.asyncContext) {
      this.constant(this.fn.result, 0);
      this.globalSet(this.asyncContext.resultGlobal);
      this.constant("i32", this.asyncContext.doneState);
      this.globalSet(this.asyncContext.stateGlobal);
      this.constant("i32", 1);
      this.emit(0x0b, "end");
      return { code: this.code, locals: this.locals, wat: this.wat };
    }
    this.constant(this.fn.result, 0);
    this.emit(0x0b, "end");
    return { code: this.code, locals: this.locals, wat: this.wat };
  }
}

class StringPool {
  constructor() { this.bytes = []; this.pointers = new Map(); }
  intern(value) {
    if (this.pointers.has(value)) return this.pointers.get(value);
    const encoded = [...new TextEncoder().encode(value)];
    const pointer = this.bytes.length + 4;
    const length = encoded.length;
    this.bytes.push(length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff, ...encoded);
    this.pointers.set(value, pointer);
    return pointer;
  }
}

function normalizeModulePath(path, parent, token) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")
    || path.split("/").some(segment => !segment) || /[:?#]/.test(path)) {
    throw new LumeError("caminho de módulo inválido; use um caminho relativo terminado em .lume", token);
  }
  if (parent === "main.lume" && /^std\/[a-z][a-z0-9_-]*\.lume$/.test(path)) return path;
  if (parent && !path.startsWith("./") && !path.startsWith("../")) {
    throw new LumeError("imports de módulo devem usar um caminho relativo iniciado em ./ ou ../", token);
  }
  const segments = parent ? parent.split("/").slice(0, -1) : [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new LumeError("o caminho do módulo não pode sair da raiz dos fontes", token);
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const normalized = segments.join("/");
  if (!normalized.endsWith(".lume")) throw new LumeError("caminhos de módulo devem terminar em .lume", token);
  return normalized;
}

function moduleError(message, token, moduleId) {
  const error = new LumeError(message, token);
  if (moduleId !== "main.lume") error.modulePath = moduleId;
  return error;
}

function arrayElementType(type) {
  const match = /^array<(.+)>$/.exec(type);
  return match?.[1] ?? null;
}

function isManagedType(type, structs) {
  return type === "string" || type === "ref" || structs.has(type) || arrayElementType(type) !== null;
}

function storageWidth(type) { return type === "f64" ? 2 : 1; }

function isKnownType(type, structs) {
  const element = arrayElementType(type);
  return TYPES.has(type) || structs.has(type) || (element !== null && isKnownType(element, structs));
}

function containsAwait(node) {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "await") return true;
  return Object.values(node).some(value =>
    Array.isArray(value) ? value.some(containsAwait) : containsAwait(value));
}

function lowerAsyncMain(main, hostAsyncFunctions) {
  const hostFunctions = new Map(hostAsyncFunctions.map(fn => [fn.name, fn]));
  const localGlobals = new Map();
  const variables = new Map();
  const globals = [
    { type: "i32", name: "state" },
    { type: "i32", name: "future" },
    { type: "i32", name: "result" },
  ];
  for (const statement of main.body.statements) {
    if (statement.kind !== "let") continue;
    const globalIndex = globals.length;
    localGlobals.set(statement, globalIndex);
    globals.push({ type: statement.type, name: statement.name });
  }

  const segments = [];
  let currentStatements = [];
  let currentPriorVariables = new Map();
  const knownVariables = new Map();
  for (const statement of main.body.statements) {
    let awaited;
    if (statement.kind === "let" && statement.value.kind === "await") {
      awaited = { expression: statement.value, declaration: statement };
    } else if (statement.kind === "assign_target" && statement.target.kind === "variable" && statement.value.kind === "await") {
      awaited = { expression: statement.value, assignment: statement };
    } else if (statement.kind === "return" && statement.value.kind === "await") {
      awaited = { expression: statement.value, returning: statement };
    } else if (containsAwait(statement)) {
      throw new LumeError("nesta versão, await precisa ser o valor direto de let, atribuição ou return no nível principal de async fn main", statement.token);
    }

    if (!awaited) {
      currentStatements.push(statement);
      if (statement.kind === "let") {
        knownVariables.set(statement.name, {
          globalIndex: localGlobals.get(statement),
          type: statement.type,
          token: statement.token,
          name: statement.name,
        });
      }
      continue;
    }

    const call = awaited.expression.value;
    if (call.kind !== "call") throw new LumeError("await precisa receber uma chamada host async", awaited.expression.token);
    const hostFunction = hostFunctions.get(call.name);
    if (!hostFunction) throw new LumeError(`“${call.name}” não é uma função host async declarada`, call.token);
    let targetType = hostFunction.result;
    let targetName;
    let targetToken = statement.token;
    if (awaited.declaration) {
      targetName = awaited.declaration.name;
      targetType = awaited.declaration.type;
      targetToken = awaited.declaration.token;
    } else if (awaited.assignment) {
      targetName = awaited.assignment.target.name;
      targetToken = awaited.assignment.target.token;
      const variable = knownVariables.get(targetName);
      if (!variable) throw new LumeError(`variável “${targetName}” precisa ser declarada antes de await`, targetToken);
      targetType = variable.type;
    } else {
      targetType = main.result;
    }
    if (hostFunction.result !== targetType) {
      throw new LumeError(`await de “${call.name}” retorna ${hostFunction.result}, mas o destino é ${targetType}`, targetToken);
    }
    currentStatements.push({
      kind: "async_start",
      call,
      nextState: segments.length + 1,
      token: awaited.expression.token,
    });
    segments.push({ statements: currentStatements, priorVariables: currentPriorVariables });
    currentStatements = [];
    currentPriorVariables = new Map(knownVariables);
    if (awaited.returning) {
      currentStatements.push({ kind: "async_resume_return", type: targetType, token: targetToken });
    } else if (awaited.declaration) {
      currentStatements.push({
        kind: "async_resume",
        name: targetName,
        type: targetType,
        declaration: awaited.declaration,
        token: targetToken,
      });
      knownVariables.set(targetName, {
        globalIndex: localGlobals.get(awaited.declaration),
        type: targetType,
        token: targetToken,
        name: targetName,
      });
    } else {
      currentStatements.push({ kind: "async_resume", name: targetName, type: targetType, token: targetToken });
    }
  }
  segments.push({ statements: currentStatements, priorVariables: currentPriorVariables });
  return {
    stateGlobal: 0,
    futureGlobal: 1,
    resultGlobal: 2,
    doneState: segments.length,
    globals,
    localGlobals,
    hostAsyncFunctions,
    segments,
    hostAsyncFunctions: new Map(hostAsyncFunctions.map(fn => [fn.name, fn])),
  };
}

function parseModules(source, options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("as opções de compilação devem ser um objeto");
  }
  const providedModules = options.modules ?? {};
  if (providedModules === null || typeof providedModules !== "object" || Array.isArray(providedModules)) {
    throw new TypeError("a opção modules deve ser um objeto de caminhos .lume para fontes");
  }
  const sources = new Map();
  for (const [path, moduleSource] of Object.entries(providedModules)) {
    const id = normalizeModulePath(path, null);
    if (id === "main.lume") throw new LumeError('o caminho "main.lume" é reservado para o programa principal');
    if (id.startsWith("std/")) throw new LumeError(`o módulo padrão “${id}” não pode ser substituído`);
    if (sources.has(id)) throw new LumeError(`o módulo “${id}” foi fornecido mais de uma vez`);
    if (typeof moduleSource !== "string" || !moduleSource.trim()) throw new LumeError(`o módulo “${id}” está vazio ou não é texto`);
    sources.set(id, moduleSource);
  }
  if (typeof source !== "string" || !source.trim()) throw new LumeError("o editor está vazio; escreva ou escolha um exemplo");
  let sourceSize = source.length + [...sources.values()].reduce((total, text) => total + text.length, 0);
  if (sourceSize > MAX_LUME_SOURCE_UNITS) {
    throw new LumeError(`fontes excedem o limite de ${MAX_LUME_SOURCE_UNITS} unidades de código UTF-16`);
  }

  const programs = new Map();
  const visited = new Set();
  function visit(id, text) {
    if (visited.has(id)) return;
    visited.add(id);
    let program;
    try {
      program = new Parser(new Lexer(text).tokenize()).parse();
    } catch (error) {
      if (error instanceof LumeError && id !== "main.lume") error.modulePath = id;
      throw error;
    }
    programs.set(id, program);
    for (const item of program.imports) {
      let dependency;
      try {
        dependency = normalizeModulePath(item.path, id, item.token);
      } catch (error) {
        if (error instanceof LumeError && id !== "main.lume") error.modulePath = id;
        throw error;
      }
      const dependencySource = sources.get(dependency) ?? STANDARD_MODULES[dependency];
      if (dependencySource === undefined) {
        const error = new LumeError(`o módulo “${dependency}” não foi fornecido na opção modules`, item.token);
        if (id !== "main.lume") error.modulePath = id;
        throw error;
      }
      if (!sources.has(dependency) && !visited.has(dependency)) {
        sourceSize += dependencySource.length;
        if (sourceSize > MAX_LUME_SOURCE_UNITS) {
          throw new LumeError(`fontes excedem o limite de ${MAX_LUME_SOURCE_UNITS} unidades de código UTF-16`, item.token);
        }
      }
      item.moduleId = dependency;
      visit(dependency, dependencySource);
    }
  }
  visit("main.lume", source);
  for (const id of sources.keys()) {
    if (!visited.has(id)) throw new LumeError(`o módulo “${id}” foi fornecido, mas não é importado pelo programa`);
  }

  const modules = [...programs].map(([id, program], index) => ({ id, index, ...program }));
  const functions = [];
  const functionsByModule = new Map();
  const structs = new Map();
  for (const module of modules) {
    for (const declaration of module.structs) {
      if (TYPES.has(declaration.name) || declaration.name === "array" || ARRAY_CONSTRUCTORS.has(declaration.name)) {
        throw moduleError(`“${declaration.name}” é um nome reservado para um tipo`, declaration.token, module.id);
      }
      if (structs.has(declaration.name)) throw moduleError(`struct “${declaration.name}” declarada mais de uma vez`, declaration.token, module.id);
      let offset = 0;
      const fields = new Map();
      for (const field of declaration.fields) {
        fields.set(field.name, { ...field, offset });
        offset += storageWidth(field.type);
      }
      structs.set(declaration.name, { ...declaration, fields, size: offset, moduleId: module.id });
    }
  }
  for (const declaration of structs.values()) {
    for (const field of declaration.fields.values()) {
      if (!isKnownType(field.type, structs)) {
        throw moduleError(`tipo “${field.type}” não suportado no campo “${field.name}”`, field.token, declaration.moduleId);
      }
    }
  }
  const hostAsyncFunctions = [];
  for (const module of modules) {
    for (const declaration of module.hostAsyncFunctions) {
      if (module.id !== "main.lume") {
        throw moduleError("declarações host async só podem aparecer em main.lume", declaration.token, module.id);
      }
      if (BUILTINS.some(item => item.name === declaration.name)
        || ASYNC_BUILTINS.some(item => item.name === declaration.name)
        || ARRAY_CONSTRUCTORS.has(declaration.name)
        || INTRINSICS.has(declaration.name)) {
        throw moduleError(`“${declaration.name}” é um nome reservado`, declaration.token, module.id);
      }
      if (hostAsyncFunctions.some(fn => fn.name === declaration.name)) {
        throw moduleError(`função host async “${declaration.name}” declarada mais de uma vez`, declaration.token, module.id);
      }
      const parameterNames = new Set();
      for (const param of declaration.params) {
        if (parameterNames.has(param.name)) throw moduleError(`parâmetro “${param.name}” duplicado`, param.token, module.id);
        if (!TYPES.has(param.type)) {
          throw moduleError(`tipo “${param.type}” não suportado em parâmetro host async`, param.token, module.id);
        }
        parameterNames.add(param.name);
      }
      if (!["i32", "f64", "bool", "string"].includes(declaration.result)) {
        throw moduleError(`tipo “${declaration.result}” não suportado como resultado host async`, declaration.token, module.id);
      }
      hostAsyncFunctions.push(declaration);
    }
  }
  for (const module of modules) {
    const localFunctions = new Map();
    for (const [functionIndex, fn] of module.functions.entries()) {
      if (BUILTINS.some(item => item.name === fn.name)
        || ASYNC_BUILTINS.some(item => item.name === fn.name)
        || hostAsyncFunctions.some(hostFn => hostFn.name === fn.name)
        || ARRAY_CONSTRUCTORS.has(fn.name)
        || INTRINSICS.has(fn.name)) throw moduleError(`“${fn.name}” é um nome reservado`, fn.token, module.id);
      if (localFunctions.has(fn.name)) throw moduleError(`função “${fn.name}” declarada mais de uma vez no módulo “${module.id}”`, fn.token, module.id);
      if (fn.asynchronous && (module.id !== "main.lume" || fn.name !== "main")) {
        throw moduleError("a primeira versão portátil de async fn oferece suporte somente a main", fn.token, module.id);
      }
      const paramNames = new Set();
      if (!isKnownType(fn.result, structs)) throw moduleError(`tipo de retorno “${fn.result}” não suportado`, fn.token, module.id);
      for (const param of fn.params) {
        if (paramNames.has(param.name)) throw moduleError(`parâmetro “${param.name}” duplicado`, param.token, module.id);
        if (!isKnownType(param.type, structs)) throw moduleError(`tipo “${param.type}” não suportado no parâmetro “${param.name}”`, param.token, module.id);
        paramNames.add(param.name);
      }
      fn.moduleId = module.id;
      fn.wasmName = `lume_m${module.index}_f${functionIndex}_${fn.name}`;
      localFunctions.set(fn.name, fn);
      functions.push(fn);
    }
    functionsByModule.set(module.id, localFunctions);
  }

  const bindingsByFunction = new Map();
  for (const module of modules) {
    const bindings = new Map();
    for (const [name, fn] of functionsByModule.get(module.id)) bindings.set(name, fn.wasmName);
    for (const item of module.imports) {
      const dependencyFunctions = functionsByModule.get(item.moduleId);
      for (const imported of item.names) {
        if (BUILTINS.some(builtin => builtin.name === imported.local)
          || ASYNC_BUILTINS.some(builtin => builtin.name === imported.local)
          || hostAsyncFunctions.some(hostFn => hostFn.name === imported.local)
          || ARRAY_CONSTRUCTORS.has(imported.local)
          || INTRINSICS.has(imported.local)) {
          throw moduleError(`“${imported.local}” é um nome reservado e não pode ser usado como alias`, imported.token, module.id);
        }
        if (bindings.has(imported.local)) throw moduleError(`nome importado “${imported.local}” já está declarado no módulo “${module.id}”`, imported.token, module.id);
        const fn = dependencyFunctions.get(imported.imported);
        if (!fn || !fn.exported) {
          throw moduleError(`a função “${imported.imported}” não está exportada pelo módulo “${item.moduleId}”`, imported.token, module.id);
        }
        bindings.set(imported.local, fn.wasmName);
      }
    }
    for (const fn of module.functions) bindingsByFunction.set(fn, bindings);
  }

  const rootFunctions = functionsByModule.get("main.lume");
  const main = rootFunctions.get("main");
  if (!main) throw new LumeError("o programa precisa declarar fn main() -> i32 { ... }");
  if (main.params.length) throw new LumeError("fn main não pode receber parâmetros", main.token);
  if (main.result !== "i32") throw new LumeError("fn main deve retornar i32", main.token);
  if (hostAsyncFunctions.length && !main.asynchronous) {
    throw new LumeError("funções host async exigem async fn main", hostAsyncFunctions[0].token);
  }
  const mainBindings = bindingsByFunction.get(main);
  for (const hostFunction of hostAsyncFunctions) {
    if (mainBindings.has(hostFunction.name)) {
      throw moduleError(`o nome host async “${hostFunction.name}” já está em uso no módulo principal`, hostFunction.token, "main.lume");
    }
  }
  const asyncPlan = main.asynchronous ? lowerAsyncMain(main, hostAsyncFunctions) : null;
  if (asyncPlan) {
    if ([...rootFunctions.keys()].some(name => ["__lume_async_state", "__lume_async_future", "__lume_async_result"].includes(name))) {
      throw new LumeError("o programa usa um nome reservado pelo runtime async", main.token);
    }
    asyncPlan.main = main;
    asyncPlan.segmentFunctions = asyncPlan.segments.map((segment, index) => {
      const fn = {
        name: `__lume_async_step_${index}`,
        token: main.token,
        params: [],
        result: "i32",
        body: { kind: "block", statements: segment.statements },
        exported: false,
        asynchronous: false,
        moduleId: "main.lume",
        wasmName: `lume_async_step_${index}`,
      };
      fn.asyncSegment = true;
      segment.function = fn;
      segment.context = {
        ...asyncPlan,
        priorVariables: segment.priorVariables,
      };
      functions.push(fn);
      bindingsByFunction.set(fn, mainBindings);
      return fn;
    });
  }
  return {
    functions,
    rootFunctions: [...rootFunctions.values()],
    bindingsByFunction,
    structs,
    asyncPlan,
    hostAsyncFunctions,
  };
}

function compileProgram(program) {
  const functions = new Map();
  for (const fn of program.functions) {
    functions.set(fn.wasmName, fn);
  }
  const functionIndices = new Map();
  const importedFunctions = [
    ...BUILTINS,
    ...(program.asyncPlan ? ASYNC_BUILTINS : []),
    ...program.hostAsyncFunctions.map(fn => ({
      name: `async_host_${fn.name}`,
      params: fn.params.map(param => param.type),
      result: "i32",
    })),
  ];
  importedFunctions.forEach((item, index) => functionIndices.set(item.name, index));
  program.functions.forEach((fn, index) => functionIndices.set(fn.wasmName, importedFunctions.length + index));

  const strings = new StringPool();
  const compiled = program.functions.map(fn => ({
    fn,
    output: new FunctionEmitter(
      fn,
      functions,
      functionIndices,
      strings,
      program.bindingsByFunction.get(fn),
      program.structs,
      fn.asyncSegment ? program.asyncPlan.segments.find(segment => segment.function === fn).context : null,
    ),
  }));
  for (const item of compiled) {
    try {
      if (item.fn === program.asyncPlan?.main) item.output.compileAsyncDispatcher(program.asyncPlan);
      else item.output.compileBlock(item.fn.body, false);
    } catch (error) {
      if (error instanceof LumeError && item.fn.moduleId !== "main.lume") error.modulePath = item.fn.moduleId;
      throw error;
    }
  }
  const bodies = compiled.map(item => item.output.finish());

  const types = [], typeIndices = new Map();
  const typeIndex = (params, result) => {
    const key = signature(params, result);
    if (!typeIndices.has(key)) {
      typeIndices.set(key, types.length);
      types.push({ params, result });
    }
    return typeIndices.get(key);
  };
  const importTypeIndices = importedFunctions.map(item => typeIndex(item.params, item.result));
  const functionTypeIndices = program.functions.map(fn => typeIndex(fn.params.map(param => param.type), fn.result));
  const typeSection = section(1, vector(types.map(type => [0x60, ...vector(type.params.map(param => [wasmTypeCode(param)])), ...vector(type.result ? [[wasmTypeCode(type.result)]] : [])])));
  const importSection = section(2, vector(importedFunctions.map((item, index) => [...wasmName("host"), ...wasmName(item.name), 0x00, ...uleb(importTypeIndices[index])])));
  const functionSection = section(3, vector(functionTypeIndices.map(index => uleb(index))));
  const exports = program.rootFunctions.map(fn => [...wasmName(fn.name), 0x00, ...uleb(functionIndices.get(fn.wasmName))]);
  exports.push([...wasmName("memory"), 0x02, ...uleb(0)]);
  if (program.asyncPlan) {
    for (const [name, index] of [["__lume_async_state", program.asyncPlan.stateGlobal], ["__lume_async_future", program.asyncPlan.futureGlobal], ["__lume_async_result", program.asyncPlan.resultGlobal]]) {
      exports.push([...wasmName(name), 0x03, ...uleb(index)]);
    }
  }
  const exportSection = section(7, vector(exports));
  const globalSection = program.asyncPlan
    ? section(6, vector(program.asyncPlan.globals.map(global => [
      wasmTypeCode(global.type),
      0x01,
      global.type === "f64" ? 0x44 : 0x41,
      ...(global.type === "f64" ? new Array(8).fill(0) : [0x00]),
      0x0b,
    ])))
    : [];
  const memoryPages = Math.max(1, Math.ceil(strings.bytes.length / 65_536));
  const memorySection = section(5, [0x01, 0x01, ...uleb(memoryPages), ...uleb(MAX_WASM_MEMORY_PAGES)]);
  const codeSection = section(10, vector(bodies.map(body => {
    const groups = body.locals.map(local => [1, wasmTypeCode(local.type)]);
    const localBytes = vector(groups);
    const content = [...localBytes, ...body.code];
    return [...uleb(content.length), ...content];
  })));
  const dataSection = strings.bytes.length
    ? section(11, [0x01, 0x00, 0x41, 0x00, 0x0b, ...uleb(strings.bytes.length), ...strings.bytes])
    : [];
  const bytes = new Uint8Array([0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00, ...typeSection, ...importSection, ...functionSection, ...memorySection, ...globalSection, ...exportSection, ...codeSection, ...dataSection]);

  const watLines = ["(module"];
  for (const item of importedFunctions) {
    const params = item.params.map(type => `(param ${watType(type)})`).join(" ");
    const result = item.result ? ` (result ${watType(item.result)})` : "";
    watLines.push(`  (import "host" "${item.name}" (func $${item.name}${params ? ` ${params}` : ""}${result}))`);
  }
  watLines.push(`  (memory ${memoryPages} ${MAX_WASM_MEMORY_PAGES})`, '  (export "memory" (memory 0))');
  if (program.asyncPlan) {
    program.asyncPlan.globals.forEach((global, index) => {
      watLines.push(`  (global $g${index} (mut ${watType(global.type)}) (${global.type === "f64" ? "f64.const 0" : "i32.const 0"}))`);
    });
  }
  for (let i = 0; i < compiled.length; i++) {
    const fn = compiled[i].fn, body = bodies[i];
    const params = fn.params.map((param, index) => `(param $l${index}_${param.name} ${watType(param.type)})`).join(" ");
    const result = fn.result ? ` (result ${watType(fn.result)})` : "";
    watLines.push(`  (func $${fn.wasmName}${params ? ` ${params}` : ""}${result}`);
    body.locals.forEach((local, index) => watLines.push(`    (local $l${fn.params.length + index}_${local.name} ${watType(local.type)})`));
    body.wat.forEach(instruction => watLines.push(`    ${instruction}`));
    watLines.push("  )");
  }
  for (const fn of program.rootFunctions) watLines.push(`  (export "${fn.name}" (func $${fn.wasmName}))`);
  if (program.asyncPlan) {
    watLines.push('  (export "__lume_async_state" (global $g0))', '  (export "__lume_async_future" (global $g1))', '  (export "__lume_async_result" (global $g2))');
  }
  if (strings.bytes.length) {
    watLines.push(`  (data (i32.const 0) "${strings.bytes.map(byte => `\\${byte.toString(16).padStart(2, "0")}`).join("")}")`);
  }
  watLines.push(")");
  return {
    bytes,
    wat: watLines.join("\n"),
    functions: program.rootFunctions.map(fn => fn.name),
    async: Boolean(program.asyncPlan),
    hostAsyncFunctions: program.hostAsyncFunctions.map(fn => ({
      name: fn.name,
      params: fn.params.map(param => param.type),
      result: fn.result,
    })),
  };
}

export function compile(source, options = {}) {
  const program = parseModules(source, options);
  return compileProgram(program);
}
