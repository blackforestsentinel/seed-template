using Bfs.Seed.Auth;
using Bfs.Seed.Functions.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Options;

namespace Api.Settings;

/// <summary>
/// Beispiel für eine geschützte Function: nur mit der Capability settings.manage, die in
/// project.yaml die Rolle Admin vergibt. Ohne sie antwortet die API mit 403. Ersetzen oder löschen.
/// </summary>
[RequireCapability("settings.manage")]
public sealed class SettingsFunction(IOptions<SeedOptions> options)
{
    [Function("Settings")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "settings")] HttpRequest request)
        => new OkObjectResult(new { options.Value.Project, options.Value.Environment });
}
