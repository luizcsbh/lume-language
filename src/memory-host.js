import {
  ArrayOffsetRequest,
  AllocateI32Request,
  FreeMemoryRequest,
  LoadI32Request,
  StoreI32Request,
} from "./memory-requests.js";

export function createMemoryHost(memoryService) {
  return {
    memory_alloc_i32(cells) { return memoryService.allocate(new AllocateI32Request(cells)); },
    memory_load_i32(handle, index) { return memoryService.load(new LoadI32Request(handle, index)); },
    memory_store_i32(handle, index, value) { memoryService.store(new StoreI32Request(handle, index, value)); },
    memory_load_f64(handle, index) { return memoryService.loadF64(new LoadI32Request(handle, index)); },
    memory_store_f64(handle, index, value) { memoryService.storeF64(new StoreI32Request(handle, index, value)); },
    memory_length(handle, stride) { return memoryService.length(new LoadI32Request(handle, stride)); },
    memory_array_offset(handle, index, stride) {
      return memoryService.arrayOffset(new ArrayOffsetRequest(handle, index, stride));
    },
    array_allocate_i32(cells) { return memoryService.allocateArray(new AllocateI32Request(cells)); },
    array_allocate_f64(cells) { return memoryService.allocateArray(new AllocateI32Request(cells), 2); },
    array_allocate_ref(cells) { return memoryService.allocateArray(new AllocateI32Request(cells)); },
    memory_free(handle) { memoryService.free(new FreeMemoryRequest(handle)); },
  };
}
