/** Document limits (PRD PG-11). Enforced by the schema, the editor and the API. */
export const LIMITS = {
  nodes: 150,
  edges: 400,
  operations: 20,
  /** UTF-8 bytes of the serialized document. */
  documentBytes: 256 * 1024,
  labelLength: 60,
  operationNameLength: 60,
  notesLength: 4096,
  /** Total steps in one flow, counting nested on-miss steps. */
  stepsPerFlow: 20,
  /** Levels of step lists: a flow, its on-miss steps, and their on-miss steps. */
  flowNesting: 3,
  maxTotalRps: 10_000_000,
} as const;

export function documentByteSize(document: unknown): number {
  return new TextEncoder().encode(JSON.stringify(document)).length;
}
