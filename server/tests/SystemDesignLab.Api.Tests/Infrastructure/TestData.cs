using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SystemDesignLab.Api.Tests.Infrastructure;

/// <summary>Small builders and assertions shared by the endpoint tests.</summary>
public static class TestData
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static JsonObject Document(int nodes = 1)
    {
        var nodeArray = new JsonArray();
        var layout = new JsonObject();
        for (var i = 0; i < nodes; i++)
        {
            nodeArray.Add(new JsonObject
            {
                ["id"] = $"n{i}",
                ["type"] = "load-balancer",
                ["label"] = $"LB {i}",
                ["config"] = new JsonObject { ["capacityRps"] = 50000 },
            });
            layout[$"n{i}"] = new JsonObject { ["x"] = i * 10, ["y"] = 0 };
        }
        return new JsonObject
        {
            ["schemaVersion"] = 1,
            ["operations"] = new JsonArray(new JsonObject { ["id"] = "read", ["name"] = "Read", ["kind"] = "read", ["share"] = 1 }),
            ["nodes"] = nodeArray,
            ["edges"] = new JsonArray(),
            ["layout"] = layout,
        };
    }

    public static async Task<Guid> CreateArchitectureAsync(HttpClient client, int nodes = 1)
    {
        var response = await client.PostAsJsonAsync("/api/architectures", new { title = "Design", document = Document(nodes) }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();
    }

    public static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal($"https://systemdesignlab.dev/problems/{type}", problem.GetProperty("type").GetString());
        return problem;
    }

    /// <summary>Asserts a 400 validation problem with an error for <paramref name="field"/>.</summary>
    public static async Task AssertInvalidAsync(HttpResponseMessage response, string field)
    {
        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "validation");
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty(field, out _), $"Expected an error for '{field}', got: {errors}");
    }
}
