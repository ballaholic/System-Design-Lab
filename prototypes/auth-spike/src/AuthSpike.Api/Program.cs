using System.Security.Claims;
using AuthSpike.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddSupabaseAuthentication();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/me", (ClaimsPrincipal principal, HttpContext http) =>
{
    var user = CurrentUser.FromPrincipal(principal);
    return Results.Ok(new
    {
        user.Id,
        user.Email,
        user.EmailVerified,
        user.AuthenticatorAssuranceLevel,
        user.AuthMethods,
        // Diagnostics for the spike write-up; not part of the production contract.
        Token = new
        {
            Issuer = principal.FindFirst("iss")?.Value,
            Audience = principal.FindFirst("aud")?.Value,
            Role = principal.FindFirst("role")?.Value,
            Algorithm = http.Items[SupabaseAuthentication.TokenAlgorithmItem],
            KeyId = http.Items[SupabaseAuthentication.TokenKeyIdItem],
            ClaimTypes = principal.Claims.Select(c => c.Type).Distinct().Order().ToArray(),
        },
    });
}).RequireAuthorization();

app.Run();

public partial class Program;
