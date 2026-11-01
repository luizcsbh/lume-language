export const STANDARD_MODULES = Object.freeze({
  "std/math.lume": `export fn abs_i32(value: i32) -> i32 {
  if value < 0 { return 0 - value; }
  return value;
}

export fn min_i32(left: i32, right: i32) -> i32 {
  if left < right { return left; }
  return right;
}

export fn max_i32(left: i32, right: i32) -> i32 {
  if left > right { return left; }
  return right;
}

export fn clamp_i32(value: i32, minimum: i32, maximum: i32) -> i32 {
  if value < minimum { return minimum; }
  if value > maximum { return maximum; }
  return value;
}

export fn abs_f64(value: f64) -> f64 { return intrinsic_abs_f64(value); }
export fn floor_f64(value: f64) -> f64 { return intrinsic_floor_f64(value); }
export fn ceil_f64(value: f64) -> f64 { return intrinsic_ceil_f64(value); }
export fn trunc_f64(value: f64) -> f64 { return intrinsic_trunc_f64(value); }
export fn round_f64(value: f64) -> f64 { return intrinsic_round_f64(value); }
export fn sqrt_f64(value: f64) -> f64 { return intrinsic_sqrt_f64(value); }

export fn min_f64(left: f64, right: f64) -> f64 {
  if left < right { return left; }
  return right;
}

export fn max_f64(left: f64, right: f64) -> f64 {
  if left > right { return left; }
  return right;
}

export fn clamp_f64(value: f64, minimum: f64, maximum: f64) -> f64 {
  if value < minimum { return minimum; }
  if value > maximum { return maximum; }
  return value;
}`,
  "std/array.lume": `export fn sum_i32(values: array<i32>) -> i32 {
  let index: i32 = 0;
  let total: i32 = 0;
  while index < values.length {
    total = total + values[index];
    index = index + 1;
  }
  return total;
}

export fn sum_f64(values: array<f64>) -> f64 {
  let index: i32 = 0;
  let total: f64 = 0.0;
  while index < values.length {
    total = total + values[index];
    index = index + 1;
  }
  return total;
}

export fn contains_i32(values: array<i32>, target: i32) -> bool {
  let index: i32 = 0;
  while index < values.length {
    if values[index] == target { return true; }
    index = index + 1;
  }
  return false;
}

export fn index_of_i32(values: array<i32>, target: i32) -> i32 {
  let index: i32 = 0;
  while index < values.length {
    if values[index] == target { return index; }
    index = index + 1;
  }
  return -1;
}

export fn fill_i32(values: array<i32>, value: i32) -> i32 {
  let index: i32 = 0;
  while index < values.length {
    values[index] = value;
    index = index + 1;
  }
  return values.length;
}

export fn fill_f64(values: array<f64>, value: f64) -> i32 {
  let index: i32 = 0;
  while index < values.length {
    values[index] = value;
    index = index + 1;
  }
  return values.length;
}`,
  "std/string.lume": `export fn length(value: string) -> i32 { return string_length(value); }
export fn byte_length(value: string) -> i32 { return string_byte_length(value); }
export fn equals(left: string, right: string) -> bool { return string_equals(left, right); }
export fn contains(value: string, part: string) -> bool { return string_contains(value, part); }
export fn concat(left: string, right: string) -> string { return string_concat(left, right); }
export fn slice(value: string, start: i32, end: i32) -> string {
  return string_slice(value, start, end);
}`,
});
