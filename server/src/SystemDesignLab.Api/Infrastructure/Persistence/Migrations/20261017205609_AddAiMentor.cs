using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SystemDesignLab.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAiMentor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_conversations",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    title = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    architecture_id = table.Column<Guid>(type: "uuid", nullable: true),
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ai_conversations", x => x.id);
                    table.ForeignKey(
                        name: "fk_ai_conversations_architectures_architecture_id",
                        column: x => x.architecture_id,
                        principalSchema: "app",
                        principalTable: "architectures",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_ai_conversations_challenge_attempts_attempt_id",
                        column: x => x.attempt_id,
                        principalSchema: "app",
                        principalTable: "challenge_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_ai_conversations_user_profiles_user_id",
                        column: x => x.user_id,
                        principalSchema: "app",
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ai_spend_global_daily",
                schema: "app",
                columns: table => new
                {
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    cost_micros = table.Column<long>(type: "bigint", nullable: false),
                    reserved_micros = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ai_spend_global_daily", x => x.day);
                });

            migrationBuilder.CreateTable(
                name: "ai_usage_daily",
                schema: "app",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    requests = table.Column<int>(type: "integer", nullable: false),
                    input_tokens = table.Column<long>(type: "bigint", nullable: false),
                    output_tokens = table.Column<long>(type: "bigint", nullable: false),
                    cache_read_tokens = table.Column<long>(type: "bigint", nullable: false),
                    cost_micros = table.Column<long>(type: "bigint", nullable: false),
                    reserved_micros = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ai_usage_daily", x => new { x.user_id, x.day });
                    table.ForeignKey(
                        name: "fk_ai_usage_daily_user_profiles_user_id",
                        column: x => x.user_id,
                        principalSchema: "app",
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ai_messages",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    findings = table.Column<string>(type: "jsonb", nullable: true),
                    context_ref = table.Column<string>(type: "jsonb", nullable: true),
                    model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    input_tokens = table.Column<int>(type: "integer", nullable: true),
                    output_tokens = table.Column<int>(type: "integer", nullable: true),
                    cache_read_tokens = table.Column<int>(type: "integer", nullable: true),
                    cost_micros = table.Column<long>(type: "bigint", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ai_messages", x => x.id);
                    table.ForeignKey(
                        name: "fk_ai_messages_ai_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalSchema: "app",
                        principalTable: "ai_conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_conversations_architecture_id",
                schema: "app",
                table: "ai_conversations",
                column: "architecture_id");

            migrationBuilder.CreateIndex(
                name: "ix_ai_conversations_attempt_id",
                schema: "app",
                table: "ai_conversations",
                column: "attempt_id");

            migrationBuilder.CreateIndex(
                name: "ix_ai_conversations_user_id_updated_at",
                schema: "app",
                table: "ai_conversations",
                columns: new[] { "user_id", "updated_at" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "ix_ai_messages_conversation_id_created_at",
                schema: "app",
                table: "ai_messages",
                columns: new[] { "conversation_id", "created_at" });

            // Same defence in depth as InitialCreate: RLS with no policies, and no access for Supabase's client roles.
            foreach (var table in new[] { "ai_conversations", "ai_messages", "ai_usage_daily", "ai_spend_global_daily" })
            {
                migrationBuilder.Sql($"ALTER TABLE app.{table} ENABLE ROW LEVEL SECURITY;");
            }
            migrationBuilder.Sql("""
                DO $$
                DECLARE client_role text;
                DECLARE mentor_table text;
                BEGIN
                  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
                      FOREACH mentor_table IN ARRAY ARRAY['ai_conversations', 'ai_messages', 'ai_usage_daily', 'ai_spend_global_daily'] LOOP
                        EXECUTE format('REVOKE ALL ON app.%I FROM %I', mentor_table, client_role);
                      END LOOP;
                    END IF;
                  END LOOP;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_messages",
                schema: "app");

            migrationBuilder.DropTable(
                name: "ai_spend_global_daily",
                schema: "app");

            migrationBuilder.DropTable(
                name: "ai_usage_daily",
                schema: "app");

            migrationBuilder.DropTable(
                name: "ai_conversations",
                schema: "app");
        }
    }
}
