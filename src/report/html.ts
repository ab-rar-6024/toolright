import type { EvalResult } from "../eval/run.js";
import { confusions, perTool, summarize } from "../eval/run.js";
import type { TestPrompt } from "../gen/prompts.js";
import { pct } from "../util.js";
import type { TuneResult } from "../tune/index.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateHtmlReport(
  title: string,
  data: { evalResults?: EvalResult[]; tuneResult?: TuneResult; prompts?: TestPrompt[] },
): string {
  const { evalResults, tuneResult, prompts } = data;

  let bodyHtml = "";

  if (evalResults && evalResults.length > 0) {
    bodyHtml += `
      <section class="card">
        <h2>Evaluation Overview</h2>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Accuracy</th>
              <th>Correct / Total</th>
              <th>95% Confidence Interval</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            ${evalResults
              .map((r) => {
                const s = summarize(r.items);
                return `
                <tr>
                  <td><strong>${escapeHtml(r.model)}</strong></td>
                  <td><span class="badge ${s.accuracy >= 0.8 ? "badge-success" : s.accuracy >= 0.6 ? "badge-warn" : "badge-danger"}">${pct(s.accuracy)}</span></td>
                  <td>${s.correct} / ${s.n}</td>
                  <td>${pct(s.ci[0])} - ${pct(s.ci[1])}</td>
                  <td>${s.errors}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </section>
    `;

    for (const r of evalResults) {
      const toolStats = Object.entries(perTool(r.items)).sort((a, b) => a[1].accuracy - b[1].accuracy);
      const confs = confusions(r.items).slice(0, 8);

      bodyHtml += `
        <section class="card">
          <h3>Model: ${escapeHtml(r.model)}</h3>
          <h4>Per-Tool Accuracy</h4>
          <table>
            <thead>
              <tr><th>Tool</th><th>Accuracy</th><th>Fraction</th></tr>
            </thead>
            <tbody>
              ${toolStats
                .map(([name, s]) => `
                <tr>
                  <td><code>${escapeHtml(name)}</code></td>
                  <td><div class="progress-bar"><div class="fill" style="width: ${Math.round(s.accuracy * 100)}%"></div><span>${pct(s.accuracy)}</span></div></td>
                  <td>${s.correct} / ${s.n}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          ${confs.length > 0 ? `
            <h4>Top Confusable Wrong Picks</h4>
            <ul>
              ${confs.map((c) => `<li>Expected <code>${escapeHtml(c.expected)}</code>, picked <code>${escapeHtml(c.picked ?? "(none)")}</code> (${c.count}x)</li>`).join("")}
            </ul>
          ` : ""}
        </section>
      `;
    }
  }

  if (tuneResult) {
    const accepted = tuneResult.rewrites.filter((r) => r.accepted);
    const rejected = tuneResult.rewrites.filter((r) => !r.accepted);

    bodyHtml += `
      <section class="card">
        <h2>Tuning & Rewrite Results</h2>
        <p><strong>Prompts:</strong> ${tuneResult.counts.train} train / ${tuneResult.counts.validate} validate / ${tuneResult.counts.test} test</p>
        <p><strong>Rewrites:</strong> ${accepted.length} accepted, ${rejected.length} rejected</p>

        <h3>Accepted Rewrites</h3>
        ${accepted.length === 0 ? "<p>No rewrites met the strict validation gain criteria without regressions.</p>" : `
          <div class="diff-container">
            ${accepted.map((r) => `
              <div class="diff-card">
                <h4>Tool: <code>${escapeHtml(r.tool)}</code></h4>
                <div class="before-after">
                  <div class="before">
                    <h5>Before</h5>
                    <p>${escapeHtml(r.before)}</p>
                  </div>
                  <div class="after">
                    <h5>After (Accepted)</h5>
                    <p>${escapeHtml(r.after)}</p>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        `}

        <h3>Rejected Candidates</h3>
        <ul>
          ${rejected.map((r) => `<li><code>${escapeHtml(r.tool)}</code>: ${escapeHtml(r.reason)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Toolright Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --success: #238636;
      --warn: #d29922;
      --danger: #f85149;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5 { color: var(--heading); margin-top: 0; }
    header { border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 2rem; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid var(--border); }
    th { color: var(--heading); }
    code { background: rgba(110,118,129,0.4); padding: 0.2em 0.4em; border-radius: 4px; font-size: 85%; }
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
    .badge-success { background: var(--success); color: #fff; }
    .badge-warn { background: var(--warn); color: #000; }
    .badge-danger { background: var(--danger); color: #fff; }
    .progress-bar { background: #21262d; border-radius: 4px; height: 18px; position: relative; overflow: hidden; display: flex; align-items: center; }
    .progress-bar .fill { background: var(--accent); height: 100%; }
    .progress-bar span { position: absolute; right: 8px; font-size: 11px; font-weight: bold; color: #fff; }
    .diff-container { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
    .diff-card { border: 1px solid var(--border); border-radius: 6px; padding: 1rem; background: #0d1117; }
    .before-after { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .before, .after { padding: 0.75rem; border-radius: 4px; }
    .before { background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.4); }
    .after { background: rgba(35, 134, 54, 0.1); border: 1px solid rgba(35, 134, 54, 0.4); }
  </style>
</head>
<body>
  <header>
    <h1>🎯 Toolright Report: ${escapeHtml(title)}</h1>
    <p>Automated tool description evaluation and tuning report.</p>
  </header>
  ${bodyHtml}
</body>
</html>`;
}
