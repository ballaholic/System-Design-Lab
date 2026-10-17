using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SystemDesignLab.Api.Features.Architectures;
using SystemDesignLab.Api.Features.Attempts;
using SystemDesignLab.Api.Features.Users;

namespace SystemDesignLab.Api.Features.Mentor;

/// <summary>A mentor conversation in one mode, optionally linked to a design and a challenge attempt (DATA_MODEL §4.2).</summary>
public sealed class AiConversation
{
    public const int MaxTitleLength = 80;

    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Mode { get; init; } = MentorModes.Tutor;
    public string Title { get; set; } = "";
    public Guid? ArchitectureId { get; set; }
    public Guid? AttemptId { get; set; }

    /// <summary>Raw JSON, e.g. <c>{ "step": "estimation" }</c> for the Interviewer.</summary>
    public string Metadata { get; set; } = "{}";

    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class AiMessage
{
    public Guid Id { get; init; }
    public Guid ConversationId { get; init; }
    public string Role { get; init; } = MessageRoles.User;
    public string Content { get; set; } = "";

    /// <summary>Raw JSON of the Reviewer's structured output, with node ids checked against the submitted design.</summary>
    public string? Findings { get; set; }

    /// <summary>Raw JSON reference to the context the answer was based on, not a copy of it.</summary>
    public string? ContextRef { get; set; }

    public string? Model { get; set; }
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    public int? CacheReadTokens { get; set; }
    public long? CostMicros { get; set; }
    public string Status { get; set; } = MessageStatuses.Complete;
    public DateTimeOffset CreatedAt { get; init; }
}

/// <summary>Per-user daily spend and the in-flight reservations (ARCHITECTURE §8.4). Days are UTC.</summary>
public sealed class AiUsageDaily
{
    public Guid UserId { get; init; }
    public DateOnly Day { get; init; }
    public int Requests { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CostMicros { get; set; }
    public long ReservedMicros { get; set; }
}

public sealed class AiSpendGlobalDaily
{
    public DateOnly Day { get; init; }
    public long CostMicros { get; set; }
    public long ReservedMicros { get; set; }
}

public static class MessageRoles
{
    public const string User = "user";
    public const string Assistant = "assistant";
}

public static class MessageStatuses
{
    public const string Complete = "complete";
    public const string Error = "error";
    public const string Truncated = "truncated";
}

internal sealed class AiConversationConfiguration : IEntityTypeConfiguration<AiConversation>
{
    public void Configure(EntityTypeBuilder<AiConversation> builder)
    {
        builder.ToTable("ai_conversations");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.Mode).HasMaxLength(16).IsRequired();
        builder.Property(c => c.Title).HasMaxLength(AiConversation.MaxTitleLength).IsRequired();
        builder.Property(c => c.Metadata).HasColumnType("jsonb").IsRequired();

        builder.HasOne<UserProfile>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Architecture>().WithMany().HasForeignKey(c => c.ArchitectureId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<ChallengeAttempt>().WithMany().HasForeignKey(c => c.AttemptId).OnDelete(DeleteBehavior.SetNull);
        builder.HasIndex(c => new { c.UserId, c.UpdatedAt }).IsDescending(false, true);
    }
}

internal sealed class AiMessageConfiguration : IEntityTypeConfiguration<AiMessage>
{
    public void Configure(EntityTypeBuilder<AiMessage> builder)
    {
        builder.ToTable("ai_messages");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).ValueGeneratedNever();
        builder.Property(m => m.Role).HasMaxLength(16).IsRequired();
        builder.Property(m => m.Content).IsRequired();
        builder.Property(m => m.Findings).HasColumnType("jsonb");
        builder.Property(m => m.ContextRef).HasColumnType("jsonb");
        builder.Property(m => m.Model).HasMaxLength(64);
        builder.Property(m => m.Status).HasMaxLength(16).IsRequired();

        builder.HasOne<AiConversation>().WithMany().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => new { m.ConversationId, m.CreatedAt });
    }
}

internal sealed class AiUsageDailyConfiguration : IEntityTypeConfiguration<AiUsageDaily>
{
    public void Configure(EntityTypeBuilder<AiUsageDaily> builder)
    {
        builder.ToTable("ai_usage_daily");
        builder.HasKey(u => new { u.UserId, u.Day });
        builder.HasOne<UserProfile>().WithMany().HasForeignKey(u => u.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class AiSpendGlobalDailyConfiguration : IEntityTypeConfiguration<AiSpendGlobalDaily>
{
    public void Configure(EntityTypeBuilder<AiSpendGlobalDaily> builder)
    {
        builder.ToTable("ai_spend_global_daily");
        builder.HasKey(s => s.Day);
    }
}
