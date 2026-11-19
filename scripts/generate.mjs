#!/usr/bin/env node
// Generates the terminal-style SVGs for the profile README.
//
//   GH_TOKEN=... node scripts/generate.mjs               # live data from the GitHub API
//   node scripts/generate.mjs --fixture data.json        # offline, from a saved API response
//   node scripts/generate.mjs ... --avatar photo.jpg      # use a local image instead of the GitHub avatar
//
// The whoami panel renders the current GitHub avatar as a halftone portrait, so changing
// the profile picture updates the README on the next run.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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

// Projects and links – each one becomes its own clickable card.
// `repo` pulls description, language, stars and last push from GitHub;
// `description` overrides the repo description. The card links to `live`
// if set (footer shows "live ↗"), otherwise to the repo (footer shows "repo ↗").
// After adding an entry here, add the matching <a><img></a> to README.md.
// ---------------------------------------------------------------------------
const PROJECTS = [
  { slug: "security-workflows", repo: "sebiweise/security-workflows", tag: "github action",
    description: "Reusable workflow that security-scans any repo with open-source tools only: Semgrep, Trivy and Gitleaks." },
  { slug: "devops-manager", name: "DevOps Manager", repo: "sebiweise/devops-manager", tag: "in development",
    description: "Self-hosted insights for GitHub repos, Actions and runners: run times, success rates, queue times and costs." },
  { slug: "solo-runner", repo: "sebiweise/solo-runner", tag: "self-hosted",
    description: "Fresh, single-use self-hosted Actions runners for all private repos of a personal account. No org needed." },
  { slug: "rueckenwind", name: "Rückenwind", repo: "sebiweise/rueckenwind", live: "https://rueckenwind-web.vercel.app", tag: "pwa",
    description: "Guides people with statutory health insurance in Germany towards an outpatient psychotherapy place." },
  { slug: "home-assistant-alamos", name: "Alamos for Home Assistant", repo: "sebiweise/home-assistant-alamos", tag: "integration",
    description: "Alamos alerting (aPager PRO, AMweb) as Home Assistant sensors and events, incl. alert feedback." },
  { slug: "gemuetlich", name: "Gemütlich", live: "https://gemuetlich.goscinski.dev", tag: "live",
    description: "Turns a TV into a cosy room with a live-generated fireplace, weather and ambience scenes." },
];

const LINKS = [
  { slug: "portfolio", label: "portfolio", value: "goscinski.dev", href: "https://goscinski.dev" },
  { slug: "linkedin", label: "linkedin", value: "sebastian-weise", href: "https://www.linkedin.com/in/sebastian-weise" },
  { slug: "keoz", label: "work", value: "KEOZ GmbH", href: "https://www.keoz.com" },
  { slug: "implet", label: "side", value: "Implet", href: "https://www.implet.com" },
];

// ---------------------------------------------------------------------------
// Halftone portrait settings
const PORTRAIT = {
  grid: 64, // dots per side
  size: 264, // px the portrait occupies
};

// Fallback when the avatar can't be loaded. Pixel logo drawn as contribution cells ("#" = filled). Rects instead of
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
    avatarUrl(size: 400)
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

async function graphql(query, variables) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set GH_TOKEN (or pass --fixture <file>).");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": LOGIN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// Repo details for the project cards. A missing or private repo is not an
// error: the card just falls back to the text from PROJECTS.
async function loadRepos(data) {
  if (data.repos) return data.repos; // fixture
  const withRepo = PROJECTS.filter((p) => p.repo);
  if (!withRepo.length) return {};
  const fields = "description url stargazerCount pushedAt primaryLanguage { name color }";
  const query = `query { ${withRepo
    .map((p, i) => {
      const [owner, name] = p.repo.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} }`;
    })
    .join("\n")} }`;
  try {
    const json = await graphql(query);
    const out = {};
    withRepo.forEach((p, i) => {
      const r = json.data?.[`r${i}`];
      if (r) out[p.slug] = r;
      else console.warn(`⚠ repo ${p.repo} not found or not public`);
    });
    return out;
  } catch (err) {
    console.warn(`⚠ repo details not loaded (${err.message})`);
    return {};
  }
}

async function loadData() {
  const i = process.argv.indexOf("--fixture");
  if (i !== -1) return JSON.parse(await readFile(process.argv[i + 1], "utf8"));

  const json = await graphql(QUERY, { login: LOGIN });
  if (json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors)}`);
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
// Avatar → ASCII
// ---------------------------------------------------------------------------
async function loadAvatar(data) {
  const i = process.argv.indexOf("--avatar");
  try {
    if (i !== -1) return await readFile(process.argv[i + 1]);
    if (!data.user.avatarUrl) return null;
    const res = await fetch(data.user.avatarUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`⚠ avatar not loaded (${err.message}), using pixel logo`);
    return null;
  }
}

