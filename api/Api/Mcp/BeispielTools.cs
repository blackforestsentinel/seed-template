using System.ComponentModel;
using System.Security.Claims;
using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;

namespace Api.Mcp;

/// <summary>
/// Beispiel-Werkzeuge für den MCP-Endpunkt (Feature mcp). Die Klasse entsteht je Aufruf neu,
/// Abhängigkeiten kommen aus der Dependency Injection, die angemeldete Person als
/// <see cref="ClaimsPrincipal"/>-Parameter. Name, Beschreibung und Parameterbeschreibungen liest
/// das Modell; daraus entsteht auch das Schema, gegen das die Argumente geprüft werden.
/// </summary>
[McpServerToolType]
public sealed class BeispielTools(IOptions<SeedOptions> options)
{
    /// <summary>Frei für alle Angemeldeten: Wer fragt, mit welchen Berechtigungen.</summary>
    [McpServerTool(Name = "ueberblick_abrufen", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("Nennt die anfragende Person, ihre App-Rollen und Berechtigungen sowie Projekt und Umgebung. Rufe dieses Werkzeug zuerst auf.")]
    public Ueberblick UeberblickAbrufen(ClaimsPrincipal user) => new(
        Person: user.FindFirst("name")?.Value ?? "unbekannt",
        Rollen: [.. user.GetRoles().Order(StringComparer.Ordinal)],
        Berechtigungen: [.. user.GetCapabilities().Order(StringComparer.Ordinal)],
        Projekt: options.Value.Project,
        Umgebung: options.Value.Environment);

    /// <summary>
    /// Nur mit der Capability <c>status.read</c>: Ohne sie fehlt das Werkzeug in tools/list,
    /// ein Aufruf liefert eine Fehlermeldung mit der fehlenden Berechtigung.
    /// </summary>
    [McpServerTool(Name = "status_abrufen", ReadOnly = true, Idempotent = true, OpenWorld = false)]
    [Description("Liefert Status und Version der API dieses Projekts.")]
    [RequireCapability("status.read")]
    public SeedHealthReport StatusAbrufen() => SeedHealthReport.Create(options.Value, typeof(BeispielTools).Assembly);
}

/// <param name="Person">Anzeigename der angemeldeten Person.</param>
/// <param name="Rollen">App-Rollen aus dem Token.</param>
/// <param name="Berechtigungen">Capabilities, die aus den App-Rollen folgen.</param>
/// <param name="Projekt">Projektname aus project.yaml.</param>
/// <param name="Umgebung">Umgebung, z. B. dev.</param>
public sealed record Ueberblick(string Person, string[] Rollen, string[] Berechtigungen, string Projekt, string Umgebung);
