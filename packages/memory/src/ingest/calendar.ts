// A4 §10.1: the calendar gets no separate polling — we only extract from the calendar_events
// that the A1 adapter already writes.
import { query } from "@omnis/db";
import { chunkCalendarEvent } from "./chunk.js";
import type { IngestDoc, IngestProvider } from "./run.js";

interface EventRow {
  external_id: string;
  title: string;
  start_at: Date;
  end_at: Date;
  location: string | null;
  attendees: Array<{ email?: string }>;
  description: string | null;
  updated_at: Date;
}

export function createCalendarProvider(): IngestProvider {
  return {
    kind: "calendar",
    ref: "calendar_events",
    async *list(ctx): AsyncIterable<IngestDoc> {
      const since =
        typeof ctx.cursor.since === "string" ? ctx.cursor.since : "1970-01-01T00:00:00.000Z";
      const rows = await query<EventRow>(
        ctx.pool,
        `SELECT ce.external_id, COALESCE(i.subject, '(no subject)') AS title, ce.start_at, ce.end_at,
                ce.location, ce.attendees, i.body AS description, ce.updated_at
           FROM calendar_events ce JOIN items i ON i.id = ce.item_id
          WHERE ce.updated_at > $1::timestamptz
          ORDER BY ce.updated_at`,
        [since],
      );
      for (const r of rows) {
        const chunk = chunkCalendarEvent({
          external_id: r.external_id,
          title: r.title,
          start_at: r.start_at.toISOString(),
          end_at: r.end_at.toISOString(),
          location: r.location,
          attendees: r.attendees.map((a) => a.email ?? "").filter((e) => e !== ""),
          description: r.description,
        });
        yield {
          source_ref: r.external_id,
          text: chunk.text,
          validFrom: r.start_at.toISOString(), // when the fact becomes valid = the event time
          meta: chunk.meta,
          nextCursor: { since: r.updated_at.toISOString() },
        };
      }
    },
  };
}
