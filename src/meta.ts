import type { JiraClient } from "./client.js";
import type { JiraFieldMeta } from "./types.js";

export type JiraIssueTypeMeta = {
  id: string;
  name: string;
  [key: string]: unknown;
};

export async function issueTypesForCreate(
  client: JiraClient,
  projectIdOrKey: string,
): Promise<JiraIssueTypeMeta[]> {
  const result = (await client.rest(
    `/issue/createmeta/${encodeURIComponent(projectIdOrKey)}/issuetypes`,
  )) as { issueTypes?: JiraIssueTypeMeta[] };
  return result.issueTypes ?? [];
}

export async function fieldsForIssueTypeCreate(
  client: JiraClient,
  projectIdOrKey: string,
  issueTypeId: string,
): Promise<JiraFieldMeta[]> {
  const result = (await client.rest(
    `/issue/createmeta/${encodeURIComponent(projectIdOrKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
  )) as { fields?: JiraFieldMeta[] };
  return result.fields ?? [];
}
