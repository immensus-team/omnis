import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { captureAll, repoRoot } from "./capture.js";

const BASELINE_DIR = path.join(repoRoot, "tools/visual/baseline");
/** Git-ignored scratch dir: fresh shots plus the diff visualizations for failures. */
const SCRATCH_DIR = path.join(repoRoot, "tools/visual/.current");
const REPORT_PATH = path.join(SCRATCH_DIR, "report.md");

/** pixelmatch's per-pixel color-delta sensitivity (library default). */
const PIXEL_THRESHOLD = 0.1;
/** Share of mismatched pixels above which a run counts as a regression. Run-to-run
 *  font antialiasing/subpixel jitter stays well under 0.1%; a real visual change
 *  (moved text, changed color, resized box) clears it easily. */
const REGRESSION_RATIO = 0.001;

type Status = "pass" | "fail" | "no-baseline" | "size-mismatch";

interface Row {
  id: string;
  status: Status;
  /** Mismatched share of pixels, null when there was nothing to compare. */
  ratio: number | null;
  note: string;
}

const STATUS_LABEL: Record<Status, string> = {
  pass: "✅ pass",
  fail: "❌ FAIL",
  "no-baseline": "⚠️ no-baseline",
  "size-mismatch": "⚠️ size-mismatch",
};

function compare(id: string, freshPath: string): Row {
  const baselinePath = path.join(BASELINE_DIR, `${id}.png`);
  // A component added to the gallery before its baseline is shot is new, not regressed.
  if (!fs.existsSync(baselinePath)) {
    return { id, status: "no-baseline", ratio: null, note: "no baseline shot yet" };
  }

  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const fresh = PNG.sync.read(fs.readFileSync(freshPath));

  if (baseline.width !== fresh.width || baseline.height !== fresh.height) {
    const dims = (p: PNG) => `${p.width}×${p.height}`;
    return {
      id,
      status: "size-mismatch",
      ratio: null,
      note: `baseline ${dims(baseline)} vs fresh ${dims(fresh)}`,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(baseline.data, fresh.data, diff.data, width, height, {
    threshold: PIXEL_THRESHOLD,
  });
  const ratio = mismatched / (width * height);

  if (ratio > 0) {
    fs.writeFileSync(path.join(SCRATCH_DIR, `${id}.diff.png`), PNG.sync.write(diff));
  }

  return {
    id,
    status: ratio > REGRESSION_RATIO ? "fail" : "pass",
    ratio,
    note: "",
  };
}

function report(rows: Row[]): string {
  const passed = rows.filter((r) => r.status === "pass").length;
  const failing = rows.filter((r) => r.status === "fail" || r.status === "size-mismatch").length;
  const summary = [
    `${passed}/${rows.length} components match baseline`,
    failing > 0 ? `— ${failing} regressed` : "",
    rows.some((r) => r.status === "no-baseline") ? "(some components have no baseline)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const table = rows.map((r) => {
    const diff =
      r.ratio === null ? `—${r.note ? ` (${r.note})` : ""}` : `${(r.ratio * 100).toFixed(3)}%`;
    return `| ${r.id} | ${STATUS_LABEL[r.status]} | ${diff} |`;
  });

  return [
    "# Visual regression report",
    "",
    summary,
    "",
    `Threshold: pass at or below ${(REGRESSION_RATIO * 100).toFixed(1)}% of pixels differing.`,
    "",
    "| Component | Status | Diff % |",
    "| --- | --- | --- |",
    ...table,
    "",
  ].join("\n");
}

try {
  // Stale diff images from an earlier failing run would misrepresent a component
  // that passes now, so the scratch dir starts empty each run.
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });

  const captures = await captureAll(SCRATCH_DIR);
  const rows = captures.map(({ id, path: freshPath }) => compare(id, freshPath));

  fs.writeFileSync(REPORT_PATH, report(rows));
  console.log(report(rows));

  if (rows.some((r) => r.status === "fail" || r.status === "size-mismatch")) {
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
