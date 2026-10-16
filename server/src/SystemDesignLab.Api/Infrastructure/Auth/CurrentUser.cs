using System.Reflection;
using System.Security.Claims;
using System.Text.Json;

namespace SystemDesignLab.Api.Infrastructure.Auth;

/// <summary>
/// The identity derived from a validated Supabase access token. The user id comes only from <c>sub</c>.
/// Endpoints receive it as a parameter (minimal API binding via <see cref="BindAsync"/>).
/// </summary>
public sealed record CurrentUser(
    Guid Id,
    string? Email,
    bool? EmailVerified,
    string SuggestedDisplayName,
    string? SuggestedAvatarUrl)
{
    public const int MaxDisplayNameLength = 60;

    public static ValueTask<CurrentUser?> BindAsync(HttpContext context, ParameterInfo parameter) =>
        ValueTask.FromResult(context.User.Identity?.IsAuthenticated == true ? FromPrincipal(context.User) : null);

    public static CurrentUser FromPrincipal(ClaimsPrincipal principal)
    {
        var email = principal.FindFirst("email")?.Value;
        using var metadata = ParseObject(principal.FindFirst("user_metadata")?.Value);
        var meta = metadata?.RootElement;

        return new CurrentUser(
            Id: Guid.Parse(principal.FindFirst("sub")!.Value),
            Email: string.IsNullOrWhiteSpace(email) ? null : email,
            // Supabase puts email_verified inside user_metadata, not at the top level. Not yet observed on a live
            // token: confirm with GET /api/me against the hosted project (Phase 1 acceptance).
            EmailVerified: meta is { } m && m.TryGetProperty("email_verified", out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? v.GetBoolean()
                : null,
            SuggestedDisplayName: SuggestDisplayName(meta, email),
            SuggestedAvatarUrl: SuggestAvatarUrl(meta));
    }

    /// <summary>Sign-up form name, then Google profile names, then the email local part.</summary>
    private static string SuggestDisplayName(JsonElement? metadata, string? email)
    {
        foreach (var key in new[] { "display_name", "full_name", "name" })
        {
            if (metadata is { } m && m.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String)
            {
                var name = value.GetString()!.Trim();
                if (name.Length > 0) return Truncate(name);
            }
        }
        var localPart = email?.Split('@')[0].Trim();
        return string.IsNullOrEmpty(localPart) ? "Learner" : Truncate(localPart);
    }

    private static string? SuggestAvatarUrl(JsonElement? metadata)
    {
        foreach (var key in new[] { "avatar_url", "picture" })
        {
            if (metadata is { } m && m.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
                && Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps
                && uri.OriginalString.Length <= 2048)
            {
                return uri.OriginalString;
            }
        }
        return null;
    }

    private static string Truncate(string value) => value.Length <= MaxDisplayNameLength ? value : value[..MaxDisplayNameLength];

    private static JsonDocument? ParseObject(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Object) return doc;
            doc.Dispose();
        }
        catch (JsonException)
        {
            // Malformed metadata is ignored; the identity itself (sub) is unaffected.
        }
        return null;
    }
}
