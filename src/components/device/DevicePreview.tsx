import { Cable, ShieldAlert } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { shortUdid } from "../../lib/format";
import type { Device } from "../../lib/types";

type Props = {
  device: Device | null;
  role: "source" | "target";
  loading?: boolean;
};

type BatteryDisplayState =
  | { kind: "loading" }
  | { kind: "available"; percent: number }
  | { kind: "unavailable" }
  | { kind: "disconnected" };

export function DevicePreview({ device, role, loading = false }: Props) {
  const { t } = useI18n();
  const state = device?.trustStatus === "notTrusted" ? "notTrusted" : device ? "connected" : "disconnected";
  const name = device?.name || t("device.iphone");
  const roleLabel = role === "source" ? t("device.roleSource") : t("device.roleTarget");
  const connectionLabel =
    state === "connected" ? t("device.connected") : state === "notTrusted" ? t("device.notTrusted") : t("device.disconnected");
  const modelOrFallback = device?.model || t("device.iphone");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const battery = batteryDisplayState(device, loading);
  const batteryLabel = battery.kind === "available" ? `${battery.percent}%` : "—";

  return (
    <section className={`devicePreview devicePreview--${state}`} aria-label={t("device.previewLabel", { role: roleLabel })}>
      <div className="devicePreview__frame" aria-hidden="true">
        <div className="devicePreview__screen">
          <div className="devicePreview__statusBar">
            <span>{time}</span>
            <span className={`devicePreview__battery devicePreview__battery--${battery.kind}`} data-state={battery.kind}>
              <span className="devicePreview__batteryShell">
                <span className="devicePreview__batteryTrack">
                  {battery.kind === "available" ? (
                    <span className="devicePreview__batteryFill" style={{ width: `${battery.percent}%` }} />
                  ) : null}
                </span>
                <span className="devicePreview__batteryText">{batteryLabel}</span>
              </span>
            </span>
          </div>
          <div className="devicePreview__island" />
          <div className="devicePreview__screenText">
            {state === "connected" ? (
              <>
                <strong>{name}</strong>
                <span>{modelOrFallback}</span>
                <span>{t("device.ios")} {device?.iosVersion || t("device.unknown")}</span>
                <small>{device ? shortUdid(device.udid) : t("device.notConnected")}</small>
                <span className="devicePreview__statusText">{connectionLabel}</span>
              </>
            ) : state === "notTrusted" ? (
              <>
                <ShieldAlert size={20} />
                <strong>{t("device.trustRequired")}</strong>
                <span>{t("device.unlockIphone")}</span>
                <small>{device ? shortUdid(device.udid) : t("device.notConnected")}</small>
                <span className="devicePreview__statusText devicePreview__statusText--warning">{connectionLabel}</span>
              </>
            ) : (
              <>
                <Cable size={20} />
                <strong>{t("device.connectIphone")}</strong>
                <span>{t("device.connectUsb")}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {loading ? <p className="devicePreview__hint">{t("device.checking")}</p> : null}
    </section>
  );
}

function batteryDisplayState(device: Device | null, loading: boolean): BatteryDisplayState {
  if (!device) {
    return { kind: "disconnected" };
  }
  if (loading) {
    return { kind: "loading" };
  }
  if (typeof device.batteryPercent === "number" && device.batteryPercent >= 0 && device.batteryPercent <= 100) {
    return { kind: "available", percent: device.batteryPercent };
  }
  return { kind: "unavailable" };
}
