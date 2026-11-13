import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("versions stay in lockstep", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("src/version.ts reads package.json", () => {
    expect(VERSION).toBe(JSON.parse(read("package.json")).version);
  });

  it("the Python launcher pins the same version as the npm package", () => {
    const npm = JSON.parse(read("package.json")).version as string;
    const pyproject = /^version = "([^"]+)"/m.exec(read("python/pyproject.toml"))![1];
    const launcher = /^__version__ = "([^"]+)"/m.exec(read("python/src/toolright/__init__.py"))![1];
    expect(pyproject).toBe(npm);
    expect(launcher).toBe(npm);
  });

  it("the README status line names the current version", () => {
    expect(read("README.md")).toContain(`Status: v${VERSION}`);
  });
});
