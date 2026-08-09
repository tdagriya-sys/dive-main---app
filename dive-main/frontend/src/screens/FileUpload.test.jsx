import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileUpload from "./FileUpload";
import { api } from "../lib/api";
import { useDive } from "../context/DiveContext";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("../context/DiveContext", () => ({
  useDive: jest.fn(),
}));

function selectFile(input, name = "statement.csv") {
  const file = new File(["name,investedValue\nA,100"], name, { type: "text/csv" });
  return userEvent.upload(input, file);
}

describe("FileUpload — per-row save failures (P2 #20)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({
      setScreen: jest.fn(),
      goBack: jest.fn(),
      loadHoldings: jest.fn().mockResolvedValue([]),
      holdings: [],
    });
  });

  async function uploadAndReachReview(candidates) {
    api.post.mockResolvedValueOnce({ data: { candidates, excludedNotes: "" } });
    render(<FileUpload />);
    await selectFile(screen.getByTestId("file-upload-input"));
    await waitFor(() => expect(screen.getByTestId("file-upload-save-all-btn")).toBeInTheDocument());
  }

  it("keeps a failed row visible with its real error message, and removes the row that succeeded", async () => {
    await uploadAndReachReview([
      { name: "Good Holding", assetClass: "EQUITY", investedValue: 100, verifiedInInstrumentList: true, missingFields: [] },
      { name: "Bad Holding", assetClass: "EQUITY", investedValue: 100, verifiedInInstrumentList: true, missingFields: [] },
    ]);

    // First save call (Good Holding) succeeds, second (Bad Holding) fails
    // with a real backend-style error.
    api.post
      .mockResolvedValueOnce({ data: { holding: { _id: "1" } } })
      .mockRejectedValueOnce({ response: { data: { message: "Selected instrument was not found." } } });

    await userEvent.click(screen.getByTestId("file-upload-save-all-btn"));

    await waitFor(() => expect(screen.getByTestId("file-upload-failed-banner")).toHaveTextContent(/1 holding couldn't be saved/i));

    // The failed row stays, showing the specific reason.
    expect(screen.getByTestId("upload-candidate-error-1")).toHaveTextContent("Selected instrument was not found.");
    // The successful row is gone — retrying can't resubmit and duplicate it.
    expect(screen.queryByDisplayValue("Good Holding")).not.toBeInTheDocument();

    // Button switches to "retry" framing once there's a failure to fix.
    expect(screen.getByTestId("file-upload-save-all-btn")).toHaveTextContent(/retry failed holdings/i);
  });

  it("clears a row's error the moment the user edits it", async () => {
    await uploadAndReachReview([
      { name: "Bad Holding", assetClass: "EQUITY", investedValue: 100, verifiedInInstrumentList: true, missingFields: [] },
    ]);
    api.post.mockRejectedValueOnce({ response: { data: { message: "Invalid value." } } });
    await userEvent.click(screen.getByTestId("file-upload-save-all-btn"));
    await waitFor(() => expect(screen.getByTestId("upload-candidate-error-0")).toBeInTheDocument());

    await userEvent.clear(screen.getByTestId("upload-candidate-invested-0"));
    await userEvent.type(screen.getByTestId("upload-candidate-invested-0"), "500");

    expect(screen.queryByTestId("upload-candidate-error-0")).not.toBeInTheDocument();
  });

  it("removes every row and shows only the success banner when all rows save cleanly", async () => {
    await uploadAndReachReview([
      { name: "Good Holding", assetClass: "EQUITY", investedValue: 100, verifiedInInstrumentList: true, missingFields: [] },
    ]);
    api.post.mockResolvedValueOnce({ data: { holding: { _id: "1" } } });

    await userEvent.click(screen.getByTestId("file-upload-save-all-btn"));

    await waitFor(() => expect(screen.getByTestId("file-upload-saved-banner")).toHaveTextContent("1 holding saved."));
    expect(screen.queryByTestId("file-upload-failed-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-candidate-0")).not.toBeInTheDocument();
  });
});

describe("FileUpload — cancel button for a hung AI extraction call (P3 #32)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({ setScreen: jest.fn(), goBack: jest.fn(), loadHoldings: jest.fn().mockResolvedValue([]), holdings: [] });
  });

  it("shows a Cancel button while extraction is in flight, and aborts the real request when clicked", async () => {
    let rejectPost;
    api.post.mockReturnValue(new Promise((_resolve, reject) => { rejectPost = reject; }));

    render(<FileUpload />);
    await selectFile(screen.getByTestId("file-upload-input"));

    await waitFor(() => expect(screen.getByTestId("scanning-loader-cancel-btn")).toBeInTheDocument());

    // The request must be genuinely abortable — a real AbortSignal was
    // actually passed to axios, not just a UI-only "pretend cancel".
    const [, , config] = api.post.mock.calls[0];
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(config.signal.aborted).toBe(false);

    await userEvent.click(screen.getByTestId("scanning-loader-cancel-btn"));
    expect(config.signal.aborted).toBe(true);

    // Simulates what axios itself does when a request is aborted.
    rejectPost(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));

    // Back to a normal, retryable state — no scary error shown for a
    // deliberate cancel.
    await waitFor(() => expect(screen.getByTestId("file-upload-pick-btn")).toBeInTheDocument());
    expect(screen.queryByText(/couldn't parse that file/i)).not.toBeInTheDocument();
  });
});

describe("FileUpload — \"Done\" routing (bug report: landed on score-reveal with 0 holdings)", () => {
  it("goes to chooseMethod, not the score-reveal screen, when nothing was ever saved on an empty account", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({ setScreen, goBack: jest.fn(), loadHoldings: jest.fn().mockResolvedValue([]), holdings: [] });

    render(<FileUpload />);
    await userEvent.click(screen.getByTestId("file-upload-done-btn"));

    expect(setScreen).toHaveBeenCalledWith("chooseMethod");
    expect(setScreen).not.toHaveBeenCalledWith("reveal");
  });

  it("still goes to the score-reveal screen when the account already has holdings", async () => {
    const setScreen = jest.fn();
    useDive.mockReturnValue({
      setScreen,
      goBack: jest.fn(),
      loadHoldings: jest.fn().mockResolvedValue([]),
      holdings: [{ id: "existing", name: "Reliance", segment: "Equity", amount: 1000 }],
    });

    render(<FileUpload />);
    await userEvent.click(screen.getByTestId("file-upload-done-btn"));

    expect(setScreen).toHaveBeenCalledWith("reveal");
  });
});
