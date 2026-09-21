import {
  Button,
  type KeyValueRow,
  KeyValueTable,
  OpaqueSurface,
  PersonCard,
  type RelationshipState,
} from "@omnis/ui";
// Not on the barrel — `channel-rail.tsx` and `inbox-row.tsx` take it by path, and Tasks.tsx takes
// ApprovalCardView the same way.
import { ChannelGlyph } from "@omnis/ui/components/channel-glyph";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { CHANNEL_LABEL } from "@omnis/ui/lib/row-meta";
import type { UiChannel } from "@omnis/ui/types";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

export interface FollowupCandidate {
  id: string;
  nextFollowupAt: number | null;
  priorityScore: number;
  mergedInto: string | null;
}

/** A5 §3.6's follow-up queue. The same conditions as A3's `persons_followup_idx`
 *  (0002_core_inbox.sql: `WHERE merged_into IS NULL AND next_followup_at IS NOT NULL`) plus the
 *  clock: a person is in the queue once their date has passed. Descending `priority_score` is the
 *  order A4 §7.3's inactive sweep itself walks (`ORDER BY c.priority_score DESC`) — the screen
 *  re-ranks nothing, it draws the loop's own ranking.
 *
 *  A person who has been merged into another is not a person the queue should offer to write to:
 *  `merged_into` means this row is a duplicate of another, and following up on it would send the
 *  same message twice under two names. */
