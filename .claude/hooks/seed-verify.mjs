// Hook für Claude Code (.claude/settings.json): Build, Tests und Formatprüfung der geänderten Teile,
// wie in der Pipeline, bevor Claude eine Antwort beendet.
//
//   node seed-verify.mjs --baseline   SessionStart: merkt sich den Stand zu Beginn der Sitzung
//   node seed-verify.mjs              Stop: prüft API und Frontend, wenn sich dort etwas geändert hat
//
// Stand heißt: Inhalt aller Dateien eines Bereichs (git ls-files -s, dazu geänderte und neue
// Dateien), nicht ein Vergleich mit einem Branch. Ein Commit ändert ihn also nicht, und es braucht
// weder Remote noch ersten Commit. Geprüft wird nur, wenn der Stand weder dem zu Beginn der Sitzung
// noch dem letzten grünen entspricht. Fehler gehen als decision block an Claude zurück, je Stand
// höchstens einmal je Sitzung; danach nur ein Hinweis an die Person.
//
// Zustand und Build-Ausgabe liegen in einem Ordner je Benutzer (%LOCALAPPDATA%, sonst
// $XDG_CACHE_HOME bzw. ~/.cache), nicht im gemeinsamen Temp: Dort könnte ein anderes Konto eine
// grüne Prüfung vortäuschen oder Test-DLLs tauschen. Lässt sich der Ordner nicht sicher anlegen oder
// beschreiben, prüft der Hook nicht und sagt das, statt bei jedem Stop zu blocken. Jede Sitzung baut
// in einen eigenen Unterordner, damit sich zwei Sitzungen im selben Projekt nicht stören.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const baselineMode = process.argv.includes('--baseline');
const input = readInput();
const session = String(input.session_id ?? 'ohne-sitzung');
const isWindows = process.platform === 'win32';

// Die Hook-Grenze in settings.json ist 900 s; alle Schritte zusammen bleiben darunter. Kleiner geht
// über SEED_VERIFY_BUDGET_SECONDS, größer nicht.
const BUDGET_MS = Math.min(780, Number(process.env.SEED_VERIFY_BUDGET_SECONDS) || 780) * 1000;
const started = Date.now();
// So viel Ausgabe eines Schritts hebt der Hook auf (das Ende zählt) und gibt Claude davon zurück.
const KEEP_BYTES = 256 * 1024;
const MAX_LINES = 80;
const MAX_CHARS = 6000;
// Sitzungen, die so lange ruhen, verlieren Zustand und Build-Ausgabe.
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const NOT_AS_ERROR = '-warnNotAsError:NU1603,NU1608,NU1801,NU1900,NU1901,NU1902,NU1903,NU1904,NU1905,MSB3026';

const workPath = workDirPath();
const workDir = prepareWorkDir(workPath);
const stateFile = workDir && join(workDir, 'state.json');
const state = workDir ? loadState() : null;
if (!state || !saveState(state)) {
  // Ohne sicheren, beschreibbaren Ordner kein Zustand, also auch kein Schutz vor Wiederholung:
  // nicht prüfen statt bei jedem Stop zu blocken.
  if (!baselineMode) {
    print({ systemMessage: `Seed-Hook: Build und Tests nicht geprüft, der Arbeitsordner ${workPath} lässt sich nicht sicher anlegen oder beschreiben.` });
  }
  process.exit(0);
}

const areas = [api(), frontend()].filter(Boolean);
const mine = (state.sessions[session] ??= { baseline: null, failed: {} });
mine.touched = Date.now();

if (baselineMode) {
  // Bei resume und compact gilt weiter der Stand vom Beginn der Sitzung.
  mine.baseline ??= Object.fromEntries(areas.map((a) => [a.name, fingerprint(a.paths)]));
  saveState(state);
  process.exit(0);
}

const failures = [];
const notes = [];
const updated = [];

