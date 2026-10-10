using Api.Health;
using Bfs.Seed.Functions.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace Api.Tests;

public class HealthFunctionTests
{
    private static HealthFunction Create(params (string Key, string Value)[] settings) => new(
        Options.Create(new SeedOptions { Project = "kundenportal", Environment = "dev" }),
        new SeedSecrets(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build()));

    [Fact]
    public void Run_ReturnsReportForConfiguredProject()
    {
        var result = Assert.IsType<OkObjectResult>(Create().Run(new DefaultHttpContext().Request));

        var report = Assert.IsType<SeedHealthReport>(result.Value);
        Assert.Equal(("ok", "kundenportal", "dev"), (report.Status, report.Project, report.Environment));
    }

    [Fact]
    public void Run_ReportsPlaceholderSecretsWithStatus200()
    {
        var function = Create(("Secrets:StripeKey", "seed-placeholder:stripe-key"));

        var result = Assert.IsType<OkObjectResult>(function.Run(new DefaultHttpContext().Request));

        var report = Assert.IsType<SeedHealthReport>(result.Value);
        Assert.Equal("degraded", report.Status);
        Assert.Equal("stripe-key", Assert.Single(report.Secrets).Secret);
    }
}