async function toHalftone(buf) {
  const n = PORTRAIT.grid;
  const { data } = await sharp(buf)
    .resize(n * 4, n * 4, { fit: "cover", position: "centre" })
    .greyscale()
    .clahe({ width: 24, height: 24, maxSlope: 4 }) // local contrast, so faces stand out
    .resize(n, n)
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const values = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // soft circular vignette so busy backgrounds fade out
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const fade = Math.max(0, Math.min(1, (0.52 - Math.hypot(dx, dy)) / 0.08));
      values.push((data[y * n + x] / 255) * fade);
    }
  }
  return values;
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
function whoamiSvg(s, dots) {
  const TX = 312;
  const rows = [
    ...PROFILE,
    ["github", `${s.repos} public repos · ${s.followers} followers · ${s.years}y on GitHub`],
  ];
  const top = 96;
  const lh = 24;
  const portrait = dots
    ? (() => {
        const n = PORTRAIT.grid;
        const step = PORTRAIT.size / n;
        const out = [];
        dots.forEach((v, i) => {
          const r = (step / 2) * Math.pow(v, 0.75);
          if (r < 0.35) return;
          const cx = 24 + (i % n) * step + step / 2;
          const cy = top - 22 + Math.floor(i / n) * step + step / 2;
          out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}"/>`);
        });
        return `<g fill="#c9d1d9">${out.join("")}</g>`;
      })()
    : null;
  const shades = [C.levels.SECOND_QUARTILE, C.levels.THIRD_QUARTILE, C.levels.FOURTH_QUARTILE, C.levels.FOURTH_QUARTILE];
  const logo = LOGO.flatMap((row, r) =>
    [...row].map((ch, c) => {
      const fill = ch === "#" ? shades[(r * 7 + c * 3) % shades.length] : C.levels.NONE;
      return `<rect x="${40 + c * 21}" y="${top - 12 + r * 21}" width="18" height="18" rx="3" fill="${fill}"/>`;
    }),
  ).join("");
  const head = `<text x="${TX}" y="${top}" font-size="15"><tspan class="accent" font-weight="700">Sebastian Goscinski</tspan><tspan class="muted"> · ${LOGIN}</tspan></text>
<text x="${TX}" y="${top + 12}" font-size="13" class="muted">${"─".repeat(48)}</text>`;
  const kv = rows
    .map(
      ([k, v], i) =>
        `<text x="${TX}" y="${top + 38 + i * lh}" font-size="14"><tspan class="prompt" font-weight="700">${esc(k.padEnd(10))}</tspan><tspan> ${esc(v)}</tspan></text>`,
    )
    .join("\n");
  const palette = Object.values(C.levels)
    .concat(["#58a6ff", "#bc8cff", "#ff7b72"])
    .map((c, i) => `<rect x="${TX + i * 26}" y="${top + 38 + rows.length * lh - 4}" width="22" height="12" rx="2" fill="${c}"/>`)
    .join("");
  const portraitBottom = dots ? top - 22 + PORTRAIT.size : 0;
  const height = Math.max(top + 38 + rows.length * lh + 40, portraitBottom + 44);
  const cursor = `<rect class="cursor" x="24" y="${height - 30}" width="9" height="16" fill="${C.accent}"/>`;
  return window({ height, title: `${LOGIN} — zsh`, command: "whoami", body: [portrait ?? logo, head, kv, palette, cursor].join("\n") });
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
// 4) project cards, link cards
// ---------------------------------------------------------------------------
const CARD_STYLE = `<style>
  text { font-family: ${FONT}; fill: ${C.text}; }
  .muted { fill: ${C.muted}; }
  .accent { fill: ${C.accent}; }
  .prompt { fill: ${C.prompt}; }
  .cursor { animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .cursor { animation: none; } }
</style>`;

// rough monospace advance, good enough for layout
const tw = (str, size) => [...str].length * size * 0.6;

function wrap(text, maxChars, maxLines) {
  const words = text.split(/\s+/);
  const lines = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur ? cur.length + 1 : 0) + w.length <= maxChars) lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    else if (lines.length < maxLines) lines.push(w);
    else {
      lines[lines.length - 1] = `${cur.slice(0, maxChars - 1).trimEnd()}…`;
      return lines;
    }
  }
  return lines;
}

function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 31) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const host = (url) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
// small "↗" drawn as a path, so it doesn't depend on fonts
const arrow = (x, y, color = C.accent) =>
  `<path d="M${x} ${y} l7 -7 M${x + 2} ${y - 7} h5 v5" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const star = (cx, cy) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 2.6 : 6;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${C.muted}"/>`;
};