// Zwei Sitzungen im selben Projekt prüfen nacheinander: Beide schrieben sonst gleichzeitig die
// README (Endpunkt-Tabelle), und die Erkennung geänderter Dateien sähe die Änderung der anderen.
const locked = await withLock(async () => {
  // Was die andere Sitzung inzwischen grün geprüft hat, gilt auch hier.
  Object.assign(state.ok, loadState().ok);
  const before = trackedChanges();

  for (const area of areas) {
    // Erst nach der Sperre: Die andere Sitzung kann inzwischen etwa die README geschrieben haben.
    const fp = fingerprint(area.paths);
    if (fp === null || fp === state.ok[area.name] || fp === mine.baseline?.[area.name]) {
      continue;
    }

    // Eine fehlende Voraussetzung (node_modules) gehört zum Stand: Ist sie behoben, wird neu geprüft.
    const missing = area.precheck?.() ?? null;
    const key = missing ? `${fp}|${missing}` : fp;
    if (mine.failed[area.name] === key) {
      // Schon einmal gemeldet; ein zweites Mal blocken hieße eine Schleife, auch mit stop_hook_active.
      notes.push(`${area.name}: Prüfung schlägt weiter fehl (seit der letzten Meldung unverändert).`);
      continue;
    }

    const result = missing ? { ok: false, command: 'Voraussetzung', output: missing } : await runSteps(area);
    if (result.ok) {
      state.ok[area.name] = fingerprint(area.paths);
      delete mine.failed[area.name];
    } else if (result.skipped) {
      notes.push(`${area.name}: ${result.skipped}`);
    } else {
      mine.failed[area.name] = key;
      failures.push({ area: area.name, ...result });
    }
  }

  // Schreibt ein Schritt eine getrackte Datei, etwa der Build die Endpunkt-Tabelle in README.md,
  // muss sie in den Commit; sonst scheitert die Pipeline an der veralteten Datei (SEEDOPENAPI015).
  for (const [path, blob] of trackedChanges()) {
    if (before.get(path) !== blob) {
      updated.push(path);
    }
  }
});
if (!locked) {
  notes.push('Eine andere Sitzung prüft dieses Projekt gerade; diesmal nicht geprüft.');
}

pruneSessions();
saveState(state);

if (failures.length > 0 || updated.length > 0) {
  const parts = ['Seed-Hook (.claude/hooks/seed-verify.mjs):'];
  for (const f of failures) {
    parts.push(`\n## ${f.area}: ${f.command} schlägt fehl\n\n${f.output}`);
  }
  if (updated.length > 0) {
    parts.push(`\n## Aktualisiert: ${updated.join(', ')}\n\nDie Prüfung hat diese Dateien geschrieben (README.md: Endpunkt-Tabelle aus dem Build). In den Commit aufnehmen, sonst scheitert die Pipeline.`);
  }
  if (failures.length > 0) {
    parts.push('\nBehebe die Ursache. Tests nicht abschwächen und Warnungen nicht ohne Begründung unterdrücken (AGENTS.md, „Ausnahmen“). Derselbe Stand blockt in dieser Sitzung nicht noch einmal.');
  }
  print({ decision: 'block', reason: parts.join('\n') });
} else if (notes.length > 0) {
  print({ systemMessage: `Seed-Hook: ${notes.join(' ')}` });
}

// --- Bereiche ---------------------------------------------------------------------------------

