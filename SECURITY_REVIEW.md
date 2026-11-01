# Lume security review

**Date:** November 1, 2026

**Scope:** compiler and WebAssembly emission, Worker lifecycle, DOM bridge, numeric heap, distribution page, and public source snapshot.

**Languages:** English | [Português (Brasil)](SECURITY_REVIEW.pt-BR.md)

## Findings corrected

1. `listen_click()` used to send a notification on every call and did not consume the host-effect budget. This could create an unnecessary Worker-to-interface message queue. Each call now consumes the 4,096-effect budget per run/callback, while the listener notice is idempotent and sent only once.
2. A program could request a listener without exporting `on_click`, leaving the Worker and heap active without a useful callback. The request now fails with a controlled error, the execution state is cleared, and no listener is announced.
3. When `main()` returned with an active callback, the interface disabled **Stop** even though the Worker was still alive. The Worker now reports this state to the interface, which keeps the control available until the run is terminated.

These paths have regression coverage in `tests/worker.test.js`. Signed arithmetic follows WebAssembly traps: division and remainder by zero trap, as does dividing the minimum `i32` by `-1`. Documentation and tests now make this behavior explicit.

## Checks performed

The independent review was a static, focused inspection of the parser/WASM emitter, DOM bridge validation, heap handles and limits, and Worker import lifecycle. No additional defects were confirmed in the inspected paths; this is not proof that defects are absent and does not replace exhaustive analysis.

The suite run on November 1, 2026 finished with **27 passing tests and zero failures**, covering compilation and WASM execution, type errors, source/nesting limits, DOM batch rejection, heap operations, handle invalidation, compaction, click listeners, and arithmetic traps. `node --check` passed for `src/app.js`, `src/worker.js`, and `src/compiler.js`; `git diff --check` reported no whitespace issues.

The static build was reproduced from the publication contract and contains only the interface, required modules, route manifest, and locally vendored MapLibre dependency with its license. The GitHub Pages landing page returned HTTP responses along with its CSS and logo, without scripts or remote CSS resources. The built route manifest contains only `/` and `/localizacao.html`. The project inspection found no `.env` files, and known credential patterns did not match source files. `package.json` declares no external npm dependencies.

## Remaining risks

WebAssembly and Web Workers are not, by themselves, a sandbox for hostile code. A loop can consume CPU until the Worker is terminated; do not run third-party programs you have not reviewed. The project has no instruction budget or origin isolation specifically for Lume code.

DOM validation checks a complete batch before delegating mutations. It cannot roll back if a native DOM write unexpectedly fails during application. The heap is an auxiliary service limited to `i32` cells; it is not WASM linear memory, does not provide strings or pointers, and may be slower than direct access because calls cross between WASM and JavaScript.

The limits of 65,536 UTF-16 source code units, syntax depth 128, a 16 MiB heap, 16,384 live blocks, and 4,096 host effects reduce some classes of errors and abuse. They do not guarantee complete security. This review was not a penetration test, comprehensive fuzzing effort, or formal verification; browser bugs, vendored dependency issues, and paths not covered by tests may remain.
