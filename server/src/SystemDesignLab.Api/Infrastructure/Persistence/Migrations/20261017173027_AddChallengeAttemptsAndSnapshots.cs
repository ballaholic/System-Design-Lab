using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SystemDesignLab.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddChallengeAttemptsAndSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "architecture_snapshots",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    architecture_id = table.Column<Guid>(type: "uuid", nullable: false),
                    label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    document = table.Column<string>(type: "jsonb", nullable: false),
                    node_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_architecture_snapshots", x => x.id);
                    table.ForeignKey(
                        name: "fk_architecture_snapshots_architectures_architecture_id",
                        column: x => x.architecture_id,
                        principalSchema: "app",
                        principalTable: "architectures",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "challenge_attempts",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    challenge_slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    challenge_version = table.Column<int>(type: "integer", nullable: false),
                    mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    current_stage_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    architecture_id = table.Column<Guid>(type: "uuid", nullable: true),
                    stage_results = table.Column<string>(type: "jsonb", nullable: false),
                    exercise_answers = table.Column<string>(type: "jsonb", nullable: false),
                    hints_revealed = table.Column<List<string>>(type: "text[]", nullable: false),
                    import_key = table.Column<Guid>(type: "uuid", nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_activity_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_challenge_attempts", x => x.id);
                    table.ForeignKey(
                        name: "fk_challenge_attempts_architectures_architecture_id",
                        column: x => x.architecture_id,
                        principalSchema: "app",
                        principalTable: "architectures",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_challenge_attempts_user_profiles_user_id",
                        column: x => x.user_id,
                        principalSchema: "app",
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_architecture_snapshots_architecture_id_created_at",
                schema: "app",
                table: "architecture_snapshots",
                columns: new[] { "architecture_id", "created_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_challenge_attempts_architecture_id",
                schema: "app",
                table: "challenge_attempts",
                column: "architecture_id");

            migrationBuilder.CreateIndex(
                name: "ix_challenge_attempts_user_id_import_key",
                schema: "app",
                table: "challenge_attempts",
                columns: new[] { "user_id", "import_key" },
                unique: true,
                filter: "import_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_challenge_attempts_user_id_last_activity_at",
                schema: "app",
                table: "challenge_attempts",
                columns: new[] { "user_id", "last_activity_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ux_challenge_attempts_in_progress",
                schema: "app",
                table: "challenge_attempts",
                columns: new[] { "user_id", "challenge_slug" },
                unique: true,
                filter: "status = 'in_progress'");

            // Same defence in depth as InitialCreate: RLS with no policies, and no access for Supabase's client roles.
            migrationBuilder.Sql("ALTER TABLE app.challenge_attempts ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("ALTER TABLE app.architecture_snapshots ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("""
                DO $$
                DECLARE client_role text;
                BEGIN
                  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
                      EXECUTE format('REVOKE ALL ON app.challenge_attempts FROM %I', client_role);
                      EXECUTE format('REVOKE ALL ON app.architecture_snapshots FROM %I', client_role);
                    END IF;
                  END LOOP;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "architecture_snapshots",
                schema: "app");

            migrationBuilder.DropTable(
                name: "challenge_attempts",
                schema: "app");
        }
    }
}
