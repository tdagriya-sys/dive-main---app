import axios from "axios";
import { env } from "../config/env";
import { IHighlightStyle, INotificationCallout, INotificationButton } from "../models/NotificationCategory";

/**
 * Outbound campaign/notification email (Phase 5 of docs/ADMIN_PANEL_PLAN.md
 * §4.5/§5.4) — mirrors otpService.ts's/ticketEmailService.ts's
 * sendViaResend/dev-mode-fallback shape exactly.
 */

// Substitutes the small fixed set of {{var}} placeholders this app
// supports (see NotificationTemplate's own comment) — a real templating
// engine would be overkill for three variables. `{{first_name}}` (also
// `{{firstName}}`) is the first word of the name — "Hi Ada" instead of
// "Hi Ada Lovelace" — and equals the whole name when there's only one word.
export function renderVars(text: string, vars: { name: string; email: string }): string {
  const firstName = vars.name.trim().split(/\s+/)[0] || vars.name;
  return text
    .replace(/\{\{\s*first_?name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name)
    .replace(/\{\{\s*email\s*\}\}/gi, vars.email);
}

// Gold/bold is this app's own existing "important" accent (see the gold
// theme used throughout the frontend) — applied to `==highlighted==` spans
// (and to a callout's own text, which is ALWAYS highlighted — see
// renderCalloutHtml) whenever the sender hasn't configured a specific
// IHighlightStyle, so either always does SOMETHING visible rather than
// silently no-op-ing.
const DEFAULT_HIGHLIGHT_STYLE: IHighlightStyle = { color: "#D4AF37", fontWeight: "bold" };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Builds the inline `style="..."` attribute for one `==highlighted==` span
// or a callout's text. A gradient needs `background-clip: text` +
// `color: transparent` to show through the text glyphs, which is why
// gradient and plain `color` are mutually exclusive rather than combined.
// Values were already constrained by validators/adminSetting.ts::
// highlightStyleSchema's regex before ever reaching here (defense-in-depth
// against attribute breakout), but this still only ever emits a fixed,
// known set of CSS property names — never a property name chosen by admin
// input.
// Fills in the default gold/bold ONLY where the sender didn't specify a
// color themselves — not merely when they left `highlightStyle` itself
// unset. Fixes a real bug: the admin UI's Weight/Style selects default to
// an EMPTY STRING (not omitted), so as soon as a sender touches either
// dropdown at all (even re-selecting "Default", or explicitly choosing
// "Normal") while never typing a Color/Gradient, `highlightStyle` becomes a
// real, non-null object like `{fontWeight: undefined}` or
// `{fontWeight: "normal"}` — never `null`/`undefined` itself. A plain
// `highlightStyle ?? DEFAULT_HIGHLIGHT_STYLE` never catches that case (the
// object IS present), so the highlight ends up with no color declaration at
// all — same, indistinguishable text color as the rest of the body, which
// reads as "the highlight isn't showing" in both email and the popup card
// (they share this same render path). A sender's own fontWeight/fontStyle/
// fontSize are always respected when present; only the color is defaulted.
function resolveHighlightStyle(style?: IHighlightStyle): IHighlightStyle {
  const hasOwnColor = Boolean(style?.color) || Boolean(style?.gradientFrom && style?.gradientTo);
  if (hasOwnColor) return style!;
  return {
    color: DEFAULT_HIGHLIGHT_STYLE.color,
    fontWeight: style?.fontWeight ?? DEFAULT_HIGHLIGHT_STYLE.fontWeight,
    fontStyle: style?.fontStyle,
    fontSize: style?.fontSize,
  };
}

function buildHighlightStyleAttr(style: IHighlightStyle): string {
  const declarations: string[] = [];
  if (style.gradientFrom && style.gradientTo) {
    declarations.push(`background-image:linear-gradient(90deg,${style.gradientFrom},${style.gradientTo})`, "-webkit-background-clip:text", "background-clip:text", "color:transparent");
  } else if (style.color) {
    declarations.push(`color:${style.color}`);
  }
  if (style.fontWeight) declarations.push(`font-weight:${style.fontWeight}`);
  if (style.fontStyle) declarations.push(`font-style:${style.fontStyle}`);
  if (style.fontSize) declarations.push(`font-size:${style.fontSize}`);
  return declarations.length ? ` style="${declarations.join(";")}"` : "";
}

// Only ever emits an <img> for a URL that actually looks like a fetchable
// image (http/https, no quote/angle-bracket characters that could break out
// of the generated `src="..."` attribute) — a `javascript:`/`data:` URL or a
// malformed one is silently dropped (the surrounding markdown syntax, if
// any, is left as literal text) rather than ever reaching the DOM.
function sanitizeImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed) && !/^http:\/\//i.test(trimmed)) return null;
  if (/["'<>]/.test(trimmed)) return null;
  return trimmed;
}

// The frontend's public origin — the same `CORS_ORIGINS[0]` convention
// shareController.ts and staffInviteService.ts already use for "a link back
// into the app". Used to turn an app-relative link (e.g. `/?go=login`) into
// an absolute one, since an email can't resolve a relative URL.
function appBaseUrl(): string {
  return (env.corsOrigins[0] || "").replace(/\/+$/, "");
}

// A link may only ever be an absolute http(s) URL, or an app-relative path
// starting with a single `/` (e.g. `/?go=login`). Anything else — a
// `javascript:`/`data:` URL, a protocol-relative `//host`, or a value with a
// quote/angle-bracket/whitespace that could break out of the generated
// `href="..."` attribute — is rejected outright and never reaches the DOM.
export function sanitizeLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/["'<>\s]/.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed)) return trimmed;
  return null;
}

// Resolves an already-sanitized link to the absolute URL that's actually
// stored/emitted (relative paths get the app's origin prepended).
export function resolveLinkHref(url: string): string {
  return url.startsWith("/") ? `${appBaseUrl()}${url}` : url;
}

// Same-origin links open in the same tab (a normal in-app navigation);
// everything else opens in a new tab so the reader never loses their place.
function isInternalHref(href: string): boolean {
  const base = appBaseUrl();
  return Boolean(base) && (href === base || href.startsWith(`${base}/`));
}

const LINK_STYLE = "color:#D4AF37;text-decoration:underline;";
const BUTTON_STYLE = "display:inline-block;background:#D4AF37;color:#111111;font-weight:bold;text-decoration:none;padding:10px 22px;border-radius:999px;";

// Builds an opening <a> tag, or null if the URL isn't allowed. `alreadyEscaped`
// is true for a URL that came out of the markdown body (already run through
// escapeHtml, so its `&` is already `&amp;`); a URL from a structured field
// (button/callout) is raw, so its `&` still needs escaping here.
function buildAnchorOpen(url: string, style: string, alreadyEscaped: boolean): string | null {
  const safe = sanitizeLinkUrl(url);
  if (!safe) return null;
  const resolved = resolveLinkHref(safe);
  const href = alreadyEscaped ? resolved : resolved.replace(/&/g, "&amp;");
  const target = isInternalHref(resolved) ? "" : ' target="_blank" rel="noopener noreferrer"';
  return `<a href="${href}"${target} style="${style}">`;
}

// `[words](url)` — also handles a linked image, `[![alt](img)](url)`, since
// images are turned into <img> tags BEFORE this runs, leaving
// `[<img ...>](url)`. The `(?<!!)` guard keeps a leftover un-rendered
// `![x](bad-url)` image (rejected earlier) from being mistaken for a link.
function renderLinks(html: string): string {
  return html.replace(/(?<!!)\[(.*?)\]\((.*?)\)/g, (match, text: string, url: string) => {
    const open = buildAnchorOpen(url, LINK_STYLE, true);
    if (!open) return match;
    return `${open}${text}</a>`;
  });
}

// `![alt text](https://...)` — the one other markdown convention worth
// borrowing verbatim (same bracket/paren shape everyone already recognizes
// from GitHub/Slack) rather than inventing a bespoke syntax. Applied AFTER
// the HTML-escape pass in renderMarkdownToHtml, which is correct, not
// coincidental: an ampersand in a real image URL (e.g. a query string) needs
// to already be `&amp;` by the time it lands inside `src="..."`.
function renderImages(html: string): string {
  return html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt: string, url: string) => {
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) return match;
    return `<img src="${safeUrl}" alt="${alt.replace(/"/g, "&quot;")}" style="max-width:100%;border-radius:12px;display:block;margin:8px 0;" />`;
  });
}

