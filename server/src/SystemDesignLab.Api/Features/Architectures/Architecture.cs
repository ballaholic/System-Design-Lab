using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SystemDesignLab.Api.Features.Users;

namespace SystemDesignLab.Api.Features.Architectures;

/// <summary>
/// A saved design (DATA_MODEL §4.2). The document is stored as <c>jsonb</c> and is opaque to the API beyond
/// schema validation: domain rules live in TypeScript (ADR-003).
/// </summary>
public sealed class Architecture
{
    public const int MaxTitleLength = 100;
    public const int MaxDescriptionLength = 1000;
    public const int MaxChallengeSlugLength = 64;

    public Guid Id { get; init; }
    public Guid OwnerId { get; init; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }

    /// <summary>Raw JSON of the architecture document.</summary>
    public string Document { get; set; } = "{}";

    /// <summary>Copy of <c>document.schemaVersion</c> for queries and migrations.</summary>
    public int SchemaVersion { get; set; }

    /// <summary>Copy of the document's node count for the designs list.</summary>
    public int NodeCount { get; set; }

    public string? ChallengeSlug { get; init; }

    /// <summary>Guest-import idempotency key; unique per owner (AUTH-9).</summary>
    public Guid? ImportKey { get; init; }

    /// <summary>Optimistic concurrency token for the document (ADR-018); incremented on every document update.</summary>
    public int Version { get; set; }

    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
}

internal sealed class ArchitectureConfiguration : IEntityTypeConfiguration<Architecture>
{
    public void Configure(EntityTypeBuilder<Architecture> builder)
    {
        builder.ToTable("architectures");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.Title).HasMaxLength(Architecture.MaxTitleLength).IsRequired();
        builder.Property(a => a.Description).HasMaxLength(Architecture.MaxDescriptionLength);
        builder.Property(a => a.Document).HasColumnType("jsonb").IsRequired();
        builder.Property(a => a.ChallengeSlug).HasMaxLength(Architecture.MaxChallengeSlugLength);

        builder.HasOne<UserProfile>().WithMany().HasForeignKey(a => a.OwnerId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(a => new { a.OwnerId, a.UpdatedAt }).IsDescending(false, true);
        builder.HasIndex(a => new { a.OwnerId, a.ImportKey }).IsUnique();
    }
}
