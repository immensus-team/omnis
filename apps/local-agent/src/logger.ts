export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void;
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export function createLogger(
  pkg: string,
  opts: { sink?: (line: string) => void; now?: () => Date } = {},
): Logger {
  const sink =
    opts.sink ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const now = opts.now ?? (() => new Date());
  const log = (level: LogLevel, msg: string, extra: Record<string, unknown> = {}): void => {
    const { trace_id = null, ...rest } = extra;
    sink(JSON.stringify({ ts: now().toISOString(), level, pkg, msg, trace_id, ...rest }));
  };
  return {
    log,
    debug: (m, e) => log("debug", m, e),
    info: (m, e) => log("info", m, e),
    warn: (m, e) => log("warn", m, e),
    error: (m, e) => log("error", m, e),
  };
}
