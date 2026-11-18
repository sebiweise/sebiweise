#!/usr/bin/env node
// Generates the terminal-style SVGs for the profile README.
//
//   GH_TOKEN=... node scripts/generate.mjs               # live data from the GitHub API
//   node scripts/generate.mjs --fixture data.json        # offline, from a saved API response
//
// No dependencies: Node 20+ (global fetch) is all it needs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
const LOGIN = process.env.GH_LOGIN || "sebiweise";

// ---------------------------------------------------------------------------
// Profile text for `whoami` – edit here, the workflow regenerates the SVG.
// ---------------------------------------------------------------------------
const PROFILE = [
  ["role", "DevOps Specialist @ KEOZ GmbH"],
  ["side", "Developer @ Implet"],
  ["focus", "CI/CD · automation · self-hosting"],
  ["stack", "TypeScript · Next.js · Python · Linux"],
  ["ci", "GitHub Actions, all day"],
  ["volunteer", "Freiwillige Feuerwehr Langenfeld"],
  ["web", "goscinski.dev"],
];

// Pixel logo drawn as contribution cells ("#" = filled). Rects instead of
// box-drawing characters, so it looks the same regardless of installed fonts.
const LOGO = [
  ".####..###.",
  "#.....#...#",
  "#.....#....",
  ".###..#.###",
  "....#.#...#",
  "....#.#...#",
  "####...###.",
];

// ---------------------------------------------------------------------------
// Theme (GitHub dark)
// ---------------------------------------------------------------------------
const C = {
  bg: "#0d1117",
  panel: "#161b22",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#39d353",
  prompt: "#58a6ff",
  levels: {
    NONE: "#161b22",
    FIRST_QUARTILE: "#0e4429",
    SECOND_QUARTILE: "#006d32",
    THIRD_QUARTILE: "#26a641",
    FOURTH_QUARTILE: "#39d353",
  },
};
const FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const W = 900;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const QUERY = `
query($login: String!) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) { totalCount }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount contributionLevel }
        }
      }
    }
  }
}`;

async function loadData() {
  const i = process.argv.indexOf("--fixture");
  if (i !== -1) return JSON.parse(await readFile(process.argv[i + 1], "utf8"));

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set GH_TOKEN (or pass --fixture <file>).");

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": LOGIN },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

function computeStats(data) {
  const cal = data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks;
  const days = weeks.flatMap((w) => w.contributionDays);

  // Longest streak
  let longest = { len: 0, start: null, end: null };
  let run = { len: 0, start: null };
  for (const d of days) {
    if (d.contributionCount > 0) {
      if (run.len === 0) run.start = d.date;
      run.len++;
      if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date };
    } else run = { len: 0, start: null };
  }

  // Current streak: today may still be empty without breaking it
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let current = { len: 0, start: null, end: i >= 0 ? days[i].date : null };
  while (i >= 0 && days[i].contributionCount > 0) {
    current.len++;
    current.start = days[i].date;
    i--;
  }
  if (current.len === 0) current.end = null;

  const active = days.filter((d) => d.contributionCount > 0).length;
  const best = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);

  const months = new Map();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    months.set(k, (months.get(k) ?? 0) + d.contributionCount);
  }
  const monthly = [...months.entries()].slice(-12).map(([k, v]) => ({ key: k, value: v }));

  const years = (Date.now() - new Date(data.user.createdAt)) / (365.25 * 864e5);

  return {
    weeks,
    total: cal.totalContributions,
    days: days.length,
    active,
    best,
    avg: active ? cal.totalContributions / active : 0,
    current,
    longest,
    monthly,
    years: Math.floor(years),
    followers: data.user.followers.totalCount,
    repos: data.user.repositories.totalCount,
  };
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => (iso ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : "–");

