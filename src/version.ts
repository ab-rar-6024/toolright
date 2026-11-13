import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Single source of truth for the version: package.json (works from src/ and from dist/). */
export const VERSION: string = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
