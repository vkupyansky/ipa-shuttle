import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { renderWithI18n } from "../../test/renderWithI18n";

describe("LanguageSwitcher", () => {
  it("switches the UI language between English and Russian", async () => {
    window.localStorage.setItem("ipa-shuttle.language", "en");
    const user = userEvent.setup();

    renderWithI18n(<LanguageSwitcher />);

    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.queryByText("EN")).not.toBeInTheDocument();
    expect(screen.queryByText("RU")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Русский" }));

    expect(screen.getByLabelText("Язык")).toBeInTheDocument();
    expect(window.localStorage.getItem("ipa-shuttle.language")).toBe("ru");
  });
});
