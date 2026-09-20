// A4 §10.1 Drive: baseline via changes.getStartPageToken() → poll changes.list(pageToken).
// Webhooks (changes.watch) require a public HTTPS endpoint, and the mini is tailnet-only, so they are out.
import type { IngestDoc, IngestProvider } from "./run.js";

export type DriveFetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com/drive/v3";

/** v1 reads only what needs no export conversion. Google Docs native formats need files.export,
 *  which is a separate scope and a separate failure mode, so we do not add it now. */
export const DRIVE_TEXT_MIME: readonly string[] = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
];

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  trashed?: boolean;
  parents?: string[];
}
interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}
interface ChangesPage {
  changes?: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export function createDriveProvider(opts: {
  fetch: DriveFetch;
  accessToken: () => Promise<string>;
  folderIds?: readonly string[];
}): IngestProvider {
  const auth = async (): Promise<Record<string, string>> => ({
    authorization: `Bearer ${await opts.accessToken()}`,
  });

  const baseline = async (): Promise<string> => {
    const res = await opts.fetch(`${API}/changes/startPageToken`, { headers: await auth() });
    if (!res.ok) throw new Error(`drive startPageToken failed: ${res.status}`);
    return ((await res.json()) as { startPageToken: string }).startPageToken;
  };

  return {
    kind: "drive",
    ref: "changes",
    async *list(ctx): AsyncIterable<IngestDoc> {
      const pageToken = typeof ctx.cursor.pageToken === "string" ? ctx.cursor.pageToken : null;
      if (pageToken === null) {
        // First run: capture the baseline only and stop. Do not scrape the whole past.
        const token = await baseline();
        ctx.logger.info("drive baseline established", { pageToken: token });
        yield {
          source_ref: "__drive_baseline__",
          text: null,
          deleted: false,
          validFrom: new Date().toISOString(),
          nextCursor: { pageToken: token },
        };
        return;
      }

      let cursorToken = pageToken;
      for (;;) {
        const url = `${API}/changes?pageToken=${encodeURIComponent(cursorToken)}&includeRemoved=true&restrictToMyDrive=true&fields=changes(fileId,removed,file(id,name,mimeType,modifiedTime,trashed,parents)),nextPageToken,newStartPageToken`;
        const res = await opts.fetch(url, { headers: await auth() });

        if (res.status === 404 || res.status === 410) {
          // A4 §10.5: token lost → re-establish the baseline. Changes in between are given up.
          // No full rescan — a full re-embedding costs more than missing a few days.
          const token = await baseline();
          ctx.logger.warn("drive pageToken expired, re-baselined", { pageToken: token });
          yield {
            source_ref: "__drive_baseline__",
            text: null,
            deleted: false,
            validFrom: new Date().toISOString(),
            nextCursor: { pageToken: token },
          };
          return;
        }
        if (!res.ok) throw new Error(`drive changes.list failed: ${res.status}`);

        const page = (await res.json()) as ChangesPage;
        const next = page.nextPageToken ?? page.newStartPageToken ?? cursorToken;

        for (const change of page.changes ?? []) {
          const file = change.file;
          if (change.removed === true || file === undefined || file.trashed === true) {
            yield {
              source_ref: change.fileId,
              text: null,
              deleted: true,
              validFrom: new Date().toISOString(),
              nextCursor: { pageToken: next },
            };
            continue;
          }
          if (opts.folderIds !== undefined && opts.folderIds.length > 0) {
            const parents = file.parents ?? [];
            if (!parents.some((p) => opts.folderIds?.includes(p))) continue;
          }
          if (!DRIVE_TEXT_MIME.includes(file.mimeType)) continue; // not even downloaded

          const body = await opts.fetch(`${API}/files/${file.id}?alt=media`, {
            headers: await auth(),
          });
          if (!body.ok) {
            ctx.logger.debug("drive download skipped", { fileId: file.id, status: body.status });
            continue;
          }
          yield {
            source_ref: file.id,
            text: await body.text(),
            validFrom: file.modifiedTime,
            meta: { name: file.name, mimeType: file.mimeType },
            nextCursor: { pageToken: next },
          };
        }

        if (page.nextPageToken === undefined) break;
        cursorToken = page.nextPageToken;
      }
    },
  };
}
