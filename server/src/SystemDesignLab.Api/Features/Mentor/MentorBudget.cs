using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SystemDesignLab.Api.Infrastructure.Persistence;

namespace SystemDesignLab.Api.Features.Mentor;

public enum ReservationOutcome
{
    Reserved,
    UserBudgetExhausted,
    GlobalBudgetExhausted,
}

/// <summary>A reservation on today's counters, released by <see cref="MentorBudget.SettleAsync"/>.</summary>
public sealed record BudgetReservation(Guid UserId, DateOnly Day, long Micros);

/// <summary>
/// Cost budgets (ARCHITECTURE §8.4, DATA_MODEL §4.2): reserve the worst case before calling Claude, then replace the
/// reservation with the actual cost. Each step is one conditional UPDATE per counter in one transaction, so concurrent
/// requests can't overshoot the per-user budget or the global cap.
/// </summary>
public sealed class MentorBudget(AppDbContext db, IOptionsMonitor<MentorOptions> options, TimeProvider clock)
{
    public DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

    public DateTimeOffset ResetsAt => new(Today.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public async Task<(ReservationOutcome Outcome, BudgetReservation? Reservation)> ReserveAsync(Guid userId, long micros, CancellationToken ct)
    {
        var day = Today;
        var settings = options.CurrentValue;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO app.ai_usage_daily (user_id, day, requests, input_tokens, output_tokens, cache_read_tokens, cost_micros, reserved_micros)
            VALUES ({userId}, {day}, 0, 0, 0, 0, 0, 0) ON CONFLICT DO NOTHING
            """, ct);
        var user = await db.Database.ExecuteSqlAsync($"""
            UPDATE app.ai_usage_daily SET reserved_micros = reserved_micros + {micros}
            WHERE user_id = {userId} AND day = {day} AND cost_micros + reserved_micros + {micros} <= {settings.UserDailyBudgetMicros}
            """, ct);
        if (user == 0) return (ReservationOutcome.UserBudgetExhausted, null);

        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO app.ai_spend_global_daily (day, cost_micros, reserved_micros) VALUES ({day}, 0, 0) ON CONFLICT DO NOTHING
            """, ct);
        var global = await db.Database.ExecuteSqlAsync($"""
            UPDATE app.ai_spend_global_daily SET reserved_micros = reserved_micros + {micros}
            WHERE day = {day} AND cost_micros + reserved_micros + {micros} <= {settings.GlobalDailyBudgetMicros}
            """, ct);
        if (global == 0) return (ReservationOutcome.GlobalBudgetExhausted, null);

        await transaction.CommitAsync(ct);
        return (ReservationOutcome.Reserved, new BudgetReservation(userId, day, micros));
    }

    /// <summary>Releases the reservation and records what the request actually cost. Runs even if the caller was cancelled.</summary>
    public async Task SettleAsync(BudgetReservation reservation, TokenUsage usage, long costMicros)
    {
        var (userId, day, reserved) = reservation;
        await using var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None);
        await db.Database.ExecuteSqlAsync($"""
            UPDATE app.ai_usage_daily SET
              reserved_micros = GREATEST(reserved_micros - {reserved}, 0),
              cost_micros = cost_micros + {costMicros},
              requests = requests + 1,
              input_tokens = input_tokens + {usage.InputTokens + usage.CacheWriteTokens},
              output_tokens = output_tokens + {usage.OutputTokens},
              cache_read_tokens = cache_read_tokens + {usage.CacheReadTokens}
            WHERE user_id = {userId} AND day = {day}
            """, CancellationToken.None);
        await db.Database.ExecuteSqlAsync($"""
            UPDATE app.ai_spend_global_daily SET
              reserved_micros = GREATEST(reserved_micros - {reserved}, 0),
              cost_micros = cost_micros + {costMicros}
            WHERE day = {day}
            """, CancellationToken.None);
        await transaction.CommitAsync(CancellationToken.None);
    }

    /// <summary>Share of today's budget left for the user, 0–100.</summary>
    public async Task<int> RemainingPercentAsync(Guid userId, CancellationToken ct)
    {
        var day = Today;
        var used = await db.Set<AiUsageDaily>().AsNoTracking()
            .Where(u => u.UserId == userId && u.Day == day)
            .Select(u => u.CostMicros + u.ReservedMicros)
            .SingleOrDefaultAsync(ct);
        var budget = options.CurrentValue.UserDailyBudgetMicros;
        if (budget <= 0) return 0;
        return (int)Math.Clamp(Math.Floor(100.0 * (budget - used) / budget), 0, 100);
    }
}

/// <summary>At most one mentor request in flight per user (ARCHITECTURE §8.4). In-process, like the rate limiter (ADR-001).</summary>
public sealed class MentorConcurrency
{
    private readonly ConcurrentDictionary<Guid, byte> _inFlight = new();

    public bool TryEnter(Guid userId) => _inFlight.TryAdd(userId, 0);

    public void Exit(Guid userId) => _inFlight.TryRemove(userId, out _);
}
