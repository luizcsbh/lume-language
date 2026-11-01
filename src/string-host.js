const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export function decodeWasmString(memory, pointer) {
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("a memória WASM não está disponível para acessar texto");
  const address = pointer >>> 0;
  if (address < 4) throw new RangeError("ponteiro de texto inválido");
  const view = new DataView(memory.buffer);
  const length = view.getUint32(address - 4, true);
  if (address + length > memory.buffer.byteLength) throw new RangeError("texto fora dos limites da memória WASM");
  return textDecoder.decode(new Uint8Array(memory.buffer, address, length));
}

export function createStringHost(getMemory) {
  let nextAddress = null;
  const read = pointer => {
    const memory = getMemory();
    return decodeWasmString(memory, pointer);
  };
  const allocate = value => {
    const memory = getMemory();
    if (!(memory instanceof WebAssembly.Memory)) throw new Error("a memória WASM não está disponível para criar texto");
    const encoded = textEncoder.encode(value);
    const start = nextAddress ?? memory.buffer.byteLength;
    const end = start + 4 + encoded.length;
    const requiredPages = Math.ceil(end / 65_536);
    const currentPages = memory.buffer.byteLength / 65_536;
    if (requiredPages > currentPages) memory.grow(requiredPages - currentPages);
    if (end > memory.buffer.byteLength) throw new RangeError("texto excede o limite da memória WASM");
    new DataView(memory.buffer).setUint32(start, encoded.length, true);
    new Uint8Array(memory.buffer, start + 4, encoded.length).set(encoded);
    nextAddress = end;
    return start + 4;
  };

  return {
    allocateString: allocate,
    string_length(pointer) { return [...read(pointer)].length; },
    string_byte_length(pointer) { return textEncoder.encode(read(pointer)).length; },
    string_equals(left, right) { return Number(read(left) === read(right)); },
    string_contains(value, part) { return Number(read(value).includes(read(part))); },
    string_concat(left, right) { return allocate(read(left) + read(right)); },
    string_slice(value, start, end) {
      return allocate([...read(value)].slice(start, end).join(""));
    },
  };
}
