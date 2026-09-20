// A4 §10.1 GitHub: ETag conditional request + If-None-Match. 304면 본문을 받지 않는다.
// rate-limit 헤더를 보고 리셋 시각까지 기다린다(GitHub 공식 권고).
import type { IngestDoc, IngestProvider } from "./run.js";

export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";

export class GithubRateLimitError extends Error {
  constructor(
    message: string,
    /** withRetry가 이 값을 보고 고정 백오프 대신 리셋 시각까지 잔다(Task 16). */
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "GithubRateLimitError";
  }
}

interface CommitRow {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string; date?: string } };
}

function rateLimitFrom(res: Response): GithubRateLimitError | null {
  if (res.status !== 403 && res.status !== 429) return null;
  if (res.headers.get("x-ratelimit-remaining") !== "0") return null;
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
  const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 - Date.now() : 60_000;
  return new GithubRateLimitError("github rate limit exhausted", Math.max(1000, waitMs));
}

export function createGithubProvider(opts: {
  fetch: GithubFetch;
  token: () => Promise<string>;
  repos: readonly string[];
}): IngestProvider {
  return {
    kind: "github",
    ref: "repos",
    async *list(ctx): AsyncIterable<IngestDoc> {
      if (opts.repos.length === 0) return; // allowlist가 비면 API를 호출조차 하지 않는다

      const cursorEtags =
        ctx.cursor.etags !== null && typeof ctx.cursor.etags === "object"
          ? ({ ...(ctx.cursor.etags as Record<string, string>) } as Record<string, string>)
          : {};
      const since = typeof ctx.cursor.since === "string" ? ctx.cursor.since : undefined;
      const token = await opts.token();

      for (const repo of opts.repos) {
        const url = `${API}/repos/${repo}/commits?per_page=50${since === undefined ? "" : `&since=${encodeURIComponent(since)}`}`;
        const etag = cursorEtags[repo];
        const res = await opts.fetch(url, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            ...(etag === undefined ? {} : { "if-none-match": etag }),
          },
        });

        const limited = rateLimitFrom(res);
        if (limited !== null) throw limited;
        if (res.status === 304) {
          ctx.logger.debug("github unchanged", { repo });
          continue; // 본문을 받지 않는다
        }
        if (!res.ok) throw new Error(`github commits failed for ${repo}: ${res.status}`);

        const newEtag = res.headers.get("etag");
        if (newEtag !== null) cursorEtags[repo] = newEtag;
        const commits = (await res.json()) as CommitRow[];

        for (const c of commits) {
          const date = c.commit.author?.date ?? new Date().toISOString();
          yield {
            source_ref: c.html_url,
            text: [
              `레포: ${repo}`,
              `커밋: ${c.sha}`,
              `작성자: ${c.commit.author?.name ?? "알 수 없음"}`,
              `시각: ${date}`,
              "",
              c.commit.message,
            ].join("\n"),
            // A4 §10.4 표: 커밋 시각이 valid_from이다.
            validFrom: date,
            meta: { repo, sha: c.sha },
            nextCursor: { etags: { ...cursorEtags }, ...(since === undefined ? {} : { since }) },
          };
        }

        if (commits.length === 0 && newEtag !== null) {
          // 커밋이 없어도 새 ETag는 남겨야 다음 폴링이 304를 받는다.
          yield {
            source_ref: "__github_etag__",
            text: null,
            validFrom: new Date().toISOString(),
            nextCursor: { etags: { ...cursorEtags }, ...(since === undefined ? {} : { since }) },
          };
        }
      }
    },
  };
}
