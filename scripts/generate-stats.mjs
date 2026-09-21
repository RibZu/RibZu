// Genera assets/stats.svg con datos reales de GitHub (GraphQL) o con datos de muestra.
//
//   GITHUB_TOKEN=... node scripts/generate-stats.mjs            -> datos reales
//   node scripts/generate-stats.mjs --sample --out preview.svg  -> datos falsos, solo para ver el diseño
//
// Sin dependencias: requiere Node 18+ (fetch incluido).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LOGIN = option('user', process.env.GITHUB_REPOSITORY_OWNER || 'RibZu');
const OUT = option('out', 'assets/stats.svg');

// Paleta del design system Industry (acento #5980a6 y sus pasos).
const C = {
  bg: '#1d2d3d',
  grid: '#749dc4',
  rule: '#b9cfe2',
  text: '#f2f7fb',
  accent: '#5980a6',
  dim: '#46586a',
};
const LANG_COLORS = ['#f2f7fb', '#b9cfe2', '#749dc4', '#5980a6', '#46586a'];
const LANG_OTHER = '#2f4459';

// Stack: estos lenguajes no se muestran y estos van primero (los demás, por tamaño).
const HIDE_LANGS = new Set(['Java', 'Python']);
const FIRST_LANGS = ['Go', 'JavaScript', 'TypeScript'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tipografía del design system. Un <img> no carga fuentes externas, así que van incrustadas en el SVG.
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const BODY = "Barlow, 'Segoe UI', Arial, sans-serif";
const fontFace = async (family, weight, file) => {
  const bytes = await readFile(fileURLToPath(new URL(`./fonts/${file}`, import.meta.url)));
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}`;
};

// ---------------------------------------------------------------- datos

async function graphql(query, variables) {
  const token = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Falta GITHUB_TOKEN (o STATS_TOKEN).');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const YEAR_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalPullRequestContributions
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const REPO_QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

async function fetchReal() {
  const now = new Date();
  const from = new Date(now.getTime() - 365 * 86400000);
  const { user } = await graphql(YEAR_QUERY, { login: LOGIN, from: from.toISOString(), to: now.toISOString() });
  const col = user.contributionsCollection;

  const days = new Map();
  for (const week of col.contributionCalendar.weeks)
    for (const d of week.contributionDays) days.set(d.date, d.contributionCount);

  const langBytes = new Map();
  let after = null;
  do {
    const { user: u } = await graphql(REPO_QUERY, { login: LOGIN, after });
    for (const repo of u.repositories.nodes)
      for (const e of repo.languages.edges)
        langBytes.set(e.node.name, (langBytes.get(e.node.name) || 0) + e.size);
    const page = u.repositories.pageInfo;
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  return { days, prs: col.totalPullRequestContributions, langBytes };
}

function fetchSample() {
  // Pseudoaleatorio determinista: el mismo dibujo en cada ejecución.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const days = new Map();
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const d = new Date(end.getTime() - i * 86400000);
    const weekend = [0, 6].includes(d.getUTCDay());
    const active = i < 4 || (rand() > (weekend ? 0.85 : 0.6) && !(i > 12 && i < 40));
    days.set(iso(d), active ? Math.ceil(rand() ** 3 * 30) : 0);
  }
  return {
    days,
    prs: 13,
    langBytes: new Map([['Go', 31000], ['JavaScript', 24000], ['TypeScript', 52000], ['Java', 40000], ['Python', 9000], ['CSS', 6000], ['HTML', 4000]]),
  };
}

// ---------------------------------------------------------------- cálculos

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => iso(new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86400000));

function languages(langBytes) {
  const shown = [...langBytes].filter(([name]) => !HIDE_LANGS.has(name));
  const total = shown.reduce((a, [, s]) => a + s, 0) || 1;
  const rank = (name) => (FIRST_LANGS.includes(name) ? FIRST_LANGS.indexOf(name) : FIRST_LANGS.length);
  shown.sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
  const top = shown.slice(0, LANG_COLORS.length).map(([name, size], i) => ({ name, share: size / total, color: LANG_COLORS[i] }));
  const rest = shown.slice(LANG_COLORS.length).reduce((a, [, s]) => a + s, 0);
  if (rest > 0) top.push({ name: 'other', share: rest / total, color: LANG_OTHER });
  return top;
}

// ---------------------------------------------------------------- render

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => n.toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const shortDate = (dateStr) => {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

// Ancho aproximado de un texto en Barlow 500 (a 14px), para colocar elementos en fila sin poder medir la fuente.
const textWidth = (str, size = 14) =>
  [...str].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 8.6 : /[0-9,]/.test(ch) ? 7.2 : ch === '%' ? 10.5 : ch === ' ' ? 3.4 : /[ilj.,:'|]/.test(ch) ? 3.6 : /[mw]/.test(ch) ? 10.6 : 6.9), 0) * (size / 14);

// Rueda técnica con anillos concéntricos, como la foto de perfil. Dibujo de línea, sin datos.
function wheel(cx, cy, R) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (r, deg) => [(cx + r * Math.cos(rad(deg))).toFixed(1), (cy + r * Math.sin(rad(deg))).toFixed(1)];
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const [x1, y1] = at(R - 9, i * 5);
    const [x2, y2] = at(R - (i % 6 === 0 ? 3 : 5.5), i * 5);
    ticks += `M${x1} ${y1}L${x2} ${y2}`;
  }
  let spokes = '';
  let nodes = '';
  for (let i = 0; i < 5; i++) {
    const deg = -90 + 12 + i * 72;
    const [hx, hy] = at(12, deg);
    const [rx, ry] = at(R, deg);
    const [nx, ny] = at(R + 7, deg);
    spokes += `M${hx} ${hy}L${rx} ${ry}`;
    nodes += `<circle cx="${nx}" cy="${ny}" r="6" fill="${C.bg}" stroke="${C.rule}" stroke-width="1.5"/>`;
  }
  return `<g aria-hidden="true">
<g clip-path="url(#rings)">
<circle cx="${cx}" cy="${cy}" r="${R + 34}" fill="none" stroke="${C.grid}" stroke-opacity=".22" stroke-width="1.5"/>
<circle cx="${cx}" cy="${cy}" r="${R + 62}" fill="none" stroke="${C.grid}" stroke-opacity=".14" stroke-width="1.5"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.grid}" stroke-width="1.5"/>
<path d="${ticks}" stroke="${C.grid}" stroke-width=".8" fill="none"/>
<path d="${spokes}" stroke="${C.rule}" stroke-width="2.5" stroke-linecap="round" fill="none"/>
${nodes}
<circle cx="${cx}" cy="${cy}" r="12" fill="${C.accent}" stroke="${C.text}" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="3.5" fill="${C.text}"/>
</g>`;
}

async function render(data) {
  const { days, prs } = data;
  const today = [...days.keys()].sort().pop();

  const W = 840;
  const PAD = 28;
  const COLS = 53;
  const WHEEL_R = 66;
  const CHART_W = W - PAD * 2 - 196;
  const PITCH = CHART_W / COLS;
  const BAR_W = Math.round(PITCH * 0.6 * 10) / 10;
  const BASE_Y = 204;
  const MAX_H = 104;

  // Datos sueltos: últimos 12 meses.
  const windowStart = addDays(today, -364);
  const lastYear = [...days.keys()].filter((d) => d >= windowStart && d <= today);
  const yearTotal = lastYear.reduce((a, d) => a + days.get(d), 0);
  const activeDays = lastYear.filter((d) => days.get(d) > 0).length;
  const busiest = lastYear.reduce((best, d) => (days.get(d) > (days.get(best) ?? 0) ? d : best), today);
  const busiestCount = days.get(busiest) ?? 0;

  // Barras: una por semana, terminando en la semana de hoy (domingo primero).
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const gridStart = addDays(today, -todayDow - (COLS - 1) * 7);
  const weekTotals = Array.from({ length: COLS }, (_, col) => {
    let sum = 0;
    for (let row = 0; row < 7; row++) {
      const date = addDays(gridStart, col * 7 + row);
      if (date <= today) sum += days.get(date) ?? 0;
    }
    return sum;
  });
  const peak = Math.max(...weekTotals, 1);

  let bars = '';
  let monthLabels = '';
  let lastMonth = -1;
  let lastLabelCol = -10;
  weekTotals.forEach((total, col) => {
    const x = (PAD + col * PITCH + (PITCH - BAR_W) / 2).toFixed(1);
    const weekStart = addDays(gridStart, col * 7);
    const h = total === 0 ? 2 : Math.max(4, Math.round((total / peak) * MAX_H));
    const isNow = col === COLS - 1;
    const tip = `${plural(total, 'contribution')}, week of ${shortDate(weekStart)}`;
    if (total === 0) {
      bars += `<rect x="${x}" y="${BASE_Y - 2}" width="${BAR_W}" height="2" rx="1" fill="${C.dim}"><title>${tip}</title></rect>`;
    } else {
      bars += `<g class="bar" style="animation-delay:${col * 16}ms"><title>${tip}</title>` +
        `<rect x="${x}" y="${BASE_Y - h}" width="${BAR_W}" height="${h}" rx="1.5" fill="${C.accent}"/>` +
        `<rect${isNow ? ' class="now"' : ''} x="${x}" y="${BASE_Y - h}" width="${BAR_W}" height="${Math.min(3, h)}" rx="1.5" fill="${isNow ? C.text : C.rule}"/></g>`;
    }

    const month = Number(weekStart.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      if (col - lastLabelCol >= 3) {
        monthLabels += `<text x="${x}" y="${BASE_Y + 20}" fill="${C.grid}" font-size="12">${MONTHS[month].toLowerCase()}</text>`;
        lastLabelCol = col;
      }
      lastMonth = month;
    }
  });

  // Lenguajes
  const langTop = BASE_Y + 40;
  const langs = languages(data.langBytes);
  const seg = W - PAD * 2 - (langs.length - 1) * 3;
  let langBar = '';
  let legend = '';
  let x = PAD;
  let lx = PAD;
  for (const l of langs) {
    const w = Math.max(4, l.share * seg);
    const pct = `${Math.max(1, Math.round(l.share * 100))}%`;
    langBar += `<rect x="${x.toFixed(1)}" y="${langTop}" width="${w.toFixed(1)}" height="6" rx="1.5" fill="${l.color}"><title>${esc(l.name)} ${(l.share * 100).toFixed(1)}%</title></rect>`;
    x += w + 3;
    // Cada nombre lleva el cuadrito del color de su segmento, así la barra y la leyenda se leen juntas.
    legend += `<rect x="${lx}" y="${langTop + 19}" width="9" height="9" rx="2" fill="${l.color}"/>` +
      `<text x="${lx + 15}" y="${langTop + 28}" fill="${C.text}" font-size="14">${esc(l.name)} <tspan fill="${C.grid}">${pct}</tspan></text>`;
    lx += 15 + textWidth(`${l.name} ${pct}`) + 28;
  }

  // Tres datos sueltos
  const factsY = langTop + 66;
  const facts = [
    [num(activeDays), ` ${activeDays === 1 ? 'day' : 'days'} with activity`],
    [num(busiestCount), ` contributions on ${shortDate(busiest)}, the busiest day`],
    [num(prs), ` pull requests opened`],
  ];
  let factsSvg = '';
  let fx = PAD;
  for (const [value, rest] of facts) {
    factsSvg += `<text x="${fx}" y="${factsY}" font-size="14"><tspan fill="${C.text}">${esc(value)}</tspan><tspan fill="${C.rule}">${esc(rest)}</tspan></text>`;
    fx += textWidth(value + rest) + 48;
  }

  const H = factsY + 30;
  const summary = `GitHub stats for ${LOGIN}: ${plural(yearTotal, 'contribution')} in the last 12 months across ${plural(activeDays, 'active day')}.`;
  const fonts = (await fontFace('Barlow Condensed', 600, 'barlow-condensed-latin-600-normal.woff2')) +
    (await fontFace('Barlow', 500, 'barlow-latin-500-normal.woff2'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="${BODY}" font-weight="500">
<title id="t">GitHub stats for ${esc(LOGIN)}</title>
<desc id="d">${esc(summary)}</desc>
<defs>
  <style>
    ${fonts}
    .bar{transform-box:fill-box;transform-origin:50% 100%;animation:rise .55s ease-out backwards}
    .now{animation:blink 1.2s linear infinite}
    @keyframes rise{from{transform:scaleY(0)}}
    @keyframes blink{0%,55%{opacity:1}56%,100%{opacity:.25}}
    @media (prefers-reduced-motion:reduce){.bar,.now{animation:none}}
  </style>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${C.grid}" stroke-opacity=".09"/></pattern>
  <clipPath id="card"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  <clipPath id="rings"><rect width="${W}" height="${langTop - 14}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="url(#grid)"/>
${wheel(W - PAD - WHEEL_R - 14, 140, WHEEL_R)}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${C.grid}" stroke-opacity=".3"/>
<text x="${PAD}" y="40" fill="${C.grid}" font-size="13">$ vault --log --since 12m</text>
<text x="${PAD}" y="80" fill="${C.text}" font-family="${DISPLAY}" font-weight="600" font-size="34">${num(yearTotal)} contributions</text>
<line x1="${PAD}" y1="${BASE_Y + 0.5}" x2="${PAD + CHART_W}" y2="${BASE_Y + 0.5}" stroke="${C.grid}" stroke-opacity=".5"/>
${bars}
${monthLabels}
${langBar}
${legend}
${factsSvg}
</svg>
`;
}

// ---------------------------------------------------------------- main

const data = flag('sample') ? fetchSample() : await fetchReal();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, await render(data));
console.log(`Escrito ${OUT}`);
