#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
// Leaf module: imports no provider or command graph.
import { VERSION } from "../src/version.js";

if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
  const { main } = await import("../src/cli.js");
  await main();
}