// A deliberately tiny markdown->HTML subset — bold/italic/highlight/image/
// line-break only. This app has no markdown-parsing dependency anywhere
// else; pulling one in for a handful of admin-authored notification fields
// isn't worth it. Escapes HTML first so admin-authored content can never
// inject markup — `==highlighted==` spans and `![]()` images are then
// generated ourselves (a fixed shape with sanitized values), never a
// passthrough of raw admin HTML. `highlightStyle` applies to every
// `==...==` span in this one string; a sender with several
// differently-styled highlights in the same message isn't supported (use
// the dedicated callout field — see renderCalloutHtml — for a second,
// independently-styled highlight).
export function renderMarkdownToHtml(markdown: string, highlightStyle?: IHighlightStyle): string {
  const escaped = escapeHtml(markdown);
  const styleAttr = buildHighlightStyleAttr(resolveHighlightStyle(highlightStyle));
  const withHighlights = escaped.replace(/==(.+?)==/g, `<span${styleAttr}>$1</span>`);
  const withImages = renderImages(withHighlights);
  const withLinks = renderLinks(withImages);
  return withLinks
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/\n/g, "<br>");
}

// A callout is a SEPARATE, optional block (image and/or a short line of
// text) rendered above the main body — for a headline discount/countdown a
// sender wants to lead with, distinct from a `==highlighted==` span buried
// inside a sentence. Unlike the body, the callout's text needs no `==`
// markers at all: the whole field IS the highlight, always, since that's
// the one thing this field is for (see NotificationTemplate.ts's own
// comment). Its `highlightStyle` is independent of the body's — a "New
// feature" banner might want a different accent than an inline discount
// mention in the same message.
function renderCalloutHtml(callout?: INotificationCallout): string {
  if (!callout || (!callout.text?.trim() && !callout.imageUrl?.trim())) return "";
  const parts: string[] = [];
  if (callout.imageUrl?.trim()) {
    const safeUrl = sanitizeImageUrl(callout.imageUrl);
    if (safeUrl) parts.push(`<img src="${safeUrl}" alt="" style="max-width:100%;border-radius:12px;display:block;margin:0 0 8px 0;" />`);
  }
  if (callout.text?.trim()) {
    const styleAttr = buildHighlightStyleAttr(resolveHighlightStyle(callout.highlightStyle));
    parts.push(`<div${styleAttr}>${escapeHtml(callout.text.trim())}</div>`);
  }
  if (!parts.length) return "";
  // A linked callout wraps its image + text together in one <a>, so the
  // whole banner is clickable (text-decoration:none — an underline through
  // gradient text would look broken).
  const open = callout.linkUrl ? buildAnchorOpen(callout.linkUrl, "display:block;text-decoration:none;color:inherit;", false) : null;
  const inner = open ? `${open}${parts.join("")}</a>` : parts.join("");
  return `<div style="margin-bottom:12px">${inner}</div>`;
}

