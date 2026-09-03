import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Onboarding from "./Onboarding";
import { useDive } from "../context/DiveContext";

jest.mock("../context/DiveContext", () => ({ useDive: jest.fn() }));

const baseContext = {
  holdings: [],
  goBack: jest.fn(),
  setScreen: jest.fn(),
};

// Signup -> Home routing: regression guard for the "land on Home with a
// get-started popup instead of the fetch-method chooser" change — a fresh
// signup used to setScreen("chooseMethod") straight after OTP verify.
describe("Onboarding — Signup", () => {
  let setScreen;

  beforeEach(() => {
    setScreen = jest.fn();
  });

  it("lands on Home (not the fetch-method chooser) after a successful signup + OTP verify", async () => {
    const user = userEvent.setup();
    useDive.mockReturnValue({
      ...baseContext,
      screen: "signup",
      setScreen,
      signupStart: jest.fn().mockResolvedValue({ devOtp: "123456" }),
      signupVerify: jest.fn().mockResolvedValue({ id: "u1", name: "Test User" }),
    });
    render(<Onboarding />);

    await user.type(screen.getByTestId("name-input"), "Test User");
    await user.type(screen.getByTestId("phone-input"), "9876543210");
    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("age-input"), "30");
    await user.type(screen.getByTestId("password-input"), "TestPass123!");
    await user.type(screen.getByTestId("confirm-password-input"), "TestPass123!");
    await user.click(screen.getByTestId("send-otp-btn"));

    await screen.findByTestId("signup-otp-screen");
    await user.click(screen.getByTestId("autofill-otp-btn"));
    await user.click(screen.getByTestId("verify-otp-btn"));

    await waitFor(() => expect(setScreen).toHaveBeenCalledWith("home"));
    expect(setScreen).not.toHaveBeenCalledWith("chooseMethod");
  });
});

