import React from "react";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";
import { captureError } from "../lib/monitoring";

// The boundary reports what it catches to error monitoring (a no-op unless a
// Sentry DSN is configured), tagged with which boundary caught it.

jest.mock("../lib/monitoring", () => ({ captureError: jest.fn() }));

function Bomb() {
  throw new Error("boom");
}

describe("ErrorBoundary → monitoring", () => {
  let consoleErrorSpy;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    captureError.mockClear();
  });
  afterEach(() => consoleErrorSpy.mockRestore());

  it("reports the error and its component stack, tagged 'app' for the outer boundary", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-fullpage")).toBeInTheDocument();
    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, extra] = captureError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(extra.boundary).toBe("app");
    expect(extra.componentStack).toContain("Bomb");
  });

  it("tags the inner in-phone boundary as 'phone'", () => {
    render(
      <ErrorBoundary variant="phone">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary-phone")).toBeInTheDocument();
    expect(captureError.mock.calls[0][1].boundary).toBe("phone");
  });

  it("reports nothing when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>fine</div>
      </ErrorBoundary>
    );
    expect(captureError).not.toHaveBeenCalled();
  });
});
