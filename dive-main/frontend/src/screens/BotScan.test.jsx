import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BotScan from "./BotScan";
import { api } from "../lib/api";
import { useDive } from "../context/DiveContext";

jest.mock("../lib/api", () => ({
  api: { post: jest.fn() },
}));

jest.mock("../context/DiveContext", () => ({
  useDive: jest.fn(),
}));

function mockCaptureApis() {
  const track = { stop: jest.fn(), addEventListener: jest.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  global.navigator.mediaDevices = { getDisplayMedia: jest.fn().mockResolvedValue(stream) };
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue();
  window.HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({ drawImage: jest.fn() });
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(cb) {
    cb(new Blob(["frame"], { type: "image/jpeg" }));
  };
}

// Drives the real capture flow (screen-share -> at least one frame -> stop
// -> analyze) rather than reaching into component internals, so this
// exercises exactly what a user's browser does.
async function runScanToReview(user, candidates, excludedNotes = "") {
  api.post.mockResolvedValueOnce({ data: { candidates, excludedNotes, framesAnalyzed: 1 } });

  await user.click(screen.getByTestId("bot-scan-start-btn"));
  await waitFor(() => expect(screen.getByTestId("bot-scan-stop-btn")).toBeInTheDocument());

  const videoEl = document.querySelector("video");
  Object.defineProperty(videoEl, "videoWidth", { value: 100, configurable: true });
  Object.defineProperty(videoEl, "videoHeight", { value: 100, configurable: true });

  act(() => {
    jest.advanceTimersByTime(1800); // FRAME_INTERVAL_MS — triggers one captureFrame
  });

  await user.click(screen.getByTestId("bot-scan-stop-btn"));
  await waitFor(() => expect(reviewHeader()).toBeInTheDocument());
}

// "Review detected holdings ({n})" splits across text nodes (the count is
// its own JSX expression), so a plain getByText string/regex match against
// it fails even though the text is really there — match on the full
// textContent of the containing <p> instead.
function reviewHeader() {
  return screen.queryByText((_, el) => el?.tagName === "P" && /^Review detected holdings \(\d+\)$/.test(el.textContent));
}

// Bug report (with screenshot): after Bot Scan found and saved 10 holdings
// successfully, the review screen still showed "Nothing was detected" and
// "Review detected holdings (0)" — stale text left over from foundList being
// correctly emptied post-save (P2 #20's fix), but never distinguished from a
// genuine zero-detection outcome.
describe("BotScan — \"Nothing was detected\" must not show after a successful save", () => {
  let user;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: null });
    useDive.mockReturnValue({
      setScreen: jest.fn(),
      goBack: jest.fn(),
      loadHoldings: jest.fn().mockResolvedValue([]),
      holdings: [],
    });
    mockCaptureApis();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the real empty-state message when the AI genuinely finds nothing", async () => {
    render(<BotScan />);
    await runScanToReview(user, []);

    expect(reviewHeader()).toHaveTextContent("Review detected holdings (0)");
    expect(screen.getByText(/nothing was detected/i)).toBeInTheDocument();
  });

  it("does not show 'nothing was detected' after every found holding saves successfully", async () => {
    render(<BotScan />);
    await runScanToReview(
      user,
      [{ name: "HDFC Flexi Cap Fund", assetClass: "MUTUAL_FUND", investedValue: 10000, currentValue: 12000, verifiedInInstrumentList: true, accountLabel: "Angel One" }],
      "All 10 distinct funds were merged into one deduplicated list under a single account label."
    );

    // Sanity check: it really did detect one, matching the bug report's
    // pre-save state (excludedNotes present, a real row shown).
    expect(reviewHeader()).toHaveTextContent("Review detected holdings (1)");

    api.post.mockResolvedValueOnce({ data: { holding: { _id: "1" } } });
    await user.click(screen.getByTestId("bot-scan-save-all-btn"));

    await waitFor(() => expect(screen.getByTestId("bot-scan-saved-banner")).toHaveTextContent("1 holding saved."));

    // The actual bug: this must NOT appear once a real save succeeded.
    expect(screen.queryByText(/nothing was detected/i)).not.toBeInTheDocument();
    expect(reviewHeader()).not.toBeInTheDocument();
  });
});
