import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { requestStepUp } from "./stepUp";
import StepUpModal from "./StepUpModal";

jest.mock("./stepUp", () => ({ requestStepUp: jest.fn() }));

describe("StepUpModal", () => {
  afterEach(() => jest.clearAllMocks());

  it("renders nothing when closed", () => {
    const { container } = render(<StepUpModal open={false} onCancel={() => {}} onSuccess={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits the password and calls onSuccess with the returned token", async () => {
    requestStepUp.mockResolvedValue("fresh-token");
    const onSuccess = jest.fn();
    render(<StepUpModal open onCancel={() => {}} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("admin-stepup-password-input"), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByTestId("admin-stepup-submit-btn"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("fresh-token"));
    expect(requestStepUp).toHaveBeenCalledWith("Passw0rd!");
  });

  it("shows an error message on a wrong password and does not call onSuccess", async () => {
    requestStepUp.mockRejectedValue({ response: { data: { message: "Incorrect password." } } });
    const onSuccess = jest.fn();
    render(<StepUpModal open onCancel={() => {}} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("admin-stepup-password-input"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("admin-stepup-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-stepup-error")).toHaveTextContent("Incorrect password."));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = jest.fn();
    render(<StepUpModal open onCancel={onCancel} onSuccess={() => {}} />);
    fireEvent.click(screen.getByTestId("admin-stepup-cancel-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables submit until a password is entered", () => {
    render(<StepUpModal open onCancel={() => {}} onSuccess={() => {}} />);
    expect(screen.getByTestId("admin-stepup-submit-btn")).toBeDisabled();
  });
});