function api() {
  const dir = join(root, 'api');
  const solution = existsSync(dir) ? readdirSync(dir).find((f) => /\.slnx?$/.test(f)) : undefined;
  if (!solution) {
    return null;
  }

  const sln = `api/${solution}`;
  // Eigener Ausgabeordner je Sitzung: kein Konflikt mit func start, der IDE oder einer zweiten Sitzung.
  const artifacts = join(workDir, `s-${hash(session).slice(0, 8)}`);
  return {
    name: 'API',
    // Was den Build der API beeinflusst; README.md, weil der Build die Endpunkt-Tabelle schreibt.
    paths: ['api/', 'project.yaml', '.editorconfig', 'global.json', 'nuget.config', 'README.md', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props'],
    steps: [
      {
        // Warnungen als Fehler wie in der Pipeline (web-app.yml, treatWarningsAsErrors); NuGet-Lücken prüft sie gesondert.
        command: `dotnet build ${sln} -warnaserror`,
        file: 'dotnet',
        args: ['build', sln, '-warnaserror', NOT_AS_ERROR, '-p:NuGetAudit=false', '-nodeReuse:false', '-nologo', '-tl:off', '-clp:ErrorsOnly;NoSummary', '--artifacts-path', artifacts],
        maxMs: 600 * 1000,
      },
      {
        command: `dotnet test --solution ${sln}`,
        file: 'dotnet',
        args: ['test', '--solution', sln, '--no-build', '--artifacts-path', artifacts],
        maxMs: 300 * 1000,
      },
      {
        // Dasselbe wie die Pipeline: nur der Leerraum. Den Rest bereinigt dotnet format vor dem Commit.
        command: `dotnet format whitespace ${sln} --verify-no-changes`,
        file: 'dotnet',
        args: ['format', 'whitespace', sln, '--verify-no-changes'],
        hint: `dotnet format ${sln} behebt das.`,
        maxMs: 180 * 1000,
      },
    ],
  };
}

function frontend() {
  const dir = join(root, 'frontend');
  if (!existsSync(join(dir, 'package.json'))) {
    return null;
  }

  return {
    name: 'Frontend',
    paths: ['frontend/'],
    precheck: () => (existsSync(join(dir, 'node_modules')) ? null : 'frontend/node_modules fehlt; erst npm ci in frontend/ ausführen.'),
    // npm ist unter Windows ein .cmd und startet nur über eine Shell; die Befehle sind fest.
    steps: [
      { command: 'npm run typecheck', shell: 'npm run --if-present typecheck', cwd: dir, maxMs: 180 * 1000 },
      { command: 'npm test', shell: 'npm test', cwd: dir, maxMs: 300 * 1000 },
    ],
  };
}

// --- Prüfen -----------------------------------------------------------------------------------

async function runSteps(area) {
  for (const step of area.steps) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 30 * 1000) {
      return { ok: false, skipped: `Zeitbudget des Hooks aufgebraucht, ${step.command} nicht geprüft.` };
    }

    const r = await run(step, Math.min(step.maxMs, left));
    if (r.missing) {
      return { ok: false, skipped: `${step.command.split(' ')[0]} ist nicht installiert; nicht geprüft.` };
    }
    if (r.timedOut) {
      return { ok: false, command: step.command, output: `Nach ${Math.round(Math.min(step.maxMs, left) / 1000)} s abgebrochen.\n\n${tail(r.output)}` };
    }
    if (r.code !== 0) {
      const output = tail(r.output) || `Exit ${r.code ?? r.signal}`;
      return { ok: false, command: step.command, output: step.hint ? `${output}\n\n${step.hint}` : output };
    }
  }

  return { ok: true };
}

// Startet einen Schritt und beendet bei Zeitüberschreitung den ganzen Prozessbaum: Mit Shell endete
// sonst nur die Shell, und dotnet oder vitest liefen weiter.
function run(step, timeoutMs) {
  return new Promise((resolve) => {
    const options = { cwd: step.cwd ?? root, env: quietEnv(), windowsHide: true, detached: !isWindows };
    const child = step.shell ? spawn(step.shell, { ...options, shell: true }) : spawn(step.file, step.args, options);
    let output = '';
    let timedOut = false;
    const keep = (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > KEEP_BYTES) {
        output = output.slice(-KEEP_BYTES);
      }
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ missing: error.code === 'ENOENT', code: null, output: String(error) });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, output });
    });
  });
}

function killTree(pid) {
  if (!pid) {
    return;
  }
  try {
    if (isWindows) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Schon beendet.
  }
}

function quietEnv() {
  return {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    DOTNET_NOLOGO: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    // Keine MSBuild-Knoten, die nach dem Schritt weiterlaufen und Dateien sperren.
    MSBUILDDISABLENODEREUSE: '1',
    DOTNET_CLI_DO_NOT_USE_MSBUILD_SERVER: '1',
  };
}

// --- Stand ------------------------------------------------------------------------------------

// Fingerabdruck aller Dateien unter paths: Blob-IDs aus dem Index, dazu der Inhalt geänderter und
// neuer Dateien. Ohne Git die Dateien selbst (Pfad, Größe, Änderungszeit). null ohne Dateien.
function fingerprint(paths) {
  const lines = gitFingerprintLines(paths) ?? walkFingerprintLines(paths);
  if (lines.length === 0) {
    return null;
  }
  return hash(lines.sort().join('\n'));
}

function gitFingerprintLines(paths) {
  const indexed = git(['ls-files', '-s', '-z', '--', ...paths]);
  const modified = git(['ls-files', '-m', '-d', '-z', '--', ...paths]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths]);
  if (indexed === null || modified === null || untracked === null) {
    return null;
  }

  const changed = new Set([...split(modified), ...split(untracked)]);
  const lines = [];
  for (const entry of split(indexed)) {
    // <mode> <blob> <stage>\t<pfad>
    const [meta, path] = entry.split('\t');
    if (!changed.has(path)) {
      lines.push(`${path} ${meta.split(' ')[1]}`);
    }
  }
  // Gelöschte Dateien fehlen einfach, ob schon im Index gelöscht oder nicht.
  for (const path of changed) {
    const blob = blobHash(path);
    if (blob) {
      lines.push(`${path} ${blob}`);
    }
  }
  return lines;
}

