import {
  AnimatedList,
  CHANNEL_LABEL,
  ChannelGlyph,
  OpaqueSurface,
  SegmentedControl,
  StatusPill,
  type UiChannel,
} from "@omnis/ui";
import { useQuery } from "@rocicorp/zero/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CostReport,
  type KillSwitchStatus,
  fetchCost,
  fetchKillSwitch,
  fetchSettings,
  putSetting,
  setKillSwitch,
} from "../api/settings.js";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

// ─── the four sub-nav sections (A5 §3.9) ────────────────────────────────────────────────────────

export const SETTINGS_TABS = ["accounts", "autonomy", "model-tiers", "general"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** A5 §8's copy, taken from the `en` dictionary (`settings.nav`) — the screen's own literals agree
 *  with it word for word rather than being a second set of names for the same four sections. */
export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  accounts: "Accounts",
  autonomy: "Autonomy",
  "model-tiers": "Model tiers",
  general: "General",
};

// ─── Model tiers: the cost bar (A5 §3.9, master §14) ────────────────────────────────────────────

export type CostBarState = "danger" | "normal" | "warn";

export interface CostBarSegments {
  /** How much of the track the month's spend fills, as a percentage of the cap. */
  spendPct: number;
  /** Where the reserve segment starts. A fixed computed boundary — the 10% is subordinate to the
   *  cap and is not itself editable (A5 §3.9). */
  reserveStartPct: number;
}

/** The bar's two numbers. The filled width is clamped: a month over the cap must not paint past the
 *  track (that is what the `data-state="danger"` colour and its sentence are for), and a cap of 0
 *  has no percentage to fill. */
export function costBarSegments(i: {
  mtdUsd: number;
  capUsd: number;
  reserveRatio: number;
}): CostBarSegments {
  const raw = i.capUsd > 0 ? (i.mtdUsd / i.capUsd) * 100 : 0;
  return {
    spendPct: Math.min(Math.max(raw, 0), 100),
    reserveStartPct: (1 - i.reserveRatio) * 100,
  };
}

/** The 80%/100% thresholds by name; the colour is the component's business. */
export function costBarState(mtdUsd: number, capUsd: number): CostBarState {
  const pct = capUsd > 0 ? (mtdUsd / capUsd) * 100 : 0;
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warn";
  return "normal";
}

/** A5 §9: the threshold is never carried by colour alone — the bar's own sentence says which state
 *  the month is in (`settings.modelTiers.status*`). */
export const COST_STATE_LABEL: Record<CostBarState, string> = {
  normal: "Normal",
  warn: "T2→T1 downgrade",
  danger: "Non-VIP drafts paused",
};

/** The cap input writes a number or nothing at all — `Number("")` is 0 and `Number("sixty")` is
 *  NaN, and either turned into `settings.cost.cap_usd` would silently break A4 §12.4's budget. */
export function parseCostCap(raw: string): number | null {
  const value = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** The same guard for `archive.t1_confidence_min`, which A4 §9.2's T1 branch compares against a
 *  confidence in 0…1. */
export function parseConfidence(raw: string): number | null {
  const value = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(value) || value <= 0 || value > 1) return null;
  return value;
}

// ─── Autonomy: the allowlist and the per-channel rules (A5 §3.9) ────────────────────────────────

/** The three ingest allowlist kinds (delta §5's `SETTING_DEFAULTS`) plus the second local root —
 *  there are two machines, so "local roots" is two keys. */
export const ALLOWLIST_KINDS = [
  "ingest.local_roots.mini",
  "ingest.local_roots.macbook",
  "ingest.drive_folders",
  "ingest.github_repos",
] as const;
export type AllowlistKind = (typeof ALLOWLIST_KINDS)[number];

export const ALLOWLIST_LABEL: Record<AllowlistKind, string> = {
  "ingest.local_roots.mini": "Mac mini folders",
  "ingest.local_roots.macbook": "MacBook folders",
  "ingest.drive_folders": "Google Drive folders",
  "ingest.github_repos": "GitHub repos",
};

