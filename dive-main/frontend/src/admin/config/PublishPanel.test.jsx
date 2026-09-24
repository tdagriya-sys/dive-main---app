import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PublishPanel from "./PublishPanel";

describe("PublishPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<PublishPanel open={false} onCancel={() => {}} onConfirm={() => {}} publishing={false} disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Publish until a change note is entered", () => {
    render(<PublishPanel open onCancel={() => {}} onConfirm={() => {}} publishing={false} disabled={false} />);
    expect(screen.getByTestId("admin-config-publish-confirm-btn")).toBeDisabled();
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "  " } });
    expect(screen.getByTestId("admin-config-publish-confirm-btn")).toBeDisabled(); // whitespace-only still counts as empty
  });

  it("calls onConfirm with the trimmed change note", () => {
    const onConfirm = jest.fn();
    render(<PublishPanel open onCancel={() => {}} onConfirm={onConfirm} publishing={false} disabled={false} />);
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "  lower the cap  " } });
    fireEvent.click(screen.getByTestId("admin-config-publish-confirm-btn"));
    expect(onConfirm).toHaveBeenCalledWith("lower the cap");
  });

  it("disables Publish when the draft is invalid, even with a change note", () => {
    render(<PublishPanel open onCancel={() => {}} onConfirm={() => {}} publishing={false} disabled />);
    fireEvent.change(screen.getByTestId("admin-config-changenote-input"), { target: { value: "a change" } });
    expect(screen.getByTestId("admin-config-publish-confirm-btn")).toBeDisabled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = jest.fn();
    render(<PublishPanel open onCancel={onCancel} onConfirm={() => {}} publishing={false} disabled={false} />);
    fireEvent.click(screen.getByTestId("admin-config-publish-cancel-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
