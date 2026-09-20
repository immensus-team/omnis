// A4 §10.1 Drive: changes.getStartPageToken()으로 베이스라인 → changes.list(pageToken) 폴링.
// 웹훅(changes.watch)은 공인 HTTPS 엔드포인트를 요구하는데 미니는 tailnet 전용이라 못 쓴다.
import type { IngestDoc, IngestProvider } from "./run.js";

export type DriveFetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://www.googleapis.com/drive/v3";

/** v1은 export 변환이 필요 없는 것만 읽는다. Google Docs 네이티브 포맷은 files.export가
 *  필요하고 그건 별도 스코프·별도 실패 모드라 지금 붙이지 않는다. */
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
        // 첫 실행: 베이스라인만 잡고 끝. 과거 전체를 긁지 않는다.
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
          // A4 §10.5: 토큰 유실 → 베이스라인 재수립. 그 사이 변경은 포기한다.
          // 전체 재스캔은 하지 않는다 — 며칠치를 놓치는 비용보다 전체 재임베딩 비용이 크다.
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
          if (!DRIVE_TEXT_MIME.includes(file.mimeType)) continue; // 다운로드조차 하지 않는다

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
