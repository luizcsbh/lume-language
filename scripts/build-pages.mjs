import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "_site");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function copy(source, destination) {
  const target = join(output, destination);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, source), target, { recursive: true });
}

await Promise.all([
  copy("docs/index.html", "index.html"),
  copy("docs/styles.css", "styles.css"),
  copy("docs/logo.svg", "logo.svg"),
  copy("docs/.nojekyll", ".nojekyll"),
  copy("docs/en", "en"),
  copy("docs/es", "es"),
  copy("LICENSE", "LICENSE"),
  copy("index.html", "playground/index.html"),
  copy("localizacao.html", "playground/localizacao.html"),
  copy("styles.css", "playground/styles.css"),
  copy("file-tabs.css", "playground/file-tabs.css"),
  copy("logo.svg", "playground/logo.svg"),
  copy("src", "playground/src"),
  copy("vendor", "playground/vendor"),
]);