function projectSvg(p, repo) {
  const w = 440;
  const h = 164;
  const name = p.name ?? p.repo?.split("/")[1] ?? p.slug;
  const desc = p.description ?? repo?.description ?? "";
  const lines = wrap(desc, 50, 3);

  const tag = p.tag
    ? (() => {
        const tWidth = tw(p.tag, 11) + 18;
        return `<rect x="${w - 20 - tWidth}" y="44" width="${tWidth}" height="22" rx="11" fill="none" stroke="${p.tag === "in development" ? "#d29922" : C.accent}"/>
<text x="${w - 20 - tWidth / 2}" y="59" font-size="11" text-anchor="middle" fill="${p.tag === "in development" ? "#d29922" : C.accent}">${esc(p.tag)}</text>`;
      })()
    : "";

  // footer: language · stars · updated  ……  live ↗
  const fy = h - 18;
  let fx = 20;
  const foot = [];
  if (repo?.primaryLanguage) {
    foot.push(`<circle cx="${fx + 5}" cy="${fy - 4}" r="5" fill="${repo.primaryLanguage.color ?? C.muted}"/>`);
    foot.push(`<text x="${fx + 15}" y="${fy}" font-size="12" class="muted">${esc(repo.primaryLanguage.name)}</text>`);
    fx += 15 + tw(repo.primaryLanguage.name, 12) + 16;
  }
  if (repo) {
    foot.push(star(fx + 6, fy - 4));
    foot.push(`<text x="${fx + 16}" y="${fy}" font-size="12" class="muted">${repo.stargazerCount}</text>`);
    fx += 16 + tw(String(repo.stargazerCount), 12) + 16;
    foot.push(`<text x="${fx}" y="${fy}" font-size="12" class="muted">updated ${ago(repo.pushedAt)}</text>`);
  }
  if (p.live) {
    // with repo stats in the footer there is only room for a short label
    const label = repo ? "live" : host(p.live);
    const lx = w - 20 - 12 - tw(label, 12);
    foot.push(`<text x="${lx}" y="${fy}" font-size="12" class="accent">${esc(label)}</text>`);
    foot.push(arrow(w - 28, fy));
  } else if (repo) {
    const label = "repo";
    foot.push(`<text x="${w - 32 - tw(label, 12)}" y="${fy}" font-size="12" class="prompt">${label}</text>`);
    foot.push(arrow(w - 28, fy, C.prompt));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`${name}: ${desc}`)}">
${CARD_STYLE}
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<path d="M0.5 30 H${w - 0.5}" stroke="${C.border}"/>
<circle cx="18" cy="15" r="4.5" fill="#ff5f57"/><circle cx="33" cy="15" r="4.5" fill="#febc2e"/><circle cx="48" cy="15" r="4.5" fill="#28c840"/>
<text x="${w / 2}" y="19" text-anchor="middle" font-size="11" class="muted">~/projects/${esc(p.slug)}</text>
<text x="20" y="61" font-size="17" font-weight="700" class="accent">${esc(name)}</text>
${tag}
${lines.map((l, i) => `<text x="20" y="${88 + i * 18}" font-size="13" fill="#c9d1d9">${esc(l)}</text>`).join("\n")}
${foot.join("\n")}
</svg>
`;
}

function linkSvg(l) {
  const w = 214;
  const h = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`${l.label}: ${l.value}`)}">
${CARD_STYLE}
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<text x="16" y="25" font-size="11" class="muted">$ ${esc(l.label)}</text>
<text x="16" y="47" font-size="14" font-weight="700" class="accent">${esc(l.value)}</text>
${arrow(w - 26, 46)}
</svg>
`;
}

// ---------------------------------------------------------------------------
const data = await loadData();
const stats = computeStats(data);
const avatar = await loadAvatar(data);
const dots = avatar ? await toHalftone(avatar) : null;
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "whoami.svg"), whoamiSvg(stats, dots));
await writeFile(join(OUT, "contributions.svg"), contributionsSvg(stats));
await writeFile(join(OUT, "stats.svg"), statsSvg(stats));

const repos = await loadRepos(data);
for (const p of PROJECTS) await writeFile(join(OUT, `project-${p.slug}.svg`), projectSvg(p, repos[p.slug]));
for (const l of LINKS) await writeFile(join(OUT, `link-${l.slug}.svg`), linkSvg(l));
console.log(
  `✔ ${stats.total} contributions · streak ${stats.current.len}/${stats.longest.len} · ${stats.active} active days → assets/`,
);
