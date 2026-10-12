using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Bfs.Seed.OpenApi;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Options;
using System.ComponentModel;

namespace Api.Settings;

/// <summary>
/// Beispiel für eine geschützte Function: nur mit der Capability settings.manage, die in
/// project.yaml die Rolle Admin vergibt. Ohne sie antwortet die API mit 403. Ersetzen oder löschen.
/// </summary>
[RequireCapability("settings.manage")]
public sealed class SettingsFunction(IOptions<SeedOptions> options)
{
    [Function("Settings")]
    [OpenApiOperation("GetSettings", "Einstellungen abrufen", Description = "Projekt und Umgebung der API; nur mit der Berechtigung settings.manage.")]
    [OpenApiResponse(200, typeof(SettingsInfo), Description = "Einstellungen")]
    [OpenApiResponse(401, Description = "Ohne gültiges Token")]
    [OpenApiResponse(403, Description = "Ohne die Berechtigung settings.manage")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "settings")] HttpRequest request)
        => new OkObjectResult(new SettingsInfo(options.Value.Project, options.Value.Environment));
}

/// <summary>Antwort von GET /api/settings; ein Record statt eines anonymen Objekts, damit openapi.json ein Schema hat.</summary>
public sealed record SettingsInfo(
    [property: Description("Projektname aus project.yaml")] string Project,
    [property: Description("Umgebung, etwa dev oder prod")] string Environment);