export function followupQueue<T extends FollowupCandidate>(persons: T[], now: number): T[] {
  return persons
    .filter((p) => p.mergedInto === null && p.nextFollowupAt !== null && p.nextFollowupAt <= now)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

/** The two things this screen can be missing, and neither is a reason to blank the list. Same shape
 *  as Tasks' `tasksState`: Zero keeps serving the rows it already synced, so cached people stay on
 *  screen and the banner says what is uncertain rather than replacing them. */
export type NetworkState = "error" | "loading" | "ready";

export function networkState(
  resultTypes: readonly ("unknown" | "complete" | "error")[],
): NetworkState {
  if (resultTypes.includes("error")) return "error";
  return resultTypes.includes("unknown") ? "loading" : "ready";
}

export const NETWORK_BANNER: Record<NetworkState, string> = {
  error: "Couldn't load people. Check the hub logs.",
  loading: "Loading people…",
  ready: "",
};

/** `en-US` for the month name only, then re-assembled day-first — the same split Tasks does, and
 *  for the same reason: the repo's relative formatter prints "4 Aug" (day first, three-letter
 *  month) and `en-GB` renders September as "Sept". */
const DATE_PARTS = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

function shortDate(d: Date): string {
  const parts = DATE_PARTS.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${day} ${month}`.trim();
}

/** `accounts.channel` is a bare `text` column, so it arrives as `string` — an account whose channel
 *  this build does not know how to draw gets no glyph rather than a raw column value. The same
 *  guard `Tasks.tsx` applies to its source labels. */
function knownChannel(channel: string | undefined): UiChannel | null {
  if (channel === undefined) return null;
  return channel in CHANNEL_LABEL ? (channel as UiChannel) : null;
}

/** A5 §3.6's queue strip entry. A person is in the queue because a date passed, and a queue that
 *  only prints the count makes the reader open every card to find out which. Overdue by a day is
 *  the ordinary case (the sweep runs weekday mornings); a week or more behind says so with a date,
 *  because "Due 4 Aug" is a fact and "Due 41 days ago" is a rebuke. */
export function followupDueLabel(nextFollowupAt: number, now: number): string {
  const due = new Date(nextFollowupAt);
  const days = Math.floor((now - nextFollowupAt) / 86_400_000);
  if (days <= 0) return "Due today";
  if (days === 1) return "Due yesterday";
  if (days < 7) return `Due ${String(days)} days ago`;
  return `Due ${shortDate(due)}`;
}

/** The follow-up card's own line. `formatRelativeTime` prints "3d" — right for a column of
 *  timestamps, wrong inside a sentence, which is why this is a second function rather than a call
 *  to that one. It states the gap and nothing more: the draft itself is the model's to write, and
 *  a screen that made one up would be putting words in someone's mouth. */
export function contactGapLabel(lastContactAt: number | null, now: number): string {
  if (lastContactAt === null) return "No conversation yet.";
  const days = Math.floor((now - lastContactAt) / 86_400_000);
  if (days <= 0) return "Last spoke today.";
  if (days === 1) return "No contact in a day.";
  return `No contact in ${String(days)} days.`;
}

export interface NetworkProps {
  /** Fixed for the life of the mount, like Today's and Tasks'. Injectable so the queue boundary is
   *  testable without waiting for a clock. */
  now?: Date;
  /** Opens the person in the detail pane (the shell's third column at 1440, its sheet at 390). */
  onOpenPerson?: (personId: string) => void;
  /** A person's conversation → its Thread, the one navigation this screen makes out of the pane. */
  onOpenThread?: (threadId: string) => void;
}

export function Network({ now: nowProp, onOpenPerson, onOpenThread }: NetworkProps) {
  const zero: ZeroClient = useZeroClient();
  const now = useMemo(() => (nowProp ?? new Date()).getTime(), [nowProp]);
  const [mergeNote, setMergeNote] = useState(false);

  // `last_contact_at` desc, which is A5 §3.6's own binding for this screen. Undated people sort
  // last rather than first: Zero orders nulls after values in an ascending scan, so the descending
  // order this asks for puts them at the end — where a person nobody has ever spoken to belongs on
  // a screen about keeping in touch.
  const [persons, personsR] = useQuery(zero.query.persons.orderBy("last_contact_at", "desc"));
  const [identities, identitiesR] = useQuery(zero.query.identities);
  const [accounts, accountsR] = useQuery(zero.query.accounts);

  const state = networkState([personsR.type, identitiesR.type, accountsR.type]);
  const banner = NETWORK_BANNER[state];

  /** Which channels reach this person. A3 §10 stores one `identities` row per channel handle, so
   *  the card's channel line is a count of those rows — not a guess from the threads they appear
   *  in, which would miss a channel nobody has written on yet. */
  const channelsByPerson = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const identity of identities) {
      const set = map.get(identity.person_id) ?? new Set<string>();
      set.add(identity.channel);
      map.set(identity.person_id, set);
    }
    return map;
  }, [identities]);

  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);

  const queue = useMemo(
    () =>
      followupQueue(
        persons.map((p) => ({
          id: p.id,
          nextFollowupAt: p.next_followup_at ?? null,
          priorityScore: p.priority_score,
          mergedInto: p.merged_into ?? null,
        })),
        now,
      ),
    [persons, now],
  );
  const queuedById = useMemo(() => new Map(queue.map((q) => [q.id, q])), [queue]);

  // A merged person is a duplicate of another row (A3 §10) — drawing both is drawing the same
  // person twice under two names, so the grid keeps only the surviving identity.
  const visible = useMemo(() => persons.filter((p) => (p.merged_into ?? null) === null), [persons]);

  return (
    <OpaqueSurface className="network-screen" data-state={state}>
      {banner !== "" && (
        <p
          className="network-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      <header className="network-screen__head">
        <h1 className="network-screen__title">Network</h1>
      </header>

      {/* A5 §3.6's follow-up queue strip — the screen's top line, because "who has gone quiet" is
          the question this screen exists to answer and it is answered before the grid is read. */}
      <section className="network-screen__queue" aria-label="Follow-up queue">
        <p className="network-screen__queue-title">Follow-up queue ({queue.length})</p>
        {queue.length === 0 ? (
          <p className="network-screen__queue-empty">Nobody is due for a follow-up.</p>
        ) : (
          <ul className="network-screen__queue-list">
            {queue.map((entry) => {
              const person = personById.get(entry.id);
              if (!person) return null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="network-screen__queue-chip"
                    onClick={() => onOpenPerson?.(entry.id)}
                  >
                    <span className="network-screen__queue-name">{person.display_name}</span>
                    <span className="network-screen__queue-due">
                      {followupDueLabel(entry.nextFollowupAt ?? now, now)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {visible.length === 0 ? (
        <p className="network-screen__empty">No people yet — they appear as messages arrive.</p>
      ) : (
        <ul className="network-screen__grid">
          {visible.map((person) => {
            const queued = queuedById.get(person.id);
            const channels = channelsByPerson.get(person.id);
            return (
              <li key={person.id} className="network-screen__cell">
                <PersonCard
                  person={{
                    name: person.display_name,
                    vip: person.vip,
                    org: person.org ?? null,
                    role: person.role ?? null,
                    channels: channels ? ([...channels] as never) : [],
                    // `now` is threaded through rather than left to default: the screen already
                    // injects the clock for the queue's boundary, and a card that read the wall
                    // clock for one field and the injected one for another would disagree with
                    // itself about what day it is.
                    lastContact: person.last_contact_at
                      ? formatRelativeTime(person.last_contact_at, now)
                      : null,
                    relationshipState: person.relationship_state as RelationshipState,
                  }}
                  {...(onOpenPerson ? { onOpen: () => onOpenPerson(person.id) } : {})}
                >
                  {/* A5 §3.6's follow-up suggestion. The plan leaves the real draft lookup to
                      follow-up scope (zeroSchema has no persons→primaryThread relationship), so the
                      block states the fact the queue row actually carries — how long it has been —
                      rather than inventing a sentence the model never wrote. */}
                  {queued && (
                    <div className="person-card__followup">
                      <p className="person-card__followup-body">
                        {contactGapLabel(person.last_contact_at ?? null, now)}
                      </p>
                      <Button variant="ghost" onClick={() => onOpenPerson?.(person.id)}>
                        Draft a follow-up
                      </Button>
                    </div>
                  )}
                </PersonCard>
              </li>
            );
          })}
        </ul>
      )}

      {/* A5 §3.6's "this is the same person" merge/split entry point. A3 §10 resolves people
          deterministically from handle, so this is for the case resolution cannot decide — two
          threads that are plainly one person. The dialog's contents are follow-up scope
          (`mergePersons`/`splitIdentity` are the memory-ingestion plan's), so the button says so
          instead of opening an empty sheet. */}
      <footer className="network-screen__footer">
        <Button variant="ghost" onClick={() => setMergeNote(true)}>
          This is the same person
        </Button>
        {mergeNote && (
          // `<output>` rather than `<p role="status">`: the element carries the role already.
          <output className="network-screen__merge-note">
            Merging two people isn&apos;t wired up yet.
          </output>
        )}
      </footer>
    </OpaqueSurface>
  );
}

/** A5 §3.6's person detail view: the right pane's answer to "who is this", opened by clicking a
 *  card. The timeline is their messages and the channel links are the conversations those messages
 *  came from — both read from `items`, so the pane never says a person wrote something they did
 *  not. */
export interface PersonDetailProps {
  personId: string;
  onOpenThread?: (threadId: string) => void;
}

/** The timeline is capped: this is a *recent* interaction list, and a person with four years of
 *  mail would otherwise make the pane a second inbox. */
export const TIMELINE_LIMIT = 20;

export function PersonDetail({ personId, onOpenThread }: PersonDetailProps) {
  const zero: ZeroClient = useZeroClient();
  const [persons] = useQuery(zero.query.persons.where("id", "=", personId));
  const [identities] = useQuery(zero.query.identities.where("person_id", "=", personId));
  const [notes] = useQuery(zero.query.notes.where("routed_to_person_id", "=", personId));
  const [accounts] = useQuery(zero.query.accounts);
  const [items, itemsR] = useQuery(
    zero.query.items
      .where("author_person_id", "=", personId)
      .orderBy("sent_at", "desc")
      .limit(TIMELINE_LIMIT),
  );
  const [threads] = useQuery(zero.query.threads);

  const person = persons[0];
  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel])),
    [accounts],
  );
  const threadById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  /** One entry per conversation, newest first: a timeline that listed the same thread eight times
   *  would push the other seven conversations off the pane. */
  const conversations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (!seen.has(item.thread_id)) seen.set(item.thread_id, item.id);
    }
    return [...seen.keys()];
  }, [items]);

  const rows: KeyValueRow[] = person
    ? [
        ...(person.org || person.role
          ? [
              {
                label: "Affiliation",
                value: [person.org, person.role]
                  .filter((v): v is string => typeof v === "string" && v !== "")
                  .join(" · "),
              },
            ]
          : []),
        ...(person.first_contact_at
          ? [
              {
                label: "First contact",
                value: formatRelativeTime(person.first_contact_at),
                numeric: true,
              },
            ]
          : []),
        ...(person.last_contact_at
          ? [
              {
                label: "Last contact",
                value: formatRelativeTime(person.last_contact_at),
                numeric: true,
              },
            ]
          : []),
        { label: "Messages", value: person.item_count, numeric: true },
      ]
    : [];

  if (!person) {
    return (
      <div className="person-detail" data-state={itemsR.type === "unknown" ? "loading" : "ready"}>
        <p className="person-detail__empty">
          {itemsR.type === "unknown" ? "Loading person…" : "This person is no longer here."}
        </p>
      </div>
    );
  }

  return (
    <div className="person-detail">
      <header className="person-detail__head">
        <h2 className="person-detail__name">{person.display_name}</h2>
        {person.vip && <span className="person-card__badge">VIP</span>}
      </header>

      <KeyValueTable rows={rows} />

      {/* A5 §3.6's "links to conversations across all channels": one row per conversation, carrying
          the channel it lives on and the thread's own title. */}
      <section className="person-detail__section" aria-label="Conversations">
        <h3 className="person-detail__section-title">Conversations</h3>
        {conversations.length === 0 ? (
          <p className="person-detail__empty">No conversations yet.</p>
        ) : (
          <ul className="person-detail__conversations">
            {conversations.map((threadId) => {
              const thread = threadById.get(threadId);
              const channel = knownChannel(
                thread ? channelByAccount.get(thread.account_id) : undefined,
              );
              return (
                <li key={threadId}>
                  <button
                    type="button"
                    className="person-detail__conversation"
                    onClick={() => onOpenThread?.(threadId)}
                  >
                    {channel !== null && <ChannelGlyph channel={channel} size={14} />}
                    <span className="person-detail__conversation-title">
                      {thread?.title || (channel ? CHANNEL_LABEL[channel] : null) || "Thread"}
                    </span>
                    {thread?.last_item_at !== undefined && thread?.last_item_at !== null && (
                      <span className="person-detail__conversation-time">
                        {formatRelativeTime(thread.last_item_at)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* A5 §3.6's "notes": both what the follow-up loop wrote onto the person
          (persons.notes, A4 §7.4's relationship_update) and what was routed here by the notes loop
          (notes.routed_to_person_id). */}
      <section className="person-detail__section" aria-label="Notes">
        <h3 className="person-detail__section-title">Notes</h3>
        {person.notes === undefined && notes.length === 0 ? (
          <p className="person-detail__empty">No notes yet.</p>
        ) : (
          <ul className="person-detail__notes">
            {person.notes !== undefined && person.notes !== null && person.notes !== "" && (
              <li className="person-detail__note">{person.notes}</li>
            )}
            {notes.map((note) => (
              <li key={note.id} className="person-detail__note">
                {note.body}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Identities are A3 §10's evidence for this person: the handles that resolved here. */}
      {identities.length > 0 && (
        <section className="person-detail__section" aria-label="Handles">
          <h3 className="person-detail__section-title">Handles</h3>
          <ul className="person-detail__handles">
            {identities.map((identity) => {
              const channel = knownChannel(identity.channel);
              return (
                <li key={identity.id} className="person-detail__handle">
                  <span className="person-detail__handle-channel">
                    {channel !== null ? CHANNEL_LABEL[channel] : identity.channel}
                  </span>
                  <span className="person-detail__handle-value">{identity.handle}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
