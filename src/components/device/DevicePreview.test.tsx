import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevicePreview } from "./DevicePreview";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { Device } from "../../lib/types";

const connectedDevice: Device = {
  udid: "1234567890abcdef",
  name: "Vlad's iPhone",
  model: "iPhone 15 Pro Max",
  iosVersion: "18.5",
  batteryPercent: 83,
  connected: true,
  trustStatus: "connected"
};

describe("DevicePreview", () => {
  it("renders connected device metadata with shortened UDID", () => {
    const { container } = renderWithI18n(<DevicePreview device={connectedDevice} role="source" />);

    expect(screen.getByLabelText("Source iPhone")).toBeInTheDocument();
    expect(screen.getByText("Vlad's iPhone")).toBeInTheDocument();
    expect(screen.getByText("iPhone 15 Pro Max")).toBeInTheDocument();
    expect(screen.getByText("iOS 18.5")).toBeInTheDocument();
    expect(screen.getByText("123456...abcdef")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>(".devicePreview__batteryFill")?.style.width).toBe("83%");
    expect(container.querySelector(".devicePreview__statusBar > span:first-child")?.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(container.querySelector(".devicePreview__caption")).not.toBeInTheDocument();
  });

  it("renders unavailable and disconnected battery states without stale values", () => {
    const notTrusted = { ...connectedDevice, trustStatus: "notTrusted" as const, name: null };
    const { rerender, container } = renderWithI18n(<DevicePreview device={notTrusted} role="target" loading />);

    expect(screen.getByText("Trust required")).toBeInTheDocument();
    expect(screen.getByText("Unlock iPhone")).toBeInTheDocument();
    expect(screen.getByText("Checking device...")).toBeInTheDocument();
    expect(container.querySelector(".devicePreview__battery")?.getAttribute("data-state")).toBe("loading");
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<DevicePreview device={{ ...connectedDevice, batteryPercent: null }} role="target" />);
    expect(container.querySelector(".devicePreview__battery")?.getAttribute("data-state")).toBe("unavailable");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector(".devicePreview__batteryFill")).not.toBeInTheDocument();

    rerender(<DevicePreview device={null} role="target" />);
    expect(screen.getByText("Connect iPhone")).toBeInTheDocument();
    expect(screen.queryByText("83%")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector(".devicePreview__battery")?.getAttribute("data-state")).toBe("disconnected");
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
  });

  it("clips a full battery fill inside an inset track", () => {
    const { container } = renderWithI18n(
      <DevicePreview device={{ ...connectedDevice, batteryPercent: 100 }} role="source" />
    );

    const track = container.querySelector(".devicePreview__batteryTrack");
    const fill = container.querySelector<HTMLElement>(".devicePreview__batteryFill");
    expect(track).toContainElement(fill);
    expect(fill?.style.width).toBe("100%");
  });
});
