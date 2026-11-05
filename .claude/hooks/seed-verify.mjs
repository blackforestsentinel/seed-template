// Stop-Hook für Claude Code (.claude/settings.json): Hat sich unter api/ oder frontend/ etwas
// geändert, laufen dort Build, Tests und Formatprüfung wie in der Pipeline, bevor Claude die
// Antwort beendet. Schlägt etwas fehl, bekommt Claude die Ausgabe zurück und arbeitet weiter.
//
// Geändert heißt: gegenüber dem Stand von main (merge-base mit origin/HEAD), samt nicht
// committeter und neuer Dateien. Ein Stand, der schon einmal grün war, läuft nicht noch einmal;
// ein Stand, dessen Fehler Claude in dieser Sitzung schon bekommen hat, hält Claude nicht erneut
// auf. So läuft der Hook nicht nach jeder Antwort, sondern nur, wenn es etwas Neues zu prüfen gibt.
//
// Die API baut der Hook in einem eigenen Ausgabeordner (--artifacts-path im Temp-Verzeichnis),
// damit ein laufendes func start oder die IDE seine Dateien nicht sperren.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const input = readInput();
const session = input.session_id ?? '';
const workDir = join(tmpdir(), 'seed-claude-hooks', hash(root).slice(0, 16));
const stateFile = join(workDir, 'verify.json');

// Wie lange ein Schritt höchstens laufen darf; der Hook selbst hat in settings.json 900 s.
const STEP_TIMEOUT_MS = 5 * 60 * 1000;
// So viel Ausgabe eines fehlgeschlagenen Schritts bekommt Claude zurück.
const MAX_LINES = 80;
const MAX_CHARS = 6000;

const areas = [api(), frontend()].filter(Boolean);
if (areas.length === 0) {
  process.exit(0);
}

const changed = changedFiles();
if (changed === null) {
  // Kein Git oder kein Repo: nichts zu vergleichen, also still.
  process.exit(0);
}

const state = loadState();
const failures = [];
const notes = [];

for (const area of areas) {
  const changes = fingerprintOf(area, changed);
  if (changes === null || state.ok[area.name] === changes) {
    continue;
  }

  // Eine fehlende Voraussetzung (node_modules) gehört zum Stand: Ist sie behoben, wird neu geprüft.
  const missing = area.precheck?.() ?? null;
  const fingerprint = missing ? `${changes}|${missing}` : changes;
  const failed = state.failed[area.name];
  if (failed && failed.fingerprint === fingerprint && failed.session === session) {
    notes.push(`${area.name}: Prüfung schlägt weiter fehl (seit der letzten Meldung unverändert).`);
    continue;
  }

  const result = missing ? { ok: false, area: area.name, command: 'Voraussetzung', output: missing } : runSteps(area);
  if (result.ok) {
    state.ok[area.name] = fingerprint;
    delete state.failed[area.name];
  } else if (result.skipped) {
    notes.push(`${area.name}: ${result.skipped}`);
  } else {
    state.failed[area.name] = { fingerprint, session };
    failures.push(result);
  }
}

saveState(state);

