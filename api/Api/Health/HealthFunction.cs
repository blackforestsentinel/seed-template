using Bfs.Seed.Functions.Core;
using Bfs.Seed.OpenApi;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Options;

namespace Api.Health;

/// <summary>
/// Anonymer Health-Endpunkt. Der Smoke-Test der Pipeline und das Frontend rufen ihn auf.
/// [AllowAnonymous] nimmt ihn von der Token-Prüfung aus, wenn das Feature sso aktiv ist.
/// Fehlen Secrets (Feature keyVault), meldet er status "degraded" mit deren Namen, bleibt aber
/// bei 200, damit der erste Deploy vor dem Setzen der Werte durchläuft.
/// </summary>
[AllowAnonymous]
public sealed class HealthFunction(IOptions<SeedOptions> options, SeedSecrets secrets)
{
    [Function("Health")]
    [OpenApiOperation("GetHealth", "Status der API abrufen", Description = "Status, Projekt, Umgebung und Version der API.", Visibility = OpenApiVisibility.Internal)]
    [OpenApiResponse(200, typeof(SeedHealthReport), Description = "Status ok oder degraded")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest request)
        => new OkObjectResult(SeedHealthReport.Create(options.Value, typeof(HealthFunction).Assembly, secrets));
}
