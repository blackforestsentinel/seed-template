# Regeln für Coding-Agents

Dieses Projekt entsteht aus Sentinel Seed. Die Regeln gelten für jede Änderung. Vieles davon prüft die Pipeline und bricht sonst ab; was sie nicht prüft, gilt trotzdem.

## Grundsätze

- `project.yaml` ist die einzige Wahrheit über Projekt, Features, Rollen und Capabilities, Secrets, App-Settings und Umgebungen. Terraform, Pipeline und API lesen sie. Nichts davon in `infra/`, im Code oder in der Pipeline nachbauen oder doppeln.
- Änderungen nur per Pull Request auf `main`, nie direkt auf `main` pushen. Der PR-Lauf der Pipeline muss grün sein.
- Ein Commit oder PR enthält nur, was zur Aufgabe gehört. Seed-Versionen hebt ein eigener PR an.

## API (`api/`)

- Jede HTTP-Function trägt `[RequireCapability("…")]` an Methode oder Klasse. Die Capability vergibt eine Rolle unter `auth.roles.<Rolle>.capabilities` in `project.yaml`.
- `[RequireAnyRole]` (jede Rolle genügt) oder `[AllowAnonymous]` (ohne Token) nur mit Grund in einem Kommentar direkt darüber. Ohne Token erreichbar ist nur `/api/health`.
- Jede HTTP-Function trägt `[OpenApiOperation]`; `OpenApiTests` verlangt ein OpenAPI-Dokument ohne Warnungen.
- Verbotene APIs stehen in `api/BannedSymbols.txt`, die Meldung von RS0030 nennt die Alternative: Zeit über `TimeProvider`, HTTP über `IHttpClientFactory`, Einstellungen über `IConfiguration`, Logs über `ILogger<T>`, `await` statt `.Result` und `Thread.Sleep`.
- Zeitzonen kommen aus einer Einstellung (`settings` in `project.yaml`), nie aus dem Server.

## Secrets

- Secrets nur im Key Vault: Name unter `keyVault.secrets` in `project.yaml`, lesen per `SeedSecrets.Get("name")`. Den Wert setzt ein Mensch.
- Nie ein Secret in `project.yaml` (auch nicht unter `settings`), im Code, in Tests, in der Pipeline oder in einer eingecheckten `local.settings.json`. `api/Api/local.settings.json` ist ignoriert; `local.settings.sample.json` enthält keine Secrets.

## Tests

- Jede Function bekommt Tests in `api/Api.Tests`: Erfolgsfall, ungültige Eingaben und, wo es Rechte gibt, die Capability. Frontend-Code bekommt Tests in `frontend/src/*.test.tsx`.
- Tests nicht löschen, abschwächen oder überspringen, um grün zu werden.

## Pakete

- Keine Vorabversionen (`-preview`, `-rc`, `-beta` …) von NuGet- oder npm-Paketen. Eine Ausnahme für ein NuGet-Paket steht mit Begründung unter `build.prereleasePackages` in `project.yaml`.
- Eine bekannte Sicherheitslücke nur bewusst hinnehmen: mit Begründung unter `build.ignoreAdvisories`.
- `Bfs.Seed.*`, `@blackforestsentinel/seed-web-*` und die Refs auf seed-pipelines (`azure-pipelines.yml`) und seed-terraform (`infra/*.tf`) gemeinsam auf Release-Versionen anheben, nach den Release-Notes.

## Ausnahmen

- Eine Regel auszusetzen braucht eine Begründung, die im PR steht:
  - `[SuppressMessage("Kategorie", "ID", Justification = "Grund")]` am kleinsten passenden Element;
  - `#pragma warning disable ID // Grund`, mit `#pragma warning restore ID` direkt danach.
- Kein `<NoWarn>` in Projektdateien und keine abgeschwächte Schwere in `.editorconfig` ohne Begründung im Kommentar daneben.

## Build und Format

- Warnungen gelten in der Pipeline als Fehler: Compiler, Nullable, Analyzer, Code-Stil. Lokal dasselbe mit `-warnaserror`.
- Vor dem Commit `dotnet format api/Api.slnx`; die Pipeline prüft mit `--verify-no-changes`.

## Befehle

Aus dem Wurzelordner des Repos:

| Zweck | API | Frontend (in `frontend/`) |
| --- | --- | --- |
| Abhängigkeiten | `dotnet restore api/Api.slnx` | `npm ci` |
| Build | `dotnet build api/Api.slnx -warnaserror` | `npm run build` |
| Tests | `dotnet test --solution api/Api.slnx` | `npm test` |
| Typen und Format | `dotnet format api/Api.slnx` (prüfen: `--verify-no-changes`) | `npm run typecheck`; einen Formatierer bringt das Template nicht mit |
| Lokal starten | `func start` in `api/Api` (vorher `local.settings.sample.json` nach `local.settings.json` kopieren) | `npm run dev` |

Infrastruktur: `terraform -chdir=infra fmt -check`, `terraform -chdir=infra init -backend=false` und `terraform -chdir=infra validate`. Plan und Apply macht nur die Pipeline.

In Claude Code laufen diese Prüfungen nach Änderungen unter `api/` oder `frontend/` von selbst, bevor eine Antwort endet; beim Start einer Sitzung meldet ein Hook veraltete Seed-Bausteine (`.claude/settings.json`, Skripte in `.claude/hooks/`). Meldet der Hook einen Fehler, die Ursache beheben, nicht den Hook umgehen.

## Dokumentation

- `README.md` dieses Repos: Features, `project.yaml`, lokale Entwicklung.
- READMEs der Seed-Repos unter github.com/blackforestsentinel: `seed-template` (diese Vorlage), `seed-pipelines` (Pipeline und Parameter), `seed-terraform` (Module), `seed-packages` (`Bfs.Seed.*` und `@blackforestsentinel/seed-web-*`, je Paket eine README).