const ALLOWLIST_ADD_LABEL: Record<AllowlistKind, string> = {
  "ingest.local_roots.mini": "Add a Mac mini folder",
  "ingest.local_roots.macbook": "Add a MacBook folder",
  "ingest.drive_folders": "Add a Google Drive folder",
  "ingest.github_repos": "Add a GitHub repo",
};

const ALLOWLIST_PLACEHOLDER: Record<AllowlistKind, string> = {
  "ingest.local_roots.mini": "~/AI-Workspaces",
  "ingest.local_roots.macbook": "~/Documents/notes",
  "ingest.drive_folders": "Boards",
  "ingest.github_repos": "logankim/omnis",
};

/** The stored value is a jsonb column, so it is whatever an earlier writer left there. A non-string
 *  entry is dropped rather than rendered as a chip nothing can remove. */
export function allowlistOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/** Add one entry: trimmed, blank ignored, duplicate ignored. Returns the array to store. */
export function allowlistAdd(list: readonly string[], raw: string): string[] {
  const entry = raw.trim();
  if (entry === "" || list.includes(entry)) return [...list];
  return [...list, entry];
}

export function allowlistRemove(list: readonly string[], entry: string): string[] {
  return list.filter((e) => e !== entry);
}

/** A5 §3.9's allowlist targets what may run without asking. The rule names the channel it applies
 *  to; `autonomy.rules` is `[]` in the migration, so every channel starts off. */
export interface AutonomyRule {
  kind: "channel";
  ref: string;
}

export function autonomyRulesOf(value: unknown): AutonomyRule[] {
  if (!Array.isArray(value)) return [];
  const rules: AutonomyRule[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const rule = entry as { kind?: unknown; ref?: unknown };
    if (rule.kind !== "channel" || typeof rule.ref !== "string" || rule.ref === "") continue;
    rules.push({ kind: "channel", ref: rule.ref });
  }
  return rules;
}

export function autonomyAllows(rules: readonly unknown[], channel: string): boolean {
  return rules.some((rule) => isChannelRuleFor(rule, channel));
}

function isChannelRuleFor(rule: unknown, channel: string): boolean {
  if (typeof rule !== "object" || rule === null) return false;
  const r = rule as { kind?: unknown; ref?: unknown };
  return r.kind === "channel" && r.ref === channel;
}

/** Takes the *stored* array, not `autonomyRulesOf`'s reading of it: the hub replaces the whole jsonb
 *  value, so rebuilding the array out of the rules this screen understands would delete every entry
 *  it does not — including the delegation rules A4 §4.4 keeps in the same key. Only the one channel's
 *  entry is replaced. */
export function autonomySet(rules: readonly unknown[], channel: string, allow: boolean): unknown[] {
  const kept = rules.filter((rule) => !isChannelRuleFor(rule, channel));
  return allow ? [...kept, { kind: "channel", ref: channel }] : kept;
}

// ─── General ────────────────────────────────────────────────────────────────────────────────────

export interface QuietHours {
  start: string;
  end: string;
}

/** A4 §3.6's window. `notify.quiet_hours` is jsonb, so a row of another shape falls back to the
 *  default rather than drawing "undefined" into a time field. Only the two times are read: the VIP
 *  exception is its own key (`notify.vip_override`, the one `notifyTierFor` documents reading), and
 *  a second copy of it living in here is how the two come to disagree. */
export function quietHoursOf(value: unknown): QuietHours {
  const fallback: QuietHours = { start: "23:00", end: "07:00" };
  if (typeof value !== "object" || value === null) return fallback;
  const c = value as { start?: unknown; end?: unknown };
  return {
    start: typeof c.start === "string" ? c.start : fallback.start,
    end: typeof c.end === "string" ? c.end : fallback.end,
  };
}

// ─── the Accounts list ──────────────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  channel: string;
  display: string;
  capabilities: unknown;
  state: string;
}

/** A5 §3.9's mockup draws one status per account. "Read only" is the honest one for a channel the
 *  adapter cannot send on — the row's own state says the connection is fine, which is a different
 *  fact and would read as "you can reply here". */
