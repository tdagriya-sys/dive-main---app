import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HistoryPanel from "./HistoryPanel";

const HISTORY = [
  { version: 2, status: "active", changeNote: "lower the cap", publishedAt: "2026-01-02T00:00:00.000Z" },
  { version: 1, status: "archived", changeNote: "initial", publishedAt: "2026-01-01T00:00:00.000Z" },
];

function noopGetVersion() {
  return Promise.resolve({ version: 1, payload: {} });
}

describe("HistoryPanel", () => {
  it("renders nothing when history is null (still loading)", () => {
    const { container } = render(<HistoryPanel history={null} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty state with no versions", () => {
    render(<HistoryPanel history={[]} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);
    expect(screen.getByTestId("admin-config-history-empty")).toBeInTheDocument();
  });

  it("lists every version with its status and change note", () => {
    render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("lower the cap")).toBeInTheDocument();
    expect(screen.getByText("initial")).toBeInTheDocument();
  });

  it("only shows a rollback button for archived versions, not the active one", () => {
    render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);
    expect(screen.queryByTestId("admin-config-rollback-btn-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-config-rollback-btn-1")).toBeInTheDocument();
  });

  it("calls onRollback with the version number", () => {
    const onRollback = jest.fn();
    render(<HistoryPanel history={HISTORY} onRollback={onRollback} rollingBack={false} getVersion={noopGetVersion} />);
    fireEvent.click(screen.getByTestId("admin-config-rollback-btn-1"));
    expect(onRollback).toHaveBeenCalledWith(1);
  });

  it("disables the rollback button while a rollback is in flight", () => {
    render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack getVersion={noopGetVersion} />);
    expect(screen.getByTestId("admin-config-rollback-btn-1")).toBeDisabled();
  });

  describe("version diff", () => {
    it("shows the Compare button only once exactly two versions are selected", () => {
      render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);
      expect(screen.queryByTestId("admin-config-history-compare-btn")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      expect(screen.queryByTestId("admin-config-history-compare-btn")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      expect(screen.getByTestId("admin-config-history-compare-btn")).toHaveTextContent("Compare v1 vs v2");
    });

    it("selecting a third version drops the oldest selection (keeps the two most recent clicks)", () => {
      const history3 = [...HISTORY, { version: 3, status: "archived", changeNote: "third", publishedAt: "2026-01-03T00:00:00.000Z" }];
      render(<HistoryPanel history={history3} onRollback={() => {}} rollingBack={false} getVersion={noopGetVersion} />);

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-3"));

      expect(screen.getByTestId("admin-config-history-select-1")).not.toBeChecked();
      expect(screen.getByTestId("admin-config-history-select-2")).toBeChecked();
      expect(screen.getByTestId("admin-config-history-select-3")).toBeChecked();
      expect(screen.getByTestId("admin-config-history-compare-btn")).toHaveTextContent("Compare v2 vs v3");
    });

    it("fetches both selected versions, diffs their payloads, and renders the result", async () => {
      const getVersion = jest.fn((version) =>
        Promise.resolve({
          version,
          payload: version === 1 ? { cryptoWithinClassCap: 70, unchanged: "x" } : { cryptoWithinClassCap: 40, unchanged: "x" },
        })
      );
      render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={getVersion} />);

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));

      expect(getVersion).toHaveBeenCalledWith(1);
      expect(getVersion).toHaveBeenCalledWith(2);

      await waitFor(() => expect(screen.queryByTestId("admin-config-diff-loading")).not.toBeInTheDocument());
      expect(screen.getByTestId("admin-config-diff-result")).toHaveTextContent("Comparing v1 → v2");
      expect(screen.getByTestId("admin-config-diff-result")).toHaveTextContent("cryptoWithinClassCap");
      expect(screen.getByTestId("admin-config-diff-result")).toHaveTextContent("70");
      expect(screen.getByTestId("admin-config-diff-result")).toHaveTextContent("40");
      expect(screen.getByTestId("admin-config-diff-result")).not.toHaveTextContent("unchanged");
    });

    it("shows a 'no differences' message when the two selected versions are identical", async () => {
      const getVersion = jest.fn(() => Promise.resolve({ payload: { a: 1 } }));
      render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={getVersion} />);

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));

      await waitFor(() => expect(screen.getByTestId("admin-config-diff-empty")).toBeInTheDocument());
    });

    it("shows an error message when fetching a version fails", async () => {
      const getVersion = jest.fn().mockRejectedValue(new Error("network down"));
      render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={getVersion} />);

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));

      await waitFor(() => expect(screen.getByTestId("admin-config-diff-error")).toBeInTheDocument());
    });

    it("unchecking a selected version hides the Compare button and clears any shown diff", async () => {
      const getVersion = jest.fn(() => Promise.resolve({ payload: { a: 1 } }));
      render(<HistoryPanel history={HISTORY} onRollback={() => {}} rollingBack={false} getVersion={getVersion} />);

      fireEvent.click(screen.getByTestId("admin-config-history-select-1"));
      fireEvent.click(screen.getByTestId("admin-config-history-select-2"));
      fireEvent.click(screen.getByTestId("admin-config-history-compare-btn"));
      await waitFor(() => expect(screen.getByTestId("admin-config-diff-result")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("admin-config-history-select-1")); // uncheck
      expect(screen.queryByTestId("admin-config-history-compare-btn")).not.toBeInTheDocument();
      expect(screen.queryByTestId("admin-config-diff-result")).not.toBeInTheDocument();
    });
  });
});
