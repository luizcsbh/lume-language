const BUILTINS = [
  { name: "print_i32", params: ["i32"], result: null },
  { name: "print_f64", params: ["f64"], result: null },
  { name: "print_string", params: ["string"], result: null },
  { name: "print", params: ["string", "f64"], result: null },
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
  { name: "memory_free", params: ["i32"], result: null },
];
const TYPES = new Set(["i32", "f64", "bool", "string"]);
const WASM_TYPE = { i32: 0x7f, f64: 0x7c, bool: 0x7f, string: 0x7f };
const KEYWORDS = new Set(["fn", "let", "return", "if", "else", "while", "true", "false", "import", "from", "as", "export"]);
export const MAX_LUME_SOURCE_UNITS = 65_536;
export const MAX_LUME_PARSE_DEPTH = 128;

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
      if ("+-*/%<>=!(){}:;,".includes(char)) {
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
  constructor(tokens) { this.tokens = tokens; this.position = 0; this.depth = 0; }
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
    const token = this.expectName("esperado tipo i32, f64, bool ou string");
    if (!TYPES.has(token.value)) throw new LumeError(`tipo “${token.value}” não suportado; use i32, f64, bool ou string`, token);
    return token.value;
  }
  parse() {
    const functions = [];
    const imports = [];
    let declarationsStarted = false;
    while (this.current().kind !== "eof") {
      if (this.match("import")) {
        if (declarationsStarted) throw new LumeError("imports devem aparecer antes das funções", this.previous());
        imports.push(this.importDeclaration());
      } else {
        declarationsStarted = true;
        const exported = this.match("export");
        functions.push(this.functionDeclaration(exported));
      }
    }
    if (!functions.length) throw new LumeError("escreva pelo menos uma função, por exemplo fn main() -> i32 { return 0; }");
    return { functions, imports };
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
  functionDeclaration(exported = false) {
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
    const body = this.block();
    return { name: name.value, token: name, params, result, body, exported };
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
    if (this.current().kind === "identifier" && this.tokens[this.position + 1]?.value === "=") {
      const name = this.tokens[this.position++]; this.expect("=");
      const value = this.expression(); this.expect(";", "termine a atribuição com ;");
      return { kind: "assign", name: name.value, value, token: name };
    }
    const value = this.expression();
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
    if (this.at("!") || this.at("-")) {
      const token = this.tokens[this.position++];
      return { kind: "unary", operator: token.value, value: this.prefix(), token };
    }
    if (this.match("(")) { const value = this.expression(); this.expect(")"); return value; }
    const token = this.current();
    if (token.kind === "number") {
      this.position++;
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new LumeError("literal numérico fora do intervalo", token);
      return { kind: "number", value, type: /[.eE]/.test(token.value) ? "f64" : "i32", token };
    }
    if (token.kind === "string") {
      this.position++;
      return { kind: "string", value: token.value, token };
    }
    if (this.match("true")) return { kind: "bool", value: 1, type: "bool", token };
    if (this.match("false")) return { kind: "bool", value: 0, type: "bool", token };
    if (token.kind === "identifier") {
      this.position++;
      if (!this.match("(")) return { kind: "variable", name: token.value, token };
      const args = [];
      if (!this.at(")")) do { args.push(this.expression()); } while (this.match(","));
      this.expect(")", "esperado ) depois dos argumentos");
      return { kind: "call", name: token.value, args, token };
    }
    throw new LumeError("esperada uma expressão (número, variável, chamada de função ou condição)", token);
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
const watType = type => type === "bool" || type === "string" ? "i32" : type;

class FunctionEmitter {
  constructor(fn, functions, functionIndices, strings, functionBindings) {
    this.fn = fn; this.functions = functions; this.functionIndices = functionIndices;
    this.functionBindings = functionBindings;
    this.strings = strings;
    this.code = []; this.wat = []; this.locals = []; this.scopes = [new Map()];
    fn.params.forEach((param, index) => this.scopes[0].set(param.name, { index, type: param.type, token: param.token }));
    this.paramCount = fn.params.length;
  }
  emit(opcode, text) { this.code.push(opcode); this.wat.push(text); }
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
        const valueType = this.compileExpression(node.value);
        if (valueType !== node.type) throw new LumeError(`a variável “${node.name}” é ${node.type}, mas recebeu ${valueType}`, node.token);
        if (this.scopes[this.scopes.length - 1].has(node.name)) throw new LumeError(`variável “${node.name}” já existe neste bloco`, node.token);
        const index = this.paramCount + this.locals.length;
        this.locals.push({ name: node.name, type: node.type });
        this.scopes[this.scopes.length - 1].set(node.name, { index, type: node.type, token: node.token });
        this.emit(0x21, `local.set $l${index}_${node.name}`); this.code.push(...uleb(index)); break;
      }
      case "assign": {
        const variable = this.lookup(node.name, node.token);
        const valueType = this.compileExpression(node.value);
        if (valueType !== variable.type) throw new LumeError(`não é possível atribuir ${valueType} à variável ${variable.type} “${node.name}”`, node.token);
        this.emit(0x21, `local.set $l${variable.index}_${node.name}`); this.code.push(...uleb(variable.index)); break;
      }
      case "return": {
        const type = this.compileExpression(node.value);
        if (type !== this.fn.result) throw new LumeError(`a função retorna ${this.fn.result}, mas recebeu ${type}`, node.token);
        this.emit(0x0f, "return"); break;
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
  compileExpression(node) {
    switch (node.kind) {
      case "number": this.constant(node.type, node.value); return node.type;
      case "string": this.constant("i32", this.strings.intern(node.value)); return "string";
      case "bool": this.constant("i32", node.value); return "bool";
      case "variable": {
        const variable = this.lookup(node.name, node.token);
        this.emit(0x20, `local.get $l${variable.index}_${node.name}`); this.code.push(...uleb(variable.index)); return variable.type;
      }
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
      case "call": return this.compileCall(node);
      case "binary": return this.compileBinary(node);
      default: throw new LumeError("expressão não suportada", node.token);
    }
  }
  compileCall(node) {
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
      const actual = this.compileExpression(arg), parameter = target.params[index];
      const expected = typeof parameter === "string" ? parameter : parameter.type;
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
  finish() {
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
    if (sources.has(id)) throw new LumeError(`o módulo “${id}” foi fornecido mais de uma vez`);
    if (typeof moduleSource !== "string" || !moduleSource.trim()) throw new LumeError(`o módulo “${id}” está vazio ou não é texto`);
    sources.set(id, moduleSource);
  }
  if (typeof source !== "string" || !source.trim()) throw new LumeError("o editor está vazio; escreva ou escolha um exemplo");
  const sourceSize = source.length + [...sources.values()].reduce((total, text) => total + text.length, 0);
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
      const dependencySource = sources.get(dependency);
      if (dependencySource === undefined) {
        const error = new LumeError(`o módulo “${dependency}” não foi fornecido na opção modules`, item.token);
        if (id !== "main.lume") error.modulePath = id;
        throw error;
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
  for (const module of modules) {
    const localFunctions = new Map();
    for (const [functionIndex, fn] of module.functions.entries()) {
      if (BUILTINS.some(item => item.name === fn.name)) throw moduleError(`“${fn.name}” é um nome reservado`, fn.token, module.id);
      if (localFunctions.has(fn.name)) throw moduleError(`função “${fn.name}” declarada mais de uma vez no módulo “${module.id}”`, fn.token, module.id);
      const paramNames = new Set();
      for (const param of fn.params) {
        if (paramNames.has(param.name)) throw moduleError(`parâmetro “${param.name}” duplicado`, param.token, module.id);
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
        if (BUILTINS.some(builtin => builtin.name === imported.local)) {
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
  return { functions, rootFunctions: [...rootFunctions.values()], bindingsByFunction };
}

function compileProgram(program) {
  const functions = new Map();
  for (const fn of program.functions) {
    functions.set(fn.wasmName, fn);
  }
  const functionIndices = new Map();
  BUILTINS.forEach((item, index) => functionIndices.set(item.name, index));
  program.functions.forEach((fn, index) => functionIndices.set(fn.wasmName, BUILTINS.length + index));

  const strings = new StringPool();
  const compiled = program.functions.map(fn => ({
    fn,
    output: new FunctionEmitter(fn, functions, functionIndices, strings, program.bindingsByFunction.get(fn)),
  }));
  for (const item of compiled) {
    try {
      item.output.compileBlock(item.fn.body, false);
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
  const importTypeIndices = BUILTINS.map(item => typeIndex(item.params, item.result));
  const functionTypeIndices = program.functions.map(fn => typeIndex(fn.params.map(param => param.type), fn.result));
  const typeSection = section(1, vector(types.map(type => [0x60, ...vector(type.params.map(param => [WASM_TYPE[param]])), ...vector(type.result ? [[WASM_TYPE[type.result]]] : [])])));
  const importSection = section(2, vector(BUILTINS.map((item, index) => [...wasmName("host"), ...wasmName(item.name), 0x00, ...uleb(importTypeIndices[index])])));
  const functionSection = section(3, vector(functionTypeIndices.map(index => uleb(index))));
  const exports = program.rootFunctions.map(fn => [...wasmName(fn.name), 0x00, ...uleb(functionIndices.get(fn.wasmName))]);
  exports.push([...wasmName("memory"), 0x02, ...uleb(0)]);
  const exportSection = section(7, vector(exports));
  const memoryPages = Math.max(1, Math.ceil(strings.bytes.length / 65_536));
  const memorySection = section(5, [0x01, 0x00, ...uleb(memoryPages)]);
  const codeSection = section(10, vector(bodies.map(body => {
    const groups = body.locals.map(local => [1, WASM_TYPE[local.type]]);
    const localBytes = vector(groups);
    const content = [...localBytes, ...body.code];
    return [...uleb(content.length), ...content];
  })));
  const dataSection = strings.bytes.length
    ? section(11, [0x01, 0x00, 0x41, 0x00, 0x0b, ...uleb(strings.bytes.length), ...strings.bytes])
    : [];
  const bytes = new Uint8Array([0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00, ...typeSection, ...importSection, ...functionSection, ...memorySection, ...exportSection, ...codeSection, ...dataSection]);

  const watLines = ["(module"];
  for (const item of BUILTINS) {
    const params = item.params.map(type => `(param ${watType(type)})`).join(" ");
    const result = item.result ? ` (result ${watType(item.result)})` : "";
    watLines.push(`  (import "host" "${item.name}" (func $${item.name}${params ? ` ${params}` : ""}${result}))`);
  }
  watLines.push(`  (memory ${memoryPages})`, '  (export "memory" (memory 0))');
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
  if (strings.bytes.length) {
    watLines.push(`  (data (i32.const 0) "${strings.bytes.map(byte => `\\${byte.toString(16).padStart(2, "0")}`).join("")}")`);
  }
  watLines.push(")");
  return { bytes, wat: watLines.join("\n"), functions: program.rootFunctions.map(fn => fn.name) };
}

export function compile(source, options = {}) {
  const program = parseModules(source, options);
  return compileProgram(program);
}
