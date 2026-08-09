import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

// Throws for as long as shouldThrow.current is true. Deliberately never
// mutates that flag itself — React 18/19's concurrent rendering makes a
// silent internal recovery attempt (a second render pass) before giving up
// and invoking the boundary; if the component flipped its own flag inside
// the throwing branch, that internal retry would quietly "heal" before the
// boundary ever needed to show a fallback at all, and Try again would never
// really be exercised. Only the test flips the flag, and only right before
// simulating the actual "Try again" click.
function Bomb({ shouldThrow }) {
  if (shouldThrow.current) {
    throw new Error("boom");
  }
  return <div data-testid="recovered-child">recovered</div>;
}

describe("ErrorBoundary", () => {
  // React logs caught errors to the console by default in test environments
  // (and componentDidCatch here explicitly console.errors too) — silence
  // that expected noise so a real, unexpected console.error would still
  // stand out.
  let consoleErrorSpy;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("catches a render error and shows the full-page fallback instead of unmounting the whole tree", () => {
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-fullpage")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("shows the phone-scoped fallback when variant='phone', not the full-page one", () => {
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary variant="phone">
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-phone")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-fullpage")).not.toBeInTheDocument();
  });

  it("recovers when Try again is clicked and the underlying problem is gone", () => {
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-fullpage")).toBeInTheDocument();

    // Simulates the underlying problem actually being resolved (e.g. the
    // data that caused a bad render is now valid) before the user retries.
    shouldThrow.current = false;
    fireEvent.click(screen.getByTestId("error-boundary-retry-btn"));

    expect(screen.getByTestId("recovered-child")).toBeInTheDocument();
    expect(screen.queryByTestId("error-boundary-fullpage")).not.toBeInTheDocument();
  });

  it("stays on the fallback if Try again is clicked while the underlying problem still exists", () => {
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByTestId("error-boundary-retry-btn"));
    // shouldThrow.current is still true — retrying re-throws, and the
    // boundary must catch it again rather than leaving a blank/broken tree.
    expect(screen.getByTestId("error-boundary-fullpage")).toBeInTheDocument();
  });

  it("reload button calls window.location.reload", () => {
    const reloadSpy = jest.fn();
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, reload: reloadSpy };

    const shouldThrow = { current: true };
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByTestId("error-boundary-reload-btn"));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    window.location = originalLocation;
  });
});
