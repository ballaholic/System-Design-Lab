namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>
/// AI mentor settings (ARCHITECTURE §8.2, §8.4). Read through <c>IOptionsMonitor</c>, so changing appsettings
/// (for example the kill switch) takes effect without a restart.
/// </summary>
public sealed class MentorOptions
{
    public const string Section = "Mentor";

    /// <summary>Kill switch. When false, every AI request is refused with 503.</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>Anthropic API key. Kept in user secrets or the environment, never in appsettings files.</summary>
    public string? ApiKey { get; init; }

    public long UserDailyBudgetMicros { get; init; } = 500_000;
    public long GlobalDailyBudgetMicros { get; init; } = 20_000_000;

    /// <summary>Messages a user may send per minute.</summary>
    public int MessagesPerMinute { get; init; } = 6;

    /// <summary>Earlier messages replayed with each request; older ones are dropped.</summary>
    public int MaxHistoryMessages { get; init; } = 20;

    public int MaxMessageLength { get; init; } = 4000;

    public Dictionary<string, MentorModeOptions> Modes { get; init; } = new(StringComparer.Ordinal)
    {
        [MentorModes.Tutor] = new() { Model = "claude-haiku-5-5", Effort = "low", MaxTokens = 2000, Thinking = false },
        [MentorModes.Interviewer] = new() { Model = "claude-sonnet-5-5", Effort = "low", MaxTokens = 2000 },
        [MentorModes.Reviewer] = new() { Model = "claude-sonnet-5-5", Effort = "medium", MaxTokens = 8000 },
    };

    /// <summary>USD per million tokens, per model. Must be kept in step with Anthropic's pricing.</summary>
    public Dictionary<string, ModelPrice> Prices { get; init; } = new(StringComparer.Ordinal)
    {
        ["claude-haiku-5-5"] = new() { Input = 0.10m, Output = 0.50m, CacheRead = 0.01m, CacheWrite = 0.125m },
        ["claude-sonnet-5-5"] = new() { Input = 2m, Output = 10m, CacheRead = 0.20m, CacheWrite = 2.50m },
    };

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public MentorModeOptions ModeOptions(string mode) =>
        Modes.TryGetValue(mode, out var options) ? options : throw new InvalidOperationException($"No settings for mentor mode \"{mode}\".");

    public ModelPrice PriceOf(string model) =>
        Prices.TryGetValue(model, out var price) ? price : throw new InvalidOperationException($"No price configured for model \"{model}\".");
}

public sealed class MentorModeOptions
{
    public string Model { get; init; } = "";

    /// <summary><c>low</c>, <c>medium</c>, <c>high</c> or <c>max</c>.</summary>
    public string Effort { get; init; } = "low";

    public int MaxTokens { get; init; } = 2000;

    /// <summary>
    /// Adaptive thinking. Turning it off shortens the time to the first token; only some models accept that
    /// (Claude Haiku 5.5 does at effort high or below, Claude Sonnet 5.5 doesn't).
    /// </summary>
    public bool Thinking { get; init; } = true;
}

/// <summary>USD per million tokens.</summary>
public sealed class ModelPrice
{
    public decimal Input { get; init; }
    public decimal Output { get; init; }
    public decimal CacheRead { get; init; }
    public decimal CacheWrite { get; init; }

    /// <summary>Micro-dollars: one USD per million tokens is one micro-dollar per token.</summary>
    public long CostMicros(TokenUsage usage) => (long)Math.Ceiling(
        usage.InputTokens * Input + usage.OutputTokens * Output + usage.CacheReadTokens * CacheRead + usage.CacheWriteTokens * CacheWrite);
}

public sealed record TokenUsage(long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens)
{
    public static readonly TokenUsage None = new(0, 0, 0, 0);
}

public static class MentorModes
{
    public const string Tutor = "tutor";
    public const string Interviewer = "interviewer";
    public const string Reviewer = "reviewer";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Tutor, Interviewer, Reviewer };
}
