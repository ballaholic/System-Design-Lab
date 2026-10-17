import type { ValidationIssue } from "@sdl/architecture";

export function issueCounts(issues: readonly ValidationIssue[]) {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
