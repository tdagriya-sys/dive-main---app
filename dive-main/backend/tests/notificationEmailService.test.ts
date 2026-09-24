import { renderMarkdownToHtml, renderVars, buildNotificationHtml, renderMarkdownToPlainHtml, buildInAppNotificationHtml, sanitizeLinkUrl, resolveLinkHref, resolveButtonLink, buildUnsubscribeFooterHtml, buildUnsubscribeHeaders } from "../src/services/notificationEmailService";
import { env } from "../src/config/env";

const APP = env.corsOrigins[0].replace(/\/+$/, "");

// Phase 5 of docs/ADMIN_PANEL_PLAN.md §4.5, extended this phase to support
// `==highlighted==` spans with a configurable IHighlightStyle on top of the
// pre-existing bold/italic/line-break subset. No prior test file existed
// for this module at all — see this phase's own changelog entry.

describe("renderVars", () => {
  it("substitutes {{name}} and {{email}}, case-insensitively", () => {
    expect(renderVars("Hi {{Name}}, we sent this to {{EMAIL}}", { name: "Ada", email: "ada@example.com" })).toBe("Hi Ada, we sent this to ada@example.com");
  });

  it("supports {{first_name}} / {{firstName}} — the first word of the name", () => {
    const vars = { name: "Ada Augusta Lovelace", email: "ada@example.com" };
    expect(renderVars("Hi {{first_name}}!", vars)).toBe("Hi Ada!");
    expect(renderVars("Hi {{ firstName }}!", vars)).toBe("Hi Ada!");
    expect(renderVars("Hi {{FIRST_NAME}}, full: {{name}}", vars)).toBe("Hi Ada, full: Ada Augusta Lovelace");
  });

  it("uses the whole name as the first name when it's a single word, and copes with stray spacing", () => {
    expect(renderVars("{{first_name}}", { name: "Cher", email: "c@example.com" })).toBe("Cher");
    expect(renderVars("{{first_name}}", { name: "  Ada   Lovelace ", email: "a@example.com" })).toBe("Ada");
    expect(renderVars("Hi {{first_name}}", { name: "there", email: "a@example.com" })).toBe("Hi there");
  });
});

