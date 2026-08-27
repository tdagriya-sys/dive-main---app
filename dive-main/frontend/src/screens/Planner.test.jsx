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
function PlannerHarness({ initialState } = {}) {
  const [plannerState, setPlannerStateRaw] = React.useState({ ...DEFAULT_PLANNER_STATE, ...initialState });
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

// Bug report: in the Lumpsum planner, each category row's "+₹X new" badge
// rendered as its own line below the category name (left-aligned), instead
// of sitting centered between the category name and the post-investment
// amount on the same line. Fixed by moving it into the row's own flex
// header as a `flex-1 text-center` middle child — asserted here via DOM
// order (name+dot group, then the badge, then the amount) since that sibling
// order is what actually produces the centered position in a
// `justify-between` flex row, plus a bump from text-xs to text-base to
// "highlight" it per the request.
describe("Planner — lumpsum CategoryRow '+amount new' badge", () => {
  it("centers the badge between the category name and the post-investment amount, only for categories actually getting new money", () => {
    render(<PlannerHarness initialState={{ mode: "lumpsum", lumpsumAmount: 100000 }} />);

    // A brand-new investor (holdings: [] from the harness) puts every active
    // category's newInvestment > 0 — Equity is active for every risk/persona
    // tier, so its row is a reliable case to assert the fix against.
    const row = screen.getByTestId("planner-cat-Equity");
    const header = row.firstElementChild; // the `.flex.items-center.justify-between` row
    expect(header.children).toHaveLength(3);

    const [nameGroup, badge, amount] = header.children;
    expect(nameGroup).toHaveTextContent("Equity");
    expect(badge).toHaveTextContent(/^\+₹[\d,]+ new$/);
    expect(badge.className).toContain("text-center");
    expect(badge.className).toContain("text-base"); // bumped up from text-xs

    // plannerEngine's planLumpsum sets finalAmount = existingAmount +
    // newInvestment (Planner.jsx:240) — for a fresh investor existingAmount
    // is 0 for every row, so the badge's figure must exactly match the
    // right-hand amount (which has no "existing → " prefix in that case).
    const badgeFigure = badge.textContent.match(/₹[\d,]+/)[0];
    expect(amount).toHaveTextContent(badgeFigure);
    expect(amount.textContent).not.toContain("→");

    // Order matters for the fix: the badge must be the middle DOM child so
    // justify-between's flex-1 middle item actually lands between the two
    // anchored ends, not appended after them.
    expect(Array.from(header.children).indexOf(badge)).toBe(1);
  });
});
