import React from "react";
import { render, screen } from "@testing-library/react";
import UsageQuotaNote from "./UsageQuotaNote";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

// docs/ADMIN_PANEL_PLAN.md §7 — "Onboarding/upload/botscan/manual-entry
// screens surface remaining quota for Freemium." Previously only the
// Subscription screen showed usage, and only after a limit was already hit
// (the PLAN_LIMIT_REACHED modal) — this is the proactive version, reused
// across ChooseFetchMethod/BotScan/FileUpload/ManualEntry.
describe("UsageQuotaNote", () => {
  it("renders nothing while entitlements hasn't loaded yet", () => {
    useDive.mockReturnValue({ entitlements: null });
    const { container } = render(<UsageQuotaNote usageKey="bot_scan" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a Premium user (unlimited)", () => {
    useDive.mockReturnValue({ entitlements: { isPremium: true, entitlements: {}, usage: {} } });
    const { container } = render(<UsageQuotaNote usageKey="bot_scan" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows remaining quota, picking whichever window (weekly/monthly) is more restrictive", () => {
    useDive.mockReturnValue({
      entitlements: {
        isPremium: false,
        entitlements: { botScanWeekly: 1, botScanMonthly: 3 },
        usage: { bot_scan: { weekly: 0, monthly: 1 } },
      },
    });
    render(<UsageQuotaNote usageKey="bot_scan" />);
    // 1 left this week (1-0), 2 left this month (3-1) — weekly is tighter.
    expect(screen.getByTestId("usage-quota-note-bot_scan")).toHaveTextContent("1 Bot Scan AI extractions left on your free plan this week");
  });

  it("shows the exhausted message once the limit is reached", () => {
    useDive.mockReturnValue({
      entitlements: {
        isPremium: false,
        entitlements: { docUploadWeekly: 1, docUploadMonthly: 3 },
        usage: { doc_upload: { weekly: 1, monthly: 1 } },
      },
    });
    render(<UsageQuotaNote usageKey="doc_upload" />);
    expect(screen.getByTestId("usage-quota-note-doc_upload")).toHaveTextContent("You've used all your free AI document extractions for this week");
  });

  it("renders nothing when the key has no configured limit (unlimited portfolio edits, e.g. Premium-shaped data)", () => {
    useDive.mockReturnValue({
      entitlements: {
        isPremium: false,
        entitlements: { portfolioEditWeekly: null, portfolioEditMonthly: null },
        usage: { portfolio_edit: { weekly: 5, monthly: 20 } },
      },
    });
    const { container } = render(<UsageQuotaNote usageKey="portfolio_edit" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an unknown usage key", () => {
    useDive.mockReturnValue({ entitlements: { isPremium: false, entitlements: {}, usage: {} } });
    const { container } = render(<UsageQuotaNote usageKey="not_a_real_key" />);
    expect(container).toBeEmptyDOMElement();
  });
});
