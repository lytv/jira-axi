export type TokenSourceKind =
  | "env"
  | "keychain"
  | "file"
  | "acli-ref"
  | "jira-cli-ref";

export type Account = {
  id: string;
  baseUrl: string;
  email: string;
  tokenSource: { kind: TokenSourceKind; ref: string };
  default: boolean;
  cloudId?: string;
  deployment: "cloud";
  authScheme: "basic";
  defaultProject?: string;
  defaultBoardId?: string;
  importedFrom?: {
    tool: "acli" | "jira-cli";
    path: string;
    importedAt: string;
  };
};

type JiraResource = { id?: string; self?: string; [key: string]: unknown };
export type JiraIssue = JiraResource & {
  id: string;
  key: string;
  fields: Record<string, unknown>;
};
export type JiraProject = JiraResource & {
  id: string;
  key: string;
  name: string;
};
export type JiraBoard = JiraResource & {
  id: number;
  name: string;
  type?: string;
};
export type JiraSprint = JiraResource & {
  id: number;
  name: string;
  state?: string;
};
export type JiraUser = JiraResource & {
  accountId: string;
  displayName?: string;
  emailAddress?: string;
};
export type JiraComment = JiraResource & {
  id: string;
  body: unknown;
  author?: JiraUser;
};
export type JiraTransition = JiraResource & { id: string; name: string };
export type JiraWorklog = JiraResource & {
  id: string;
  timeSpentSeconds: number;
  comment?: unknown;
};
export type JiraLink = JiraResource & {
  id?: string;
  type: Record<string, unknown>;
};
export type JiraFieldMeta = JiraResource & {
  key?: string;
  name: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};
