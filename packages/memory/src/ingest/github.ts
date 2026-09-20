// A4 §10.1 GitHub: ETag conditional request + If-None-Match. On a 304 the body is not fetched.
// Read the rate-limit headers and wait until the reset time (GitHub's official recommendation).
import type { IngestDoc, IngestProvider } from "./run.js";

export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";

export class GithubRateLimitError extends Error {
  constructor(
    message: string,
    /** withRetry reads this value and sleeps until the reset time instead of a fixed backoff (Task 16). */
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
      if (opts.repos.length === 0) return; // an empty allowlist means the API is not even called

      const cursorEtags =
        ctx.cursor.etags !== null && typeof ctx.cursor.etags === "object"
          ? ({ ...(ctx.cursor.etags as Record<string, string>) } as Record<string, string>)
          : {};
      // since advances per repo — with a single shared value, a busy repo would skip over a quiet
      // repo's commits. The old cursor's flat since is used only as the default for repos not yet in sinces.
      const sinces =
        ctx.cursor.sinces !== null && typeof ctx.cursor.sinces === "object"
          ? ({ ...(ctx.cursor.sinces as Record<string, string>) } as Record<string, string>)
          : {};
      const legacySince = typeof ctx.cursor.since === "string" ? ctx.cursor.since : undefined;
      const token = await opts.token();
      const cursorNow = (): Record<string, unknown> => ({
        etags: { ...cursorEtags },
        sinces: { ...sinces },
        ...(legacySince === undefined ? {} : { since: legacySince }),
      });

      for (const repo of opts.repos) {
        const since = sinces[repo] ?? legacySince;
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
          continue; // the body is not fetched
        }
        if (!res.ok) throw new Error(`github commits failed for ${repo}: ${res.status}`);

        const newEtag = res.headers.get("etag");
        if (newEtag !== null) cursorEtags[repo] = newEtag;
        const commits = (await res.json()) as CommitRow[];

        // Advance to the newest commit time so the next poll does not re-extract commits already stored.
        // The moment the ETag changes, a 200 hands back all per_page=50 commits, so without this a busy
        // repo re-runs T1 extraction over 50 chunks on every poll (upsertMemory only dedupes rows).
        const newest = commits.reduce<string | undefined>((max, c) => {
          const d = c.commit.author?.date;
          return d !== undefined && (max === undefined || d > max) ? d : max;
        }, undefined);
        if (newest !== undefined) sinces[repo] = newest;

        for (const c of commits) {
          const date = c.commit.author?.date ?? new Date().toISOString();
          yield {
            source_ref: c.html_url,
            text: [
              `repo: ${repo}`,
              `commit: ${c.sha}`,
              `author: ${c.commit.author?.name ?? "unknown"}`,
              `time: ${date}`,
              "",
              c.commit.message,
            ].join("\n"),
            // A4 §10.4 table: the commit time is valid_from.
            validFrom: date,
            meta: { repo, sha: c.sha },
            nextCursor: cursorNow(),
          };
        }

        if (commits.length === 0 && newEtag !== null) {
          // Even with no commits, the new ETag must be kept so the next poll gets a 304.
          yield {
            source_ref: "__github_etag__",
            text: null,
            validFrom: new Date().toISOString(),
            nextCursor: cursorNow(),
          };
        }
      }
    },
  };
}
