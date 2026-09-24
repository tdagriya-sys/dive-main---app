import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SimulationPanel from "./SimulationPanel";

describe("SimulationPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SimulationPanel open={false} onCancel={() => {}} onRun={() => {}} running={false} result={null} error="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onRun with the entered sample size", () => {
    const onRun = jest.fn();
    render(<SimulationPanel open onCancel={() => {}} onRun={onRun} running={false} result={null} error="" />);
    fireEvent.change(screen.getByTestId("admin-config-simulation-samplesize-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("admin-config-simulation-run-btn"));
    expect(onRun).toHaveBeenCalledWith(10);
  });

  it("disables Run while a simulation is in flight", () => {
    render(<SimulationPanel open onCancel={() => {}} onRun={() => {}} running result={null} error="" />);
    expect(screen.getByTestId("admin-config-simulation-run-btn")).toBeDisabled();
  });

  it("shows the error message when the simulation fails", () => {
    render(<SimulationPanel open onCancel={() => {}} onRun={() => {}} running={false} result={null} error="Couldn't run the simulation." />);
    expect(screen.getByTestId("admin-config-simulation-error")).toHaveTextContent("Couldn't run the simulation.");
  });

  it("shows an empty-sample message when no eligible users were found", () => {
    render(<SimulationPanel open onCancel={() => {}} onRun={() => {}} running={false} result={{ sampleSize: 0 }} error="" />);
    expect(screen.getByTestId("admin-config-simulation-empty")).toBeInTheDocument();
  });

  it("shows the aggregate result stats", () => {
    const result = {
      sampleSize: 20,
      avgBaselineScore: 62.5,
      avgCandidateScore: 60.1,
      avgDelta: -2.4,
      improvedCount: 3,
      worsenedCount: 15,
      unchangedCount: 2,
      minDelta: -8,
      maxDelta: 1,
    };
    render(<SimulationPanel open onCancel={() => {}} onRun={() => {}} running={false} result={result} error="" />);
    expect(screen.getByTestId("admin-config-simulation-result")).toHaveTextContent("20");
    expect(screen.getByTestId("admin-config-simulation-result")).toHaveTextContent("62.5");
    expect(screen.getByTestId("admin-config-simulation-result")).toHaveTextContent("60.1");
    expect(screen.getByTestId("admin-config-simulation-result")).toHaveTextContent("-2.4");
    expect(screen.getByTestId("admin-config-simulation-breakdown")).toHaveTextContent("3 improved · 15 worsened · 2 unchanged (range -8 to 1)");
  });

  it("calls onCancel when Close is clicked", () => {
    const onCancel = jest.fn();
    render(<SimulationPanel open onCancel={onCancel} onRun={() => {}} running={false} result={null} error="" />);
    fireEvent.click(screen.getByTestId("admin-config-simulation-cancel-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
