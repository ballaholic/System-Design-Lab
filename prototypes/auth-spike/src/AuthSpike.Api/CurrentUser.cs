using System.Security.Claims;
using System.Text.Json;

namespace AuthSpike.Api;

/// <summary>The identity the API derives from a validated Supabase access token. The user id comes only from `sub`.</summary>
public sealed record CurrentUser(Guid Id, string? Email, bool? EmailVerified, string? AuthenticatorAssuranceLevel, IReadOnlyList<string> AuthMethods)
{
    public static CurrentUser FromPrincipal(ClaimsPrincipal principal) => new(
        Id: Guid.Parse(principal.FindFirst("sub")!.Value),
        Email: principal.FindFirst("email")?.Value,
        EmailVerified: ReadEmailVerified(principal),
        AuthenticatorAssuranceLevel: principal.FindFirst("aal")?.Value,
        AuthMethods: ReadAuthMethods(principal));

    // Supabase puts email_verified inside the user_metadata object claim, not at the top level.
    private static bool? ReadEmailVerified(ClaimsPrincipal principal)
    {
        var metadata = principal.FindFirst("user_metadata")?.Value;
        if (string.IsNullOrEmpty(metadata)) return null;
        using var doc = JsonDocument.Parse(metadata);
        return doc.RootElement.TryGetProperty("email_verified", out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;
    }

    // amr is an array of { method, timestamp } objects; each element arrives as its own JSON claim.
    private static IReadOnlyList<string> ReadAuthMethods(ClaimsPrincipal principal) =>
        principal.FindAll("amr")
            .Select(c =>
            {
                if (!c.Value.StartsWith('{')) return c.Value;
                using var doc = JsonDocument.Parse(c.Value);
                return doc.RootElement.TryGetProperty("method", out var m) ? m.GetString() ?? "" : "";
            })
            .Where(m => m.Length > 0)
            .ToList();
}
