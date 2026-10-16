using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SystemDesignLab.Api.Infrastructure.Persistence;

public static class PersistenceSetup
{
    public static IServiceCollection AddPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<AppDbContext>((provider, options) =>
        {
            // Resolved lazily so a missing value fails with a clear message only when the database is used.
            var connectionString = provider.GetRequiredService<IConfiguration>().GetConnectionString("Database");
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException(
                    "ConnectionStrings:Database is not configured. See server/README.md (dotnet user-secrets).");
            }
            Configure(options, connectionString);
        });
        return services;
    }

    public static void Configure(DbContextOptionsBuilder options, string connectionString) =>
        options
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable(AppDbContext.MigrationsHistoryTable, AppDbContext.Schema))
            .UseSnakeCaseNamingConvention();
}

/// <summary>
/// Used by `dotnet ef migrations add` only. Adding a migration does not connect, so a placeholder is fine;
/// `dotnet ef database update` needs a real connection string via --connection or ConnectionStrings__Database.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Database")
            ?? "Host=localhost;Database=design_time_only";
        var options = new DbContextOptionsBuilder<AppDbContext>();
        PersistenceSetup.Configure(options, connectionString);
        return new AppDbContext(options.Options);
    }
}