// The optional call-to-action button under the body — a real styled button
// on email/popup. Returns "" for a missing/invalid button so it never emits
// a dead or dangerous link.
function renderButtonHtml(button?: INotificationButton): string {
  if (!button?.label?.trim() || !button.url?.trim()) return "";
  const open = buildAnchorOpen(button.url, BUTTON_STYLE, false);
  if (!open) return "";
  return `<div style="margin-top:16px">${open}${escapeHtml(button.label.trim())}</a></div>`;
}

// The button as it's stored on a UserNotification row for the bell:
// `{ link, linkLabel }`, or undefined when there's no (valid) button.
export function resolveButtonLink(button?: INotificationButton): { link: string; linkLabel: string } | undefined {
  if (!button?.label?.trim() || !button.url?.trim()) return undefined;
  const safe = sanitizeLinkUrl(button.url);
  if (!safe) return undefined;
  return { link: resolveLinkHref(safe), linkLabel: button.label.trim() };
}

// The rich version — callout + full `==highlighted==`/image rendering — for
// the two channels with room and a reason to show it: email and the popup
// card. The bell (in-app) deliberately gets a reduced rendering instead, via
// buildInAppNotificationHtml below — see that function's own comment.
export function buildNotificationHtml(body: string, opts?: { highlightStyle?: IHighlightStyle; callout?: INotificationCallout; button?: INotificationButton }): string {
  return renderCalloutHtml(opts?.callout) + renderMarkdownToHtml(body, opts?.highlightStyle) + renderButtonHtml(opts?.button);
}

// The in-app bell is a plain-text-first surface — no callout banner (that's
// an email/popup-only concept), no images (a raw <img> doesn't fit a small
// dropdown row), and `==highlighted==` spans lose their color/gradient
// styling entirely. The words inside a highlight or an image's alt text are
// still stripped, not kept, so the bell shows exactly what a sender wrote
// as body prose minus the callout/image/highlight features — only **bold**
// survives as real styling, by explicit design (not an oversight).
export function renderMarkdownToPlainHtml(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const withoutImages = escaped.replace(/!\[(.*?)\]\((.*?)\)/g, "");
  // `[words](url)` keeps its words but drops the link — same "keep the words,
  // drop the extra" treatment as a highlight. A linked image, `[![a](i)](u)`,
  // has already lost its image above, leaving `[](u)`, which collapses to
  // nothing here.
  const withoutLinks = withoutImages.replace(/\[(.*?)\]\((.*?)\)/g, "$1");
  const withoutHighlights = withoutLinks.replace(/==(.+?)==/g, "$1");
  const withBold = withoutHighlights.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const withoutItalics = withBold.replace(/\*(.+?)\*/g, "$1");
  return withoutItalics.replace(/\n/g, "<br>");
}

// The one function every send path should call for the in_app channel
// specifically — never includes a callout, regardless of whether one was
// configured, since a callout is an email/popup-only banner concept.
export function buildInAppNotificationHtml(body: string): string {
  return renderMarkdownToPlainHtml(body);
}

