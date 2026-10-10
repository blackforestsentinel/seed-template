using Api.Health;
using Bfs.Seed.Functions.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Tests;

public class HealthFunctionTests
{
    [Fact]
    public void Run_ReturnsReportForConfiguredProject()
    {
        var function = new HealthFunction(Options.Create(new SeedOptions { Project = "kundenportal", Environment = "dev" }));

        var result = Assert.IsType<OkObjectResult>(function.Run(new DefaultHttpContext().Request));

        var report = Assert.IsType<SeedHealthReport>(result.Value);
        Assert.Equal(("ok", "kundenportal", "dev"), (report.Status, report.Project, report.Environment));
    }
}
