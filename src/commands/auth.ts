import { AxiError } from "axi-sdk-js";
import { readAccounts, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import { render } from "../render.js";
import type { Account } from "../types.js";

export type AuthReport = {
  account: string;
  status: "connected" | "expired" | "unreachable";
  detail?: string;
};
type ClientFactory = (
  account: Account,
  token: string,
) => Pick<JiraClient, "rest">;

export async function authReports(
  accounts: Account[],
  createClient: ClientFactory = (account, token) =>
    new JiraClient(account, token),
): Promise<AuthReport[]> {
  return Promise.all(
    accounts.map(async (account) => {
      try {
        const token = await tokenForAccount(account);
        await createClient(account, token).rest("/myself");
        return { account: account.id, status: "connected" as const };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          account: account.id,
          status: /401|rejected|unauthorized/i.test(message)
            ? ("expired" as const)
            : ("unreachable" as const),
          detail: message,
        };
      }
    }),
  );
}

export async function authCommand(args: string[]): Promise<string> {
  const json = args.includes("--json");
  if (args.some((arg) => arg !== "--json"))
    throw new AxiError("auth accepts only --json", "VALIDATION_ERROR", [
      "Run `jra-axi auth --json`",
    ]);
  const reports = await authReports(await readAccounts());
  return render({ auth: reports }, json);
}
