using Api.Health;
using Microsoft.Extensions.Configuration;

namespace Api.Tests;

public class HealthReportTests
{
    [Fact]
    public void Create_ReadsProjectAndEnvironmentFromConfiguration()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Seed:Project"] = "kundenportal",
                ["Seed:Environment"] = "dev",
            })
            .Build();

        var report = HealthReport.Create(configuration);

        Assert.Equal("ok", report.Status);
        Assert.Equal("kundenportal", report.Project);
        Assert.Equal("dev", report.Environment);
    }

    [Fact]
    public void Create_FallsBackToLocalWithoutConfiguration()
    {
        var report = HealthReport.Create(new ConfigurationBuilder().Build());

        Assert.Equal("local", report.Project);
        Assert.Equal("local", report.Environment);
    }
}
