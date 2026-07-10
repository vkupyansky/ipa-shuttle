import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TargetIPhoneScreen } from "./TargetIPhoneScreen";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { Device, LocalIpa } from "../../lib/types";

const device: Device = {
  udid: "000000000000000000000000",
  name: "iPhone",
  connected: true,
  trustStatus: "connected"
};

const missingIpa: LocalIpa = {
  id: "ipa-1",
  bundleId: "com.example.missing",
  appName: "Missing App",
  ipaPath: "/tmp/missing.ipa",
  downloadedAt: "2026-07-09T00:00:00.000Z",
  status: "missing"
};

const downloadedIpa: LocalIpa = {
  id: "ipa-2",
  bundleId: "com.example.downloaded",
  appName: "Downloaded App",
  ipaPath: "/tmp/downloaded.ipa",
  downloadedAt: "2026-07-09T00:00:00.000Z",
  status: "downloaded"
};

describe("TargetIPhoneScreen", () => {
  it("blocks install and explains missing IPA entries", () => {
    renderWithI18n(
      <TargetIPhoneScreen
        device={device}
        ipas={[missingIpa]}
        installing={false}
        selectedIds={new Set(["ipa-1"])}
        statuses={{}}
        query=""
        onQueryChange={vi.fn()}
        onToggleIpa={vi.fn()}
        onSelectAllIpas={vi.fn()}
        onClearIpaSelection={vi.fn()}
        onDeleteIpa={vi.fn()}
        onDeleteSelectedIpas={vi.fn()}
        onInstallSelected={vi.fn()}
      />
    );

    expect(screen.getByText("IPA file is missing")).toBeInTheDocument();
    expect(screen.getByText("Missing IPA files cannot be installed")).toBeInTheDocument();
    expect(screen.getByText("1 selected of 1 IPA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove entry for com.example.missing" })).toBeInTheDocument();
  });

  it("shows no-selection and disconnected disabled reasons", () => {
    const props = {
      ipas: [downloadedIpa],
      installing: false,
      selectedIds: new Set<string>(),
      statuses: {},
      query: "",
      onQueryChange: vi.fn(),
      onToggleIpa: vi.fn(),
      onSelectAllIpas: vi.fn(),
      onClearIpaSelection: vi.fn(),
      onDeleteIpa: vi.fn(),
      onDeleteSelectedIpas: vi.fn(),
      onInstallSelected: vi.fn()
    };
    const { rerender } = renderWithI18n(<TargetIPhoneScreen {...props} device={device} />);

    expect(screen.getByText("Select at least one IPA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install selected" })).toBeDisabled();

    rerender(<TargetIPhoneScreen {...props} device={null} selectedIds={new Set(["ipa-2"])} />);
    expect(screen.getByText("Connect and trust the target iPhone")).toBeInTheDocument();
  });

  it("allows installing downloaded selected IPA and shows loading labels", () => {
    renderWithI18n(
      <TargetIPhoneScreen
        device={device}
        ipas={[downloadedIpa]}
        installing
        selectedIds={new Set(["ipa-2"])}
        statuses={{ "ipa-2": "installed" }}
        query=""
        onQueryChange={vi.fn()}
        onToggleIpa={vi.fn()}
        onSelectAllIpas={vi.fn()}
        onClearIpaSelection={vi.fn()}
        onDeleteIpa={vi.fn()}
        onDeleteSelectedIpas={vi.fn()}
        onInstallSelected={vi.fn()}
      />
    );

    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installing selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete selected IPA files" })).toBeDisabled();
  });

  it("uses Remove entries for selected missing IPAs", () => {
    renderWithI18n(
      <TargetIPhoneScreen
        device={device}
        ipas={[missingIpa]}
        installing={false}
        selectedIds={new Set(["ipa-1"])}
        statuses={{}}
        query=""
        onQueryChange={vi.fn()}
        onToggleIpa={vi.fn()}
        onSelectAllIpas={vi.fn()}
        onClearIpaSelection={vi.fn()}
        onDeleteIpa={vi.fn()}
        onDeleteSelectedIpas={vi.fn()}
        onInstallSelected={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Remove entries" })).toBeInTheDocument();
  });
});
