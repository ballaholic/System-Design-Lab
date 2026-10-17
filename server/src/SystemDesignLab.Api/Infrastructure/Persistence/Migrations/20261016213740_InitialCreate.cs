using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SystemDesignLab.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "app");

            migrationBuilder.CreateTable(
                name: "user_profiles",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    avatar_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_profiles", x => x.id);
                });

            // Defence in depth (ADR-006): the browser never queries the database, and the API connects as the
            // table owner, which bypasses RLS. Enabling RLS with no policies and revoking Supabase's client roles
            // means the Data API cannot read app tables even if the schema were ever exposed.
            // Every new app table must enable RLS in its own migration.
            migrationBuilder.Sql("ALTER TABLE app.user_profiles ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("""
                DO $$
                DECLARE client_role text;
                BEGIN
                  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
                      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', client_role);
                      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', client_role);
                      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM %I', client_role);
                    END IF;
                  END LOOP;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_profiles",
                schema: "app");
        }
    }
}
