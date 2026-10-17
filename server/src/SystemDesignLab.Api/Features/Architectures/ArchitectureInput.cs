using System.Text.RegularExpressions;

namespace SystemDesignLab.Api.Features.Architectures;

/// <summary>Field rules shared by create, rename and import. Errors are keyed by JSON field name.</summary>
internal static partial class ArchitectureInput
{
    [GeneratedRegex("^[a-z0-9-]{1,64}$")]
    private static partial Regex ChallengeSlugPattern();

    public static string NormalizeTitle(string? title) => title?.Trim() ?? "";

    public static string? NormalizeDescription(string? description) =>
        string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    public static void ValidateTitle(string title, string key, Dictionary<string, string[]> errors)
    {
        if (title.Length == 0) errors[key] = ["Title is required."];
        else if (title.Length > Architecture.MaxTitleLength)
            errors[key] = [$"Title must be at most {Architecture.MaxTitleLength} characters."];
        else if (title.Any(char.IsControl)) errors[key] = ["Title cannot contain control characters."];
    }

    public static void ValidateDescription(string? description, string key, Dictionary<string, string[]> errors)
    {
        if (description is { Length: > Architecture.MaxDescriptionLength })
            errors[key] = [$"Description must be at most {Architecture.MaxDescriptionLength} characters."];
    }

    public static void ValidateChallengeSlug(string? slug, string key, Dictionary<string, string[]> errors)
    {
        if (slug is not null && !ChallengeSlugPattern().IsMatch(slug))
            errors[key] = ["Challenge slug must be 1-64 lowercase letters, digits or dashes."];
    }

    /// <summary>Parses <c>If-Match: "3"</c> (also accepts a bare or weak tag). Null when absent; -1 when malformed.</summary>
    public static int? ParseIfMatch(string? header)
    {
        if (string.IsNullOrWhiteSpace(header)) return null;
        var value = header.Trim();
        if (value.StartsWith("W/", StringComparison.Ordinal)) value = value[2..];
        value = value.Trim('"');
        return int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var version)
            ? version
            : -1;
    }

    public static string ETag(int version) => $"\"{version}\"";
}
