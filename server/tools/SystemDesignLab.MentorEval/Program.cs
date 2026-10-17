using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using SystemDesignLab.Api.Features.Challenges;
using SystemDesignLab.Api.Features.Mentor;

// Runs the mentor's prompt evaluation set: each scenario goes through the same prompt builder and Claude client as
// the API, and the answer is checked for the expected properties. Usage (from the repo root):
//   pnpm --filter @sdl/challenges mentor-evals          # regenerate evals/mentor/scenarios.json
//   dotnet run --project server/tools/SystemDesignLab.MentorEval [-- --only <scenario-id>]
// The API key comes from the API's user secrets (Mentor:ApiKey) or the Mentor__ApiKey environment variable.

var root = FindRepoRoot();
var only = args.SkipWhile(a => a != "--only").Skip(1).FirstOrDefault();

var configuration = new ConfigurationBuilder()
    .AddUserSecrets(typeof(MentorOptions).Assembly, optional: true)
    .AddEnvironmentVariables()
    .Build();
var options = configuration.GetSection(MentorOptions.Section).Get<MentorOptions>() ?? new MentorOptions();
if (!options.IsConfigured)
{
    Console.Error.WriteLine("No API key: set Mentor:ApiKey in the API's user secrets or the Mentor__ApiKey environment variable.");
    return 1;
}

var catalog = ChallengeCatalog.Load(Path.Combine(root, "content", "challenges"));
using var scenarioFile = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "evals", "mentor", "scenarios.json")));
var scenarios = scenarioFile.RootElement.GetProperty("scenarios").EnumerateArray()
    .Where(s => only is null || s.GetProperty("id").GetString() == only)
    .ToList();

using var claude = new AnthropicClaudeClient(new FixedOptions(options));
var results = new List<EvalResult>();
foreach (var scenario in scenarios)
{
    var result = await Evaluate(scenario, options, catalog, claude);
    results.Add(result);
    Console.WriteLine($"{(result.Failures.Count == 0 ? "PASS" : "FAIL")}  {result.Id}{(result.Failures.Count > 0 ? "  — " + string.Join("; ", result.Failures) : "")}");
}

var report = Report(results);
var reportDir = Path.Combine(root, "evals", "mentor", "reports");
Directory.CreateDirectory(reportDir);
var reportPath = Path.Combine(reportDir, $"report-{DateTime.UtcNow:yyyyMMdd-HHmmss}.md");
await File.WriteAllTextAsync(reportPath, report);
var passed = results.Count(r => r.Failures.Count == 0);
Console.WriteLine();
Console.WriteLine($"{passed}/{results.Count} passed, ${results.Sum(r => r.CostMicros) / 1_000_000m:0.0000} spent. Report: {Path.GetRelativePath(root, reportPath)}");
return passed == results.Count ? 0 : 2;

static async Task<EvalResult> Evaluate(JsonElement scenario, MentorOptions options, ChallengeCatalog catalog, IClaudeClient claude)
{
    var id = scenario.GetProperty("id").GetString()!;
    var mode = scenario.GetProperty("mode").GetString()!;
    var question = scenario.GetProperty("question").GetString()!;
    var simulation = scenario.GetProperty("simulation");
    var request = new SendMessageRequest(
        question,
        scenario.GetProperty("architecture").Clone(),
        simulation.ValueKind == JsonValueKind.Null ? null : simulation.Clone());
    var errors = new Dictionary<string, string[]>();
    var context = MentorContextValidator.Validate(request, errors);
    if (context is null) return new EvalResult(id, mode, "", 0, [$"invalid context: {string.Join(", ", errors.Keys)}"]);

    ChallengeStageRef? challenge = null;
    if (scenario.TryGetProperty("challenge", out var c))
        challenge = new ChallengeStageRef(catalog.Find(c.GetProperty("slug").GetString()!)!, c.GetProperty("stageId").GetString()!);
    var history = scenario.TryGetProperty("history", out var h)
        ? h.EnumerateArray().Select(m => new ClaudeMessage(m.GetProperty("role").GetString()!, m.GetProperty("text").GetString()!)).ToList()
        : [];
    var step = scenario.TryGetProperty("interviewStep", out var s) ? s.GetString() : null;
    var settings = options.ModeOptions(mode);
    var prompt = PromptBuilder.Build(mode, settings, challenge, history, question, context, step);

    var text = new StringBuilder();
    ClaudeCompleted? completed = null;
    try
    {
        await foreach (var e in claude.StreamAsync(prompt, CancellationToken.None))
        {
            if (e is ClaudeTextDelta d) text.Append(d.Text);
            else if (e is ClaudeCompleted done) completed = done;
        }
    }
    catch (Exception ex) when (ex is Anthropic.Exceptions.AnthropicException or IOException)
    {
        return new EvalResult(id, mode, text.ToString(), 0, [$"request failed: {ex.Message}"]);
    }

    var cost = completed is null ? 0 : options.PriceOf(settings.Model).CostMicros(completed.Usage);
    var answer = text.ToString();
    var failures = Check(scenario.GetProperty("expect"), mode, answer, context.NodeIds, completed?.StopReason);
    return new EvalResult(id, mode, answer, cost, failures);
}

