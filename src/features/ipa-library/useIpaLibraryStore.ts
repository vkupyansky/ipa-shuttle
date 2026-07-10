import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { LocalIpa } from "../../lib/types";

export function useIpaLibraryStore() {
  const [items, setItems] = useState<LocalIpa[]>([]);
  const requestGenerationRef = useRef(0);
  const mutationRevisionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback((update: LocalIpa[] | ((current: LocalIpa[]) => LocalIpa[])) => {
    mutationRevisionRef.current += 1;
    requestGenerationRef.current += 1;
    setItems(update);
  }, []);

  const reconcile = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    const mutationRevision = mutationRevisionRef.current;
    const nextItems = await api.listLocalIpas();
    const currentRequest = requestGeneration === requestGenerationRef.current;
    const noNewerMutation = mutationRevision === mutationRevisionRef.current;

    if (mountedRef.current && currentRequest && noNewerMutation) {
      setItems(nextItems);
      return { items: nextItems, applied: true };
    }
    return { items: nextItems, applied: false };
  }, []);

  const replace = useCallback(
    (nextItems: LocalIpa[]) => {
      commit(nextItems);
    },
    [commit]
  );

  const upsert = useCallback(
    (item: LocalIpa) => {
      commit((current) => [
        ...current.filter((existing) => existing.id !== item.id && existing.bundleId !== item.bundleId),
        item
      ]);
    },
    [commit]
  );

  const remove = useCallback(
    (ipaIds: Iterable<string>) => {
      const removedIds = new Set(ipaIds);
      commit((current) => current.filter((item) => !removedIds.has(item.id)));
    },
    [commit]
  );

  return { items, reconcile, replace, upsert, remove };
}
