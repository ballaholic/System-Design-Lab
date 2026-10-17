namespace SystemDesignLab.Api.Common;

/// <summary>Stable problem "type" URIs (RFC 9457). These are part of the API contract (ADR-017).</summary>
public static class ProblemTypes
{
    private const string Base = "https://systemdesignlab.dev/problems/";

    public const string Unauthorized = Base + "unauthorized";
    public const string Forbidden = Base + "forbidden";
    public const string NotFound = Base + "not-found";
    public const string Validation = Base + "validation";
    public const string DocumentTooLarge = Base + "document-too-large";
    public const string Conflict = Base + "conflict";
    public const string AttemptInProgress = Base + "attempt-in-progress";
    public const string AttemptNotInProgress = Base + "attempt-not-in-progress";
    public const string PreconditionRequired = Base + "precondition-required";
    public const string RateLimited = Base + "rate-limited";
    public const string EmailNotVerified = Base + "email-not-verified";
    public const string MentorUnavailable = Base + "mentor-unavailable";
    public const string MentorBusy = Base + "mentor-busy";
    public const string MentorQuotaExceeded = Base + "mentor-quota-exceeded";
    public const string MentorPaused = Base + "mentor-paused";
    public const string MentorFailed = Base + "mentor-failed";
    public const string Unexpected = Base + "unexpected";
}
