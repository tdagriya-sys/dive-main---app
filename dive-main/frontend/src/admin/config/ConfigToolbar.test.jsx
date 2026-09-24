import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfigToolbar from "./ConfigToolbar";

const BASE_PROPS = {
  title: "Dive Score Model",
  activeEntry: { version: 3 },
  draft: { version: 4 },
  dirty: false,
  validation: { valid: true, errors: [] },
  saving: false,
  onSave: jest.fn(),
  publishOpen: false,
  onPublishToggle: jest.fn(),
  historyOpen: false,
  onToggleHistory: jest.fn(),
};

describe("ConfigToolbar", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the active and draft version numbers", () => {
    render(<ConfigToolbar {...BASE_PROPS} />);
    expect(screen.getByTestId("admin-config-status-line")).toHaveTextContent("Active: v3");
    expect(screen.getByTestId("admin-config-status-line")).toHaveTextContent("Draft: v4");
  });

  it("shows 'none yet' when nothing has ever been published", () => {
    render(<ConfigToolbar {...BASE_PROPS} activeEntry={undefined} />);
    expect(screen.getByTestId("admin-config-status-line")).toHaveTextContent("Active: none yet");
  });

  it("shows an unsaved-changes indicator only when dirty", () => {
    const { rerender } = render(<ConfigToolbar {...BASE_PROPS} dirty={false} />);
    expect(screen.getByTestId("admin-config-status-line")).not.toHaveTextContent("unsaved changes");
    rerender(<ConfigToolbar {...BASE_PROPS} dirty />);
    expect(screen.getByTestId("admin-config-status-line")).toHaveTextContent("unsaved changes");
  });

  it("disables Save draft when not dirty, enables it when dirty", () => {
    const { rerender } = render(<ConfigToolbar {...BASE_PROPS} dirty={false} />);
    expect(screen.getByTestId("admin-config-save-btn")).toBeDisabled();
    rerender(<ConfigToolbar {...BASE_PROPS} dirty />);
    expect(screen.getByTestId("admin-config-save-btn")).not.toBeDisabled();
  });

  it("disables Publish when validation fails, and shows the error list", () => {
    render(<ConfigToolbar {...BASE_PROPS} validation={{ valid: false, errors: ["compositeWeights must sum to 1.0"] }} />);
    expect(screen.getByTestId("admin-config-publish-toggle-btn")).toBeDisabled();
    expect(screen.getByTestId("admin-config-validation-errors")).toHaveTextContent("compositeWeights must sum to 1.0");
  });

  it("calls onSave/onPublishToggle/onToggleHistory", () => {
    render(<ConfigToolbar {...BASE_PROPS} dirty />);
    fireEvent.click(screen.getByTestId("admin-config-save-btn"));
    fireEvent.click(screen.getByTestId("admin-config-publish-toggle-btn"));
    fireEvent.click(screen.getByTestId("admin-config-history-toggle-btn"));
    expect(BASE_PROPS.onSave).toHaveBeenCalledTimes(1);
    expect(BASE_PROPS.onPublishToggle).toHaveBeenCalledTimes(1);
    expect(BASE_PROPS.onToggleHistory).toHaveBeenCalledTimes(1);
  });

  it("omits the Simulate button entirely when onSimulateToggle isn't given (e.g. SuggestionModel)", () => {
    render(<ConfigToolbar {...BASE_PROPS} />);
    expect(screen.queryByTestId("admin-config-simulate-toggle-btn")).not.toBeInTheDocument();
  });

  it("shows and wires the Simulate button when onSimulateToggle is given", () => {
    const onSimulateToggle = jest.fn();
    const { rerender } = render(<ConfigToolbar {...BASE_PROPS} simulateOpen={false} onSimulateToggle={onSimulateToggle} />);
    expect(screen.getByTestId("admin-config-simulate-toggle-btn")).toHaveTextContent("Simulate…");
    fireEvent.click(screen.getByTestId("admin-config-simulate-toggle-btn"));
    expect(onSimulateToggle).toHaveBeenCalledTimes(1);

    rerender(<ConfigToolbar {...BASE_PROPS} simulateOpen onSimulateToggle={onSimulateToggle} />);
    expect(screen.getByTestId("admin-config-simulate-toggle-btn")).toHaveTextContent("Hide simulation");
  });
});
