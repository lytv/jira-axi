import { AxiError } from "axi-sdk-js";
import type { Account, JiraIssue } from "./types.js";

export type FetchLike = typeof fetch;
type ApiKind = "rest" | "agile";
type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  api?: ApiKind;
};

export class JiraClientError extends AxiError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, "JIRA_ERROR", suggestions);
  }
}

export class JiraClient {
  readonly account: Account;
  private readonly token: string;
  private readonly fetcher: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    account: Account,
    token: string,
    options: {
      fetcher?: FetchLike;
      sleep?: (milliseconds: number) => Promise<void>;
    } = {},
  ) {
    const accountUrl = new URL(account.baseUrl);
    const host = accountUrl.hostname;
    if (accountUrl.protocol !== "https:" || !host.endsWith(".atlassian.net")) {
      throw new JiraClientError(
        "Jira Cloud v1 requires a *.atlassian.net site",
        ["Use a Jira Cloud account URL"],
      );
    }
    this.account = account;
    this.token = token;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  rest(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request(path, { ...options, api: "rest" });
  }
  agile(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request(path, { ...options, api: "agile" });
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const api = options.api ?? "rest";
    let scoped = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.fetcher(
        this.url(path, api, scoped, options.query),
        {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${Buffer.from(`${this.account.email}:${this.token}`).toString("base64")}`,
            ...(options.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        },
      );
      if (response.status === 401 && !scoped && this.account.cloudId) {
        scoped = true;
        continue;
      }
      if (response.status === 401 && !scoped && !this.account.cloudId) {
        throw new JiraClientError(
          "Jira rejected this token. It may be a scoped token with missing cloudId",
          ["Set cloudId on this account, then retry"],
        );
      }
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.sleep(
          Math.min(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 500 * 2 ** attempt,
            10_000,
          ),
        );
        continue;
      }
      if (response.status === 429)
        throw new JiraClientError(`Jira rate limited ${path}`, [
          "Wait and retry this command",
        ]);
      if (!response.ok) throw await this.errorFor(response, path);
      if (response.status === 204) return undefined;
      return response.json();
    }
    throw new JiraClientError(`Jira request failed for ${path}`);
  }

  async searchJql(
    jql: string,
    fields: string[],
    maxResults = 50,
    limit?: number,
  ): Promise<{ issues: JiraIssue[]; nextPageToken?: string }> {
    if (fields.length === 0)
      throw new JiraClientError("Jira search requires at least one field");
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const remaining = limit === undefined ? maxResults : limit - issues.length;
      const page = (await this.rest("/search/jql", {
        method: "POST",
        body: {
          jql,
          fields,
          maxResults: Math.min(maxResults, remaining),
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      })) as { issues?: JiraIssue[]; nextPageToken?: string };
      issues.push(...(page.issues ?? []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken && (limit === undefined || issues.length < limit));
    return {
      issues: limit === undefined ? issues : issues.slice(0, limit),
      ...(nextPageToken ? { nextPageToken } : {}),
    };
  }

  async approximateSearchCount(jql: string): Promise<number | undefined> {
    const result = (await this.rest("/search/approximate-count", {
      method: "POST",
      body: { jql },
    })) as { count?: number };
    return result.count;
  }

  async listClassic<T>(
    path: string,
    api: ApiKind = "rest",
    maxResults = 50,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    if (api === "rest" && path !== "/project") {
      throw new JiraClientError(
        "Classic pagination is only valid for /project and Agile list endpoints",
      );
    }
    const values: T[] = [];
    for (let startAt = 0; ; startAt += maxResults) {
      const page = (await this.request(path, {
        api,
        query: { ...query, startAt, maxResults },
      })) as { values?: T[]; isLast?: boolean; total?: number };
      const pageValues = page.values ?? [];
      values.push(...pageValues);
      if (
        page.isLast ||
        (page.total !== undefined && values.length >= page.total) ||
        (page.total === undefined && pageValues.length < maxResults)
      )
        return values;
    }
  }

  private url(
    path: string,
    api: ApiKind,
    scoped: boolean,
    query?: RequestOptions["query"],
  ): string {
    const root = scoped
      ? `https://api.atlassian.com/ex/jira/${this.account.cloudId}`
      : this.account.baseUrl.replace(/\/$/, "");
    const prefix = api === "rest" ? "/rest/api/3" : "/rest/agile/1.0";
    const url = new URL(`${root}${prefix}${path}`);
    for (const [key, value] of Object.entries(query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    return url.toString();
  }

  private async errorFor(
    response: Response,
    path: string,
  ): Promise<JiraClientError> {
    let payload: { errorMessages?: unknown; errors?: Record<string, unknown> } =
      {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      /* Jira did not return JSON. */
    }
    const messages = [
      ...(Array.isArray(payload.errorMessages)
        ? payload.errorMessages.filter(
            (message): message is string => typeof message === "string",
          )
        : []),
      ...Object.entries(payload.errors ?? {}).map(
        ([field, message]) => `${field}: ${String(message)}`,
      ),
    ];
    const detail = messages[0] ?? `HTTP ${response.status}`;
    return new JiraClientError(`Jira request failed for ${path}: ${detail}`, [
      "Check the account, permissions, and request fields",
    ]);
  }
}
