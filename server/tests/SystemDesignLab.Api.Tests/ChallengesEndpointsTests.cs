using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SystemDesignLab.Api.Tests.Infrastructure;

namespace SystemDesignLab.Api.Tests;

/// <summary>The challenge catalog is anonymous and needs no database.</summary>
public sealed class ChallengesEndpointsTests(DefaultApiFactory api) : IClassFixture<DefaultApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Lists_challenges_anonymously_with_cache_headers()
    {
        var response = await api.CreateClient().GetAsync("/api/challenges", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("public, max-age=300", response.Headers.CacheControl?.ToString());
        var item = Assert.Single((await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("items").EnumerateArray());
        Assert.Equal("url-shortener", item.GetProperty("slug").GetString());
        Assert.Equal(1, item.GetProperty("version").GetInt32());
        Assert.Equal("beginner", item.GetProperty("difficulty").GetString());
        Assert.Equal(3, item.GetProperty("stageCount").GetInt32());
        Assert.Equal("Going viral", item.GetProperty("stages")[1].GetProperty("title").GetString());
        Assert.False(item.TryGetProperty("stages", out var stages) && stages[0].TryGetProperty("criteria", out _));
    }

    [Fact]
    public async Task Gets_a_challenge_with_briefs_and_the_starter_design()
    {
        var challenge = await api.CreateClient().GetFromJsonAsync<JsonElement>("/api/challenges/url-shortener", Ct);

        Assert.Equal("URL Shortener", challenge.GetProperty("title").GetString());
        var stage = challenge.GetProperty("stages")[0];
        Assert.StartsWith("You're launching a link shortener.", stage.GetProperty("briefMd").GetString(), StringComparison.Ordinal);
        Assert.Equal("s1-baseline.md", stage.GetProperty("brief").GetString());
        Assert.Equal(7, stage.GetProperty("criteria").GetArrayLength());
        Assert.Equal("users", challenge.GetProperty("starter").GetProperty("nodes")[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Unknown_challenges_return_404_problem_details()
    {
        var response = await api.CreateClient().GetAsync("/api/challenges/nope", Ct);
        await TestData.ProblemAsync(response, HttpStatusCode.NotFound, "not-found");
    }

    public static TheoryData<string, string> ProtectedRoutes => new()
    {
        { "GET", "/api/attempts" },
        { "POST", "/api/attempts" },
        { "GET", $"/api/attempts/{Guid.Empty}" },
        { "PATCH", $"/api/attempts/{Guid.Empty}" },
        { "GET", $"/api/architectures/{Guid.Empty}/snapshots" },
        { "POST", $"/api/architectures/{Guid.Empty}/snapshots" },
    };

    [Theory]
    [MemberData(nameof(ProtectedRoutes))]
    public async Task Attempts_and_snapshots_require_a_bearer_token(string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        if (method is "POST" or "PATCH") request.Content = JsonContent.Create(new { });

        var response = await api.CreateClient().SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
