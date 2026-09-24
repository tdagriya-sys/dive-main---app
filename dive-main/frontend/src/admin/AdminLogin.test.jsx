import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "./AdminAuthContext";

jest.mock("./AdminAuthContext", () => ({ useAdminAuth: jest.fn() }));

function mockAuth(overrides = {}) {
  const auth = {
    loginWithPassword: jest.fn(),
    totpSetup: jest.fn(),
    totpConfirm: jest.fn(),
    totpVerify: jest.fn(),
    completeLogin: jest.fn(),
    ...overrides,
  };
  useAdminAuth.mockReturnValue(auth);
  return auth;
}

describe("AdminLogin", () => {
  afterEach(() => jest.clearAllMocks());

  it("submits credentials and, for a NOT-yet-enrolled account, fetches and shows the TOTP QR setup screen", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({
      loginWithPassword: jest.fn().mockResolvedValue({ pendingToken: "ptok", totpEnrolled: false }),
      totpSetup: jest.fn().mockResolvedValue({ otpauthUrl: "otpauth://x", qrDataUrl: "data:image/png;base64,abc", secret: "ABCDEFGH" }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "Passw0rd!");
    await user.click(screen.getByTestId("admin-login-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-totp-screen")).toBeInTheDocument());
    expect(auth.loginWithPassword).toHaveBeenCalledWith("boss@divve.in", "Passw0rd!");
    expect(auth.totpSetup).toHaveBeenCalledWith("ptok");
    expect(screen.getByTestId("admin-totp-qr")).toHaveAttribute("src", "data:image/png;base64,abc");
    expect(screen.getByTestId("admin-totp-secret")).toHaveTextContent("ABCDEFGH");
  });

  it("skips straight to code entry (no QR fetch) when the account is already enrolled", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({
      loginWithPassword: jest.fn().mockResolvedValue({ pendingToken: "ptok", totpEnrolled: true }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "Passw0rd!");
    await user.click(screen.getByTestId("admin-login-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-totp-screen")).toBeInTheDocument());
    expect(auth.totpSetup).not.toHaveBeenCalled();
    expect(screen.queryByTestId("admin-totp-qr")).not.toBeInTheDocument();
  });

  it("shows a clear error banner for a wrong password", async () => {
    const user = userEvent.setup();
    mockAuth({
      loginWithPassword: jest.fn().mockRejectedValue({ response: { data: { message: "Incorrect email/mobile or password." } } }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "wrong");
    await user.click(screen.getByTestId("admin-login-submit-btn"));

    expect(await screen.findByTestId("admin-login-error")).toHaveTextContent("Incorrect email/mobile or password.");
    expect(screen.getByTestId("admin-login-screen")).toBeInTheDocument();
  });

  it("first-time enrolment: confirming a valid code shows the recovery-codes screen, and completeLogin only fires after acknowledgement", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({
      loginWithPassword: jest.fn().mockResolvedValue({ pendingToken: "ptok", totpEnrolled: false }),
      totpSetup: jest.fn().mockResolvedValue({ otpauthUrl: "otpauth://x", qrDataUrl: "data:image/png;base64,abc", secret: "ABCDEFGH" }),
      totpConfirm: jest.fn().mockResolvedValue({
        accessToken: "real-tok",
        user: { email: "boss@divve.in", staffRole: "superadmin" },
        recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"],
      }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "Passw0rd!");
    await user.click(screen.getByTestId("admin-login-submit-btn"));
    await screen.findByTestId("admin-totp-screen");

    await user.type(screen.getByTestId("admin-totp-code-input"), "042042");
    await user.click(screen.getByTestId("admin-totp-submit-btn"));

    await waitFor(() => expect(screen.getByTestId("admin-recovery-codes-screen")).toBeInTheDocument());
    expect(auth.totpConfirm).toHaveBeenCalledWith("ptok", "042042");
    expect(screen.getByTestId("admin-recovery-code-0")).toHaveTextContent("AAAA-BBBB");
    expect(screen.getByTestId("admin-recovery-code-1")).toHaveTextContent("CCCC-DDDD");
    // The session must not be established just from confirming — only once
    // the staff member acknowledges having saved the codes.
    expect(auth.completeLogin).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("admin-recovery-codes-continue-btn"));
    expect(auth.completeLogin).toHaveBeenCalledWith("real-tok", { email: "boss@divve.in", staffRole: "superadmin" });
  });

  it("regular sign-in (already enrolled): a valid code calls completeLogin directly, no recovery-codes screen", async () => {
    const user = userEvent.setup();
    const auth = mockAuth({
      loginWithPassword: jest.fn().mockResolvedValue({ pendingToken: "ptok", totpEnrolled: true }),
      totpVerify: jest.fn().mockResolvedValue({ accessToken: "real-tok", user: { email: "boss@divve.in", staffRole: "admin" } }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "Passw0rd!");
    await user.click(screen.getByTestId("admin-login-submit-btn"));
    await screen.findByTestId("admin-totp-screen");

    await user.type(screen.getByTestId("admin-totp-code-input"), "111111");
    await user.click(screen.getByTestId("admin-totp-submit-btn"));

    await waitFor(() => expect(auth.totpVerify).toHaveBeenCalledWith("ptok", "111111"));
    expect(auth.completeLogin).toHaveBeenCalledWith("real-tok", { email: "boss@divve.in", staffRole: "admin" });
    expect(screen.queryByTestId("admin-recovery-codes-screen")).not.toBeInTheDocument();
  });

  it("shows an error and stays on the code-entry screen for a wrong code", async () => {
    const user = userEvent.setup();
    mockAuth({
      loginWithPassword: jest.fn().mockResolvedValue({ pendingToken: "ptok", totpEnrolled: true }),
      totpVerify: jest.fn().mockRejectedValue({ response: { data: { message: "That code is incorrect or has expired." } } }),
    });
    render(<AdminLogin />);

    await user.type(screen.getByTestId("admin-login-identifier-input"), "boss@divve.in");
    await user.type(screen.getByTestId("admin-login-password-input"), "Passw0rd!");
    await user.click(screen.getByTestId("admin-login-submit-btn"));
    await screen.findByTestId("admin-totp-screen");

    await user.type(screen.getByTestId("admin-totp-code-input"), "000000");
    await user.click(screen.getByTestId("admin-totp-submit-btn"));

    expect(await screen.findByTestId("admin-login-error")).toHaveTextContent("That code is incorrect or has expired.");
    expect(screen.getByTestId("admin-totp-screen")).toBeInTheDocument();
  });
});
