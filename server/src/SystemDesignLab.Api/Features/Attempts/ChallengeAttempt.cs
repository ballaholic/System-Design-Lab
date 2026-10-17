using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SystemDesignLab.Api.Features.Architectures;
using SystemDesignLab.Api.Features.Users;

namespace SystemDesignLab.Api.Features.Attempts;

/// <summary>
/// A learner's attempt at a challenge (DATA_MODEL §4.2). Criteria results are evaluated in the browser and stored
/// as evidence (ADR-010): the API checks their shape against the challenge definition but never re-runs the engine.
/// </summary>
public sealed class ChallengeAttempt
{
    public const int MaxSlugLength = 64;
    public const int MaxStageIdLength = 60;

    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string ChallengeSlug { get; init; } = "";
    public int ChallengeVersion { get; init; }
    public string Mode { get; init; } = AttemptModes.Guided;
    public string Status { get; set; } = AttemptStatuses.InProgress;
    public string CurrentStageId { get; set; } = "";
    public Guid? ArchitectureId { get; set; }

    /// <summary>Raw JSON: <c>{ [stageId]: { passedAt?, criteria, engineVersion } }</c>.</summary>
    public string StageResults { get; set; } = "{}";

    /// <summary>Raw JSON: <c>{ [exerciseId]: answer }</c>.</summary>
    public string ExerciseAnswers { get; set; } = "{}";

    public List<string> HintsRevealed { get; set; } = [];

    /// <summary>Guest-import idempotency key; unique per user.</summary>
    public Guid? ImportKey { get; init; }

    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset LastActivityAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public static class AttemptStatuses
{
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Abandoned = "abandoned";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { InProgress, Completed, Abandoned };
}

public static class AttemptModes
{
    public const string Guided = "guided";
    public const string Interview = "interview";
}

internal sealed class ChallengeAttemptConfiguration : IEntityTypeConfiguration<ChallengeAttempt>
{
    public void Configure(EntityTypeBuilder<ChallengeAttempt> builder)
    {
        builder.ToTable("challenge_attempts");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.ChallengeSlug).HasMaxLength(ChallengeAttempt.MaxSlugLength).IsRequired();
        builder.Property(a => a.Mode).HasMaxLength(16).IsRequired();
        builder.Property(a => a.Status).HasMaxLength(16).IsRequired();
        builder.Property(a => a.CurrentStageId).HasMaxLength(ChallengeAttempt.MaxStageIdLength).IsRequired();
        builder.Property(a => a.StageResults).HasColumnType("jsonb").IsRequired();
        builder.Property(a => a.ExerciseAnswers).HasColumnType("jsonb").IsRequired();
        builder.Property(a => a.HintsRevealed).HasColumnType("text[]").IsRequired();

        builder.HasOne<UserProfile>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Architecture>().WithMany().HasForeignKey(a => a.ArchitectureId).OnDelete(DeleteBehavior.SetNull);

        // At most one attempt in progress per user and challenge; restarting abandons the current one.
        builder.HasIndex(a => new { a.UserId, a.ChallengeSlug })
            .IsUnique()
            .HasFilter("status = 'in_progress'")
            .HasDatabaseName("ux_challenge_attempts_in_progress");
        builder.HasIndex(a => new { a.UserId, a.ImportKey }).IsUnique().HasFilter("import_key IS NOT NULL");
        builder.HasIndex(a => new { a.UserId, a.LastActivityAt }).IsDescending(false, true);
    }
}
