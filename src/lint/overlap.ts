import type { ToolInfo } from "../mcp/connect.js";
import { tokenize } from "../util.js";
import type { Finding } from "./structure.js";

export interface Pair {
  a: string;
  b: string;
  score: number;
  /** true if either description names the other tool or says "instead"/"not for" */
  disambiguated: boolean;
}

export type SimilarityMethod = "lexical" | "embeddings";

export const DEFAULT_THRESHOLD: Record<SimilarityMethod, number> = {
  lexical: 0.45,
  embeddings: 0.6,
};

function docTokens(t: ToolInfo): string[] {
  // name tokens count twice: names carry most of the intent for terse descriptions
  const name = tokenize(t.name);
  return [...name, ...name, ...tokenize(t.description ?? "")];
}
// NB: uses raw counts then log-scales, so a name token (x2) + one description mention = 3.

/**
 * Cosine similarity of sublinear term-frequency vectors over name + description words.
 * Pure local computation, no downloads. This is a heuristic: it finds tools that share
 * vocabulary, not tools a model will actually confuse (that is what `eval` measures).
 *
 * No IDF on purpose: with a handful of tools IDF down-weights the shared noun
 * ("issue" in search_issues / list_issues), which is exactly the signal we want.
 * On bigger servers, words that appear in over half the tools are ignored instead.
 */
export function lexicalSimilarity(tools: ToolInfo[]): number[][] {
  const docs = tools.map(docTokens);
  const n = docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const ubiquitous = (w: string) => n >= 8 && (df.get(w) ?? 0) / n > 0.5;

  const vecs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) if (!ubiquitous(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [w, c] of tf) {
      const weight = 1 + Math.log(c);
      v.set(w, weight);
      norm += weight * weight;
    }
    return { v, norm: Math.sqrt(norm) };
  });

  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    sim[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = vecs[i]!;
      const b = vecs[j]!;
      let dot = 0;
      for (const [w, x] of a.v) {
        const y = b.v.get(w);
        if (y) dot += x * y;
      }
      const s = a.norm && b.norm ? dot / (a.norm * b.norm) : 0;
      sim[i]![j] = s;
      sim[j]![i] = s;
    }
  }
  return sim;
}

/**
 * Embedding cosine similarity using a small local model (all-MiniLM-L6-v2) via
 * @huggingface/transformers. The package is an optional dependency; the model
 * (~25 MB) is downloaded from Hugging Face on first use and cached locally.
 */
export async function embeddingSimilarity(tools: ToolInfo[]): Promise<number[][]> {
  let mod: any;
  try {
    const name = "@huggingface/transformers";
    mod = await import(name);
  } catch {
    throw new Error(
      "Embeddings need the optional package @huggingface/transformers. Install it with: npm i @huggingface/transformers",
    );
  }
  const extractor = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const texts = tools.map((t) => `${t.name.replace(/[_-]+/g, " ")}: ${t.description}`);
  const vectors: number[][] = [];
  for (const text of texts) {
    const out = await extractor(text, { pooling: "mean", normalize: true });
    vectors.push(Array.from(out.data as Float32Array));
  }
  const n = tools.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let dot = 0;
      for (let k = 0; k < vectors[i]!.length; k++) dot += vectors[i]![k]! * vectors[j]![k]!;
      sim[i]![j] = dot;
      sim[j]![i] = dot;
    }
  }
  return sim;
}

function mentions(desc: string | undefined, other: ToolInfo): boolean {
  const d = (desc ?? "").toLowerCase();
  return d.includes(other.name.toLowerCase());
}

const DISAMBIG_RE = /\b(instead|not for|do not use|don't use|rather than|unlike|as opposed to)\b/i;

export function confusablePairs(tools: ToolInfo[], sim: number[][], threshold: number): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const score = sim[i]![j]!;
      if (score < threshold) continue;
      const a = tools[i]!;
      const b = tools[j]!;
      const disambiguated =
        mentions(a.description, b) ||
        mentions(b.description, a) ||
        (DISAMBIG_RE.test(a.description) && DISAMBIG_RE.test(b.description));
      pairs.push({ a: a.name, b: b.name, score, disambiguated });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

export function pairFindings(pairs: Pair[]): Finding[] {
  return pairs.map((p) => ({
    rule: "confusable-pair",
    severity: p.disambiguated ? "info" : "warn",
    tools: [p.a, p.b],
    message: p.disambiguated
      ? `${p.a} and ${p.b} look similar (${Math.round(p.score * 100)}%), but at least one description points at the other.`
      : `${p.a} and ${p.b} look similar (${Math.round(p.score * 100)}%) and nothing tells the agent when to use which. Likely source of wrong picks.`,
  }));
}

/** tool name -> names of the tools it is confusable with. A Map, so odd tool names can't hit Object.prototype. */
export function siblingMap(pairs: Pair[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of pairs) {
    m.set(p.a, [...(m.get(p.a) ?? []), p.b]);
    m.set(p.b, [...(m.get(p.b) ?? []), p.a]);
  }
  return m;
}
