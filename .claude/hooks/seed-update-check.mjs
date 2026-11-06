// SessionStart-Hook für Claude Code (.claude/settings.json): Sind die Seed-Bausteine des
// Projekts aktuell? Vergleicht
//   - den Ref von seed-pipelines in azure-pipelines.yml,
//   - die Refs der Module aus seed-terraform in infra/*.tf,
//   - die Versionen von Bfs.Seed.* (api/**/*.csproj, *.props) und @blackforestsentinel/seed-web-*
//     (package.json der Ordner auf oberster Ebene)
// mit dem neuesten Release. Liegt etwas zurück, nennt der Hook es der Person und gibt Claude den
// Auftrag, das Update vorzuschlagen. Ohne Netz, bei Fehlern oder wenn alles aktuell ist, bleibt er
// still; jede Abfrage hat ein kurzes Timeout.
//
// Die Pipeline warnt zusätzlich im Lauf (seed-pipelines); dieser Hook ist für die lokale Sitzung.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Je Abfrage; alle laufen parallel. Danach endet der Hook, auch wenn eine Abfrage noch hängt.
const TIMEOUT_MS = 3000;
const GITHUB = 'https://github.com/blackforestsentinel';

// Abschalten: Umgebungsvariable SEED_UPDATE_CHECK=0, etwa unter env in .claude/settings.local.json.
if (process.env.SEED_UPDATE_CHECK === '0') {
  process.exit(0);
}

let output = '';
try {
  const outdated = await Promise.race([check(), sleep(TIMEOUT_MS + 1000).then(() => [])]);
  if (outdated.length > 0) {
    output = report(outdated);
  }
} catch {
  // Der Hook soll keine Sitzung stören.
}
// Ohne Netz startet git ls-remote einen Hilfsprozess, der erst mit dem Timeout der Verbindung
// endet; auf ihn nicht warten. Beenden erst, wenn die Ausgabe geschrieben ist.
process.stdout.write(output, () => process.exit(0));

async function check() {
  const used = collect();
  const lookups = [];

  if (used.pipelines.length > 0) {
    lookups.push(latestTag('seed-pipelines').then((latest) => compare('seed-pipelines', used.pipelines, latest)));
  }
  if (used.terraform.length > 0) {
    lookups.push(latestTag('seed-terraform').then((latest) => compare('seed-terraform', used.terraform, latest)));
  }
  for (const [id, uses] of group(used.nuget)) {
    lookups.push(latestNuGet(id).then((latest) => compare(id, uses, latest)));
  }
  for (const [name, uses] of group(used.npm)) {
    lookups.push(latestNpm(name).then((latest) => compare(name, uses, latest)));
  }

  const results = await Promise.allSettled(lookups);
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
}

// --- Was das Projekt nutzt --------------------------------------------------------------------

function collect() {
  const used = { pipelines: [], terraform: [], nuget: [], npm: [] };

  const pipelineRef = seedPipelinesRef(read('azure-pipelines.yml') ?? '');
  if (pipelineRef) {
    used.pipelines.push({ version: pipelineRef, file: 'azure-pipelines.yml' });
  }

  for (const file of list('infra', (f) => f.endsWith('.tf'))) {
    for (const m of (read(file) ?? '').matchAll(/github\.com\/blackforestsentinel\/seed-terraform(?:\.git)?\/\/[\w-]+\?ref=(v\d+\.\d+\.\d+)/g)) {
      used.terraform.push({ version: m[1], file });
    }
  }

  for (const file of walk('api', (f) => /\.(csproj|props|targets)$/.test(f))) {
    for (const m of (read(file) ?? '').matchAll(/<Package(?:Reference|Version)\b[^>]*>/g)) {
      const id = attribute(m[0], 'Include') ?? attribute(m[0], 'Update');
      const version = attribute(m[0], 'Version');
      if (id && version && /^Bfs\.Seed\./i.test(id)) {
        used.nuget.push({ key: id, version, file });
      }
    }
  }

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    const file = `${dir.name}/package.json`;
    if (!dir.isDirectory() || dir.name === 'node_modules' || dir.name.startsWith('.') || !existsSync(join(root, file))) {
      continue;
    }
    try {
      const pkg = JSON.parse(read(file));
      for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (name.startsWith('@blackforestsentinel/seed-web-')) {
          used.npm.push({ key: name, version: String(range).replace(/^[\^~=v]+/, ''), file });
        }
      }
    } catch {
      // Kaputte package.json meldet npm selbst.
    }
  }

  return used;
}

