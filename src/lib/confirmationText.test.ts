import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import {
  clearLogsConfirmation,
  deleteIpasConfirmation,
  forgetAppleSessionConfirmation
} from "./confirmationText";

const t = translate.bind(null, "en");

describe("confirmation text", () => {
  it("uses delete wording that explicitly says iPhone apps are not removed", () => {
    expect(deleteIpasConfirmation(false, t)).toContain("This will not delete apps from any iPhone");
    expect(deleteIpasConfirmation(true, t)).toContain("This will not delete apps from any iPhone");
    expect(clearLogsConfirmation(t)).toContain("diagnostic log files");
    expect(forgetAppleSessionConfirmation(t)).toContain("will not delete IPA files");
  });
});
