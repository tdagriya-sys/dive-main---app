import {
  generateTotpSecret,
  buildOtpauthUrl,
  generateQrDataUrl,
  verifyTotpCode,
  generateRecoveryCodes,
  findMatchingRecoveryCodeIndex,
  _generateCurrentCodeForTests,
} from "../src/services/totpService";

// Phase 0.3 of docs/ADMIN_PANEL_PLAN.md — services/totpService.ts. Uses
// _generateCurrentCodeForTests (otplib's own generator against a KNOWN
// secret) rather than depending on wall-clock timing to produce a valid code.
describe("totpService", () => {
  it("generates a base32-looking secret", () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThanOrEqual(16);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it("builds a valid otpauth:// URL carrying the label, issuer and secret", () => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl(secret, "staffer@divve.in");
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(encodeURIComponent("staffer@divve.in"));
    expect(url).toContain(`secret=${secret}`);
  });

  it("generates a PNG data URL QR code from an otpauth URL", async () => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl(secret, "staffer@divve.in");
    const dataUrl = await generateQrDataUrl(url);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("verifies a currently-valid code and rejects a wrong one", () => {
    const secret = generateTotpSecret();
    const validCode = _generateCurrentCodeForTests(secret);
    expect(verifyTotpCode(secret, validCode)).toBe(true);

    const wrongCode = validCode === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(secret, wrongCode)).toBe(false);
  });

  it("rejects a code for the WRONG secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeForA = _generateCurrentCodeForTests(secretA);
    expect(verifyTotpCode(secretB, codeForA)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "not-a-code")).toBe(false);
    expect(verifyTotpCode(secret, "12345")).toBe(false); // too short
    expect(verifyTotpCode(secret, "1234567")).toBe(false); // too long
  });

  it("generates 8 recovery codes, each in XXXX-XXXX shape, hashed for storage", async () => {
    const { plaintext, hashes } = await generateRecoveryCodes();
    expect(plaintext).toHaveLength(8);
    expect(hashes).toHaveLength(8);
    for (const code of plaintext) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Hashes never equal their own plaintext, and are real bcrypt hashes.
    plaintext.forEach((code, i) => {
      expect(hashes[i]).not.toBe(code);
      expect(hashes[i]).toMatch(/^\$2[aby]\$/);
    });
  });

  it("finds and matches a recovery code case-insensitively, and rejects an unknown one", async () => {
    const { plaintext, hashes } = await generateRecoveryCodes();
    const target = plaintext[3];
    await expect(findMatchingRecoveryCodeIndex(hashes, target)).resolves.toBe(3);
    await expect(findMatchingRecoveryCodeIndex(hashes, target.toLowerCase())).resolves.toBe(3);
    await expect(findMatchingRecoveryCodeIndex(hashes, "ZZZZ-ZZZZ")).resolves.toBe(-1);
  });
});
