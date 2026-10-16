namespace SystemDesignLab.Api.Common;

/// <summary>Stable problem "type" URIs (RFC 9457). These are part of the API contract (ADR-017).</summary>
public static class ProblemTypes
{
    private const string Base = "https://systemdesignlab.dev/problems/";

    public const string Unauthorized = Base + "unauthorized";
    public const string Forbidden = Base + "forbidden";
    public const string NotFound = Base + "not-found";
    public const string Validation = Base + "validation";
    public const string RateLimited = Base + "rate-limited";
    public const string Unexpected = Base + "unexpected";
}
