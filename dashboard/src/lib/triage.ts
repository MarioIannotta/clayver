import { useMemo } from "react";
import { DEFAULT_PRIORITIES, DEFAULT_STAGES, subscribeTriageOptions, type TriageOption, type TriageOptions } from "@clayver/core";
import { useClient } from "../clayver";
import type { SelectOption } from "../components/Select";
import { useValueSubscription } from "./hooks";

const DEFAULTS: TriageOptions = { priority: [...DEFAULT_PRIORITIES], stage: [...DEFAULT_STAGES] };

/** The workspace's priority and status lists, with lookups by id. */
export function useTriageOptions() {
  const client = useClient();
  const result = useValueSubscription<TriageOptions>("triage-options", DEFAULTS, (onValue, onError) =>
    subscribeTriageOptions(client, onValue, onError),
  );
  const byId = useMemo(
    () => ({
      priority: new Map(result.data.priority.map((o) => [o.id, o])),
      stage: new Map(result.data.stage.map((o) => [o.id, o])),
    }),
    [result.data],
  );
  return { ...result, byId };
}

/** Select options for a list, led by an empty choice (`""` means "not set"). */
export function triageSelectOptions(options: TriageOption[], emptyLabel: string): SelectOption<string>[] {
  return [{ value: "", label: emptyLabel }, ...options.map((o) => ({ value: o.id, label: o.name, color: o.color }))];
}