if (failures.length > 0) {
  const reason = [
    'Seed-Hook (.claude/hooks/seed-verify.mjs): Die Prüfung der geänderten Teile schlägt fehl.',
    ...failures.map((f) => `\n## ${f.area}: ${f.command}\n\n${f.output}`),
    '\nBehebe die Ursache. Tests nicht abschwächen und Warnungen nicht ohne Begründung unterdrücken (AGENTS.md, „Ausnahmen“).',
  ].join('\n');
  print({ decision: 'block', reason });
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
  const artifacts = join(workDir, 'artifacts');
  return {
    name: 'API',
    // project.yaml liegt in der Build-Ausgabe (Rollen), .editorconfig und global.json steuern den Build.
    paths: ['api/', 'project.yaml', '.editorconfig', 'global.json'],
    steps: [
      {
        command: `dotnet build ${sln} -warnaserror`,
        run: () => exec('dotnet', ['build', sln, '-warnaserror', '-nologo', '-tl:off', '-clp:ErrorsOnly;NoSummary', '--artifacts-path', artifacts]),
      },
      {
        command: `dotnet test --solution ${sln}`,
        run: () => exec('dotnet', ['test', '--solution', sln, '--no-build', '--artifacts-path', artifacts]),
      },
      {
        command: `dotnet format ${sln} --verify-no-changes`,
        hint: `dotnet format ${sln} behebt das.`,
        run: () => exec('dotnet', ['format', sln, '--verify-no-changes']),
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
    steps: [
      { command: 'npm run typecheck', run: () => shell('npm run --if-present typecheck', dir) },
      { command: 'npm test', run: () => shell('npm test', dir) },
    ],
  };
}

// --- Prüfen -----------------------------------------------------------------------------------

function runSteps(area) {
  for (const step of area.steps) {
    const r = step.run();
    if (r.error?.code === 'ENOENT') {
      return { ok: false, skipped: `${step.command.split(' ')[0]} ist nicht installiert; nicht geprüft.` };
    }
    if (r.error || r.status !== 0) {
      const output = tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim() || String(r.error ?? `Exit ${r.status}`));
      return { ok: false, area: area.name, command: step.command, output: step.hint ? `${output}\n\n${step.hint}` : output };
    }
  }

  return { ok: true };
}

function exec(file, args) {
  return spawnSync(file, args, { cwd: root, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, env: quietEnv(), windowsHide: true });
}

// npm ist unter Windows ein .cmd und startet nur über eine Shell. Der Befehl ist fest, ohne Eingaben.
function shell(command, cwd) {
  return spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, env: quietEnv(), windowsHide: true });
}

function quietEnv() {
  return { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
}

// --- Änderungen -------------------------------------------------------------------------------

// Pfade (relativ zum Repo, mit /) aller Dateien, die sich gegenüber main geändert haben oder neu sind.
function changedFiles() {
  const base = mergeBase();
  if (base === null) {
    return null;
  }

  // Beide Listen relativ zum Projektordner, wie die Pfade der Bereiche.
  const tracked = git(['diff', '--name-only', '-z', '--no-renames', '--relative', base]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked === null || untracked === null) {
    return null;
  }

  return [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort();
}

function mergeBase() {
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master']) {
    const base = git(['merge-base', 'HEAD', ref]);
    if (base) {
      return base.trim();
    }
  }
  // Ohne Remote: nur was noch nicht committet ist.
  return git(['rev-parse', '--verify', '--quiet', 'HEAD'])?.trim() || null;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

// Fingerabdruck der geänderten Dateien eines Bereichs: Pfad und Inhalt. null ohne Änderungen.
function fingerprintOf(area, files) {
  const relevant = files.filter((f) => area.paths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
  if (relevant.length === 0) {
    return null;
  }

  const h = createHash('sha256');
  for (const file of relevant) {
    const full = join(root, file);
    h.update(file).update('\0').update(existsSync(full) ? hash(readFileSync(full)) : 'gelöscht').update('\0');
  }
  return h.digest('hex');
}

// --- Hilfen -----------------------------------------------------------------------------------

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    return { ok: s.ok ?? {}, failed: s.failed ?? {} };
  } catch {
    return { ok: {}, failed: {} };
  }
}

function saveState(s) {
  try {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(s));
  } catch {
    // Ohne Zustand prüft der Hook beim nächsten Mal erneut; das ist nur langsamer.
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Letzte Zeilen der Ausgabe, ohne Farbcodes; Fehler stehen bei dotnet und vitest am Ende.
function tail(text) {
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n');
  let out = lines.slice(-MAX_LINES).join('\n');
  if (out.length > MAX_CHARS) {
    out = `…${out.slice(-MAX_CHARS)}`;
  }
  return lines.length > MAX_LINES ? `…\n${out}` : out;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
