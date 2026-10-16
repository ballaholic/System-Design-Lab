using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace AuthSpike.Api.Tests;

public sealed class TokenValidationTests(TestAuthServer server) : IClassFixture<TestAuthServer>
{
    private async Task<HttpResponseMessage> GetMe(string? token)
    {
        var client = server.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/me");
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Valid_token_identifies_the_user_from_sub()
    {
        var userId = Guid.NewGuid();

        var response = await GetMe(server.CreateToken(userId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(userId, body.GetProperty("id").GetGuid());
        Assert.Equal("learner@example.com", body.GetProperty("email").GetString());
        Assert.True(body.GetProperty("emailVerified").GetBoolean());
        Assert.Equal(["password"], body.GetProperty("authMethods").EnumerateArray().Select(m => m.GetString()));
        Assert.Equal("ES256", body.GetProperty("token").GetProperty("algorithm").GetString());
    }

    [Fact]
    public async Task Signing_keys_are_fetched_from_the_supabase_jwks_endpoint()
    {
        await GetMe(server.CreateToken());

        Assert.Contains(TestAuthServer.JwksUri, server.RequestedJwksAddresses);
    }

    [Fact]
    public async Task Missing_token_returns_problem_details()
    {
        var response = await GetMe(null);

        await AssertUnauthorizedProblem(response, "A bearer token is required.");
    }

    public static TheoryData<string, Func<TestAuthServer, string>> InvalidTokens => new()
    {
        { "expired", s => s.CreateToken(expires: DateTime.UtcNow.AddMinutes(-5)) },
        { "wrong issuer", s => s.CreateToken(issuer: "https://other-project.supabase.co/auth/v1") },
        { "wrong audience", s => s.CreateToken(audience: "anon") },
        {
            "signed by an unknown key with the same kid",
            s => s.CreateToken(credentials: new SigningCredentials(TestAuthServer.NewKey("current-key"), SecurityAlgorithms.EcdsaSha256))
        },
        {
            "legacy HS256 shared secret",
            s => s.CreateToken(credentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes("test-only-fake-hs256-key-not-a-real-secret-0000")),
                SecurityAlgorithms.HmacSha256))
        },
        { "tampered payload", s => Tamper(s.CreateToken()) },
        { "unsigned (alg none)", s => Unsigned(s.CreateToken()) },
        { "anonymous user", s => s.CreateToken(overrides: new Dictionary<string, object> { ["is_anonymous"] = true }) },
        { "non-authenticated role", s => s.CreateToken(overrides: new Dictionary<string, object> { ["role"] = "service_role" }) },
        { "non-UUID subject", s => s.CreateToken(overrides: new Dictionary<string, object> { ["sub"] = "not-a-uuid" }) },
    };

    [Theory]
    [MemberData(nameof(InvalidTokens))]
    public async Task Invalid_tokens_are_rejected(string _, Func<TestAuthServer, string> makeToken)
    {
        var response = await GetMe(makeToken(server));

        await AssertUnauthorizedProblem(response, "The bearer token is invalid or expired.");
    }

    [Fact]
    public async Task Health_endpoint_is_anonymous()
    {
        var response = await server.CreateClient().GetAsync("/health", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task AssertUnauthorizedProblem(HttpResponseMessage response, string detail)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("https://systemdesignlab.dev/problems/unauthorized", problem.GetProperty("type").GetString());
        Assert.Equal(detail, problem.GetProperty("detail").GetString());
    }

    /// <summary>Swaps the payload for one with a different sub while keeping the original signature.</summary>
    private static string Tamper(string token)
    {
        var parts = token.Split('.');
        var json = Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(parts[1]));
        var payload = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
        var changed = payload.ToDictionary(kv => kv.Key, kv => (object)kv.Value);
        changed["sub"] = Guid.NewGuid().ToString();
        parts[1] = Base64UrlEncoder.Encode(JsonSerializer.Serialize(changed));
        return string.Join('.', parts);
    }

    private static string Unsigned(string token)
    {
        var parts = token.Split('.');
        var header = Base64UrlEncoder.Encode("""{"alg":"none","typ":"JWT"}""");
        return $"{header}.{parts[1]}.";
    }
}
