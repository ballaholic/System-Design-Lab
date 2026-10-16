using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Tokens;

namespace AuthSpike.Api.Tests;

/// <summary>Stands in for a Supabase project: an ES256 signing key, its JWKS, and a token factory.</summary>
public sealed class TestAuthServer : WebApplicationFactory<Program>
{
    public const string ProjectUrl = "https://test-project.supabase.co";
    public const string Issuer = ProjectUrl + "/auth/v1";
    public const string JwksUri = Issuer + "/.well-known/jwks.json";

    public ECDsaSecurityKey SigningKey { get; } = NewKey("current-key");
    public List<string> RequestedJwksAddresses { get; } = [];

    /// <summary>Keys currently published in the JWKS; tests mutate this to simulate rotation.</summary>
    public List<ECDsaSecurityKey> PublishedKeys { get; }

    /// <summary>Overrides the unknown-kid refresh throttle (default 1 minute) so rotation tests run quickly.</summary>
    public TimeSpan? JwksRefreshInterval { get; init; }

    public TestAuthServer() => PublishedKeys = [SigningKey];

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Supabase:ProjectUrl", ProjectUrl);
        if (JwksRefreshInterval is { } interval) builder.UseSetting("Supabase:JwksRefreshInterval", interval.ToString("c"));
        builder.ConfigureTestServices(services =>
            services.AddSingleton<IDocumentRetriever>(new StaticJwksRetriever(this)));
    }

    public static ECDsaSecurityKey NewKey(string keyId) =>
        new(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = keyId };

    public string CreateToken(
        Guid? userId = null,
        string issuer = Issuer,
        string audience = "authenticated",
        DateTime? expires = null,
        SigningCredentials? credentials = null,
        IDictionary<string, object>? overrides = null)
    {
        var now = DateTime.UtcNow;
        var claims = new Dictionary<string, object>
        {
            ["sub"] = (userId ?? Guid.NewGuid()).ToString(),
            ["email"] = "learner@example.com",
            ["role"] = "authenticated",
            ["aal"] = "aal1",
            ["is_anonymous"] = false,
            ["session_id"] = Guid.NewGuid().ToString(),
            ["user_metadata"] = new Dictionary<string, object> { ["email_verified"] = true },
            ["amr"] = new object[] { new Dictionary<string, object> { ["method"] = "password", ["timestamp"] = 1760000000 } },
        };
        foreach (var (k, v) in overrides ?? new Dictionary<string, object>()) claims[k] = v;

        var exp = expires ?? now.AddHours(1);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = exp.AddHours(-1),
            NotBefore = exp.AddHours(-1),
            Expires = exp,
            Claims = claims,
            SigningCredentials = credentials ?? new SigningCredentials(SigningKey, SecurityAlgorithms.EcdsaSha256),
        });
    }

    private sealed class StaticJwksRetriever(TestAuthServer server) : IDocumentRetriever
    {
        public Task<string> GetDocumentAsync(string address, CancellationToken cancel)
        {
            lock (server.PublishedKeys)
            {
                server.RequestedJwksAddresses.Add(address);
                var keys = server.PublishedKeys
                    .Select(JsonWebKeyConverter.ConvertFromECDsaSecurityKey)
                    .Select(jwk => new { kty = jwk.Kty, crv = jwk.Crv, x = jwk.X, y = jwk.Y, kid = jwk.Kid, alg = "ES256", use = "sig" })
                    .ToArray();
                return Task.FromResult(JsonSerializer.Serialize(new { keys }));
            }
        }
    }
}
