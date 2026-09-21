// US-C05 / A5 §3.9 (A4 §4.4, master §19 Q10). The Delegation block on the Autonomy tab: the
// per-runtime, per-host, per-repo rules that let a delegation approval skip the human click.
//
// The rules are their own settings key (`delegation.allow_rules`), read by the hub's delegate
// executor through the kernel's `parseDelegationRules` (apps/hub/src/delegate-exec.ts). That schema
// is what decides a rule's effect, so this screen only ever writes values it accepts: both selects
// are constrained to its enums and the path field refuses anything that is not absolute. The type is
// re-declared here rather than imported — the desktop does not depend on @omnis/kernel, and the
// shape is three strings, not the schema that guards the column.
import { RUNTIME_LABEL } from "@omnis/ui";
import { useEffect, useMemo, useRef, useState } from "react";

/** The kernel's `DelegationRule.runtime` enum, in its order. `RUNTIME_OPTIONS`
 *  (packages/agents/src/decision/decisions.ts) is not this list: it is the routable-runtime list and
 *  it has no `hermes`, which is a delegation target from US-C07 on. */
export const DELEGATION_RUNTIMES = [
  "claude_code",
  "codex",
  "claude_ds",
  "hermes",
  "omnis",
] as const;

/** The kernel's `DelegationRule.host` enum — the two machines of A2 §4.5. */
export const DELEGATION_HOSTS = ["mini", "macbook"] as const;

export interface DelegationRule {
  runtime: string;
  host: string;
  repo: string;
}

/** `RUNTIME_LABEL` is the app's one set of runtime names (the inbox rows and the agent session
 *  badges already render from it), so this screen does not carry a second set. Widened to
 *  `Record<string, string>` because a stored rule's runtime is a string off a jsonb column, not the
 *  enum: an unknown one prints as its own id rather than as nothing. */
const RUNTIME_LABEL_BY_ID: Record<string, string> = RUNTIME_LABEL;

/** No host has a label anywhere else in the app; these are the words the ingest allowlist above
 *  already uses for the two machines. */
const HOST_LABEL: Record<string, string> = { mini: "Mac mini", macbook: "MacBook" };

function runtimeLabel(runtime: string): string {
  return RUNTIME_LABEL_BY_ID[runtime] ?? runtime;
}

function hostLabel(host: string): string {
  return HOST_LABEL[host] ?? host;
}

/** The rule the dialog opens on. Not `DELEGATION_RUNTIMES[0]`: a `noUncheckedIndexedAccess` read of
 *  a tuple is `string | undefined`, and a select whose value is undefined is an uncontrolled select
 *  React warns about. */
const DEFAULT_RUNTIME = "claude_code";
const DEFAULT_HOST = "mini";

/** `delegation.allow_rules` is jsonb and writable through `PUT /settings/:key`, so it is whatever an
 *  earlier writer left. A row missing one of the three strings is not a rule and is dropped.
 *
 *  A row the *kernel* would refuse — an unknown runtime, a relative path — is kept, because this
 *  screen writes the whole value back: dropping one here would delete it from the database on the
 *  next Remove, and `parseDelegationRules` already refuses to apply it, so keeping it costs nothing
 *  and losing it would be the destructive half. Remove is how a person retires it. */
export function delegationRulesOf(value: unknown): DelegationRule[] {
  if (!Array.isArray(value)) return [];
  const rules: DelegationRule[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as { runtime?: unknown; host?: unknown; repo?: unknown };
    if (typeof r.runtime !== "string" || r.runtime === "") continue;
    if (typeof r.host !== "string" || r.host === "") continue;
    if (typeof r.repo !== "string" || r.repo === "") continue;
    rules.push({ runtime: r.runtime, host: r.host, repo: r.repo });
  }
  return rules;
}

export interface DelegationRulesProps {
  /** The stored `delegation.allow_rules`, unread — this component owns the parsing. */
  rules: unknown;
  /** `delegation.hermes_enabled`: while it is off the hub refuses a Hermes delegation outright
   *  (US-C06/US-C07), so a rule naming Hermes would be a door painted on a wall. */
  hermesEnabled: boolean;
  /** The whole new array, not a patch — `PUT /settings/:key` upserts the value it is given. */
  onSave(next: DelegationRule[]): Promise<void>;
}

/** Two-step by default (A5 §3.9): Add opens the warning, and nothing is stored until Allow. The
 *  warning is about one runtime in one repository, so the dialog is a fresh set of fields each time.
 *
 *  Opaque, not glass: the desktop shell owns the glass surfaces (rail/toolbar/sheet/palette) and a
 *  dialog drawn on the content layer is not one of them (DESIGN-DIRECTION §3). It reuses the
 *  Autonomy section's own field, row and dialog classes for the same reason — a second set of
 *  names for one list is where the two come to disagree. */
