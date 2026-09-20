import { readFileSync } from "node:fs";

const lines = readFileSync(new URL("./sample-sentences.txt", import.meta.url), "utf8")
  .split("\n").filter(Boolean);

const latencies: number[] = [];
const t0 = performance.now();

for (const line of lines) {
  const s = performance.now();
  const res = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: line }),
  });
  if (!res.ok) throw new Error(`ollama error: ${res.status} ${await res.text()}`);
  await res.json();
  latencies.push(performance.now() - s);
}

const totalS = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.floor(latencies.length * 0.95)];
console.log(`total_s=${totalS.toFixed(1)} p95_ms=${p95.toFixed(1)} n=${lines.length}`);
process.exit(totalS <= 120 && p95 <= 300 ? 0 : 1);
