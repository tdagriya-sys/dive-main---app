import axios from "axios";
import { env } from "../src/config/env";
import { sendTicketCreatedEmail, sendTicketReplyEmail } from "../src/services/ticketEmailService";
import { requestOtp } from "../src/services/otpService";

// Ticket emails carry an optional support reply-to (SUPPORT_REPLY_TO) so a
// customer's email reply reaches a real support mailbox. It applies to ticket
// emails ONLY — sign-in codes are untouched.

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Sent = { from: string; reply_to?: string; to: string[]; subject: string; html: string };
const sent = () => mockedAxios.post.mock.calls.map((c) => c[1] as Sent);

const realEnv = { placeholder: env.emailApiKeyIsPlaceholder, from: env.emailFrom, support: env.supportReplyTo };
beforeAll(() => {
  env.emailApiKeyIsPlaceholder = false;
});
afterAll(() => {
  env.emailApiKeyIsPlaceholder = realEnv.placeholder;
  env.emailFrom = realEnv.from;
  env.supportReplyTo = realEnv.support;
});
beforeEach(() => {
  env.emailFrom = "Divve <no-reply@example.com>";
  env.supportReplyTo = "";
  mockedAxios.post.mockReset();
  mockedAxios.post.mockResolvedValue({ data: { id: "resend_mock_id" } });
});

describe("support reply-to on ticket emails", () => {
  it("sets reply_to on both ticket emails when SUPPORT_REPLY_TO is configured, and still sends from the no-reply address", async () => {
    env.supportReplyTo = "support@example.com";
    await sendTicketCreatedEmail("user@example.com", "TKT-1", "Help");
    await sendTicketReplyEmail("user@example.com", "TKT-1", "Hello");

    expect(sent()).toHaveLength(2);
    for (const email of sent()) {
      expect(email.reply_to).toBe("support@example.com");
      expect(email.from).toBe("Divve <no-reply@example.com>");
    }
    expect(sent()[1].html).toContain("reply to this email");
  });

  it("sends no reply_to (and no 'reply to this email' line) when it isn't configured", async () => {
    await sendTicketReplyEmail("user@example.com", "TKT-1", "Hello");
    expect(sent()[0].reply_to).toBeUndefined();
    expect(sent()[0].html).not.toContain("reply to this email");
  });

  it("does not touch sign-in codes — an OTP email has no reply_to even when the support one is set", async () => {
    env.supportReplyTo = "support@example.com";
    await requestOtp("9999999997", "signup", "otp-user@example.com");
    expect(sent()).toHaveLength(1);
    expect(sent()[0].subject).toContain("verification code");
    expect(sent()[0].reply_to).toBeUndefined();
    expect(sent()[0].from).toBe("Divve <no-reply@example.com>");
  });
});
