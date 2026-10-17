using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SystemDesignLab.Api.Features.Architectures;

/// <summary>
/// A saved copy of a design (DATA_MODEL §4.2): created explicitly or when a challenge stage passes. Autosaves
/// don't create snapshots. Only the newest <see cref="RetainedPerArchitecture"/> are kept.
/// </summary>
public sealed class ArchitectureSnapshot
{
    public const int MaxLabelLength = 100;
    public const int RetainedPerArchitecture = 20;

    public Guid Id { get; init; }
    public Guid ArchitectureId { get; init; }
    public string Label { get; init; } = "";
    public string Document { get; init; } = "{}";

    /// <summary>Copy of the document's node count for the list.</summary>
    public int NodeCount { get; init; }

    public DateTimeOffset CreatedAt { get; init; }
}

internal sealed class ArchitectureSnapshotConfiguration : IEntityTypeConfiguration<ArchitectureSnapshot>
{
    public void Configure(EntityTypeBuilder<ArchitectureSnapshot> builder)
    {
        builder.ToTable("architecture_snapshots");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Label).HasMaxLength(ArchitectureSnapshot.MaxLabelLength).IsRequired();
        builder.Property(s => s.Document).HasColumnType("jsonb").IsRequired();
        builder.HasOne<Architecture>().WithMany().HasForeignKey(s => s.ArchitectureId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(s => new { s.ArchitectureId, s.CreatedAt }).IsDescending(false, true);
    }
}
