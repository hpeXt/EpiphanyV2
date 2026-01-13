import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider } from "@/components/i18n/I18nProvider";
import { LanguageSettings } from "@/components/my/LanguageSettings";

const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

describe("LanguageSettings", () => {
  beforeEach(() => {
    document.cookie = "epiphany_locale=; Path=/; Max-Age=0";
    mockRefresh.mockReset();
  });

  it("switches locale and persists to cookie", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh">
        <LanguageSettings />
      </I18nProvider>,
    );

    const zh = screen.getByRole("button", { name: "中文" });
    const en = screen.getByRole("button", { name: "EN" });

    expect(zh).toHaveAttribute("aria-pressed", "true");
    expect(en).toHaveAttribute("aria-pressed", "false");

    await user.click(en);

    expect(zh).toHaveAttribute("aria-pressed", "false");
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(document.cookie).toContain("epiphany_locale=en");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing when clicking active locale", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh">
        <LanguageSettings />
      </I18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "中文" }));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