function window({ height, title, command, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(command)}">
<title>${esc(`${LOGIN}@github ~ $ ${command}`)}</title>
<style>
  text { font-family: ${FONT}; fill: ${C.text}; }
  .muted { fill: ${C.muted}; }
  .accent { fill: ${C.accent}; }
  .prompt { fill: ${C.prompt}; }
  .cursor { animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .cursor { animation: none; } }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<path d="M0.5 32 H${W - 0.5}" stroke="${C.border}"/>
<circle cx="20" cy="16" r="5.5" fill="#ff5f57"/><circle cx="38" cy="16" r="5.5" fill="#febc2e"/><circle cx="56" cy="16" r="5.5" fill="#28c840"/>
<text x="${W / 2}" y="20.5" text-anchor="middle" font-size="11" class="muted">${esc(title)}</text>
<text x="24" y="60" font-size="14"><tspan class="accent">${LOGIN}@github</tspan><tspan class="muted"> ~ </tspan><tspan class="prompt">$</tspan> ${esc(command)}</text>
${body}
</svg>
`;
}

// ---------------------------------------------------------------------------
// 1) whoami – neofetch style
// ---------------------------------------------------------------------------
function whoamiSvg(s) {
  const rows = [
    ...PROFILE,
    ["github", `${s.repos} public repos · ${s.followers} followers · ${s.years}y on GitHub`],
  ];
  const top = 96;
  const lh = 24;
  const shades = [C.levels.SECOND_QUARTILE, C.levels.THIRD_QUARTILE, C.levels.FOURTH_QUARTILE, C.levels.FOURTH_QUARTILE];
  const logo = LOGO.flatMap((row, r) =>
    [...row].map((ch, c) => {
      const fill = ch === "#" ? shades[(r * 7 + c * 3) % shades.length] : C.levels.NONE;
      return `<rect x="${40 + c * 21}" y="${top - 12 + r * 21}" width="18" height="18" rx="3" fill="${fill}"/>`;
    }),
  ).join("");
  const head = `<text x="290" y="${top}" font-size="15"><tspan class="accent" font-weight="700">Sebastian Goscinski</tspan><tspan class="muted"> · ${LOGIN}</tspan></text>
<text x="290" y="${top + 12}" font-size="13" class="muted">${"─".repeat(48)}</text>`;
  const kv = rows
    .map(
      ([k, v], i) =>
        `<text x="290" y="${top + 38 + i * lh}" font-size="14"><tspan class="prompt" font-weight="700">${esc(k.padEnd(10))}</tspan><tspan> ${esc(v)}</tspan></text>`,
    )
    .join("\n");
  const palette = Object.values(C.levels)
    .concat(["#58a6ff", "#bc8cff", "#ff7b72"])
    .map((c, i) => `<rect x="${290 + i * 26}" y="${top + 38 + rows.length * lh - 4}" width="22" height="12" rx="2" fill="${c}"/>`)
    .join("");
  const height = top + 38 + rows.length * lh + 40;
  const cursor = `<rect class="cursor" x="24" y="${height - 30}" width="9" height="16" fill="${C.accent}"/>`;
  return window({ height, title: `${LOGIN} — zsh`, command: "whoami", body: [logo, head, kv, palette, cursor].join("\n") });
}

// ---------------------------------------------------------------------------
// 2) contributions heatmap
// ---------------------------------------------------------------------------
function contributionsSvg(s) {
  const cell = 12;
  const gap = 3;
  const step = cell + gap;
  const x0 = 64;
  const y0 = 112;
  const cells = [];
  const monthLabels = [];
  let lastMonth = -1;

  s.weeks.forEach((w, wi) => {
    const first = w.contributionDays[0];
    const m = +first.date.slice(5, 7) - 1;
    if (m !== lastMonth && +first.date.slice(8, 10) <= 7 && wi < s.weeks.length - 1) {
      monthLabels.push(`<text x="${x0 + wi * step}" y="${y0 - 10}" font-size="11" class="muted">${MON[m]}</text>`);
      lastMonth = m;
    }
    for (const d of w.contributionDays) {
      const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      cells.push(
        `<rect x="${x0 + wi * step}" y="${y0 + dow * step}" width="${cell}" height="${cell}" rx="2.5" fill="${C.levels[d.contributionLevel] ?? C.levels.NONE}"><title>${d.contributionCount} on ${d.date}</title></rect>`,
      );
    }
  });

  const dayLabels = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ]
    .map(([r, t]) => `<text x="24" y="${y0 + r * step + 10}" font-size="11" class="muted">${t}</text>`)
    .join("");

  const yb = y0 + 7 * step + 26;
  const legendX = W - 24 - 5 * step - 72;
  const legend =
    `<text x="${legendX}" y="${yb}" font-size="11" class="muted">Less</text>` +
    Object.values(C.levels)
      .map((c, i) => `<rect x="${legendX + 36 + i * step}" y="${yb - 10}" width="${cell}" height="${cell}" rx="2.5" fill="${c}"/>`)
      .join("") +
    `<text x="${legendX + 36 + 5 * step + 4}" y="${yb}" font-size="11" class="muted">More</text>`;

  const footer = `<text x="24" y="${yb}" font-size="13"><tspan class="accent" font-weight="700">${fmt(s.total)}</tspan><tspan class="muted"> contributions in the last year</tspan></text>`;

  return window({
    height: yb + 26,
    title: "contributions.sh",
    command: "./contributions.sh",
    body: [monthLabels.join(""), dayLabels, cells.join(""), footer, legend].join("\n"),
  });
}

// ---------------------------------------------------------------------------
// 3) stats tiles + monthly bars
// ---------------------------------------------------------------------------
function statsSvg(s) {
  const tiles = [
    ["current streak", s.current.len, "days", s.current.len ? `${short(s.current.start)} – ${short(s.current.end)}` : "start one today"],
    ["longest streak", s.longest.len, "days", s.longest.len ? `${short(s.longest.start)} – ${short(s.longest.end)}` : "–"],
    ["contributions", fmt(s.total), "", "in the last year"],
    ["active days", s.active, `/ ${s.days}`, `${Math.round((s.active / s.days) * 100)}% of the year`],
    ["best day", s.best.contributionCount, "", short(s.best.date)],
    ["avg / active day", s.avg.toFixed(1), "", "contributions"],
  ];
  const cols = 3;
  const pad = 24;
  const gap = 12;
  const tw = (W - 2 * pad - (cols - 1) * gap) / cols;
  const th = 78;
  const y0 = 84;

  const tileSvg = tiles
    .map(([label, value, unit, sub], i) => {
      const x = pad + (i % cols) * (tw + gap);
      const y = y0 + Math.floor(i / cols) * (th + gap);
      return `<g transform="translate(${x},${y})">
<rect width="${tw}" height="${th}" rx="6" fill="${C.panel}" stroke="${C.border}"/>
<text x="14" y="22" font-size="11" class="muted">$ ${esc(label)}</text>
<text x="14" y="50" font-size="24" font-weight="700" class="accent">${esc(value)}<tspan font-size="12" font-weight="400" class="muted"> ${esc(unit)}</tspan></text>
<text x="14" y="67" font-size="10.5" class="muted">${esc(sub)}</text>
</g>`;
    })
    .join("\n");

  // Monthly bar chart
  const cy = y0 + 2 * (th + gap) + 4;
  const ch = 170;
  const chartW = W - 2 * pad;
  const max = Math.max(1, ...s.monthly.map((m) => m.value));
  const barArea = ch - 64;
  const slot = (chartW - 28) / s.monthly.length;
  const bw = Math.min(36, slot * 0.6);
  const bars = s.monthly
    .map((m, i) => {
      const h = Math.max(m.value ? 2 : 0, (m.value / max) * barArea);
      const x = pad + 14 + i * slot + (slot - bw) / 2;
      const yb = cy + ch - 26;
      const isMax = m.value === max;
      return `<rect x="${x}" y="${yb - h}" width="${bw}" height="${h}" rx="3" fill="${isMax ? C.accent : "#26a641"}"><title>${m.value} in ${m.key}</title></rect>
${isMax ? `<text x="${x + bw / 2}" y="${yb - h - 6}" font-size="10.5" text-anchor="middle" class="accent">${fmt(m.value)}</text>` : ""}
<text x="${x + bw / 2}" y="${yb + 16}" font-size="10.5" text-anchor="middle" class="muted">${MON[+m.key.slice(5, 7) - 1][0]}</text>`;
    })
    .join("\n");

  const chart = `<rect x="${pad}" y="${cy}" width="${chartW}" height="${ch}" rx="6" fill="${C.panel}" stroke="${C.border}"/>
<text x="${pad + 14}" y="${cy + 22}" font-size="11" class="muted">$ contributions / month</text>
${bars}`;

  return window({
    height: cy + ch + 24,
    title: "stats.sh",
    command: "./stats.sh",
    body: [tileSvg, chart].join("\n"),
  });
}

// ---------------------------------------------------------------------------
const data = await loadData();
const stats = computeStats(data);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "whoami.svg"), whoamiSvg(stats));
await writeFile(join(OUT, "contributions.svg"), contributionsSvg(stats));
await writeFile(join(OUT, "stats.svg"), statsSvg(stats));
console.log(
  `✔ ${stats.total} contributions · streak ${stats.current.len}/${stats.longest.len} · ${stats.active} active days → assets/`,
);
