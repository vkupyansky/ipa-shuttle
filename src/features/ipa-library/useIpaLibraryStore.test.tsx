import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import type { LocalIpa } from "../../lib/types";
import { useIpaLibraryStore } from "./useIpaLibraryStore";

const downloadedIpa: LocalIpa = {
  id: "ipa-1",
  bundleId: "com.example.app",
  appName: "Example App",
  ipaPath: "/tmp/Example.ipa",
  downloadedAt: "2026-07-10T00:00:00.000Z",
  status: "downloaded"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("useIpaLibraryStore", () => {
  it("ignores a stale reconcile response after a local library mutation", async () => {
    const staleList = deferred<LocalIpa[]>();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_local_ipas") {
        return staleList.promise;
      }
      return undefined;
    });
    const { result } = renderHook(() => useIpaLibraryStore());

    act(() => result.current.replace([downloadedIpa]));
    let reconcilePromise!: Promise<{ items: LocalIpa[]; applied: boolean }>;
    act(() => {
      reconcilePromise = result.current.reconcile();
    });
    act(() => result.current.remove([downloadedIpa.id]));
    staleList.resolve([downloadedIpa]);
    await act(async () => {
      await reconcilePromise;
    });

    expect(result.current.items).toEqual([]);
  });

  it("upserts by bundle ID and removes entries atomically", () => {
    const { result } = renderHook(() => useIpaLibraryStore());
    const replacement = { ...downloadedIpa, id: "ipa-2", ipaPath: "/tmp/New.ipa" };

    act(() => result.current.upsert(downloadedIpa));
    act(() => result.current.upsert(replacement));
    expect(result.current.items).toEqual([replacement]);

    act(() => result.current.remove([replacement.id]));
    expect(result.current.items).toEqual([]);
  });
});