// Forgot-password: mirrors the exact 3-step backend flow (send OTP -> verify
// OTP -> set new password), so these tests drive the UI through all three
// steps plus the branches where each step can fail, the same way a real user
// (or a wrong/expired OTP, or a mismatched new password) would hit them.
describe("Onboarding — Forgot password", () => {
  let setScreen;

  beforeEach(() => {
    jest.clearAllMocks();
    setScreen = jest.fn();
  });

  function renderForgotPassword(overrides = {}) {
    useDive.mockReturnValue({
      ...baseContext,
      screen: "forgotPassword",
      setScreen,
      forgotPasswordStart: jest.fn().mockResolvedValue({ message: "OTP sent to your email address.", mobile: "9876543210", devOtp: "123456" }),
      forgotPasswordVerify: jest.fn().mockResolvedValue("a-real-reset-token"),
      resetPassword: jest.fn().mockResolvedValue("Password updated. Please log in with your new password."),
      ...overrides,
    });
    return render(<Onboarding />);
  }

  it("walks through identifier -> OTP -> new password -> done, calling each context function with the right arguments", async () => {
    const forgotPasswordStart = jest.fn().mockResolvedValue({ mobile: "9876543210", devOtp: "654321" });
    const forgotPasswordVerify = jest.fn().mockResolvedValue("reset-token-abc");
    const resetPassword = jest.fn().mockResolvedValue("Password updated.");
    const user = userEvent.setup();
    renderForgotPassword({ forgotPasswordStart, forgotPasswordVerify, resetPassword });

    expect(screen.getByTestId("forgot-password-screen")).toBeInTheDocument();
    await user.type(screen.getByTestId("forgot-password-identifier-input"), "testuser@example.com");
    await user.click(screen.getByTestId("forgot-password-send-otp-btn"));

    expect(forgotPasswordStart).toHaveBeenCalledWith("testuser@example.com");
    await waitFor(() => expect(screen.getByTestId("forgot-password-otp-screen")).toBeInTheDocument());

    // Dev-mode autofill button appears since the mocked response included a devOtp.
    await user.click(screen.getByTestId("forgot-password-autofill-otp-btn"));
    expect(screen.getByTestId("forgot-password-otp-input")).toHaveValue("654321");
    await user.click(screen.getByTestId("forgot-password-verify-otp-btn"));

    expect(forgotPasswordVerify).toHaveBeenCalledWith("9876543210", "654321");
    await waitFor(() => expect(screen.getByTestId("forgot-password-new-screen")).toBeInTheDocument());

    await user.type(screen.getByTestId("forgot-password-new-input"), "NewPassw0rd!");
    await user.type(screen.getByTestId("forgot-password-confirm-input"), "NewPassw0rd!");
    await user.click(screen.getByTestId("forgot-password-reset-btn"));

    expect(resetPassword).toHaveBeenCalledWith("reset-token-abc", "NewPassw0rd!", "NewPassw0rd!");
    await waitFor(() => expect(screen.getByTestId("forgot-password-done-screen")).toBeInTheDocument());

    await user.click(screen.getByTestId("forgot-password-done-login-btn"));
    expect(setScreen).toHaveBeenCalledWith("login");
  });

  it("shows the backend's error message when the identifier isn't a known account", async () => {
    const forgotPasswordStart = jest.fn().mockRejectedValue({ response: { data: { message: "We couldn't find an account with these details." } } });
    const user = userEvent.setup();
    renderForgotPassword({ forgotPasswordStart });

    await user.type(screen.getByTestId("forgot-password-identifier-input"), "nobody@example.com");
    await user.click(screen.getByTestId("forgot-password-send-otp-btn"));

    await waitFor(() => expect(screen.getByText("We couldn't find an account with these details.")).toBeInTheDocument());
    expect(screen.getByTestId("forgot-password-screen")).toBeInTheDocument(); // stays on this step
  });

  it("shows an error and stays on the OTP step when the OTP is wrong", async () => {
    const forgotPasswordVerify = jest.fn().mockRejectedValue({ response: { data: { message: "That OTP is incorrect or has expired." } } });
    const user = userEvent.setup();
    renderForgotPassword({ forgotPasswordVerify });

    await user.type(screen.getByTestId("forgot-password-identifier-input"), "testuser@example.com");
    await user.click(screen.getByTestId("forgot-password-send-otp-btn"));
    await waitFor(() => expect(screen.getByTestId("forgot-password-otp-screen")).toBeInTheDocument());

    await user.type(screen.getByTestId("forgot-password-otp-input"), "000000");
    await user.click(screen.getByTestId("forgot-password-verify-otp-btn"));

    await waitFor(() => expect(screen.getByText("That OTP is incorrect or has expired.")).toBeInTheDocument());
    expect(screen.getByTestId("forgot-password-otp-screen")).toBeInTheDocument();
  });

  it("shows the backend's validation error when the new passwords don't match, without navigating away", async () => {
    const resetPassword = jest.fn().mockRejectedValue({ response: { data: { message: "Passwords do not match" } } });
    const user = userEvent.setup();
    renderForgotPassword({ resetPassword });

    await user.type(screen.getByTestId("forgot-password-identifier-input"), "testuser@example.com");
    await user.click(screen.getByTestId("forgot-password-send-otp-btn"));
    await waitFor(() => expect(screen.getByTestId("forgot-password-otp-screen")).toBeInTheDocument());
    await user.type(screen.getByTestId("forgot-password-otp-input"), "123456");
    await user.click(screen.getByTestId("forgot-password-verify-otp-btn"));
    await waitFor(() => expect(screen.getByTestId("forgot-password-new-screen")).toBeInTheDocument());

    await user.type(screen.getByTestId("forgot-password-new-input"), "NewPassw0rd!");
    await user.type(screen.getByTestId("forgot-password-confirm-input"), "Different1!");
    await user.click(screen.getByTestId("forgot-password-reset-btn"));

    await waitFor(() => expect(screen.getByText("Passwords do not match")).toBeInTheDocument());
    expect(screen.getByTestId("forgot-password-new-screen")).toBeInTheDocument();
  });

  it("Login screen has a 'Forgot password?' link that navigates to the forgotPassword screen", async () => {
    useDive.mockReturnValue({ ...baseContext, screen: "login", setScreen, login: jest.fn() });
    const user = userEvent.setup();
    render(<Onboarding />);

    await user.click(screen.getByTestId("forgot-password-link"));
    expect(setScreen).toHaveBeenCalledWith("forgotPassword");
  });
});
