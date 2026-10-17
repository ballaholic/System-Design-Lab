using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using SystemDesignLab.Api.Features.Mentor;

namespace SystemDesignLab.Api.Tests.Infrastructure;

/// <summary>A scripted Claude: each call takes the next script, records the request and replays the events.</summary>
public sealed class FakeClaude : IClaudeClient
{
    private readonly ConcurrentQueue<Func<ClaudeRequest, CancellationToken, IAsyncEnumerable<ClaudeStreamEvent>>> _scripts = new();

    public ConcurrentQueue<ClaudeRequest> Requests { get; } = new();

    public FakeClaude Reply(string text, TokenUsage? usage = null, string stopReason = "end_turn")
    {
        _scripts.Enqueue((_, _) => Events(text, usage ?? new TokenUsage(1000, 200, 0, 0), stopReason));
        return this;
    }

    public FakeClaude Fail(Exception exception)
    {
        _scripts.Enqueue((_, _) => Throw(exception));
        return this;
    }

    /// <summary>Replies only after <paramref name="release"/> completes, to hold a request in flight.</summary>
    public FakeClaude ReplyAfter(Task release, string text)
    {
        _scripts.Enqueue((_, ct) => Delayed(release, text, ct));
        return this;
    }

    public IAsyncEnumerable<ClaudeStreamEvent> StreamAsync(ClaudeRequest request, CancellationToken cancellationToken)
    {
        Requests.Enqueue(request);
        if (!_scripts.TryDequeue(out var script)) throw new InvalidOperationException("FakeClaude has no scripted reply left.");
        return script(request, cancellationToken);
    }

    private static async IAsyncEnumerable<ClaudeStreamEvent> Events(string text, TokenUsage usage, string stopReason)
    {
        await Task.Yield();
        // Split into a few deltas, the way a real stream arrives.
        var size = Math.Max(1, text.Length / 3);
        for (var i = 0; i < text.Length; i += size) yield return new ClaudeTextDelta(text.Substring(i, Math.Min(size, text.Length - i)));
        yield return new ClaudeCompleted(stopReason, usage);
    }

    private static async IAsyncEnumerable<ClaudeStreamEvent> Delayed(Task release, string text, [EnumeratorCancellation] CancellationToken ct)
    {
        await release.WaitAsync(ct);
        yield return new ClaudeTextDelta(text);
        yield return new ClaudeCompleted("end_turn", new TokenUsage(100, 10, 0, 0));
    }

#pragma warning disable CS1998 // An iterator that throws before yielding needs no await.
    private static async IAsyncEnumerable<ClaudeStreamEvent> Throw(Exception exception)
    {
        throw exception;
#pragma warning disable CS0162
        yield break;
#pragma warning restore CS0162
    }
#pragma warning restore CS1998
}
