import type { NodeId } from "@sdl/architecture";
import type { Failure, FailureKind } from "@sdl/simulation";
import { useEditor, useEditorStore } from "../store/editorContext";

/** Reading and changing the injected failures (session only, not saved with the design). */
export function useFailures() {
  const store = useEditorStore();
  const failures = useEditor((s) => s.scenario.failures);
  const find = (nodeId: NodeId, kind: FailureKind) =>
    failures.find((f) => f.nodeId === nodeId && f.kind === kind);
  /** `true` or a count turns a failure on (instance failures take a count), `false` turns it off. */
  const set = (nodeId: NodeId, kind: FailureKind, value: boolean | number) => {
    const others = store
      .getState()
      .scenario.failures.filter((f) => !(f.nodeId === nodeId && f.kind === kind));
    if (value === false) {
      store.getState().setFailures(others);
      return;
    }
    const failure: Failure =
      kind === "app-instance-failure"
        ? { kind, nodeId, count: typeof value === "number" ? value : 1 }
        : ({ kind, nodeId } as Failure);
    store.getState().setFailures([...others, failure]);
  };
  return { failures, find, set, clear: () => store.getState().setFailures([]) };
}
