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

    /// <summary>
    /// Optional connection string to an existing PostgreSQL server, for machines without Docker. A throwaway
    /// database is created on it for the run and dropped afterwards.
    /// </summary>
    public const string ServerVariable = "SDL_TEST_POSTGRES";

    private string? _serverConnectionString;
    private string? _databaseName;

    public async ValueTask InitializeAsync()
    {
        if (Environment.GetEnvironmentVariable(ServerVariable) is { Length: > 0 } server)
        {
            _serverConnectionString = server;
            _databaseName = $"sdl_test_{Guid.NewGuid():N}";
            await ExecuteOnServerAsync($"CREATE DATABASE {_databaseName}");
            ConnectionString = new Npgsql.NpgsqlConnectionStringBuilder(server) { Database = _databaseName }.ConnectionString;
        }
        else
        {
            try
            {
                _container = new PostgreSqlBuilder("postgres:17-alpine").Build();
                await _container.StartAsync();
            }
            catch (Exception ex) when (Environment.GetEnvironmentVariable("CI") is null)
            {
                _unavailableReason = $"Docker is not available for Testcontainers ({ex.GetType().Name}). These tests run in CI, or set {ServerVariable}.";
                return;
            }
            ConnectionString = _container.GetConnectionString();
        }

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
        if (_databaseName is not null)
        {
            Npgsql.NpgsqlConnection.ClearAllPools();
            await ExecuteOnServerAsync($"DROP DATABASE IF EXISTS {_databaseName} WITH (FORCE)");
        }
    }

    private async Task ExecuteOnServerAsync(string sql)
    {
        await using var connection = new Npgsql.NpgsqlConnection(_serverConnectionString);
        await connection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class DatabaseTestGroup : ICollectionFixture<PostgresFixture>
{
    public const string Name = "database";
}
