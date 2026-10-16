using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Tokens;

namespace SystemDesignLab.Api.Tests.Infrastructure;

/// <summary>Stands in for a Supabase project: an ES256 signing key, its JWKS document, and a token factory.</summary>
public static class TestTokens
{
    public const string ProjectUrl = "https://test-project.supabase.co";
    public const string Issuer = ProjectUrl + "/auth/v1";

    public static readonly ECDsaSecurityKey SigningKey = new(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "test-key" };

    public static string Create(
        Guid userId,
        string email = "learner@example.com",
        Dictionary<string, object>? userMetadata = null,
        string issuer = Issuer,
        string audience = "authenticated",
        DateTime? expires = null,
        SigningCredentials? credentials = null,
        IDictionary<string, object>? overrides = null)
    {
        var exp = expires ?? DateTime.UtcNow.AddHours(1);
        var claims = new Dictionary<string, object>
        {
            ["sub"] = userId.ToString(),
            ["email"] = email,
            ["role"] = "authenticated",
            ["aal"] = "aal1",
            ["is_anonymous"] = false,
            ["user_metadata"] = userMetadata ?? new Dictionary<string, object> { ["email_verified"] = true },
        };
        foreach (var (key, value) in overrides ?? new Dictionary<string, object>()) claims[key] = value;

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

    /// <summary>Serves the test JWKS in place of https://test-project.supabase.co/auth/v1/.well-known/jwks.json.</summary>
    public sealed class JwksRetriever : IDocumentRetriever
    {
        public Task<string> GetDocumentAsync(string address, CancellationToken cancel)
        {
            if (address != Issuer + "/.well-known/jwks.json") throw new InvalidOperationException($"Unexpected JWKS address {address}");
            var jwk = JsonWebKeyConverter.ConvertFromECDsaSecurityKey(SigningKey);
            var keys = new[] { new { kty = jwk.Kty, crv = jwk.Crv, x = jwk.X, y = jwk.Y, kid = jwk.Kid, alg = "ES256", use = "sig" } };
            return Task.FromResult(JsonSerializer.Serialize(new { keys }));
        }
    }
}
