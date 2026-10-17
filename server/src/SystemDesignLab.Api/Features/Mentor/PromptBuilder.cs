using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SystemDesignLab.Api.Features.Challenges;

namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>The challenge stage a conversation is about, looked up on the server from the linked attempt (trusted).</summary>
public sealed record ChallengeStageRef(ChallengeEntry Challenge, string StageId);

/// <summary>
/// Builds a Claude request (ARCHITECTURE §8.1 step 5): the static mode prompt, honesty rules and capability summary
/// (cached prefix), then the trusted challenge content, then history and the new message with the untrusted
/// context in delimited tags.
/// </summary>
public static class PromptBuilder
{
    private const string CapabilitiesResource = "simulator-capabilities.md";

    private static readonly Lazy<string> Capabilities = new(() =>
    {
        using var stream = typeof(PromptBuilder).Assembly.GetManifestResourceStream(CapabilitiesResource)
            ?? throw new InvalidOperationException($"Embedded resource {CapabilitiesResource} is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    });

    public static string CapabilitySummary => Capabilities.Value;

    public static ClaudeRequest Build(
        string mode,
        MentorModeOptions settings,
        ChallengeStageRef? challenge,
        IReadOnlyList<ClaudeMessage> history,
        string content,
        ValidatedContext context,
        string? interviewStep)
    {
        var modePrompt = mode switch
        {
            MentorModes.Interviewer => MentorPrompts.Interviewer,
            MentorModes.Reviewer => MentorPrompts.Reviewer,
            _ => MentorPrompts.Tutor,
        };
        var system = new List<string>
        {
            string.Join("\n\n", MentorPrompts.Product, MentorPrompts.Honesty, modePrompt, "Capability summary:\n\n" + CapabilitySummary),
        };
        if (challenge is not null) system.Add(ChallengeContext(challenge, mode));

        var messages = new List<ClaudeMessage>();
        // The Messages API expects the conversation to start with the learner; the Interviewer's opening is ours.
        if (history.Count > 0 && history[0].Role == MessageRoles.Assistant)
            messages.Add(new ClaudeMessage(MessageRoles.User, "Let's start the interview."));
        messages.AddRange(history);
        messages.Add(new ClaudeMessage(MessageRoles.User, UserTurn(content, context, mode == MentorModes.Interviewer ? interviewStep : null)));

        return new ClaudeRequest(
            settings.Model,
            settings.MaxTokens,
            settings.Effort,
            settings.Thinking,
            system,
            messages,
            mode == MentorModes.Reviewer ? ReviewSchema.Schema : null);
    }

    /// <summary>Rough upper bound for budget reservations: about two characters per token, plus overhead.</summary>
    public static long EstimateInputTokens(ClaudeRequest request) =>
        (request.System.Sum(s => (long)s.Length) + request.Messages.Sum(m => (long)m.Text.Length)) / 2 + 500;

    private static string UserTurn(string content, ValidatedContext context, string? interviewStep)
    {
        var turn = new StringBuilder();
        turn.AppendLine("<context>");
        if (interviewStep is not null) turn.AppendLine(CultureInfo.InvariantCulture, $"<interview step=\"{interviewStep}\"/>");
        if (context.ArchitectureJson is not null)
            turn.AppendLine("<architecture trust=\"untrusted\">").AppendLine(context.ArchitectureJson).AppendLine("</architecture>");
        else
            turn.AppendLine("<architecture>No design was included with this message.</architecture>");
        if (context.Simulation is { } simulation)
        {
            turn.AppendLine(CultureInfo.InvariantCulture, $"<simulation engine=\"{Escape(simulation.EngineVersion)}\" source=\"engine output\">")
                .AppendLine(JsonSerializer.Serialize(simulation, MentorJson.Options))
                .AppendLine("</simulation>");
        }
        else
        {
            turn.AppendLine("<simulation>No valid simulation result was included: the simulator reports nothing for this message.</simulation>");
        }
        turn.AppendLine("</context>");
        turn.AppendLine();
        turn.Append(content);
        return turn.ToString();
    }

    /// <summary>
    /// The stage the learner is on, from repo content. Exercise answers and decision feedback are left out so the
    /// mentor can't give them away.
    /// </summary>
    private static string ChallengeContext(ChallengeStageRef reference, string mode)
    {
        var detail = JsonNode.Parse(reference.Challenge.DetailJson)!.AsObject();
        var stages = detail["stages"]!.AsArray().Select(s => s!.AsObject()).ToList();
        var index = Math.Max(0, stages.FindIndex(s => s["id"]!.GetValue<string>() == reference.StageId));
        var stage = stages[index];

        var text = new StringBuilder();
        text.AppendLine(CultureInfo.InvariantCulture, $"Challenge: {detail["title"]!.GetValue<string>()}");
        text.AppendLine(detail["summary"]!.GetValue<string>());
        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $"Stages: {string.Join("; ", stages.Select((s, i) => $"{i + 1}. {s["title"]!.GetValue<string>()}"))}");
        text.AppendLine(CultureInfo.InvariantCulture, $"The learner is on stage {index + 1}: {stage["title"]!.GetValue<string>()}.");
        text.AppendLine();
        text.AppendLine("Stage brief:");
        text.AppendLine(stage["briefMd"]?.GetValue<string>() ?? "");
        text.AppendLine(CultureInfo.InvariantCulture, $"Stage traffic: {stage["traffic"]!.ToJsonString()}");
        if (stage["scenario"] is { } scenario) text.AppendLine(CultureInfo.InvariantCulture, $"Stage failure scenario: {scenario.ToJsonString()}");
        text.AppendLine();
        text.AppendLine("Requirements checked for this stage:");
        foreach (var criterion in stage["criteria"]!.AsArray())
        {
            var optional = criterion!["optional"]?.GetValue<bool>() == true ? " (optional)" : "";
            text.AppendLine(CultureInfo.InvariantCulture, $"- {criterion["description"]!.GetValue<string>()}{optional}");
        }
        var exercises = stage["exercises"]?.AsArray() ?? [];
        if (exercises.Count > 0)
        {
            text.AppendLine();
            text.AppendLine("Exercises in this stage (their answers are deliberately not given to you):");
            foreach (var exercise in exercises) text.AppendLine(CultureInfo.InvariantCulture, $"- {exercise!["prompt"]!.GetValue<string>()}");
        }
        if (mode == MentorModes.Interviewer)
        {
            text.AppendLine();
            text.AppendLine("Use this as the interview problem. Reveal requirements only when the candidate asks about them.");
        }
        return text.ToString();
    }

    private static string Escape(string value) => value.Replace("\"", "", StringComparison.Ordinal).Replace("<", "", StringComparison.Ordinal);
}
