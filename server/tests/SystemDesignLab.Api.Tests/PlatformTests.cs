using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

/// <summary>Cross-cutting behaviour that needs no database: auth, problem details, CORS, rate limiting.</summary>
public sealed class PlatformTests(DefaultApiFactory api) : IClassFixture<DefaultApiFactory>
{
    private readonly ApiFactory _api = api;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Health_is_anonymous()
    {
        var response = await _api.CreateClient().GetAsync("/health", Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Api_requires_a_bearer_token()
    {
        var response = await _api.CreateClient().GetAsync("/api/me", Ct);

        var problem = await AssertProblem(response, HttpStatusCode.Unauthorized, "https://systemdesignlab.dev/problems/unauthorized");
        Assert.Equal("A bearer token is required.", problem.GetProperty("detail").GetString());
    }

    public static TheoryData<string, Func<string>> InvalidTokens => new()
    {
        { "expired", () => TestTokens.Create(Guid.NewGuid(), expires: DateTime.UtcNow.AddMinutes(-5)) },
        { "another project", () => TestTokens.Create(Guid.NewGuid(), issuer: "https://other.supabase.co/auth/v1") },
        { "wrong audience", () => TestTokens.Create(Guid.NewGuid(), audience: "anon") },
        {
            "legacy HS256 secret",
            () => TestTokens.Create(Guid.NewGuid(), credentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes("test-only-fake-hs256-key-not-a-real-secret-0000")),
                SecurityAlgorithms.HmacSha256))
        },
        { "anonymous user", () => TestTokens.Create(Guid.NewGuid(), overrides: new Dictionary<string, object> { ["is_anonymous"] = true }) },
        { "service role", () => TestTokens.Create(Guid.NewGuid(), overrides: new Dictionary<string, object> { ["role"] = "service_role" }) },
    };

    [Theory]
    [MemberData(nameof(InvalidTokens))]
    public async Task Invalid_tokens_are_rejected(string _, Func<string> token)
    {
        var client = _api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token());

        var response = await client.GetAsync("/api/me", Ct);

        var problem = await AssertProblem(response, HttpStatusCode.Unauthorized, "https://systemdesignlab.dev/problems/unauthorized");
        Assert.Equal("The bearer token is invalid or expired.", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Unknown_routes_return_problem_details()
    {
        var response = await _api.CreateClient().GetAsync("/no-such-route", Ct);
        await AssertProblem(response, HttpStatusCode.NotFound, "https://systemdesignlab.dev/problems/not-found");
    }

    [Theory]
    [InlineData(ApiFactory.WebOrigin, true)]
    [InlineData("https://evil.example", false)]
    public async Task Cors_allows_only_the_web_app_origin(string origin, bool allowed)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/me");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "PATCH");
        request.Headers.Add("Access-Control-Request-Headers", "authorization,content-type");

        var response = await _api.CreateClient().SendAsync(request, Ct);

        Assert.Equal(allowed, response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) && values.Single() == origin);
    }

    [Fact]
    public async Task Rate_limit_returns_429_problem_with_retry_after()
    {
        await using var api = new ApiFactory(permitsPerMinute: 3);
        var client = api.CreateClient();

        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me", Ct)).StatusCode);
        var limited = await client.GetAsync("/api/me", Ct);

        await AssertProblem(limited, HttpStatusCode.TooManyRequests, "https://systemdesignlab.dev/problems/rate-limited");
        Assert.NotNull(limited.Headers.RetryAfter);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health", Ct)).StatusCode); // health is exempt
    }

    private static async Task<JsonElement> AssertProblem(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.Equal(type, problem.GetProperty("type").GetString());
        Assert.True(problem.TryGetProperty("traceId", out _), "problem details should carry a traceId");
        return problem;
    }
}
