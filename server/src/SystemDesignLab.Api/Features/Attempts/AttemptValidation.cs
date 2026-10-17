using System.Globalization;
using System.Text.Json;
using SystemDesignLab.Api.Features.Challenges;

namespace SystemDesignLab.Api.Features.Attempts;

/// <summary>
/// Shape checks for attempt progress against the challenge definition (ADR-010): ids must exist and values must
/// have the documented types. Errors are keyed by JSON field (with a prefix for import items).
/// </summary>
internal static class AttemptValidation
{
    public const int MaxCriteriaPerStage = 20;
    public const int MaxDetailLength = 500;
    public const int MaxEngineVersionLength = 20;
    public const int MaxHints = 100;
    public const int MaxIdLength = 60;

    public static void StageId(string? stageId, ChallengeEntry challenge, string key, Dictionary<string, string[]> errors)
    {
        if (stageId is null || !challenge.StageIds.Contains(stageId)) errors[key] = ["Current stage must be a stage of the challenge."];
    }

    /// <summary>Validates <c>{ [stageId]: { passedAt?, criteria: [...], engineVersion } }</c>; returns the raw JSON when valid.</summary>
    public static string? StageResults(JsonElement value, ChallengeEntry challenge, string key, Dictionary<string, string[]> errors)
    {
        if (value.ValueKind != JsonValueKind.Object) return Fail(errors, key, "Stage results must be an object keyed by stage id.");
        foreach (var stage in value.EnumerateObject())
        {
            var at = $"{key}.{stage.Name}";
            if (!challenge.StageIds.Contains(stage.Name)) return Fail(errors, at, $"\"{stage.Name}\" isn't a stage of the challenge.");
            var result = stage.Value;
            if (result.ValueKind != JsonValueKind.Object) return Fail(errors, at, "Each stage result must be an object.");
            foreach (var property in result.EnumerateObject())
            {
                if (property.Name is not ("passedAt" or "criteria" or "engineVersion"))
                    return Fail(errors, $"{at}.{property.Name}", "Unknown property.");
            }
            if (result.TryGetProperty("passedAt", out var passedAt) && !IsTimestamp(passedAt))
                return Fail(errors, $"{at}.passedAt", "passedAt must be an ISO 8601 timestamp.");
            if (!result.TryGetProperty("engineVersion", out var engine) || engine.ValueKind != JsonValueKind.String
                || engine.GetString()!.Length is 0 or > MaxEngineVersionLength)
                return Fail(errors, $"{at}.engineVersion", $"engineVersion must be a string of at most {MaxEngineVersionLength} characters.");
            if (!result.TryGetProperty("criteria", out var criteria) || criteria.ValueKind != JsonValueKind.Array
                || criteria.GetArrayLength() > MaxCriteriaPerStage)
                return Fail(errors, $"{at}.criteria", $"criteria must be an array of at most {MaxCriteriaPerStage} results.");
            var index = 0;
            foreach (var criterion in criteria.EnumerateArray())
            {
                var c = $"{at}.criteria[{index++}]";
                if (criterion.ValueKind != JsonValueKind.Object) return Fail(errors, c, "Each criterion result must be an object.");
                foreach (var property in criterion.EnumerateObject())
                {
                    if (property.Name is not ("id" or "passed" or "detail" or "optional"))
                        return Fail(errors, $"{c}.{property.Name}", "Unknown property.");
                }
                if (!IsString(criterion, "id", MaxIdLength, required: true)) return Fail(errors, $"{c}.id", "id must be a short string.");
                if (!IsBool(criterion, "passed", required: true)) return Fail(errors, $"{c}.passed", "passed must be true or false.");
                if (!IsString(criterion, "detail", MaxDetailLength, required: true, allowEmpty: true))
                    return Fail(errors, $"{c}.detail", $"detail must be a string of at most {MaxDetailLength} characters.");
                if (!IsBool(criterion, "optional", required: false)) return Fail(errors, $"{c}.optional", "optional must be true or false.");
            }
        }
        return value.GetRawText();
    }