export function accountStatusLabel(account: { state: string; capabilities: unknown }): string {
  const caps =
    typeof account.capabilities === "object" && account.capabilities !== null
      ? (account.capabilities as { write?: unknown })
      : {};
  if (caps.write === false) return "Read only";
  if (account.state === "active") return "Connected";
  if (account.state === "paused") return "Paused";
  if (account.state === "broken") return "Broken";
  return account.state;
}

function accountTone(account: { state: string; capabilities: unknown }) {
  const label = accountStatusLabel(account);
  if (label === "Read only") return "neutral" as const;
  if (label === "Connected") return "success" as const;
  if (label === "Broken") return "danger" as const;
  return "warning" as const;
}

// ─── the screen ─────────────────────────────────────────────────────────────────────────────────

export type SettingsState = "error" | "loading" | "ready";

/** The three reads' own state, the same shape Digest and Today use. */
export function settingsState(
  resultTypes: readonly ("unknown" | "complete" | "error")[],
): SettingsState {
  if (resultTypes.includes("error")) return "error";
  return resultTypes.includes("unknown") ? "loading" : "ready";
}

export const SETTINGS_BANNER: Record<SettingsState, string> = {
  error: "Couldn't load your settings. Check the hub logs.",
  loading: "Loading your settings…",
  ready: "",
};

/** A5 §8's two dialogues, word for word — the kill switch's confirmation question and the autonomy
 *  warning. The autonomy warning's second sentence is A5 §3.9's own ("Continue?"), reduced to the
 *  question the button already answers. */
export const KILL_SWITCH_QUESTION = "Stop all autonomous actions?";
export const AUTONOMY_WARNING = "Actions to this target send without approval";

const KILL_SWITCH_REASON = "Stopped from the Settings screen";

interface Notice {
  kind: "status" | "alert";
  text: string;
}