function walkFingerprintLines(paths) {
  const skip = new Set(['bin', 'obj', 'node_modules', 'dist', '.git', '.vs', '.terraform', 'TestResults']);
  const lines = [];
  const visit = (rel) => {
    let info;
    try {
      info = statSync(join(root, rel));
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(join(root, rel))) {
        if (!skip.has(name)) {
          visit(rel ? `${rel}/${name}` : name);
        }
      }
    } else {
      lines.push(`${rel} ${info.size} ${info.mtimeMs}`);
    }
  };
  for (const p of paths) {
    visit(p.replace(/\/$/, ''));
  }
  return lines;
}

// Getrackte Dateien, die vom Index abweichen, mit Hash ihres Inhalts.
function trackedChanges() {
  const modified = git(['ls-files', '-m', '-z']);
  return new Map(modified === null ? [] : split(modified).map((p) => [p, blobHash(p) ?? 'gelöscht']));
}

// Wie git die ID eines Blobs bildet (SHA-1 über "blob <Länge>\0<Inhalt>"): So ergibt eine Datei vor
// und nach git add denselben Fingerabdruck, und ein Commit ändert ihn nicht. null, wenn es sie nicht gibt.
function blobHash(path) {
  let content;
  try {
    content = readFileSync(join(root, path));
  } catch {
    return null;
  }
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return r.status === 0 && !r.error ? r.stdout : null;
}

function split(text) {
  return text.split('\0').filter(Boolean);
}

// --- Arbeitsordner und Zustand ------------------------------------------------------------------

// Führt fn unter einer Sperrdatei im Arbeitsordner aus. Wartet höchstens die Hälfte des Budgets auf
// eine andere Sitzung; eine Sperre, die älter als die Hook-Grenze ist, gilt als verwaist. false, wenn
// die Sperre nicht frei wurde.
async function withLock(fn) {
  const lock = join(workDir, 'run.lock');
  const giveUp = started + BUDGET_MS / 2;
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        return false;
      }
      let age = Infinity;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > 900 * 1000) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > giveUp) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  try {
    await fn();
    return true;
  } finally {
    rmSync(lock, { force: true });
  }
}


function workDirPath() {
  const base = isWindows
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  // Kurze Namen: Unter Windows bleiben die Pfade der Build-Ausgabe so unter 260 Zeichen.
  return join(base, 'seed-hooks', hash(root).slice(0, 8));
}

function prepareWorkDir(dir) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return isPrivate(dirname(dir)) && isPrivate(dir) ? dir : null;
  } catch {
    return null;
  }
}

// Unter Linux und macOS: ein echter Ordner (kein Link), der dem Benutzer gehört und nur ihm offen
// steht. Unter Windows schützt das Benutzerprofil %LOCALAPPDATA%.
function isPrivate(dir) {
  const info = lstatSync(dir);
  if (!info.isDirectory()) {
    return false;
  }
  if (isWindows) {
    return true;
  }
  if (info.uid !== process.getuid()) {
    return false;
  }
  if ((info.mode & 0o077) !== 0) {
    chmodSync(dir, 0o700);
  }
  return true;
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    return { ok: s.ok ?? {}, sessions: s.sessions ?? {} };
  } catch {
    return { ok: {}, sessions: {} };
  }
}

// Atomar über eine temporäre Datei, damit eine zweite Sitzung nie halbes JSON liest.
function saveState(s) {
  const tmp = `${stateFile}.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    renameSync(tmp, stateFile);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Bleibt liegen; der nächste Lauf mit derselben Prozess-ID überschreibt sie.
    }
    return false;
  }
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of Object.entries(state.sessions)) {
    if (id !== session && now - (s.touched ?? 0) > SESSION_TTL_MS) {
      delete state.sessions[id];
      try {
        rmSync(join(workDir, `s-${hash(id).slice(0, 8)}`), { recursive: true, force: true });
      } catch {
        // Gesperrt oder schon weg; beim nächsten Mal.
      }
    }
  }
}

// --- Hilfen -----------------------------------------------------------------------------------

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Letzte Zeilen der Ausgabe, ohne Farbcodes; Fehler stehen bei dotnet und vitest am Ende.
function tail(text) {
  const lines = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trim().split('\n');
  let out = lines.slice(-MAX_LINES).join('\n');
  if (out.length > MAX_CHARS) {
    out = `…${out.slice(-MAX_CHARS)}`;
  }
  return lines.length > MAX_LINES ? `…\n${out}` : out;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
