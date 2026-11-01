export class AllocateI32Request {
  constructor(cells) { this.cells = cells; Object.freeze(this); }
}

export class LoadI32Request {
  constructor(handle, index) { this.handle = handle; this.index = index; Object.freeze(this); }
}

export class StoreI32Request {
  constructor(handle, index, value) {
    this.handle = handle;
    this.index = index;
    this.value = value;
    Object.freeze(this);
  }
}

export class FreeMemoryRequest {
  constructor(handle) { this.handle = handle; Object.freeze(this); }
}