export function DelegationRules({ rules, hermesEnabled, onSave }: DelegationRulesProps) {
  const stored = useMemo(() => delegationRulesOf(rules), [rules]);
  const [adding, setAdding] = useState(false);
  const [runtime, setRuntime] = useState<string>(DEFAULT_RUNTIME);
  const [host, setHost] = useState<string>(DEFAULT_HOST);
  const [repo, setRepo] = useState("");
  const [pathError, setPathError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // A5 §9's focus rule: the fields sit at the foot of a long section, so the dialog takes focus
  // when it opens rather than leaving the caret on the button that opened it.
  useEffect(() => {
    if (adding) dialogRef.current?.focus();
  }, [adding]);

  function open(): void {
    setRuntime(DEFAULT_RUNTIME);
    setHost(DEFAULT_HOST);
    setRepo("");
    setPathError(false);
    setAdding(true);
  }

  /** A4 §4.4's `repo` is absolute by schema: `delegationAllowed` resolves the workdir to compare it,
   *  so a relative rule would silently resolve against the hub process's cwd — on the mini, the omnis
   *  repo root, where a rule reading "omnis" would open every path under it. */
  function allow(): void {
    const path = repo.trim();
    if (!path.startsWith("/")) {
      setPathError(true);
      return;
    }
    setAdding(false);
    const duplicate = stored.some(
      (r) => r.runtime === runtime && r.host === host && r.repo === path,
    );
    if (duplicate) return;
    void onSave([...stored, { runtime, host, repo: path }]);
  }

  return (
    <div className="settings-screen__field">
      <h2 className="settings-screen__label">Delegation</h2>
      <p className="settings-screen__hint">
        A rule lets one runtime run in one repository on one host without asking you first.
      </p>

      {stored.length === 0 ? (
        <p className="settings-screen__hint">No runtime runs without your approval.</p>
      ) : (
        <ul className="settings-screen__switch-list">
          {stored.map((rule, index) => (
            <li
              key={`${String(index)}:${rule.runtime}:${rule.host}:${rule.repo}`}
              className="settings-screen__switch-row"
            >
              <span className="settings-screen__rule">
                {`${runtimeLabel(rule.runtime)} on the ${hostLabel(rule.host)} in ${rule.repo}`}
              </span>
              <button
                type="button"
                className="settings-screen__action"
                // The visible label is the plan's one word; the accessible name has to name the row,
                // because a list of rules otherwise offers six identical "Remove" buttons — the same
                // split the allowlist chips above use.
                aria-label={`Remove ${runtimeLabel(rule.runtime)} in ${rule.repo}`}
                onClick={() => void onSave(stored.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="settings-screen__row">
        <button type="button" className="settings-screen__action" onClick={open}>
          Add rule
        </button>
      </div>

      {adding && (
        <div
          role="alertdialog"
          ref={dialogRef}
          tabIndex={-1}
          aria-label="Delegations to this runtime in this repository will run without approval. Continue?"
          className="settings-screen__dialog"
        >
          <p className="settings-screen__dialog-question">
            Delegations to this runtime in this repository will run without approval. Continue?
          </p>

          <div className="settings-screen__field">
            <label className="settings-screen__label" htmlFor="delegation-runtime">
              Runtime
            </label>
            <select
              id="delegation-runtime"
              className="settings-screen__input"
              value={runtime}
              aria-describedby={hermesEnabled ? undefined : "delegation-hermes-hint"}
              onChange={(e) => setRuntime(e.target.value)}
            >
              {DELEGATION_RUNTIMES.map((value) => (
                <option key={value} value={value} disabled={value === "hermes" && !hermesEnabled}>
                  {runtimeLabel(value)}
                </option>
              ))}
            </select>
            {/* A disabled option is skipped by the keyboard and says nothing about why, so the
                reason is its own line — and the select points at it, so it is read with the field
                rather than only seen next to it. */}
            {!hermesEnabled && (
              <p className="settings-screen__hint" id="delegation-hermes-hint">
                Needs the Hermes approval check first
              </p>
            )}
          </div>

          <div className="settings-screen__field">
            <label className="settings-screen__label" htmlFor="delegation-host">
              Host
            </label>
            <select
              id="delegation-host"
              className="settings-screen__input"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            >
              {DELEGATION_HOSTS.map((value) => (
                <option key={value} value={value}>
                  {hostLabel(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-screen__field">
            <label className="settings-screen__label" htmlFor="delegation-repo">
              Repository path
            </label>
            <input
              id="delegation-repo"
              type="text"
              className="settings-screen__input"
              placeholder="/Users/you/AI-Workspaces/omnis"
              value={repo}
              aria-invalid={pathError ? true : undefined}
              onChange={(e) => {
                setRepo(e.target.value);
                setPathError(false);
              }}
            />
            {pathError && (
              <p className="settings-screen__hint" role="alert">
                Use an absolute path
              </p>
            )}
          </div>

          <div className="settings-screen__dialog-actions">
            <button
              type="button"
              className="settings-screen__action settings-screen__action--danger"
              onClick={allow}
            >
              Allow
            </button>
            <button
              type="button"
              className="settings-screen__action"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
