import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("emits one JSON line with the five required keys", () => {
    const lines: string[] = [];
    const log = createLogger("@omnis/local-agent", {
      sink: (l) => lines.push(l),
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    });
    log.info("bridge connected", { host: "mini" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      ts: "2026-09-20T00:00:00.000Z",
      level: "info",
      pkg: "@omnis/local-agent",
      msg: "bridge connected",
      trace_id: null,
      host: "mini",
    });
  });

  it("carries an explicit trace_id when given", () => {
    const lines: string[] = [];
    const log = createLogger("@omnis/local-agent", { sink: (l) => lines.push(l) });
    log.warn("reconnecting", { trace_id: "01JBQ0000000000000000000" });
    expect(JSON.parse(lines[0] as string).trace_id).toBe("01JBQ0000000000000000000");
  });
});
