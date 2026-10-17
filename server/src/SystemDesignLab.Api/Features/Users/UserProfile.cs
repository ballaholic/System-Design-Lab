using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SystemDesignLab.Api.Infrastructure.Auth;

namespace SystemDesignLab.Api.Features.Users;

/// <summary>App-side profile; <see cref="Id"/> equals the Supabase user id (<c>sub</c>). No FK to auth.users (ADR-007).</summary>
public sealed class UserProfile
{
    public Guid Id { get; init; }
    public string DisplayName { get; set; } = "";
    public string? AvatarUrl { get; set; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
}

internal sealed class UserProfileConfiguration : IEntityTypeConfiguration<UserProfile>
{
    public void Configure(EntityTypeBuilder<UserProfile> builder)
    {
        builder.ToTable("user_profiles");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();
        builder.Property(p => p.DisplayName).HasMaxLength(CurrentUser.MaxDisplayNameLength).IsRequired();
        builder.Property(p => p.AvatarUrl).HasMaxLength(2048);
    }
}
