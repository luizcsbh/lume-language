# Lume

**Languages:** English | [Português (Brasil)](README.pt-BR.md)

Lume is an experimental language for a browser-based playground. Its dependency-free JavaScript compiler translates a typed subset of the language directly into a WebAssembly binary module. The module is validated and run in a Web Worker; calls to visual browser APIs pass through explicit JavaScript imports. The Worker keeps the interface responsive and can be terminated to stop a loop, but it is not a security sandbox for arbitrary code.

## Download and run

Visit the [Lume download page](https://luizcsbh.github.io/lume-language/). Choose **Download source code (.zip)** to get a public source snapshot without Git history or environment files. This is browser source code—not a native installer or executable. This project is licensed under the [MIT License](LICENSE).

After extracting the ZIP, open a terminal in that folder and run `python3 -m http.server 8000`; then visit `http://localhost:8000`. Local HTTP allows you to try both the playground and the geolocation page. With Node.js installed, `npm test` runs the automated suite.

## First steps

1. Download or clone this repository and open a terminal in its root folder (the folder containing `index.html`).
2. Start a local HTTP server:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000` in a modern browser.
4. In the playground, choose an example, edit `main.lume`, and use **＋ Arquivo** to create modules. Tabs switch between files; the project is saved in browser storage when available. The playground does not read files from disk.
5. Click **Compile** to inspect the generated WebAssembly Text, then **Run** to execute the program. You can also press `Ctrl/⌘ + Enter` to run.

Try this minimal program in the editor:

```lume
fn main() -> i32 {
  print("Hello, Lume!");
  return 0;
}
```

The playground console prints `Hello, Lume!`.

## How developers can use Lume

The compiler can be installed as an npm dependency. The package has not been published to the npm registry yet; in the meantime, install it directly from GitHub:

```bash
npm install github:luizcsbh/lume-language
```

To develop against a local checkout, install by its path, for example `npm install ../lume-language`. Once the package is published to npm, it can be installed with `npm install @luizcsbh/lume-language`.

Create `app.mjs` in your project:

```js
import { instantiate } from "@luizcsbh/lume-language";

const source = `
fn main() -> i32 {
  print_i32(42);
  return 0;
}`;

const { run } = await instantiate(source, {
  host: {
    print_i32(value) {
      console.log(value);
    },
  },
});

run();
```

Run it with `node app.mjs`. The console prints `42`. `instantiate` compiles and validates the WASM module and returns the instance and compilation output. `run()` executes `main()` and releases the managed heap when it returns (or when the Promise resolves for `async fn main`), unless the program registers a click listener; in that case call `dispose()` after callbacks are finished. If calling `instance.exports.main()` directly, call `dispose()` when the program is finished. The runtime supplies managed-memory imports; provide an implementation in `host` for other imported functions your program uses. Calling a missing import throws an explicit error.

### Importing Lume modules

Use named imports and export functions from the supplied source map:

```js
import { instantiate } from "@luizcsbh/lume-language";

const source = `
import { add as sum } from "./math.lume";
fn main() -> i32 { return sum(19, 23); }`;

const { run } = await instantiate(source, {
  modules: {
    "math.lume": "export fn add(a: i32, b: i32) -> i32 { return a + b; }",
  },
  host: {},
});

console.log(run()); // 42
```

Modules are compiled into one WebAssembly module. Only source files explicitly provided through `modules` can be imported; paths are relative `.lume` paths, and no filesystem or network access occurs during resolution. The browser playground exposes these source files as tabs, with `main.lume` as the entry point.

### Standard library

The compiler bundles these modules, which cannot be overridden through the `modules` option:

```lume
import { sum_i32, contains_i32 } from "std/array.lume";
import { clamp_i32, sqrt_f64 } from "std/math.lume";
import { concat, length, slice } from "std/string.lume";
```

`std/array.lume` provides sums, search, index lookup, and fill operations for `i32`/`f64` arrays; `std/math.lume` provides clamps and common `f64` operations; `std/string.lume` provides concatenation, equality, search, slicing, Unicode code-point length, and UTF-8 byte length. `concat` and `slice` allocate strings in WASM linear memory, capped at 16 MiB per module. `sqrt_f64` follows IEEE-754 and returns `NaN` for negative input. `clamp_*` requires `minimum <= maximum`.

This is an initial set of modules, not yet a comprehensive standard library.

### Experimental async/await

The compiler includes a portable continuation-based async path without JSPI. In this version, `async fn` is supported only on `main`; `await` must be the direct value of a declaration, assignment, or return at the function's top level. Await inside expressions, conditions, loops, nested blocks, or helper functions is explicitly rejected.

Declare each asynchronous host operation before the functions:

```lume
host async fn sleep_ms(milliseconds: i32) -> i32;

async fn main() -> i32 {
  let waited: i32 = await sleep_ms(25);
  print_i32(waited);
  return waited;
}
```

In the playground, the Worker provides `sleep_ms(i32)`, which resolves with the duration after waiting. With the package API, provide the implementation in `host` and await the result of `run()`:

```js
const source = `
host async fn sleep_ms(milliseconds: i32) -> i32;
async fn main() -> i32 {
  let waited: i32 = await sleep_ms(25);
  return waited;
}`;
const runtime = await instantiate(source, {
  host: {
    sleep_ms: milliseconds => new Promise(resolve => setTimeout(() => resolve(milliseconds), milliseconds)),
  },
});
const result = await runtime.run();
```

Synchronous `run()` calls still return the `i32` directly; for an `async fn main`, it returns a Promise. Async host functions can receive and return `i32`, `f64`, `bool`, or `string`; rejections are propagated, and `dispose()` cancels the instance's wait. This is not general async support yet: helper functions cannot be async, and `await` is not allowed in nested control flow.

To compile and inspect without instantiating:

```js
import { compile } from "@luizcsbh/lume-language";

const source = "fn main() -> i32 { return 0; }";
const { bytes, wat, functions } = compile(source);
```

`compile()` only generates the module. `instantiate().run()` executes `main()` on the current thread: it returns the `i32` directly for a synchronous function and a Promise for `async fn main`. In a browser UI, use a Web Worker to avoid blocking the page. The package does not create a DOM or Canvas bridge automatically: provide those integrations through your application's `host` functions. WebAssembly and Workers are not a sandbox for hostile code.

### Use through the playground

You can also use Lume in this repository to experiment with typed numeric logic and connect it to the browser features supported by the playground. For example, this program reads the slider and writes its value to a registered DOM target:

```lume
fn main() -> i32 {
  let value: i32 = read_slider();
  dom_set_i32(1, value);
  dom_set_visible(3, true);
  print_i32(value);
  return value;
}
```

Here, target `1` is `result-value` and target `3` is `result-pill`. Other available imports include Canvas drawing, click callbacks, and the experimental `i32` memory handles; see the sections below for details.

The package distributes the compiler and a minimal WebAssembly instantiation helper. The full playground integration—including Worker, DOM, and Canvas—remains the responsibility of the integrating application. The implementation is in `src/compiler.js`, `src/runtime.js`, `src/worker.js`, and `src/app.js`.

### Relevant project files

- `src/` contains the compiler, worker, DOM API, and runtime glue.
- `index.html` loads the browser playground.
- `localizacao.html` demonstrates geolocation using a compiled Lume program.
- `tests/` contains the automated validation suite.

### Keep in mind

- Lume is a browser-oriented experimental language.
- Programs are compiled to WebAssembly and run in a Web Worker.
- Browser features are exposed through explicit imports such as `print_i32`, `read_slider()`, `listen_click()`, and the controlled DOM and memory APIs.
- Use only programs you understand and trust; the worker is not a sandbox for arbitrary hostile code.

## Playground controls

Open the [repository playground](https://luizcsbh.github.io/lume-language/playground/) or run the local server above. The GitHub Pages workflow publishes the landing page and playground; enable **Settings → Pages → Build and deployment → GitHub Actions** in the repository to deploy it. **Compile** shows the WebAssembly Text representation; **Run** compiles and executes the module. **Stop** terminates the Worker, including when a program enters an infinite loop. The slider value is read when `read_slider()` is called. The click example receives coordinates through `on_click(x, y)`.

## Prototype syntax

```lume
fn soma(a: i32, b: i32) -> i32 {
  return a + b;
}

fn main() -> i32 {
  let limite: i32 = 10;
  let soma_total: i32 = 0;
  let indice: i32 = 0;

  while indice < limite {
    soma_total = soma_total + indice;
    indice = indice + 1;
  }

  if soma_total > 0 {
    print_i32(soma(soma_total, 2));
  } else {
    print_i32(0);
  }
  return soma_total;
}
```

Functions use `fn`; parameters have names and types (`name: type`), and a return type may follow `->`. `main` is the entry point, takes no parameters, and returns `i32`. Available primitive types are `i32`, `f64`, `bool`, and `string`; booleans use WebAssembly's `i32` representation, and strings are stored as UTF-8 in the module's memory. Local variables use `let name: type = value;` and can be updated. Integers are written without a decimal point; decimals are `f64`. The prototype supports `if`/`else`, `while`, function calls, recursion, assignment, `//` and `/* ... */` comments, arithmetic, comparisons, and `&&`/`||` boolean operators (without short-circuit evaluation). Implicit conversions and string concatenation with `+` are not included; `print("text", number)` joins text and a number only in its output. Import the standard string, array, and math modules for those operations.

### Arrays and structs

Arrays have an explicit element type, fixed length after allocation, mutable indexed elements, and a `.length` property. A typed array literal allocates its elements in the managed heap:

```lume
fn main() -> i32 {
  let scores: array<i32> = [8, 13, 21];
  scores[1] = 34;
  print_i32(scores[1]);
  return scores.length;
}
```

For a size known only at runtime, use `array_i32(size)`, `array_f64(size)`, `array_bool(size)`, or `array_string(size)`. Use `array_ref(size)` for an array of structs or other managed values, with an explicit type such as `array<Point>`. Empty literals are allowed when the variable or parameter supplies the array type, for example `let values: array<f64> = [];`.

Structs declare named, typed fields and are initialized with all fields exactly once. Fields and array elements can be read or assigned, including nested values:

```lume
struct Point { x: i32, y: f64 }

fn main() -> i32 {
  let points: array<Point> = array_ref(1);
  points[0] = Point { x: 4, y: 2.5 };
  points[0].x = points[0].x + 1;
  print_f64(points[0].y);
  return points[0].x;
}
```

The runtime manages these allocations in its bounded host heap and releases them at the end of `run()` unless a click listener keeps callbacks active; in that case, call `dispose()` when done. In the playground, the Worker releases them when execution ends. This is per-run region management, not a garbage collector: arrays do not resize, and values are not shared across runs or Workers.

## JavaScript interoperability

Imported host functions include `print_i32(i32)`, `print_f64(f64)`, `print_string(string)`, `print(string, number)`, Canvas, the controlled DOM API, `read_slider() -> i32`, `listen_click()`, and the memory imports described below. `instantiate()` supplies the bounded memory imports for arrays, structs, and explicit memory operations. In Lume, `print` and `print_string` are equivalent: both accept `print("text")` or `print("text", number)`; the number can be `i32` or `f64`, and the text and number representation are emitted together. To implement printing in another application, the text argument is a pointer to UTF-8 bytes in the exported WASM memory; the four bytes before the pointer contain its byte length as a little-endian integer. In the playground, the Worker decodes the text and sends it to the console. These imports demonstrate the WASM–JavaScript boundary; visual imports are Worker messages that the interface uses to update the DOM and Canvas. `listen_click()` enables calls to the optional exported function `on_click(x: i32, y: i32) -> i32` when the user clicks the Canvas.

## Controlled DOM API

The **Batched DOM** example uses three typed imports: `dom_set_i32(target: i32, value: i32)`, `dom_set_f64(target: i32, value: f64)`, and `dom_set_visible(target: i32, visible: bool)`. The fixed catalogue assigns IDs 1=`result-value`, 2=`input-value`, 3=`result-pill`, and 4=`canvas-empty`. The first two accept numeric text only; the last two accept visibility changes only. The legacy `dom_value(i32)` import remains available as a shortcut to update `result-value` and show `result-pill`.

The Worker accumulates commands from a `main` call or WASM `on_click` callback and sends a batch of up to 4,096 operations instead of one message per operation. The host service validates the whole batch before mutating any node, checks IDs, capabilities, i32 ranges, finite f64 values, and 0/1 booleans, then applies the writes in one synchronous pass. A batch rejected during validation is not partially applied. If execution or a callback throws or exceeds its budget, pending commands are discarded and the click listener is disabled until the next run. This guarantee covers full validation before mutation; it does not provide rollback if a native DOM write unexpectedly fails. The interface does not read layout measurements for these commands, and text is written through `textContent`, never `innerHTML`.

The program cannot supply selectors, HTML, attributes, URLs, event listeners, or node references: only the host registers and exposes the four fixed targets. This reduces capabilities and injection risks but does not turn a Worker or WebAssembly into a sandbox for hostile code. The controlled DOM API writes numbers only; strings can be printed to the console with `print_string`, not written arbitrarily to the DOM. Every call still crosses the WASM–JavaScript boundary; batching reduces messages, but simple or DOM-intensive work may still be faster in JavaScript. The target list is not a general-purpose API for arbitrary pages.

## Numeric memory management

The **Memory & threads** example uses `memory_alloc_i32(cells: i32) -> i32`, `memory_load_i32(handle: i32, index: i32) -> i32`, `memory_store_i32(handle: i32, index: i32, value: i32)`, and `memory_free(handle: i32)`. Allocation returns an opaque handle, not an address or pointer. Each read and write requires a live handle and an index within the block; out-of-range i32 values, invalid handles or indices, and repeated frees are rejected.

The host maintains the heap in the Worker using a bounded buffer; it is **not** the WebAssembly module's native linear memory. It starts at 64 KiB, grows on demand to 16 MiB, and allows at most 16,384 live blocks per run. New and freed allocations are zeroed; adjacent free ranges are merged. When fragmentation prevents an allocation, blocks can be compacted: the program holds only stable handles and cannot observe physical positions. The Worker reports bytes used/reserved and the live block count in the console. Typed arrays and structs use this same heap; `f64` elements occupy two `i32` cells.

The heap resets on each playground run: it is released when `main()` returns if there is no click listener; if `listen_click()` keeps the Worker active, the heap lasts until the next run, an error, or Worker termination. The managed heap does not expose raw pointers or general access to WASM memory, and it does not provide a garbage collector or sharing between Workers.

The **Memory & threads** example demonstrates allocating, writing, reading, reusing, and freeing a block. The Canvas displays a dot chart: three dots represent the three allocated `i32` cells, and one dot per execution thread compares Lume and JavaScript. Labels and the calculated sum appear in the console. Lume controls memory through handles, while the JavaScript host maintains the actual buffer. In the playground, the WASM program runs in **one Worker (one execution thread)** while the interface JavaScript stays on the main thread. Synchronous JavaScript on the interface uses one execution thread; to keep the interface responsive while isolating computation, JavaScript also uses a Worker. Thus, for this setup, Lume does not require more threads than JavaScript. Thread count alone does not determine which option is faster.

## HTML5 geolocation processed by Lume

Open [`/localizacao.html`](localizacao.html) on the local server, or visit the [geolocation demo](https://luizcsbh.github.io/lume-language/playground/localizacao.html), and click **Locate my position**. Only then does JavaScript call `navigator.geolocation.getCurrentPosition`, subject to browser permission and a secure context (HTTPS or localhost). Latitude and longitude are passed as `f64` to the `analyze_location` export of a Lume program compiled to WebAssembly; that function classifies the hemispheres. Then locally hosted MapLibre GL JS 6.16.0, with its license in `vendor/maplibre-gl`, shows the position on an OpenFreeMap vector map. The Liberty map and its data are requested only after the browser returns an authorized location; the page shows a marker and a circle for the accuracy estimate provided by the browser.

The public OpenFreeMap instance is currently advertised as free, with no registration, API key, request limit, or cookies. The service does not promise an SLA, and future availability is not guaranteed. Its maps are served from `tiles.openfreemap.org`, while the map data comes from OpenStreetMap. Visible attribution identifies OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors. See the [OpenFreeMap website](https://openfreemap.org/), its [official integration guide](https://openfreemap.org/quick_start/), and the [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/).

To render the region, the browser requests the style and public tiles from OpenFreeMap; the service receives the browser's IP address and approximate areas requested. The app does not send coordinates to its own backend or store them. The library and stylesheet are hosted on the site and loaded only after permission. If permission is denied or the browser does not return a location, the app does not contact the map provider. The HTML5 API has a 15-second timeout, and the interface releases the button after 20 seconds if no callback arrives. Coordinates and the marker are shown as soon as Lume finishes its calculation, without waiting for tiles; if the map is still loading after 35 seconds, the interface displays a notice while allowing loading to continue.

## Build and test

MapLibre GL JS and its worker are served from local files in `vendor/maplibre-gl`; vector map data comes from OpenFreeMap after permission. With Node.js installed, `npm test` runs the compiler, heap, and integration tests using Node's native WebAssembly engine. `npm start` starts the static preview on port 3000.

## Limits

This is an educational prototype: the managed heap supports typed arrays, structs, and explicit `i32` blocks, but does not manage native WASM linear memory; debugger and package ecosystem support are also limited. The compiler rejects source above 65,536 UTF-16 code units and syntax nesting deeper than 128; host effects are limited to 4,096 per call. These limits reduce accidental failures and simple abuse but do not provide a WASM instruction budget: a loop can consume CPU until the Worker is stopped. Do not run untrusted programs; WebAssembly and Workers are not a security sandbox. Automated and manual review reduce known risks but cannot guarantee that vulnerabilities are absent. WebAssembly is not automatically faster than JavaScript for every workload; frequent DOM access still passes through JavaScript. The public OpenFreeMap endpoint has no SLA; for critical applications, consider a commercial provider or self-hosting.

Signed `i32` arithmetic follows WebAssembly instructions: division or remainder by zero traps, and `-2147483648 / -1` also traps. In that case, `-2147483648 % -1` is zero. A trap interrupts the call and the Worker discards pending DOM commands.

For corrected findings, verification details, and residual risks, see the [security review](SECURITY_REVIEW.md).
