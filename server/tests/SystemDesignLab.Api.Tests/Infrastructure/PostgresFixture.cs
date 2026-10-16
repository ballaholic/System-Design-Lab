using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SystemDesignLab.Api.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace SystemDesignLab.Api.Tests.Infrastructure;

/// <summary>
/// A throwaway PostgreSQL (Testcontainers) with all migrations applied, shared by database tests.
/// Without Docker the tests are skipped locally; in CI (CI=true) a missing Docker fails the run instead.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public ApiFactory Api { get; private set; } = null!;
    public string ConnectionString { get; private set; } = "";
    private string? _unavailableReason;

    public async ValueTask InitializeAsync()
    {
        try
        {
            _container = new PostgreSqlBuilder("postgres:17-alpine").Build();
            await _container.StartAsync();
        }
        catch (Exception ex) when (Environment.GetEnvironmentVariable("CI") is null)
        {
            _unavailableReason = $"Docker is not available for Testcontainers ({ex.GetType().Name}). These tests run in CI.";
            return;
        }

        ConnectionString = _container.GetConnectionString();
        Api = new ApiFactory(ConnectionString);

        await using var scope = Api.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    public void SkipIfUnavailable()
    {
        if (_unavailableReason is not null) Assert.Skip(_unavailableReason);
    }

    public async Task<T> QueryAsync<T>(Func<AppDbContext, Task<T>> query)
    {
        await using var scope = Api.Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public async ValueTask DisposeAsync()
    {
        if (Api is not null) await Api.DisposeAsync();
        if (_container is not null) await _container.DisposeAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class DatabaseTestGroup : ICollectionFixture<PostgresFixture>
{
    public const string Name = "database";
}