// Ref aus dem Eintrag unter resources.repositories, dessen name blackforestsentinel/seed-pipelines
// ist. Ein Eintrag beginnt mit "- " und endet beim nächsten oder bei einer Zeile, die nicht tiefer
// eingerückt ist; ein ref außerhalb des Eintrags zählt nicht.
function seedPipelinesRef(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)-\s+\S/.exec(lines[i]);
    if (!start) {
      continue;
    }
    const indent = start[1].length;
    const entry = { repository: false, name: null, ref: null };
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      if (j > i && line.trim() !== '' && !line.trim().startsWith('#') && line.search(/\S/) <= indent) {
        break;
      }
      const key = j === i ? line.replace(/^\s*-\s+/, '') : line.trim();
      entry.repository ||= /^repository:/.test(key);
      entry.name ??= /^name:\s*['"]?([^'"\s#]+)/.exec(key)?.[1] ?? null;
      entry.ref ??= /^ref:\s*['"]?refs\/tags\/(v\d+\.\d+\.\d+)['"]?\s*(?:#.*)?$/.exec(key)?.[1] ?? null;
    }
    if (entry.repository && entry.name?.toLowerCase() === 'blackforestsentinel/seed-pipelines' && entry.ref) {
      return entry.ref;
    }
  }
  return null;
}

// --- Neueste Versionen ------------------------------------------------------------------------

function latestTag(repo) {
  const lookup = new Promise((resolve) => {
    execFile(
      'git',
      // Öffentliche Repos: ohne Anmeldung und nie mit einem Dialog des Git Credential Managers.
      ['-c', 'credential.helper=', 'ls-remote', '--tags', '--refs', `${GITHUB}/${repo}.git`],
      { timeout: TIMEOUT_MS, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } },
      (error, stdout) => resolve(error ? null : newest(stdout.split('\n').map((l) => l.split('refs/tags/')[1]))),
    );
  });
  return Promise.race([lookup, sleep(TIMEOUT_MS).then(() => null)]);
}

async function latestNuGet(id) {
  const index = await getJson(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`);
  return newest(index?.versions ?? []);
}

async function latestNpm(name) {
  const manifest = await getJson(`https://registry.npmjs.org/${name}/latest`);
  return manifest?.version ?? null;
}

async function getJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// --- Vergleich und Ausgabe --------------------------------------------------------------------

// Nur stabile Versionen, mit oder ohne führendes v.
function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

function less(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i];
    }
  }
  return false;
}

function newest(versions) {
  let best = null;
  for (const v of versions) {
    const p = parse(v);
    if (p && (!best || less(best.parsed, p))) {
      best = { version: v.trim(), parsed: p };
    }
  }
  return best?.version ?? null;
}

// Liegt eine der genutzten Versionen hinter latest, ein Eintrag mit allen Stellen.
function compare(name, uses, latest) {
  const target = parse(latest);
  const behind = target ? uses.filter((u) => parse(u.version) && less(parse(u.version), target)) : [];
  if (behind.length === 0) {
    return null;
  }
  return {
    name,
    current: [...new Set(behind.map((u) => u.version))].join(', '),
    latest,
    files: [...new Set(behind.map((u) => u.file))],
  };
}

function group(uses) {
  const map = new Map();
  for (const u of uses) {
    map.set(u.key, [...(map.get(u.key) ?? []), u]);
  }
  return map;
}

function report(outdated) {
  const lines = outdated.map((o) => `- ${o.name}: ${o.current} → ${o.latest} (${o.files.join(', ')})`);
  const context = [
    'Seed-Update verfügbar (SessionStart-Hook .claude/hooks/seed-update-check.mjs):',
    ...lines,
    '',
    'Schlag der Person das Update vor, bevor du mit der eigentlichen Aufgabe beginnst, und führ es nur auf ihren Wunsch aus, als eigenen Pull Request.',
    `Vorgehen: Release-Notes lesen (${GITHUB}/<repo>/releases für seed-pipelines, seed-terraform und seed-packages).`,
    'Versionen an den genannten Stellen anheben, Bfs.Seed.* und seed-web-* jeweils alle auf dieselbe Version.',
    'Im Frontend danach npm install für package-lock.json; nach neuen Modulen terraform init -upgrade und die Lock-Datei infra/.terraform.lock.hcl neu erzeugen (README, Terraform).',
    'Danach Build und Tests.',
  ].join('\n');

  // systemMessage sieht die Person, additionalContext bekommt Claude.
  return `${JSON.stringify({
    systemMessage: `Seed-Bausteine nicht aktuell: ${outdated.map((o) => `${o.name} ${o.current} → ${o.latest}`).join('; ')}`,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  })}\n`;
}

// --- Dateien ----------------------------------------------------------------------------------

function read(file) {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return null;
  }
}

function list(dir, filter) {
  try {
    return readdirSync(join(root, dir)).filter(filter).map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

// Rekursiv, ohne bin, obj, node_modules und versteckte Ordner.
function walk(dir, filter) {
  const out = [];
  const visit = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(abs, e.name);
      if (e.isDirectory()) {
        if (!['bin', 'obj', 'node_modules'].includes(e.name) && !e.name.startsWith('.')) {
          visit(path);
        }
      } else if (filter(e.name)) {
        out.push(relative(root, path).replaceAll('\\', '/'));
      }
    }
  };
  visit(join(root, dir));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? null;
}