// Who an email is sent AS. Omitted everywhere except marketing sends, which
// means the ordinary no-reply `env.emailFrom` — so adding the marketing
// sender below can't change what OTPs, invites, tickets, dunning notices, or
// campaigns to registered users go out from.
export interface EmailSender {
  from: string;
  replyTo?: string;
}

const senderFields = (sender?: EmailSender) => ({ from: sender?.from ?? env.emailFrom, ...(sender?.replyTo ? { reply_to: sender.replyTo } : {}) });

async function sendViaResend(email: string, subject: string, html: string, tag: string, headers?: Record<string, string>, sender?: EmailSender): Promise<boolean> {
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails",
      { ...senderFields(sender), to: [email], subject, html, ...(headers ? { headers } : {}) },
      { headers: { Authorization: `Bearer ${env.emailApiKey}`, "Content-Type": "application/json" }, timeout: 8000 }
    );
    if (!data?.id) {
      // eslint-disable-next-line no-console
      console.error(`[notificationEmailService] Resend returned an unexpected response (${tag}): ${JSON.stringify(data)}`);
      return false;
    }
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[notificationEmailService] Resend send failed (${tag}):`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function sendNotificationEmail(email: string, subject: string, bodyHtml: string, tag: string, sender?: EmailSender): Promise<boolean> {
  if (env.emailApiKeyIsPlaceholder) {
    // eslint-disable-next-line no-console
    console.log(`[notificationEmailService] DEV MODE — ${tag} email to ${email} not sent (no real provider configured)`);
    return true;
  }
  return sendViaResend(email, subject, bodyHtml, tag, undefined, sender);
}

// ── Marketing email to imported (non-user) contacts ──────────────────────

// Appended to every external-list email: says why they're getting it and
// gives a working one-click way out. Required practice (and, for bulk
// senders, required by Gmail/Yahoo) — not optional decoration.
export function buildUnsubscribeFooterHtml(unsubscribeUrl: string): string {
  return (
    `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;font-size:12px;color:#888888;line-height:1.5;">` +
    `You're receiving this email because your address was added to a Divve mailing list. ` +
    `If you'd rather not hear from us, <a href="${unsubscribeUrl}" style="color:#888888;text-decoration:underline;">unsubscribe</a>.` +
    `</div>`
  );
}

// The RFC 2369 / RFC 8058 headers that make Gmail/Yahoo/Outlook show their
// own native "Unsubscribe" button, and let it work in one click.
export function buildUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export interface BatchEmail {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

// Resend allows ~2 single sends per second; when a batch is rejected we fall
// back to one-by-one and need to stay under that.
const INDIVIDUAL_SEND_GAP_MS = env.nodeEnv === "test" ? 0 : 550;
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// Sends up to ~100 personalized emails in ONE call to Resend's batch
// endpoint (a big list can't be sent one request at a time without tripping
// the provider's per-second limit), and returns a per-email success flag in
// the same order. The batch call is all-or-nothing on the provider's side, so
// when it's REJECTED (an HTTP error response — e.g. one invalid address) we
// fall back to one-by-one so a single bad address doesn't sink the rest. A
// network error/timeout is different: the batch may already have gone out, so
// re-sending could duplicate it — those are all reported as failed instead.
export async function sendNotificationEmailBatch(emails: BatchEmail[], tag: string, sender?: EmailSender): Promise<boolean[]> {
  if (emails.length === 0) return [];
  if (env.emailApiKeyIsPlaceholder) {
    // eslint-disable-next-line no-console
    console.log(`[notificationEmailService] DEV MODE — ${tag} batch of ${emails.length} email(s) not sent (no real provider configured)`);
    return emails.map(() => true);
  }
  try {
    const { data } = await axios.post(
      "https://api.resend.com/emails/batch",
      emails.map((e) => ({ ...senderFields(sender), to: [e.to], subject: e.subject, html: e.html, ...(e.headers ? { headers: e.headers } : {}) })),
      { headers: { Authorization: `Bearer ${env.emailApiKey}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    if (Array.isArray(data?.data) && data.data.length === emails.length) return emails.map(() => true);
    // eslint-disable-next-line no-console
    console.error(`[notificationEmailService] Resend batch returned an unexpected response (${tag}): ${JSON.stringify(data)}`);
    return emails.map(() => false);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[notificationEmailService] Resend batch failed (${tag}):`, err instanceof Error ? err.message : err);
    if (!(axios.isAxiosError(err) && err.response)) return emails.map(() => false);
  }
  const results: boolean[] = [];
  for (const e of emails) {
    results.push(await sendViaResend(e.to, e.subject, e.html, tag, e.headers, sender));
    await sleep(INDIVIDUAL_SEND_GAP_MS);
  }
  return results;
}
