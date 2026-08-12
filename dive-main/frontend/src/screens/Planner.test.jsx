import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Planner from "./Planner";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({
  useDive: jest.fn(),
}));

const DEFAULT_PLANNER_STATE = {
  mode: "sip", lumpsumAmount: 50000, sipMonthly: 5000, sipStepUp: 10, sipYears: 10, sipExpandedMonthly: false,
};

// Mirrors DiveContext.js's real setPlannerState exactly (merge-patch, with
// support for a functional patch of the whole state) — the bug only shows up
// against this real merge behavior, not a naive test double.
function PlannerHarness() {
  const [plannerState, setPlannerStateRaw] = React.useState(DEFAULT_PLANNER_STATE);
  const setPlannerState = (patch) =>
    setPlannerStateRaw((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  useDive.mockReturnValue({
    holdings: [], prefs: { risk: "Balanced", excluded: [] }, user: { age: 30 }, plannerState, setPlannerState,
  });
  return <Planner />;
}

// Bug report: clicking "Show monthly" switched the SIP breakdown to monthly
// rows, but clicking "Show yearly" afterward never switched back. Root
// cause: the button called setExpandedMonthly((v) => !v) — a React
// useState-style functional updater — but setExpandedMonthly (Planner.jsx)
// is a plain value setter (`(v) => setPlannerState({ sipExpandedMonthly: v })`),
// not a useState dispatch function. It stored the updater FUNCTION itself as
// sipExpandedMonthly's value instead of calling it — and since a function is
// always truthy, `expandedMonthly` was permanently stuck "on" from the very
// first click onward, no matter how many more times it was clicked.
describe("Planner — SIP yearly/monthly toggle", () => {
  it("switches back to yearly after switching to monthly", async () => {
    const user = userEvent.setup();
    render(<PlannerHarness />);

    // sipExpandedMonthly starts false → yearly view, offering to switch to monthly.
    expect(screen.getByTestId("planner-expand-monthly-btn")).toHaveTextContent("Show monthly");
    expect(screen.getByTestId("planner-row-y-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("planner-expand-monthly-btn"));
    expect(screen.getByTestId("planner-expand-monthly-btn")).toHaveTextContent("Show yearly");
    expect(screen.getByTestId("planner-row-m-1")).toBeInTheDocument();

    // The actual bug: this second click must flip it back, not leave it stuck.
    await user.click(screen.getByTestId("planner-expand-monthly-btn"));
    expect(screen.getByTestId("planner-expand-monthly-btn")).toHaveTextContent("Show monthly");
    expect(screen.getByTestId("planner-row-y-1")).toBeInTheDocument();
    expect(screen.queryByTestId("planner-row-m-1")).not.toBeInTheDocument();
  });
});
