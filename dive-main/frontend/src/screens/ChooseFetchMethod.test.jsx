import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChooseFetchMethod from "./ChooseFetchMethod";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

describe("ChooseFetchMethod", () => {
  const baseContext = { setScreen: jest.fn(), goBack: jest.fn(), holdings: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue(baseContext);
  });

  it("renders every method and navigates to its screen on click", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({ ...baseContext, setScreen });
    const user = userEvent.setup();
    render(<ChooseFetchMethod />);

    await user.click(screen.getByTestId("method-botScan"));
    expect(setScreen).toHaveBeenCalledWith("botScan");
  });

  it("shows the skip-for-now button only when the account already has holdings", () => {
    const { rerender } = render(<ChooseFetchMethod />);
    expect(screen.queryByTestId("choose-method-skip-btn")).not.toBeInTheDocument();

    useDive.mockReturnValue({ ...baseContext, holdings: [{ id: "h1" }] });
    rerender(<ChooseFetchMethod />);
    expect(screen.getByTestId("choose-method-skip-btn")).toBeInTheDocument();
  });

  // docs/ADMIN_PANEL_PLAN.md §7 — proactive Freemium quota surfacing, since
  // every method here eventually consumes portfolio-edit quota.
  it("shows the portfolio-edit quota note for a Freemium user nearing their limit", () => {
    useDive.mockReturnValue({
      ...baseContext,
      entitlements: {
        isPremium: false,
        entitlements: { portfolioEditWeekly: 2, portfolioEditMonthly: 5 },
        usage: { portfolio_edit: { weekly: 1, monthly: 1 } },
      },
    });
    render(<ChooseFetchMethod />);
    expect(screen.getByTestId("usage-quota-note-portfolio_edit")).toHaveTextContent("1 portfolio edits left");
  });

  it("shows nothing for a Premium user", () => {
    useDive.mockReturnValue({ ...baseContext, entitlements: { isPremium: true, entitlements: {}, usage: {} } });
    render(<ChooseFetchMethod />);
    expect(screen.queryByTestId("usage-quota-note-portfolio_edit")).not.toBeInTheDocument();
  });
});
