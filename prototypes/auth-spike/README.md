# Experiment B — Supabase token validation in ASP.NET Core

Phase 0 spike: a minimal ASP.NET Core (.NET 10) API that validates Supabase-issued access tokens and
identifies the user. It's not production code. Phase 1 moves `SupabaseAuthentication` and `CurrentUser`
into `server/src/SystemDesignLab.Api/Infrastructure`.

```bash
dotnet test                  # 16 offline tests + 1 end-to-end test (skipped without credentials)
```

## How validation works

- **Issuer** `https://<project-ref>.supabase.co/auth/v1`, **audience** `authenticated`, lifetime required, 30 s clock skew.
- **Signing keys** come from `<issuer>/.well-known/jwks.json` via IdentityModel's `ConfigurationManager`,
  which caches them.
- **Key rotation:** a token whose `kid` isn't cached makes the token handler refetch the JWKS and revalidate.
  The first refetch is immediate, and later ones are throttled by `Supabase:JwksRefreshInterval` (default 1 min).
  Tokens from the previous key keep working while Supabase still publishes it. A **revoked** key stays trusted
  until the periodic refresh (`Supabase:JwksAutomaticRefreshInterval`, default 10 min; IdentityModel minimum
  5 min) or until the token expires (Supabase default: 1 h). That's an accepted window for this product.
  *Finding:* in .NET 10 the refetch is done by IdentityModel itself. `JwtBearerOptions.RefreshOnIssuerKeyNotFound`
  isn't the operative mechanism, because disabling it didn't break rotation.
- **Algorithms:** only ES256 and RS256. Tokens signed with the legacy shared HS256 secret are refused,
  so the API holds no signing secret.
- **Identity:** the user ID is the `sub` claim, which must be a UUID. Tokens are additionally refused when
  `role ≠ authenticated` or `is_anonymous = true`.
- **Errors:** 401 responses are RFC 9457 ProblemDetails, and the rejection reason is logged server-side only.
- `email_verified` is read from the `user_metadata` object claim, where Supabase puts it.

## Automated tests (offline, locally generated ES256 key)

Pass: a valid token returns 200 and the ID equals `sub`; keys are fetched from the expected JWKS URI; `/health` is anonymous.
Reject (401 ProblemDetails): missing token, expired, wrong issuer, wrong audience, unknown key with the
same `kid`, HS256 shared secret, tampered payload, `alg: none`, anonymous user, non-`authenticated`
role, non-UUID `sub`.
Rotation: a token signed by a newly published key is accepted without a restart, the old key's tokens
still work while that key is published, and a never-published `kid` stays rejected even after refetching.
Probe: freezing the JWKS to the old key makes the rotation test fail, so the test depends on refetching.

## End-to-end test against a hosted Supabase project

`SupabaseEndToEndTests` signs in with the Supabase Auth REST API (what supabase-js does), calls `/me`
with the real access token, asserts the API's user ID equals Supabase's user ID, and asserts a token
with a tampered signature is rejected. It prints the token's algorithm, key ID, and claim types for the
write-up.

Setup:

1. Create a Supabase project (free tier is fine for development).
2. **Authentication → Sign In / Providers:** keep Email enabled.
3. **Project Settings → JWT Keys:** make sure the *current* key is asymmetric (ECC P-256 or RSA). If it's the legacy HS256 secret, create a standby asymmetric key and rotate to it.
4. **Authentication → Users → Add user:** create a throwaway test user with **Auto Confirm User** checked.
5. Run:

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."   # or the legacy anon key
$env:SUPABASE_TEST_EMAIL = "test-user@example.com"
$env:SUPABASE_TEST_PASSWORD = "<password>"
dotnet test --output Detailed   # run from this folder; global.json here selects the test runner
```

## Status

- [x] Offline validation behaviour, including key rotation (16 tests).
- [x] End-to-end against a hosted free project, **passed 2026-10-17** (17/17, not skipped). This confirmed
  the issuer format, the JWKS path, asymmetric signing, `role = authenticated`, and that the API's user ID
  equals the Supabase user ID. A tampered token was rejected.
  Not yet recorded: the exact algorithm (ES256 vs RS256) and the `email_verified` location. Confirm both
  in Phase 1 from the `/me` response.
- [ ] Google OAuth redirect flow. This needs a browser and is moved to Phase 1, where the login UI exists.
  Token validation is identical for OAuth sessions.
