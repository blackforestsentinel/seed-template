using System.Text.Json.Nodes;
using Api.Health;
using Bfs.Seed.OpenApi;

namespace Api.Tests;

/// <summary>
/// openapi.json für den Custom Connector (Feature customConnector): Jede HTTP-Function ist
/// beschrieben, und der Build meldet keine Warnungen aus Bfs.Seed.OpenApi.
/// </summary>
public sealed class OpenApiTests
{
    private static readonly SeedOpenApiResult Result = SeedOpenApiDocument.Generate(typeof(HealthFunction).Assembly);

    [Fact]
    public void KeineWarnungen() => Assert.Empty(Result.Warnings);

    [Fact]
    public void AlleOperationenOhneMcpUndQueue()
    {
        var operations = Result.Document["paths"]!.AsObject()
            .SelectMany(path => path.Value!.AsObject().Select(op => op.Value!["operationId"]!.GetValue<string>()))
            .Order()
            .ToArray();

        Assert.Equal(["CreateJob", "GetHealth", "GetJob", "GetMe", "GetSettings"], operations);
    }

    [Fact]
    public void NurHealthOhneToken()
    {
        var paths = Result.Document["paths"]!.AsObject();
        Assert.Null(paths["/health"]!["get"]!["security"]);
        Assert.NotNull(paths["/me"]!["get"]!["security"]);
        Assert.IsType<JsonArray>(paths["/settings"]!["get"]!["security"]);
    }
}
