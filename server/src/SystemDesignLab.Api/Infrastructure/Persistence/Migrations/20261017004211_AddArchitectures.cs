using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SystemDesignLab.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddArchitectures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "architectures",
                schema: "app",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    document = table.Column<string>(type: "jsonb", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    node_count = table.Column<int>(type: "integer", nullable: false),
                    challenge_slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    import_key = table.Column<Guid>(type: "uuid", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_architectures", x => x.id);
                    table.ForeignKey(
                        name: "fk_architectures_user_profiles_owner_id",
                        column: x => x.owner_id,
                        principalSchema: "app",
                        principalTable: "user_profiles",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_architectures_owner_id_import_key",
                schema: "app",
                table: "architectures",
                columns: new[] { "owner_id", "import_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_architectures_owner_id_updated_at",
                schema: "app",
                table: "architectures",
                columns: new[] { "owner_id", "updated_at" },
                descending: new[] { false, true });

            // Same defence in depth as InitialCreate: RLS with no policies, and no access for Supabase's client roles.
            migrationBuilder.Sql("ALTER TABLE app.architectures ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("""
                DO $$
                DECLARE client_role text;
                BEGIN
                  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
                      EXECUTE format('REVOKE ALL ON app.architectures FROM %I', client_role);
                    END IF;
                  END LOOP;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Dropping the table also drops its RLS setting and grants.
            migrationBuilder.DropTable(
                name: "architectures",
                schema: "app");
        }
    }
}
