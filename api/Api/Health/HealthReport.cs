using System.Reflection;
using Microsoft.Extensions.Configuration;

namespace Api.Health;

public sealed record HealthReport(string Status, string Project, string Environment, string Version)
{
    public static HealthReport Create(IConfiguration configuration) => new(
        Status: "ok",
        Project: configuration["Seed:Project"] ?? "local",
        Environment: configuration["Seed:Environment"] ?? "local",
        Version: typeof(HealthReport).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0");
}