export function Settings() {
  const zero: ZeroClient = useZeroClient();
  const [accounts] = useQuery(zero.query.accounts);

  const [tab, setTab] = useState<SettingsTab>("accounts");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [cost, setCost] = useState<CostReport | null>(null);
  // Not `setKillSwitch`: that is the imported hub write, and a same-named state setter would
  // shadow it — React would swallow the call and the switch would never move.
  const [killSwitch, setKillSwitchState] = useState<KillSwitchStatus | null>(null);
  const [state, setState] = useState<SettingsState>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);

  // Drafts are local until they are saved: A5 §3.9 puts a Save button on the cap and the quiet-hours
  // window, so the field has to hold a value the settings map does not have yet.
  const [capDraft, setCapDraft] = useState("");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [allowlistDraft, setAllowlistDraft] = useState<Record<string, string>>({});

  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);
  // Both dialogs are the same shape and only one is on screen at a time, so they share the ref.
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchSettings(), fetchCost(), fetchKillSwitch()])
      .then(([s, c, k]) => {
        if (!live) return;
        setSettings(s);
        setCost(c);
        setKillSwitchState(k);
        setState("ready");
      })
      .catch(() => {
        if (!live) return;
        setState("error");
      });
    return () => {
      live = false;
    };
  }, []);

  const capUsd = cost?.capUsd ?? 60;
  const reserveRatio = numberOr(settings["cost.reserve_ratio"], 0.1);
  const quiet = useMemo(() => quietHoursOf(settings["notify.quiet_hours"]), [settings]);
  const rules = useMemo(() => autonomyRulesOf(settings["autonomy.rules"]), [settings]);
  // What a write sends back: the stored value, of which this screen only understands part. See
  // autonomySet.
  const storedRules = useMemo<readonly unknown[]>(
    () =>
      Array.isArray(settings["autonomy.rules"]) ? (settings["autonomy.rules"] as unknown[]) : [],
    [settings],
  );
  const threshold = numberOr(settings["archive.t1_confidence_min"], 0.85);

  // The fetched value is the source of truth; each draft is seeded from it and re-seeded whenever a
  // save lands, so a field never shows a number the hub did not accept.
  useEffect(() => setCapDraft(String(capUsd)), [capUsd]);
  // A5 §9's focus rule. It also does the scrolling: the panels sit at the foot of the screen, and at
  // 390 a dialog that opens below the fold reads as a click that did nothing.
  useEffect(() => {
    if (confirmingKill || pendingChannel !== null) dialogRef.current?.focus();
  }, [confirmingKill, pendingChannel]);
  useEffect(() => setQuietStart(quiet.start), [quiet.start]);
  useEffect(() => setQuietEnd(quiet.end), [quiet.end]);
  useEffect(() => setThresholdDraft(String(threshold)), [threshold]);

  /** Every write goes through here: the hub audits it (delta §5), the local map is updated so the
   *  screen shows the new value without a second round trip, and both outcomes are announced — a
   *  save that failed silently is the one thing a settings screen may not do. */
  async function write(key: string, value: unknown, okText: string): Promise<boolean> {
    try {
      await putSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      setNotice({ kind: "status", text: okText });
      return true;
    } catch {
      setNotice({ kind: "alert", text: `Couldn't save ${key}. Try again.` });
      return false;
    }
  }

  async function saveCap(): Promise<void> {
    const value = parseCostCap(capDraft);
    if (value === null) {
      setNotice({ kind: "alert", text: "Enter a monthly cap above $0." });
      return;
    }
    if (await write("cost.cap_usd", value, "Monthly cost cap saved.")) {
      setCost((prev) => (prev === null ? prev : { ...prev, capUsd: value }));
    }
  }

  async function saveQuietHours(): Promise<void> {
    // The hub takes the whole value, so the rest of the stored row is carried through: this screen
    // edits two times and owns nothing else in the object.
    const storedQuiet = settings["notify.quiet_hours"];
    const base =
      typeof storedQuiet === "object" && storedQuiet !== null
        ? (storedQuiet as Record<string, unknown>)
        : {};
    await write(
      "notify.quiet_hours",
      { ...base, start: quietStart, end: quietEnd },
      "Quiet hours saved.",
    );
  }

  async function saveThreshold(): Promise<void> {
    const value = parseConfidence(thresholdDraft);
    if (value === null) {
      setNotice({ kind: "alert", text: "Enter a threshold between 0 and 1." });
      return;
    }
    await write("archive.t1_confidence_min", value, "Auto-archive threshold saved.");
  }

  async function toggleKillSwitch(on: boolean): Promise<void> {
    try {
      await setKillSwitch(on, on ? KILL_SWITCH_REASON : "Resumed");
      setKillSwitchState((prev) => ({
        on,
        since: new Date().toISOString(),
        reason: prev?.reason ?? null,
      }));
      setNotice({
        kind: "status",
        text: on ? "All autonomous actions are stopped." : "Autonomous actions are running again.",
      });
    } catch {
      setNotice({ kind: "alert", text: "Couldn't change the kill switch. Try again." });
    }
  }

  async function confirmAutonomy(): Promise<void> {
    const channel = pendingChannel;
    if (channel === null) return;
    setPendingChannel(null);
    await write(
      "autonomy.rules",
      autonomySet(storedRules, channel, true),
      `Autonomy on for ${channelLabel(channel)}.`,
    );
  }

  const banner = SETTINGS_BANNER[state];
  const barState = costBarState(cost?.mtdUsd ?? 0, capUsd);
  const segments = costBarSegments({
    mtdUsd: cost?.mtdUsd ?? 0,
    capUsd,
    reserveRatio,
  });
  // The hatch width and the tick position are the same number as the label, so they come from the
  // same computation: `cost.reserve_ratio` is a setting and only its default makes this 10%.
  const reserveWidthPct = 100 - segments.reserveStartPct;
  const stopped = killSwitch?.on === true;

  return (
    <OpaqueSurface className="settings-screen" data-state={state}>
      <header className="settings-screen__head">
        <h1 className="settings-screen__title">Settings</h1>
      </header>

      {banner !== "" && (
        <p
          className="settings-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      {notice !== null && (
        <p className="settings-screen__notice" role={notice.kind}>
          {notice.text}
        </p>
      )}

      {/* A5 §3.9 draws the four sections as a sub-nav beside the section body; SegmentedControl is
          the same radiogroup the thread detail header already uses, so it is reused rather than
          rebuilt — the reference's vertical rail is a container-query relayout of this one control
          (app.css), which is also why the two share a wrapper: they are one two-column pane at the
          wide shell and two stacked blocks at the narrow one. */}
      <div className="settings-screen__panes">
        <div className="settings-screen__nav">
          <SegmentedControl<SettingsTab>
            label="Settings sections"
            options={SETTINGS_TABS.map((value) => ({ value, label: SETTINGS_TAB_LABEL[value] }))}
            value={tab}
            onChange={setTab}
          />
        </div>

        <div className="settings-screen__body">
          {tab === "accounts" && (
            <section className="settings-screen__section" aria-label="Accounts">
              <ul className="settings-screen__accounts">
                {accounts.map((account) => (
                  <li key={account.id} className="settings-screen__account">
                    <ChannelGlyph channel={account.channel as UiChannel} size={18} />
                    <span className="settings-screen__account-name">
                      {channelLabel(account.channel)}
                    </span>
                    <StatusPill tone={accountTone(account)} label={accountStatusLabel(account)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "autonomy" && (
            <section className="settings-screen__section" aria-label="Autonomy">
              {/* A5 §3.9: every target is off by default (approval required) and turning one on has to
                be confirmed. Turning one off does not — the safe direction needs no ceremony. */}
              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Autonomy allowed</h2>
                <p className="settings-screen__hint">
                  Actions to a channel on this list are sent without asking. Every channel starts
                  off.
                </p>
                <ul className="settings-screen__switch-list">
                  {accounts.map((account) => {
                    const on = autonomyAllows(rules, account.channel);
                    return (
                      <li key={account.id} className="settings-screen__switch-row">
                        <span>{channelLabel(account.channel)}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`Allow autonomy for ${channelLabel(account.channel)}`}
                          className="settings-screen__switch"
                          onClick={() => {
                            if (on) {
                              void write(
                                "autonomy.rules",
                                autonomySet(storedRules, account.channel, false),
                                `Autonomy off for ${channelLabel(account.channel)}.`,
                              );
                              return;
                            }
                            setPendingChannel(account.channel);
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Ingest allowlist</h2>
                <p className="settings-screen__hint">
                  The folders and repositories the ingest loops may read. An empty list means none.
                </p>
                {ALLOWLIST_KINDS.map((kind) => {
                  const entries = allowlistOf(settings[kind]);
                  const draft = allowlistDraft[kind] ?? "";
                  return (
                    <div key={kind} className="settings-screen__allowlist">
                      <h3 className="settings-screen__sublabel">{ALLOWLIST_LABEL[kind]}</h3>
                      <AnimatedList className="settings-screen__chips">
                        {entries.map((entry) => (
                          <li key={entry} className="settings-screen__chip">
                            <span className="settings-screen__chip-text">{entry}</span>
                            <button
                              type="button"
                              className="settings-screen__chip-remove"
                              aria-label={`Remove ${entry} from ${ALLOWLIST_LABEL[kind]}`}
                              onClick={() =>
                                void write(
                                  kind,
                                  allowlistRemove(entries, entry),
                                  `${ALLOWLIST_LABEL[kind]} saved.`,
                                )
                              }
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </AnimatedList>
                      <input
                        type="text"
                        className="settings-screen__input"
                        aria-label={ALLOWLIST_ADD_LABEL[kind]}
                        placeholder={ALLOWLIST_PLACEHOLDER[kind]}
                        value={draft}
                        onChange={(e) =>
                          setAllowlistDraft((prev) => ({ ...prev, [kind]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          // Enter is the add gesture — a form submit would reload the shell, and there
                          // is no form here.
                          e.preventDefault();
                          const next = allowlistAdd(entries, draft);
                          if (next.length === entries.length) return;
                          void write(kind, next, `${ALLOWLIST_LABEL[kind]} saved.`).then((ok) => {
                            if (ok) setAllowlistDraft((prev) => ({ ...prev, [kind]: "" }));
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {tab === "model-tiers" && (
            <section className="settings-screen__section" aria-label="Model tiers">
              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Spend this month</h2>
                <p className="settings-screen__spend">${cost?.mtdUsd ?? 0} used</p>
                {/* The bar is three parts: the filled spend, the boundary mark, and the reserve
                  segment behind it. The risk sentence below carries the same information as the
                  colour, which is what A5 §9 requires. */}
                <div
                  className="settings-screen__bar"
                  data-state={barState}
                  role="img"
                  aria-label={`Monthly budget used: ${String(Math.round(segments.spendPct))}% of $${String(capUsd)}`}
                >
                  <div
                    className="settings-screen__bar-spend"
                    style={{ width: `${String(segments.spendPct)}%` }}
                  />
                  <div
                    className="settings-screen__bar-reserve"
                    style={{ width: `${String(reserveWidthPct)}%` }}
                  />
                  <span
                    className="settings-screen__bar-mark"
                    style={{ right: `${String(reserveWidthPct)}%` }}
                  >{`${String(Math.round(segments.reserveStartPct))}%`}</span>
                </div>
                <p className="settings-screen__bar-state">{COST_STATE_LABEL[barState]}</p>
              </div>

              <div className="settings-screen__field">
                <label className="settings-screen__label" htmlFor="settings-cost-cap">
                  Monthly cost cap
                </label>
                <div className="settings-screen__row">
                  <input
                    id="settings-cost-cap"
                    type="number"
                    min="1"
                    step="1"
                    className="settings-screen__input settings-screen__input--number"
                    aria-label="Monthly cost cap"
                    value={capDraft}
                    onChange={(e) => setCapDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="settings-screen__action"
                    onClick={() => void saveCap()}
                  >
                    Save
                  </button>
                </div>
                {/* A5 §3.9: the reserve is a computed value subordinate to the cap, so it is fixed text
                  beside the field and never an input of its own. */}
                <p className="settings-screen__hint">
                  VIP/sensitive thread reserve: ${Math.round(capUsd * reserveRatio)} (
                  {`${String(Math.round(reserveRatio * 100))}% of the cap`})
                </p>
              </div>

              {/* A5 §3.9: the sensitivity rules are read-only — master D9/§14 are not open for
                re-discussion, so they are a display, not toggles. */}
              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Sensitivity rules</h2>
                <dl className="settings-screen__rules">
                  <div>
                    <dt>T1: local</dt>
                    <dd>
                      Classification, labeling, todo extraction, auto-archive. No draft text leaves
                      a local model.
                    </dd>
                  </div>
                  <div>
                    <dt>T2: escalation</dt>
                    <dd>
                      Draft generation only, and never for a sensitive thread. Paused first when the
                      cap is reached.
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          )}

          {tab === "general" && (
            <section className="settings-screen__section" aria-label="General">
              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Quiet hours</h2>
                <p className="settings-screen__hint">
                  Notifications inside this window are held and sent with the 07:00 briefing.
                </p>
                <div className="settings-screen__row">
                  <label className="settings-screen__sublabel" htmlFor="settings-quiet-start">
                    Start
                  </label>
                  <input
                    id="settings-quiet-start"
                    type="time"
                    className="settings-screen__input"
                    aria-label="Quiet hours start"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                  />
                  <label className="settings-screen__sublabel" htmlFor="settings-quiet-end">
                    End
                  </label>
                  <input
                    id="settings-quiet-end"
                    type="time"
                    className="settings-screen__input"
                    aria-label="Quiet hours end"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                  />
                  <button
                    type="button"
                    className="settings-screen__action"
                    onClick={() => void saveQuietHours()}
                  >
                    Save quiet hours
                  </button>
                </div>
              </div>

              <div className="settings-screen__field">
                <h2 className="settings-screen__label">Auto-archive</h2>
                <div className="settings-screen__switch-row">
                  <span>Archive T0 mail automatically</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings["archive.enabled"] !== false}
                    aria-label="Auto-archive"
                    className="settings-screen__switch"
                    onClick={() =>
                      void write(
                        "archive.enabled",
                        settings["archive.enabled"] === false,
                        "Auto-archive saved.",
                      )
                    }
                  />
                </div>
                <div className="settings-screen__row">
                  <label className="settings-screen__sublabel" htmlFor="settings-threshold">
                    Confidence threshold
                  </label>
                  <input
                    id="settings-threshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    className="settings-screen__input settings-screen__input--number"
                    aria-label="Auto-archive confidence threshold"
                    value={thresholdDraft}
                    onChange={(e) => setThresholdDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="settings-screen__action"
                    onClick={() => void saveThreshold()}
                  >
                    Save auto-archive threshold
                  </button>
                </div>
              </div>

              <div className="settings-screen__field">
                <h2 className="settings-screen__label">VIP messages</h2>
                <div className="settings-screen__switch-row">
                  <span>Let VIP messages break quiet hours</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings["notify.vip_override"] !== false}
                    aria-label="VIP override"
                    className="settings-screen__switch"
                    onClick={() =>
                      void write(
                        "notify.vip_override",
                        settings["notify.vip_override"] === false,
                        "VIP override saved.",
                      )
                    }
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* A5 §3.9: the kill switch is the same control in Settings and the menu bar, and it stays on
          this screen whichever section is open — it is not a General setting. */}
      <section
        className="settings-screen__kill"
        data-state={stopped ? "stopped" : "running"}
        aria-label="Kill switch"
      >
        <div className="settings-screen__kill-head">
          <h2 className="settings-screen__label">Kill switch</h2>
          <p className="settings-screen__hint">
            {stopped
              ? "Autonomous actions are stopped. Nothing is sending or archiving until you resume."
              : "Stops every autonomous loop at once. Drafts and archiving resume the moment you undo it."}
          </p>
        </div>
        {stopped ? (
          <button
            type="button"
            className="settings-screen__action"
            onClick={() => void toggleKillSwitch(false)}
          >
            Resume autonomous actions
          </button>
        ) : (
          <button
            type="button"
            className="settings-screen__action settings-screen__action--danger"
            onClick={() => setConfirmingKill(true)}
          >
            Stop all autonomous actions
          </button>
        )}
      </section>

      {confirmingKill && (
        <div
          role="alertdialog"
          ref={dialogRef}
          tabIndex={-1}
          aria-label={KILL_SWITCH_QUESTION}
          className="settings-screen__dialog"
        >
          <p className="settings-screen__dialog-question">{KILL_SWITCH_QUESTION}</p>
          <p className="settings-screen__hint">
            Every autonomous loop stops. Drafting, archiving and delegation resume when you undo it.
          </p>
          <div className="settings-screen__dialog-actions">
            <button
              type="button"
              className="settings-screen__action settings-screen__action--danger"
              onClick={() => {
                setConfirmingKill(false);
                void toggleKillSwitch(true);
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className="settings-screen__action"
              onClick={() => setConfirmingKill(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pendingChannel !== null && (
        <div
          role="alertdialog"
          ref={dialogRef}
          tabIndex={-1}
          aria-label={`Allow autonomy for ${channelLabel(pendingChannel)}?`}
          className="settings-screen__dialog"
        >
          <p className="settings-screen__dialog-question">{AUTONOMY_WARNING}</p>
          <p className="settings-screen__hint">
            {channelLabel(pendingChannel)} actions will be sent automatically from now on, with no
            approval step. You can turn it off again here.
          </p>
          <div className="settings-screen__dialog-actions">
            <button
              type="button"
              className="settings-screen__action settings-screen__action--danger"
              onClick={() => void confirmAutonomy()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="settings-screen__action"
              onClick={() => setPendingChannel(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </OpaqueSurface>
  );
}

/** The channel's display name, from the map the rail and every inbox row already render from. An
 *  unknown channel (a new adapter the app has not been taught) shows its own id rather than an
 *  empty label. */
function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel as UiChannel] ?? channel;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
