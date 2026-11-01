import {
  MEMORY_CELL_BYTES,
  MEMORY_INITIAL_BYTES,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_CELLS,
  MEMORY_MAX_HANDLE,
  MEMORY_MAX_LIVE_BLOCKS,
} from "./memory-contract.js";

const isPositiveInteger = value => Number.isSafeInteger(value) && value > 0;
const isI32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

export class MemoryRepository {
  #buffer;
  #cells;
  #capacityCells;
  #maxCells;
  #maxLiveBlocks;
  #freeRanges;
  #blocks = new Map();
  #nextHandle = 1;
  #usedCells = 0;
  #closed = false;

  constructor({ initialBytes = MEMORY_INITIAL_BYTES, maxBytes = MEMORY_MAX_BYTES, maxLiveBlocks = MEMORY_MAX_LIVE_BLOCKS } = {}) {
    if (!isPositiveInteger(initialBytes) || !isPositiveInteger(maxBytes)
      || initialBytes % MEMORY_CELL_BYTES !== 0 || maxBytes % MEMORY_CELL_BYTES !== 0
      || initialBytes > maxBytes || maxBytes > MEMORY_MAX_BYTES
      || !isPositiveInteger(maxLiveBlocks) || maxLiveBlocks > MEMORY_MAX_LIVE_BLOCKS) {
      throw new RangeError("configuração de heap inválida ou acima dos limites Lume");
    }
    this.#buffer = new ArrayBuffer(initialBytes);
    this.#cells = new Int32Array(this.#buffer);
    this.#capacityCells = initialBytes / MEMORY_CELL_BYTES;
    this.#maxCells = maxBytes / MEMORY_CELL_BYTES;
    this.#maxLiveBlocks = maxLiveBlocks;
    this.#freeRanges = [{ start: 0, length: this.#capacityCells }];
  }

  #assertOpen() {
    if (this.#closed) throw new Error("heap desta execução já foi liberado");
  }

  #findRange(cells) { return this.#freeRanges.findIndex(range => range.length >= cells); }

  #insertFreeRange(range) {
    this.#freeRanges.push(range);
    this.#freeRanges.sort((left, right) => left.start - right.start);
    const merged = [];
    for (const item of this.#freeRanges) {
      const previous = merged.at(-1);
      if (!previous || item.start > previous.start + previous.length) {
        merged.push({ start: item.start, length: item.length });
      } else if (item.start === previous.start + previous.length) {
        previous.length += item.length;
      } else {
        throw new Error("invariante interna do heap: intervalos livres sobrepostos");
      }
    }
    this.#freeRanges = merged;
  }

  #compact() {
    const ordered = [...this.#blocks.values()].sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const block of ordered) {
      if (block.start !== cursor) this.#cells.copyWithin(cursor, block.start, block.start + block.length);
      block.start = cursor;
      cursor += block.length;
    }
    this.#cells.fill(0, cursor, this.#capacityCells);
    this.#usedCells = cursor;
    this.#freeRanges = cursor < this.#capacityCells
      ? [{ start: cursor, length: this.#capacityCells - cursor }]
      : [];
  }

  #grow() {
    if (this.#capacityCells >= this.#maxCells) return false;
    const oldCapacity = this.#capacityCells;
    const nextCapacity = Math.min(this.#maxCells, Math.max(oldCapacity + 1, oldCapacity * 2));
    let nextBuffer;
    try {
      nextBuffer = new ArrayBuffer(nextCapacity * MEMORY_CELL_BYTES);
    } catch {
      throw new RangeError("o navegador não conseguiu expandir o heap Lume");
    }
    const nextCells = new Int32Array(nextBuffer);
    nextCells.set(this.#cells);
    this.#buffer = nextBuffer;
    this.#cells = nextCells;
    this.#capacityCells = nextCapacity;
    this.#insertFreeRange({ start: oldCapacity, length: nextCapacity - oldCapacity });
    return true;
  }

  #requireBlock(handle) {
    if (!Number.isSafeInteger(handle) || handle < 1 || handle > MEMORY_MAX_HANDLE) {
      throw new RangeError("handle de memória inválido");
    }
    const block = this.#blocks.get(handle);
    if (!block) throw new RangeError("handle inválido ou já liberado");
    return block;
  }

  allocate(cells) {
    this.#assertOpen();
    if (!isPositiveInteger(cells) || cells > MEMORY_MAX_CELLS) {
      throw new RangeError(`alocação deve pedir de 1 a ${MEMORY_MAX_CELLS} células i32`);
    }
    if (this.#blocks.size >= this.#maxLiveBlocks) {
      throw new RangeError(`heap excede o limite de ${this.#maxLiveBlocks} blocos vivos`);
    }
    if (this.#nextHandle > MEMORY_MAX_HANDLE) throw new RangeError("esgotados os handles desta execução");

    let rangeIndex = this.#findRange(cells);
    if (rangeIndex < 0) {
      this.#compact();
      rangeIndex = this.#findRange(cells);
    }
    while (rangeIndex < 0 && this.#capacityCells < this.#maxCells) {
      this.#grow();
      rangeIndex = this.#findRange(cells);
    }
    if (rangeIndex < 0) throw new RangeError(`heap sem espaço: limite de ${this.#maxCells * MEMORY_CELL_BYTES} bytes atingido`);

    const range = this.#freeRanges[rangeIndex];
    const start = range.start;
    range.start += cells;
    range.length -= cells;
    if (range.length === 0) this.#freeRanges.splice(rangeIndex, 1);

    const handle = this.#nextHandle++;
    this.#blocks.set(handle, { start, length: cells });
    this.#cells.fill(0, start, start + cells);
    this.#usedCells += cells;
    return handle;
  }

  loadI32(handle, index) {
    this.#assertOpen();
    const block = this.#requireBlock(handle);
    if (!Number.isSafeInteger(index) || index < 0 || index >= block.length) {
      throw new RangeError("índice fora dos limites do bloco Lume");
    }
    return this.#cells[block.start + index];
  }

  storeI32(handle, index, value) {
    this.#assertOpen();
    const block = this.#requireBlock(handle);
    if (!Number.isSafeInteger(index) || index < 0 || index >= block.length) {
      throw new RangeError("índice fora dos limites do bloco Lume");
    }
    if (!isI32(value)) throw new RangeError("valor deve ser um inteiro i32 válido");
    this.#cells[block.start + index] = value;
  }

  free(handle) {
    this.#assertOpen();
    const block = this.#requireBlock(handle);
    this.#cells.fill(0, block.start, block.start + block.length);
    this.#blocks.delete(handle);
    this.#usedCells -= block.length;
    this.#insertFreeRange({ start: block.start, length: block.length });
  }

  stats() {
    return Object.freeze({
      capacityBytes: this.#buffer.byteLength,
      usedBytes: this.#usedCells * MEMORY_CELL_BYTES,
      freeBytes: this.#buffer.byteLength - this.#usedCells * MEMORY_CELL_BYTES,
      liveBlocks: this.#blocks.size,
      maxBytes: this.#maxCells * MEMORY_CELL_BYTES,
      maxLiveBlocks: this.#maxLiveBlocks,
    });
  }

  close() {
    if (this.#closed) return;
    this.#cells.fill(0);
    this.#blocks.clear();
    this.#freeRanges = [];
    this.#usedCells = 0;
    this.#buffer = new ArrayBuffer(0);
    this.#cells = new Int32Array(this.#buffer);
    this.#capacityCells = 0;
    this.#closed = true;
  }
}