    /// <summary>Validates <c>{ [exerciseId]: estimate | decision }</c>; returns the raw JSON when valid.</summary>
    public static string? ExerciseAnswers(JsonElement value, ChallengeEntry challenge, string key, Dictionary<string, string[]> errors)
    {
        if (value.ValueKind != JsonValueKind.Object) return Fail(errors, key, "Exercise answers must be an object keyed by exercise id.");
        foreach (var answer in value.EnumerateObject())
        {
            var at = $"{key}.{answer.Name}";
            if (!challenge.Exercises.TryGetValue(answer.Name, out var exercise))
                return Fail(errors, at, $"\"{answer.Name}\" isn't an exercise of the challenge.");
            var a = answer.Value;
            if (a.ValueKind != JsonValueKind.Object) return Fail(errors, at, "Each answer must be an object.");
            if (!a.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String || kind.GetString() != exercise.Kind)
                return Fail(errors, $"{at}.kind", $"kind must be \"{exercise.Kind}\" for this exercise.");
            if (!a.TryGetProperty("answeredAt", out var answeredAt) || !IsTimestamp(answeredAt))
                return Fail(errors, $"{at}.answeredAt", "answeredAt must be an ISO 8601 timestamp.");

            if (exercise.Kind == "estimate")
            {
                foreach (var property in a.EnumerateObject())
                {
                    if (property.Name is not ("kind" or "value" or "correct" or "attempts" or "revealed" or "answeredAt"))
                        return Fail(errors, $"{at}.{property.Name}", "Unknown property.");
                }
                if (!a.TryGetProperty("value", out var number) || number.ValueKind != JsonValueKind.Number || !double.IsFinite(number.GetDouble()))
                    return Fail(errors, $"{at}.value", "value must be a number.");
                if (!IsBool(a, "correct", required: true)) return Fail(errors, $"{at}.correct", "correct must be true or false.");
                if (!IsBool(a, "revealed", required: true)) return Fail(errors, $"{at}.revealed", "revealed must be true or false.");
                if (!a.TryGetProperty("attempts", out var attempts) || !attempts.TryGetInt32(out var count) || count < 0)
                    return Fail(errors, $"{at}.attempts", "attempts must be a whole number of at least 0.");
            }
            else
            {
                foreach (var property in a.EnumerateObject())
                {
                    if (property.Name is not ("kind" or "optionId" or "answeredAt"))
                        return Fail(errors, $"{at}.{property.Name}", "Unknown property.");
                }
                if (!a.TryGetProperty("optionId", out var option) || option.ValueKind != JsonValueKind.String
                    || !exercise.OptionIds.Contains(option.GetString()!))
                    return Fail(errors, $"{at}.optionId", "optionId must be one of the exercise's options.");
            }
        }
        return value.GetRawText();
    }

    /// <summary>Validates a list of unique hint ids from the definition.</summary>
    public static List<string>? Hints(JsonElement value, ChallengeEntry challenge, string key, Dictionary<string, string[]> errors)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaxHints)
        {
            errors[key] = [$"hintsRevealed must be an array of at most {MaxHints} hint ids."];
            return null;
        }
        var hints = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || !challenge.HintIds.Contains(item.GetString()!))
            {
                errors[key] = ["hintsRevealed may only contain hint ids of the challenge."];
                return null;
            }
            var id = item.GetString()!;
            if (hints.Contains(id))
            {
                errors[key] = ["hintsRevealed can't list a hint twice."];
                return null;
            }
            hints.Add(id);
        }
        return hints;
    }

    private static string? Fail(Dictionary<string, string[]> errors, string key, string message)
    {
        errors[key] = [message];
        return null;
    }

    private static bool IsTimestamp(JsonElement value) =>
        value.ValueKind == JsonValueKind.String
        && DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);

    private static bool IsString(JsonElement obj, string name, int maxLength, bool required, bool allowEmpty = false)
    {
        if (!obj.TryGetProperty(name, out var value)) return !required;
        return value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= maxLength && (allowEmpty || value.GetString()!.Length > 0);
    }

    private static bool IsBool(JsonElement obj, string name, bool required)
    {
        if (!obj.TryGetProperty(name, out var value)) return !required;
        return value.ValueKind is JsonValueKind.True or JsonValueKind.False;
    }
}
