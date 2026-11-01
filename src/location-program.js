export const LOCATION_PROGRAM = `// A interface obtém as coordenadas com a API HTML5 após consentimento.
// Esta função Lume decide o quadrante e roda como WebAssembly.
fn main() -> i32 {
  return 0;
}

fn analyze_location(latitude: f64, longitude: f64) -> i32 {
  if latitude >= 0.0 {
    if longitude >= 0.0 {
      return 0;
    } else {
      return 1;
    }
  } else {
    if longitude >= 0.0 {
      return 2;
    } else {
      return 3;
    }
  }
  return 0;
}`;
