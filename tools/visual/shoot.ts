import path from "node:path";
import { captureAll, repoRoot } from "./capture.js";

try {
  const results = await captureAll(path.join(repoRoot, "tools/visual/baseline"));
  for (const { id, path: file } of results) console.log(`✓ ${id} -> ${file}`);
  console.log(`\n${results.length} screenshots written`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
