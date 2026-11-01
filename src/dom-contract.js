export const MAX_DOM_OPERATIONS = 4096;

export const DOM_TARGETS = Object.freeze({
  1: Object.freeze({ elementId: "result-value", operations: Object.freeze(["set_i32", "set_f64"]) }),
  2: Object.freeze({ elementId: "input-value", operations: Object.freeze(["set_i32", "set_f64"]) }),
  3: Object.freeze({ elementId: "result-pill", operations: Object.freeze(["set_visible"]) }),
  4: Object.freeze({ elementId: "canvas-empty", operations: Object.freeze(["set_visible"]) }),
});
