import { useI18n } from "../../app/providers/LanguageProvider";
import type { Device, ItemProgress, LocalIpa } from "../../lib/types";
import { IpaLibraryList } from "../../components/ipa-library/IpaLibraryList";
import { MacButton } from "../../components/mac/MacButton";

type Props = {
  device: Device | null;
  ipas: LocalIpa[];
  installing: boolean;
  selectedIds: Set<string>;
  statuses: Record<string, ItemProgress | "missing">;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleIpa: (ipaId: string) => void;
  onSelectAllIpas: (ipaIds: string[]) => void;
  onClearIpaSelection: () => void;
  onDeleteIpa: (ipaId: string) => void;
  onDeleteSelectedIpas: () => void;
  onInstallSelected: () => void;
};

export function TargetIPhoneScreen({
  device,
  ipas,
  installing,
  selectedIds,
  statuses,
  query,
  onQueryChange,
  onToggleIpa,
  onSelectAllIpas,
  onClearIpaSelection,
  onDeleteIpa,
  onDeleteSelectedIpas,
  onInstallSelected
}: Props) {
  const { t } = useI18n();
  const connected = Boolean(device && device.trustStatus === "connected");
  const selectedItems = ipas.filter((ipa) => selectedIds.has(ipa.id));
  const selectedHasMissing = selectedItems.some((ipa) => ipa.status === "missing");
  const selectedAllMissing = selectedItems.length > 0 && selectedItems.every((ipa) => ipa.status === "missing");
  const installBlockedReason = installing
    ? null
    : !connected
      ? t("target.block.connect")
      : selectedIds.size === 0
        ? t("target.block.select")
        : selectedHasMissing
          ? t("target.block.missing")
          : null;

  return (
    <div className="screenStack compactScreen">
      <IpaLibraryList
        items={ipas}
        query={query}
        selectedIds={selectedIds}
        statuses={statuses}
        onQueryChange={onQueryChange}
        onToggle={onToggleIpa}
        onSelectAll={onSelectAllIpas}
        onClearSelection={onClearIpaSelection}
        onDeleteOne={onDeleteIpa}
      />
      <div className="actionBar">
        <div>
          <strong>{t("target.selectedOfTotal", { selected: selectedIds.size, total: ipas.length })}</strong>
          {installBlockedReason ? <p className="actionHint">{installBlockedReason}</p> : null}
        </div>
        <div className="actionBar__buttons">
          <MacButton
            type="button"
            variant="secondary"
            disabled={selectedIds.size === 0 || installing}
          onClick={onDeleteSelectedIpas}
        >
            {selectedAllMissing ? t("target.removeEntries") : t("target.deleteSelected")}
          </MacButton>
          <MacButton
            type="button"
            disabled={!connected || selectedIds.size === 0 || selectedHasMissing || installing}
          onClick={onInstallSelected}
        >
            {installing ? t("target.installingSelected") : t("target.installSelected")}
          </MacButton>
        </div>
      </div>
    </div>
  );
}
