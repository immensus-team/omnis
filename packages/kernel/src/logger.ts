export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** Contract §9: one JSON line to stdout. Required keys ts/level/pkg/msg/trace_id.
 *  Secrets never go into any key. */
export function createLogger(pkg: string, traceId: string | null = null): Logger {
  const write = (level: LogLevel, msg: string, extra?: Record<string, unknown>): void => {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, pkg, msg, trace_id: traceId, ...extra })}\n`,
    );
  };
  return {
    debug: (m, e) => write("debug", m, e),
    info: (m, e) => write("info", m, e),
    warn: (m, e) => write("warn", m, e),
    error: (m, e) => write("error", m, e),
  };
}