static List<string> Check(JsonElement expect, string mode, string answer, IReadOnlySet<string> nodeIds, string? stopReason)
{
    var failures = new List<string>();
    if (stopReason is "refusal" or "max_tokens") failures.Add($"stop reason {stopReason}");

    var searchable = answer;
    if (mode == MentorModes.Reviewer)
    {
        try
        {
            using var review = JsonDocument.Parse(answer);
            var findings = review.RootElement.GetProperty("findings").EnumerateArray().ToList();
            searchable = review.RootElement.GetProperty("summary").GetString() + "\n" +
                string.Join("\n", findings.Select(f => $"{f.GetProperty("title").GetString()} {f.GetProperty("explanation").GetString()} {f.GetProperty("suggestion").GetString()}"));
            if (expect.TryGetProperty("minFindings", out var min) && findings.Count < min.GetInt32())
                failures.Add($"expected at least {min.GetInt32()} findings, got {findings.Count}");
            if (expect.TryGetProperty("validNodeIds", out var valid) && valid.GetBoolean())
            {
                var unknown = findings.SelectMany(f => f.GetProperty("nodeIds").EnumerateArray().Select(n => n.GetString()!)).Where(n => !nodeIds.Contains(n)).ToList();
                if (unknown.Count > 0) failures.Add($"unknown node ids: {string.Join(", ", unknown)}");
            }
            if (expect.TryGetProperty("noHighSeverity", out var noHigh) && noHigh.GetBoolean()
                && findings.Any(f => f.GetProperty("severity").GetString() == "high"))
                failures.Add("a high-severity finding on a design that meets the requirements");
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            failures.Add("the answer isn't a valid review");
        }
    }

    foreach (var pattern in Strings(expect, "mustMatch"))
        if (!Regex.IsMatch(searchable, pattern, RegexOptions.IgnoreCase | RegexOptions.Multiline, TimeSpan.FromSeconds(1)))
            failures.Add($"doesn't match /{pattern}/");
    foreach (var pattern in Strings(expect, "mustNotMatch"))
        if (Regex.IsMatch(searchable, pattern, RegexOptions.IgnoreCase | RegexOptions.Multiline, TimeSpan.FromSeconds(1)))
            failures.Add($"matches forbidden /{pattern}/");
    var quotes = Strings(expect, "quotesOneOf").ToList();
    if (quotes.Count > 0 && !quotes.Any(q => searchable.Contains(q, StringComparison.Ordinal)))
        failures.Add($"quotes none of the engine's numbers ({string.Join(", ", quotes)})");
    if (expect.TryGetProperty("asksQuestion", out var asks) && asks.GetBoolean() && !searchable.Contains('?', StringComparison.Ordinal))
        failures.Add("doesn't ask the candidate anything");
    return failures;
}

static IEnumerable<string> Strings(JsonElement expect, string name) =>
    expect.TryGetProperty(name, out var list) ? list.EnumerateArray().Select(e => e.GetString()!) : [];

static string Report(List<EvalResult> results)
{
    var text = new StringBuilder();
    text.AppendLine(CultureInfo.InvariantCulture, $"# Mentor evaluation, {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC");
    text.AppendLine();
    text.AppendLine(CultureInfo.InvariantCulture, $"{results.Count(r => r.Failures.Count == 0)}/{results.Count} passed. Cost ${results.Sum(r => r.CostMicros) / 1_000_000m:0.0000}.");
    text.AppendLine();
    text.AppendLine("| Scenario | Mode | Result | Notes |");
    text.AppendLine("|---|---|---|---|");
    foreach (var r in results)
        text.AppendLine(CultureInfo.InvariantCulture, $"| {r.Id} | {r.Mode} | {(r.Failures.Count == 0 ? "pass" : "**fail**")} | {string.Join("; ", r.Failures).Replace("|", "\\|", StringComparison.Ordinal)} |");
    foreach (var r in results)
    {
        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $"## {r.Id}");
        text.AppendLine();
        text.AppendLine("```");
        text.AppendLine(r.Answer);
        text.AppendLine("```");
    }
    return text.ToString();
}

static string FindRepoRoot()
{
    var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) dir = dir.Parent;
    return dir?.FullName ?? throw new InvalidOperationException("Run from inside the repository.");
}

internal sealed record EvalResult(string Id, string Mode, string Answer, long CostMicros, List<string> Failures);

internal sealed class FixedOptions(MentorOptions value) : IOptionsMonitor<MentorOptions>
{
    public MentorOptions CurrentValue => value;

    public MentorOptions Get(string? name) => value;

    public IDisposable? OnChange(Action<MentorOptions, string?> listener) => null;
}
