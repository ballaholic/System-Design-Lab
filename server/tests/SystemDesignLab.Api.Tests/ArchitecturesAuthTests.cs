using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

/// <summary>
/// Architectures behaviour that needs no database: authentication, body limits (enforced while the body is read,
/// before the profile filter touches the database) and CORS.
/// </summary>
public sealed class ArchitecturesAuthTests(DefaultApiFactory api) : IClassFixture<DefaultApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static TheoryData<string, string> Routes => new()
    {
        { "GET", "/api/architectures" },
        { "POST", "/api/architectures" },
        { "POST", "/api/architectures/import" },
        { "GET", $"/api/architectures/{Guid.Empty}" },
        { "PUT", $"/api/architectures/{Guid.Empty}" },
        { "PATCH", $"/api/architectures/{Guid.Empty}" },
        { "DELETE", $"/api/architectures/{Guid.Empty}" },
        { "POST", $"/api/architectures/{Guid.Empty}/duplicate" },
    };

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task Routes_require_a_bearer_token(string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method is "POST" or "PUT" or "PATCH") request.Content = JsonContent.Create(new { });

        var response = await api.CreateClient().SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Cors_exposes_etag_and_location()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", ApiFactory.WebOrigin);

        var response = await api.CreateClient().SendAsync(request, Ct);

        var exposed = string.Join(",", response.Headers.GetValues("Access-Control-Expose-Headers"));
        Assert.Contains("ETag", exposed, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Location", exposed, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Bodies_over_the_endpoint_limit_return_413()
    {
        var payload = new StringContent(JsonSerializer.Serialize(new { title = "x", document = new { notes = new string('x', 600 * 1024) } }));
        payload.Headers.ContentType = new MediaTypeHeaderValue("application/json");

        // TestServer doesn't enforce body size limits, so this test runs the API on a real Kestrel server.
        await using var kestrel = new ApiFactory();
        kestrel.UseKestrel(0);
        kestrel.StartServer();

        var response = await kestrel.CreateClientFor(Guid.NewGuid()).PostAsync("/api/architectures", payload, Ct);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }
}
