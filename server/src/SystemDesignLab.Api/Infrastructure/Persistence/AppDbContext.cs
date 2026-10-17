using Microsoft.EntityFrameworkCore;
using SystemDesignLab.Api.Features.Architectures;
using SystemDesignLab.Api.Features.Users;

namespace SystemDesignLab.Api.Infrastructure.Persistence;

/// <summary>Application data lives in the <c>app</c> schema; Supabase owns <c>auth</c> (ADR-007).</summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public const string Schema = "app";
    public const string MigrationsHistoryTable = "__ef_migrations_history";

    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<Architecture> Architectures => Set<Architecture>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
