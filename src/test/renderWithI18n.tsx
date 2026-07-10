import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { LanguageProvider } from "../app/providers/LanguageProvider";

function I18nWrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

export function renderWithI18n(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: I18nWrapper, ...options });
}
