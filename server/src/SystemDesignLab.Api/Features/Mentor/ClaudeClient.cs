using System.Runtime.CompilerServices;
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Options;

namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>
/// The only way the API talks to Claude (ADR-011). The mentor endpoints depend on this interface, so tests use a
/// scripted fake and never call the real API.
/// </summary>
public interface IClaudeClient
{
    IAsyncEnumerable<ClaudeStreamEvent> StreamAsync(ClaudeRequest request, CancellationToken cancellationToken);
}

/// <param name="System">System prompt blocks. The last block ends the cached prefix.</param>
/// <param name="OutputSchema">JSON Schema for structured output (Reviewer); null for free text.</param>
public sealed record ClaudeRequest(
    string Model,
    int MaxTokens,
    string Effort,
    bool Thinking,
    IReadOnlyList<string> System,
    IReadOnlyList<ClaudeMessage> Messages,
    IReadOnlyDictionary<string, JsonElement>? OutputSchema = null);

public sealed record ClaudeMessage(string Role, string Text);

public abstract record ClaudeStreamEvent;

public sealed record ClaudeTextDelta(string Text) : ClaudeStreamEvent;

/// <summary>The end of a response: why it stopped (<c>end_turn</c>, <c>max_tokens</c>, <c>refusal</c>…) and the usage.</summary>
public sealed record ClaudeCompleted(string? StopReason, TokenUsage Usage) : ClaudeStreamEvent;

/// <summary>Streams from the Messages API with the official Anthropic C# SDK.</summary>
public sealed class AnthropicClaudeClient(IOptionsMonitor<MentorOptions> options) : IClaudeClient, IDisposable
{
    private AnthropicClient? _client;
    private string? _clientKey;

    public async IAsyncEnumerable<ClaudeStreamEvent> StreamAsync(
        ClaudeRequest request, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        MessageCreateParams parameters = new()
        {
            Model = request.Model,
            MaxTokens = request.MaxTokens,
            System = request.System
                .Select((text, index) => new TextBlockParam
                {
                    Text = text,
                    CacheControl = index == request.System.Count - 1 ? new CacheControlEphemeral() : null,
                })
                .ToList(),
            Messages = request.Messages
                .Select(m => new MessageParam { Role = m.Role == MessageRoles.Assistant ? Role.Assistant : Role.User, Content = m.Text })
                .ToList(),
            OutputConfig = new OutputConfig
            {
                Effort = ParseEffort(request.Effort),
                Format = request.OutputSchema is { } schema ? new JsonOutputFormat { Schema = schema.ToDictionary() } : null,
            },
        };
        // Omitted, these models think adaptively; disabling it shortens the time to the first token.
        if (!request.Thinking) parameters = parameters with { Thinking = new ThinkingConfigDisabled() };

        long input = 0, cacheRead = 0, cacheWrite = 0, output = 0;
        string? stopReason = null;
        await foreach (var streamEvent in Client().Messages.CreateStreaming(parameters, cancellationToken))
        {
            if (streamEvent.TryPickStart(out var start))
            {
                input = start.Message.Usage.InputTokens;
                cacheRead = start.Message.Usage.CacheReadInputTokens ?? 0;
                cacheWrite = start.Message.Usage.CacheCreationInputTokens ?? 0;
            }
            else if (streamEvent.TryPickContentBlockDelta(out var delta) && delta.Delta.TryPickText(out var text))
            {
                yield return new ClaudeTextDelta(text.Text);
            }
            else if (streamEvent.TryPickDelta(out var messageDelta))
            {
                stopReason = messageDelta.Delta.StopReason?.ToString();
                output = messageDelta.Usage.OutputTokens;
            }
        }
        yield return new ClaudeCompleted(stopReason, new TokenUsage(input, output, cacheRead, cacheWrite));
    }

    /// <summary>
    /// One client per API key, recreated when the key changes in configuration. The old client isn't disposed, since a
    /// stream may still be using it; key changes are rare.
    /// </summary>
    private AnthropicClient Client()
    {
        var key = options.CurrentValue.ApiKey;
        if (_client is null || _clientKey != key)
        {
            _client = new AnthropicClient { ApiKey = key };
            _clientKey = key;
        }
        return _client;
    }

    public void Dispose() => _client?.Dispose();

    private static Effort ParseEffort(string effort) => effort switch
    {
        "medium" => Effort.Medium,
        "high" => Effort.High,
        "max" => Effort.Max,
        _ => Effort.Low,
    };
}