describe("unsubscribe footer and headers", () => {
  it("builds a footer with a link to the given URL and a plain explanation", () => {
    const html = buildUnsubscribeFooterHtml("https://api.example.com/api/unsubscribe/abc.def");
    expect(html).toContain('href="https://api.example.com/api/unsubscribe/abc.def"');
    expect(html).toContain("added to a Divve mailing list");
    expect(html).toContain(">unsubscribe</a>");
  });

  it("builds the RFC 2369 / RFC 8058 one-click headers", () => {
    expect(buildUnsubscribeHeaders("https://api.example.com/api/unsubscribe/abc.def")).toEqual({
      "List-Unsubscribe": "<https://api.example.com/api/unsubscribe/abc.def>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("renderMarkdownToHtml", () => {
  it("renders bold and italic exactly as before this phase", () => {
    expect(renderMarkdownToHtml("Hi **there**, *welcome*\nline2")).toBe("Hi <b>there</b>, <i>welcome</i><br>line2");
  });

  it("escapes HTML special characters before applying any markup", () => {
    expect(renderMarkdownToHtml("<script>alert(1)</script> & \"quotes\"")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; \"quotes\"");
  });

  it("wraps ==highlighted== text in a span with the DEFAULT gold/bold style when no style is given", () => {
    const html = renderMarkdownToHtml("Only ==3 days left==!");
    expect(html).toContain('<span style="color:#D4AF37;font-weight:bold">3 days left</span>');
  });

  it("applies a custom solid color + font size", () => {
    const html = renderMarkdownToHtml("==50% discount==", { color: "#FF0000", fontSize: "1.5em" });
    expect(html).toBe('<span style="color:#FF0000;font-size:1.5em">50% discount</span>');
  });

  it("applies a gradient instead of a plain color when both gradient stops are set, ignoring color", () => {
    const html = renderMarkdownToHtml("==big sale==", { color: "#000000", gradientFrom: "#D4AF37", gradientTo: "#FF6B6B", fontWeight: "bold" });
    expect(html).toBe('<span style="background-image:linear-gradient(90deg,#D4AF37,#FF6B6B);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:bold">big sale</span>');
  });

  it("applies fontStyle (italic) alongside the default color/weight when no color of its own is given", () => {
    const html = renderMarkdownToHtml("==note==", { fontStyle: "italic" });
    expect(html).toBe('<span style="color:#D4AF37;font-weight:bold;font-style:italic">note</span>');
  });

  // Real bug: the admin UI's Weight/Style selects default to an empty
  // string rather than being omitted, so touching either dropdown at all
  // (even re-picking "Default") turns `highlightStyle` into a real,
  // non-null object with no color — `highlightStyle ?? DEFAULT` never
  // caught that, since the object itself isn't null/undefined. Result: the
  // highlight got no color at all and was visually indistinguishable from
  // plain body text in both email and the popup card.
  it("still applies the default color when highlightStyle is a real but colorless object — e.g. Weight/Style left at 'Default'", () => {
    const html = renderMarkdownToHtml("==3 days left==", {});
    expect(html).toBe('<span style="color:#D4AF37;font-weight:bold">3 days left</span>');
  });

  it("still applies the default COLOR when Weight/Style are explicitly 'Normal' rather than 'Default' — but respects the explicit normal weight/style instead of forcing bold", () => {
    const html = renderMarkdownToHtml("==3 days left==", { fontWeight: "normal", fontStyle: "normal" });
    expect(html).toBe('<span style="color:#D4AF37;font-weight:normal;font-style:normal">3 days left</span>');
  });

  it("does NOT override an explicitly chosen color, even when weight/style are also left at their defaults", () => {
    const html = renderMarkdownToHtml("==sale==", { color: "#FF0000" });
    expect(html).toBe('<span style="color:#FF0000">sale</span>');
  });

  it("supports bold, highlight, and line breaks together in one message", () => {
    const html = renderMarkdownToHtml("Your plan renews in ==3 days==.\n**Don't miss it.**", { color: "#D4AF37" });
    expect(html).toBe('Your plan renews in <span style="color:#D4AF37">3 days</span>.<br><b>Don\'t miss it.</b>');
  });

  it("renders multiple ==...== spans in the same message with the same style", () => {
    const html = renderMarkdownToHtml("==7 days== then ==3 days== then ==0 days==", { fontWeight: "bold" });
    expect(html.match(/<span/g)).toHaveLength(3);
  });

  it("produces no style attribute at all when highlighting isn't used and no style is passed", () => {
    // Confirms the default style never leaks into unrelated output.
    expect(renderMarkdownToHtml("Plain text, no formatting")).toBe("Plain text, no formatting");
  });

  it("renders ![alt](url) as an <img>, with the alt text HTML-escaped", () => {
    const html = renderMarkdownToHtml('Check this out: ![a "cool" chart](https://example.com/chart.png)');
    expect(html).toBe('Check this out: <img src="https://example.com/chart.png" alt="a &quot;cool&quot; chart" style="max-width:100%;border-radius:12px;display:block;margin:8px 0;" />');
  });

  it("HTML-escapes an ampersand in the image URL itself (a real query string), producing a valid attribute", () => {
    const html = renderMarkdownToHtml("![](https://example.com/img.png?a=1&b=2)");
    expect(html).toContain('src="https://example.com/img.png?a=1&amp;b=2"');
  });

  it("drops a javascript: URL, leaving the literal markdown text untouched", () => {
    const html = renderMarkdownToHtml("![x](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).toContain("javascript:alert(1)");
  });

  it("drops an image URL containing a quote character (attribute-breakout attempt)", () => {
    const html = renderMarkdownToHtml('![x](https://example.com/a.png" onerror="alert(1))');
    expect(html).not.toContain("<img");
  });

  it("renders multiple images in the same message", () => {
    const html = renderMarkdownToHtml("![](https://a.com/1.png) and ![](https://a.com/2.png)");
    expect(html.match(/<img/g)).toHaveLength(2);
  });
});

describe("buildNotificationHtml", () => {
  it("returns just the rendered body when no callout is given", () => {
    expect(buildNotificationHtml("Hi **there**")).toBe("Hi <b>there</b>");
  });

  it("renders an empty string for a callout with neither text nor an image", () => {
    expect(buildNotificationHtml("Body text", { callout: {} })).toBe("Body text");
  });

  it("renders callout text as ALWAYS highlighted — no ==markers== needed", () => {
    const html = buildNotificationHtml("Regular body.", { callout: { text: "50% off today!" } });
    expect(html).toBe('<div style="margin-bottom:12px"><div style="color:#D4AF37;font-weight:bold">50% off today!</div></div>Regular body.');
  });

  it("uses the callout's OWN highlightStyle, independent of the body's highlightStyle", () => {
    const html = buildNotificationHtml("==body highlight==", {
      highlightStyle: { color: "#00FF00" },
      callout: { text: "Callout highlight", highlightStyle: { color: "#FF00FF" } },
    });
    expect(html).toContain('<div style="color:#FF00FF">Callout highlight</div>');
    expect(html).toContain('<span style="color:#00FF00">body highlight</span>');
  });

  it("renders a callout image above the callout text, both above the body", () => {
    const html = buildNotificationHtml("Body", { callout: { imageUrl: "https://example.com/banner.gif", text: "Big sale" } });
    const imgIndex = html.indexOf("<img");
    const textIndex = html.indexOf("Big sale");
    const bodyIndex = html.indexOf("Body");
    expect(imgIndex).toBeGreaterThanOrEqual(0);
    expect(imgIndex).toBeLessThan(textIndex);
    expect(textIndex).toBeLessThan(bodyIndex);
  });

  it("renders just the image when only imageUrl is set (no text)", () => {
    const html = buildNotificationHtml("Body", { callout: { imageUrl: "https://example.com/banner.gif" } });
    expect(html).toContain("<img");
    expect(html).not.toContain("<div style=\"color");
  });

  it("HTML-escapes callout text", () => {
    const html = buildNotificationHtml("Body", { callout: { text: "<script>alert(1)</script>" } });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("still applies the default color to a callout's colorless highlightStyle — same fix as the body's own highlight", () => {
    const html = buildNotificationHtml("Body", { callout: { text: "Big news!", highlightStyle: {} } });
    expect(html).toContain('<div style="color:#D4AF37;font-weight:bold">Big news!</div>');
  });

  it("still applies the default color to a callout when Weight/Style are explicitly 'Normal'", () => {
    const html = buildNotificationHtml("Body", { callout: { text: "Big news!", highlightStyle: { fontWeight: "normal" } } });
    expect(html).toContain('<div style="color:#D4AF37;font-weight:normal">Big news!</div>');
  });
});

// The in-app bell gets a deliberately reduced render — no callout (that's
// email/popup-only), no images, and ==highlighted== spans lose their
// styling but keep their words. Only **bold** survives as real styling.
describe("renderMarkdownToPlainHtml / buildInAppNotificationHtml", () => {
  it("keeps bold as real <b> styling", () => {
    expect(renderMarkdownToPlainHtml("Hi **there**")).toBe("Hi <b>there</b>");
  });

  it("strips ==highlight== markers but keeps the words, unstyled", () => {
    expect(renderMarkdownToPlainHtml("Only ==3 days left==!")).toBe("Only 3 days left!");
  });

  it("strips *italic* markers too, keeping the words — only bold applies in-app", () => {
    expect(renderMarkdownToPlainHtml("Hi **there**, *welcome*")).toBe("Hi <b>there</b>, welcome");
  });

  it("removes an image entirely, including its alt text — no trace left", () => {
    expect(renderMarkdownToPlainHtml("Look: ![a chart](https://example.com/chart.png) neat right?")).toBe("Look:  neat right?");
  });

  it("removes multiple images and keeps surrounding text intact", () => {
    expect(renderMarkdownToPlainHtml("![](https://a.com/1.png)Before and ![](https://a.com/2.png)after")).toBe("Before and after");
  });

  it("still escapes HTML and converts line breaks", () => {
    expect(renderMarkdownToPlainHtml("<script>x</script>\nline2")).toBe("&lt;script&gt;x&lt;/script&gt;<br>line2");
  });

  it("combines bold, highlight, and an image in one message correctly", () => {
    const html = renderMarkdownToPlainHtml("**Sale!** Only ==3 days left==! ![banner](https://example.com/b.png)");
    expect(html).toBe("<b>Sale!</b> Only 3 days left! ");
  });

  it("buildInAppNotificationHtml never includes a callout, even when one is passed to the rich builder for the same body", () => {
    const body = "Plain body with ==highlight== and ![img](https://example.com/x.png)";
    const rich = buildNotificationHtml(body, { callout: { text: "Big news!", imageUrl: "https://example.com/banner.gif" } });
    const inApp = buildInAppNotificationHtml(body);
    expect(rich).toContain("Big news!");
    expect(inApp).not.toContain("Big news!");
    expect(inApp).not.toContain("<img");
    expect(inApp).toBe("Plain body with highlight and ");
  });
});

// Redirect links — inline `[words](url)`, a linked image, a callout link, and
// a call-to-action button. A link is only ever an absolute http(s) URL or an
// app-relative `/path` (resolved against CORS_ORIGINS[0], since an email can't
// resolve a relative URL); everything else is refused outright.
describe("sanitizeLinkUrl / resolveLinkHref", () => {
  it("accepts absolute http(s) URLs and single-slash app paths", () => {
    expect(sanitizeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(sanitizeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(sanitizeLinkUrl("/?go=login")).toBe("/?go=login");
    expect(sanitizeLinkUrl("/")).toBe("/");
  });

  it("rejects javascript:/data:/mailto:, protocol-relative, empty, and attribute-breakout values", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.com", "//evil.com", "", "   ", 'https://a.com/"onclick="x', "https://a.com/<b>", "https://a.com/a b", "login"]) {
      expect(sanitizeLinkUrl(bad)).toBeNull();
    }
  });

  it("prepends the app origin to a relative path and leaves an absolute URL alone", () => {
    expect(resolveLinkHref("/?go=login")).toBe(`${APP}/?go=login`);
    expect(resolveLinkHref("https://example.com/x")).toBe("https://example.com/x");
  });
});

describe("inline links in the body", () => {
  it("renders [words](external-url) as a new-tab anchor", () => {
    const html = renderMarkdownToHtml("See [our blog](https://example.com/blog) now");
    expect(html).toBe('See <a href="https://example.com/blog" target="_blank" rel="noopener noreferrer" style="color:#D4AF37;text-decoration:underline;">our blog</a> now');
  });

  it("renders an app-relative link as an absolute same-tab anchor (no target)", () => {
    const html = renderMarkdownToHtml("[Log in](/?go=login)");
    expect(html).toBe(`<a href="${APP}/?go=login" style="color:#D4AF37;text-decoration:underline;">Log in</a>`);
    expect(html).not.toContain("target=");
  });

  it("keeps a real & in the URL valid as &amp; inside the attribute (once, not twice)", () => {
    const html = renderMarkdownToHtml("[go](https://example.com/?a=1&b=2)");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).not.toContain("&amp;amp;");
  });

  it("leaves a javascript: link as literal text instead of emitting an anchor", () => {
    const html = renderMarkdownToHtml("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("javascript:alert(1)");
  });

  it("renders a linked image, [![alt](img)](url), as an <a> wrapping the <img>", () => {
    const html = renderMarkdownToHtml("[![banner](https://example.com/b.png)](https://example.com/sale)");
    expect(html).toMatch(/^<a href="https:\/\/example\.com\/sale" target="_blank"[^>]*><img src="https:\/\/example\.com\/b\.png" alt="banner"[^>]*\/><\/a>$/);
  });

  it("does not turn a rejected image (![x](bad)) into a link", () => {
    const html = renderMarkdownToHtml("![x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
  });

  it("supports a link, a highlight, and bold together", () => {
    const html = renderMarkdownToHtml("**Hurry** — ==50% off== [here](https://example.com)");
    expect(html).toContain("<b>Hurry</b>");
    expect(html).toContain('<span style="color:#D4AF37;font-weight:bold">50% off</span>');
    expect(html).toContain(">here</a>");
  });
});

describe("callout link", () => {
  it("wraps the callout image + text together in one anchor", () => {
    const html = buildNotificationHtml("Body", { callout: { text: "Big sale", imageUrl: "https://example.com/b.png", linkUrl: "/?go=signup" } });
    expect(html).toContain(`<a href="${APP}/?go=signup" style="display:block;text-decoration:none;color:inherit;"><img`);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Big sale"));
    expect(html.indexOf("Big sale")).toBeLessThan(html.indexOf("</a>"));
  });

  it("ignores an invalid callout linkUrl but still renders the callout", () => {
    const html = buildNotificationHtml("Body", { callout: { text: "Big sale", linkUrl: "javascript:alert(1)" } });
    expect(html).toContain("Big sale");
    expect(html).not.toContain("<a ");
  });

  it("renders no link (and no callout) when there's a linkUrl but neither text nor image", () => {
    expect(buildNotificationHtml("Body", { callout: { linkUrl: "/?go=login" } })).toBe("Body");
  });
});

describe("call-to-action button", () => {
  it("renders a styled button link after the body", () => {
    const html = buildNotificationHtml("Body text", { button: { label: "Get started", url: "/?go=signup" } });
    expect(html).toBe(
      `Body text<div style="margin-top:16px"><a href="${APP}/?go=signup" style="display:inline-block;background:#D4AF37;color:#111111;font-weight:bold;text-decoration:none;padding:10px 22px;border-radius:999px;">Get started</a></div>`
    );
  });

  it("opens an external button URL in a new tab and HTML-escapes the label", () => {
    const html = buildNotificationHtml("B", { button: { label: "<b>Go</b> & see", url: "https://example.com/x?a=1&b=2" } });
    expect(html).toContain('href="https://example.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("&lt;b&gt;Go&lt;/b&gt; &amp; see");
    expect(html).not.toContain("<b>Go</b>");
  });

  it("renders nothing for a button with a bad URL or a blank label", () => {
    expect(buildNotificationHtml("B", { button: { label: "Go", url: "javascript:alert(1)" } })).toBe("B");
    expect(buildNotificationHtml("B", { button: { label: "  ", url: "/?go=login" } })).toBe("B");
  });

  it("resolveButtonLink returns the absolute URL + label for the bell, or undefined when invalid", () => {
    expect(resolveButtonLink({ label: " Get started ", url: "/?go=signup" })).toEqual({ link: `${APP}/?go=signup`, linkLabel: "Get started" });
    expect(resolveButtonLink({ label: "Go", url: "javascript:x" })).toBeUndefined();
    expect(resolveButtonLink(undefined)).toBeUndefined();
  });
});

describe("in-app (bell) rendering of links and the button", () => {
  it("keeps the words of an inline link but drops the link itself", () => {
    expect(renderMarkdownToPlainHtml("Read [our guide](https://example.com/guide) today")).toBe("Read our guide today");
  });

  it("removes a linked image completely — no image, no link, no leftover brackets", () => {
    expect(renderMarkdownToPlainHtml("Look [![banner](https://example.com/b.png)](https://example.com/sale) here")).toBe("Look  here");
  });

  it("never includes the button in the plain body (the bell shows it as a separate link)", () => {
    expect(buildInAppNotificationHtml("Body")).toBe("Body");
  });
});
