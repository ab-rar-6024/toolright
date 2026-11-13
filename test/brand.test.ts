import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { artRows, depthOf, renderBanner, renderTag, shouldShowBanner } from "../src/brand.js";

const ESC = String.fromCharCode(27);
const strip = (s: string) => s.split(ESC).map((p, i) => (i === 0 ? p : p.replace(/^\[[0-9;]*m/, ""))).join("");

describe("banner art", () => {
  it("spells TOOLRIGHT in five rows that fit an 80-column terminal", () => {
    const rows = artRows();
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(80);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1); // every row the same width
    expect(rows.join("")).toContain(String.fromCharCode(0x2588));
  });

  it("uses only ASCII plus the full block (safe for the legacy Windows console)", () => {
    const allowed = new Set([String.fromCharCode(0x2588), " "]);
    for (const ch of artRows().join("")) expect(allowed.has(ch)).toBe(true);
  });
});

describe("color depth", () => {
  const art = strip(renderBanner(1, "9.9.9"));

  it("depth 1 (no color) has no escape codes at all", () => {
    expect(renderBanner(1, "9.9.9")).not.toContain(ESC);
    expect(renderTag(1, "9.9.9")).not.toContain(ESC);
  });

  it("24-bit, 256 and 16-color output all contain codes and the same visible art", () => {
    for (const depth of [4, 8, 24]) {
      const b = renderBanner(depth, "9.9.9");
      expect(b).toContain(ESC);
      expect(strip(b)).toBe(art.replace("Does your agent pick the right tool?  v9.9.9", "Does your agent pick the right tool?  v9.9.9"));
    }
    expect(renderBanner(24, "1.2.3")).toMatch(/\[38;2;\d+;\d+;\d+m/);
    expect(renderBanner(8, "1.2.3")).toMatch(/\[38;5;\d+m/);
  });

  it("every colored line is reset so color can't leak into later output", () => {
    for (const depth of [4, 8, 24]) {
      for (const line of renderBanner(depth, "1").split("\n").filter((l) => l.includes(ESC))) {
        expect(line.endsWith(`${ESC}[0m`)).toBe(true);
      }
    }
  });

  it("shows the version and tagline", () => {
    expect(strip(renderBanner(24, "4.5.6"))).toContain("v4.5.6");
    expect(strip(renderBanner(24, "4.5.6"))).toContain("Does your agent pick the right tool?");
    expect(strip(renderTag(24, "4.5.6"))).toBe("toolright v4.5.6");
  });
});

describe("when the banner is allowed", () => {
  const tty = { isTTY: true, getColorDepth: () => 24 };
  it("only on an interactive terminal", () => {
    expect(shouldShowBanner(tty, {})).toBe(true);
    expect(shouldShowBanner({ isTTY: false }, {})).toBe(false);
    expect(shouldShowBanner({}, {})).toBe(false);
  });
  it("never in CI, and the user can opt out", () => {
    expect(shouldShowBanner(tty, { CI: "true" })).toBe(false);
    expect(shouldShowBanner(tty, { CI: "1" })).toBe(false);
    expect(shouldShowBanner(tty, { CI: "false" })).toBe(true);
    expect(shouldShowBanner(tty, { TOOLRIGHT_NO_BANNER: "1" })).toBe(false);
  });
  it("depthOf is 1 for non-terminals and survives a throwing stream", () => {
    expect(depthOf({ isTTY: false, getColorDepth: () => 24 }, {})).toBe(1);
    expect(depthOf(tty, {})).toBe(24);
    expect(depthOf({ isTTY: true, getColorDepth: () => { throw new Error("x"); } }, {})).toBe(1);
  });
});

describe("CLI output stays clean when not a terminal", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });

  it("--help, lint and --json contain no escape codes or block characters when piped, even with FORCE_COLOR", () => {
    for (const args of [["--help"], ["lint", "--tools", "fixtures/confusing-tools.json", "--fail-on", "none"], ["lint", "--tools", "fixtures/confusing-tools.json", "--json", "--fail-on", "none"]]) {
      const r = run(args, { FORCE_COLOR: "3" });
      expect(r.stdout + r.stderr).not.toContain(ESC);
      expect(r.stdout + r.stderr).not.toContain(String.fromCharCode(0x2588));
    }
  }, 60_000);

  it("--version prints only the version, matching package.json", () => {
    const r = run(["--version"]);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  it("--json output is parseable JSON", () => {
    const r = run(["lint", "--tools", "fixtures/confusing-tools.json", "--json", "--fail-on", "none"]);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe("help output has the tagline exactly once", () => {
  const TAGLINE = "Does your agent pick the right tool?";
  const count = (text: string) => text.split(TAGLINE).length - 1;

  async function helpFor(opts: { tty: boolean; depth?: number; sub?: boolean; env?: NodeJS.ProcessEnv }) {
    const { Command } = await import("commander");
    const { attachBranding } = await import("../src/brand.js");
    const program = new Command();
    program.name("toolright").description(TAGLINE).version("9.9.9");
    let out = "";
    let err = "";
    program.configureOutput({ writeOut: (s) => (out += s), writeErr: (s) => (err += s) });
    program.exitOverride();
    program.command("lint").description("Tier 1: instant checks"); // created after, so it inherits the capture
    const stream = (sink: (s: string) => void) => ({ isTTY: opts.tty, getColorDepth: () => opts.depth ?? 1, write: (s: string) => sink(s) });
    attachBranding(program, { version: "9.9.9", stdout: stream((s) => (out += s)), stderr: stream((s) => (err += s)), env: opts.env ?? {} });
    try {
      await program.parseAsync(["node", "toolright", ...(opts.sub ? ["lint", "--help"] : ["--help"])]);
    } catch {
      /* exitOverride throws after printing help */
    }
    return out + err;
  }

  it("on a terminal: banner shows the tagline once, and the description is not repeated", async () => {
    const text = await helpFor({ tty: true });
    expect(text).toContain(String.fromCharCode(0x2588)); // banner is there
    expect(count(text)).toBe(1);
    expect(text).toContain("Usage: toolright");
    expect(text).toContain("Commands:");
  });

  it("with color on, still exactly one tagline", async () => {
    expect(count(strip(await helpFor({ tty: true, depth: 24 })))).toBe(1);
  });

  it("not a terminal (pipe / CI / opt-out): no banner, and the description IS shown", async () => {
    for (const opts of [{ tty: false }, { tty: true, env: { CI: "true" } }, { tty: true, env: { TOOLRIGHT_NO_BANNER: "1" } }]) {
      const text = await helpFor(opts);
      expect(text).not.toContain(String.fromCharCode(0x2588));
      expect(count(text)).toBe(1);
    }
  });

  it("a subcommand keeps its own description when the banner is shown", async () => {
    const text = await helpFor({ tty: true, sub: true });
    expect(text).toContain("Tier 1: instant checks");
    expect(text).toContain(String.fromCharCode(0x2588));
  });
});
