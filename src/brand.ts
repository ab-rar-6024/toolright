import type { Command } from "commander";

/**
 * Terminal branding: a block-letter TOOLRIGHT banner with a color gradient.
 *
 * Only ever shown on an interactive terminal (never in pipes, --json output or CI logs), and
 * the color adapts to what the terminal supports. Uses only the full-block character, which
 * exists in the legacy Windows console code page as well as in modern terminals.
 */

export const BRAND = "TOOLRIGHT";
export const TAGLINE = "Does your agent pick the right tool?";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const BLOCK = String.fromCharCode(0x2588);

// 5-row block font; '#' becomes a full block.
const FONT: Record<string, string[]> = {
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  I: ["###", " # ", " # ", " # ", "###"],
  G: [" ####", "#    ", "#  ##", "#   #", " ### "],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
};

/** The five rows of the banner art, with no color. */
export function artRows(): string[] {
  const rows = ["", "", "", "", ""];
  for (const [i, letter] of [...BRAND].entries()) {
    const glyph = FONT[letter];
    if (!glyph) throw new Error(`no glyph for ${letter}`);
    for (let r = 0; r < 5; r++) rows[r] += (i === 0 ? "" : " ") + glyph[r]!.replace(/#/g, BLOCK);
  }
  return rows;
}

type RGB = [number, number, number];
const START: RGB = [34, 211, 238]; // cyan
const END: RGB = [192, 132, 252]; // violet

function lerp(t: number): RGB {
  return [0, 1, 2].map((k) => Math.round(START[k]! + (END[k]! - START[k]!) * t)) as RGB;
}

function to256([r, g, b]: RGB): number {
  const q = (v: number) => Math.round(v / 51);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

/** SGR color prefix for a gradient position t in [0,1], or "" when the terminal has no color. */
function colorCode(t: number, depth: number): string {
  if (depth >= 24) {
    const [r, g, b] = lerp(t);
    return `${ESC}[38;2;${r};${g};${b}m`;
  }
  if (depth >= 8) return `${ESC}[38;5;${to256(lerp(t))}m`;
  if (depth >= 4) return `${ESC}[${t < 0.34 ? 96 : t < 0.67 ? 94 : 95}m`;
  return "";
}

/**
 * The banner. `depth` is the terminal color depth (1 = no color, 4, 8, 24 bits).
 * With depth 1 the output has no escape codes at all.
 */
export function renderBanner(depth: number, version: string): string {
  const rows = artRows();
  const width = rows[0]!.length;
  const lines = rows.map((row) => {
    if (depth < 4) return row;
    let out = "";
    let last = "";
    [...row].forEach((ch, c) => {
      if (ch === " ") {
        out += ch;
        return;
      }
      const code = colorCode(width > 1 ? c / (width - 1) : 0, depth);
      if (code !== last) {
        out += code;
        last = code;
      }
      out += ch;
    });
    return out + RESET;
  });
  const tag = depth >= 4 ? `${DIM}${TAGLINE}${RESET}  ${DIM}v${version}${RESET}` : `${TAGLINE}  v${version}`;
  return `\n${lines.join("\n")}\n\n${tag}\n`;
}

/** One-line brand tag shown before ordinary commands. */
export function renderTag(depth: number, version: string): string {
  if (depth < 4) return `toolright v${version}`;
  const word = [...BRAND.toLowerCase()]
    .map((ch, i, a) => `${colorCode(a.length > 1 ? i / (a.length - 1) : 0, depth)}${ch}`)
    .join("");
  return `${BOLD}${word}${RESET} ${DIM}v${version}${RESET}`;
}

export interface StreamLike {
  isTTY?: boolean;
  getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
  write?: (chunk: string) => unknown;
}

/** Banner only on an interactive terminal, and never in CI or when the user opts out. */
export function shouldShowBanner(stream: StreamLike, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!stream.isTTY) return false;
  if (env.TOOLRIGHT_NO_BANNER) return false;
  if (env.CI && env.CI !== "0" && env.CI.toLowerCase() !== "false") return false;
  return true;
}

/** Color depth of a stream (1 when it isn't a color-capable terminal). Honors NO_COLOR and FORCE_COLOR. */
export function depthOf(stream: StreamLike, env: NodeJS.ProcessEnv = process.env): number {
  if (!stream.isTTY || typeof stream.getColorDepth !== "function") return 1;
  try {
    return stream.getColorDepth(env);
  } catch {
    return 1;
  }
}

export interface BrandingOptions {
  version: string;
  /** injectable for tests; default to the real process streams */
  stdout?: StreamLike;
  stderr?: StreamLike;
  env?: NodeJS.ProcessEnv;
}

/**
 * Wire the branding into a commander program:
 *  - the full banner above help output (on whichever stream help is written to), and
 *  - a one-line tag before each command, on stderr, skipped for --json.
 * When the banner is shown it already carries the tagline, so the root command's own
 * description is dropped from help to avoid printing the same sentence twice. Subcommand
 * descriptions are unaffected, and without a banner (pipes, CI) the description stays.
 */
export function attachBranding(program: Command, o: BrandingOptions): void {
  const out: StreamLike = o.stdout ?? process.stdout;
  const err: StreamLike = o.stderr ?? process.stderr;
  const env = o.env ?? process.env;
  let bannerShown = false;

  program.addHelpText("beforeAll", (ctx) => {
    const stream = ctx.error ? err : out;
    bannerShown = shouldShowBanner(stream, env);
    return bannerShown ? renderBanner(depthOf(stream, env), o.version) : "";
  });

  program.configureHelp({
    commandDescription: (cmd) => (cmd === program && bannerShown ? "" : cmd.description()),
  });

  program.hook("preAction", (_command, action) => {
    if (action.opts().json || !shouldShowBanner(err, env)) return;
    err.write?.(`${renderTag(depthOf(err, env), o.version)}
`);
  });
}
