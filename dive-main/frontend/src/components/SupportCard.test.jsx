import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupportCard from "./SupportCard";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

describe("SupportCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDive.mockReturnValue({ user: { name: "Priya Sharma", email: "priya@example.com", mobile: "9876543210" } });
  });

  it("pre-fills email and mobile from the logged-in user", () => {
    render(<SupportCard onClose={jest.fn()} />);
    expect(screen.getByTestId("support-email-input")).toHaveValue("priya@example.com");
    expect(screen.getByTestId("support-mobile-input")).toHaveValue("9876543210");
  });

  it("submitting opens a mailto: link to hello@divve.in with subject/body prefilled from the form, then closes", async () => {
    const onClose = jest.fn();
    const u = userEvent.setup();
    render(<SupportCard onClose={onClose} />);

    await u.clear(screen.getByTestId("support-subject-input"));
    await u.type(screen.getByTestId("support-subject-input"), "Can't connect my broker");
    await u.type(screen.getByTestId("support-description-input"), "It just spins forever.");

    // jsdom doesn't implement real mailto: navigation — assert on the
    // location assignment itself instead of any actual navigation effect.
    delete window.location;
    window.location = { href: "" };

    await u.click(screen.getByTestId("support-submit-btn"));

    expect(window.location.href).toContain("mailto:hello@divve.in");
    expect(window.location.href).toContain(encodeURIComponent("Can't connect my broker"));
    expect(window.location.href).toContain(encodeURIComponent("It just spins forever."));
    expect(window.location.href).toContain(encodeURIComponent("priya@example.com"));
    expect(window.location.href).toContain(encodeURIComponent("9876543210"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the X button and on a backdrop click", async () => {
    const onClose = jest.fn();
    const u = userEvent.setup();
    render(<SupportCard onClose={onClose} />);
    await u.click(screen.getByTestId("support-close-btn"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
