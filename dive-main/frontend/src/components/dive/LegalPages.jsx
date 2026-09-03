import React from "react";
import { BackLink, SubpageHead } from "./SubpageChrome";

// Standard early-stage draft language for a portfolio-analysis fintech app —
// covers the shape of what a real Terms/Privacy page needs (no-advice
// disclaimer, Account Aggregator consent, data rights, grievance contact),
// not final legal copy. This should go through an actual lawyer/compliance
// review (SEBI/RBI-adjacent positioning + the DPDP Act 2023 for the privacy
// side) before it's treated as binding — flagged here, not just in chat, so
// it isn't missed on a future pass.
const EFFECTIVE_DATE = "23 August 2026";

function LegalPage({ eyebrow, title, sections, onBack }) {
  return (
    <div className="max-w-4xl mx-auto px-6 lg:px-10 py-16 md:py-20" data-testid={`legal-page-${eyebrow.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <BackLink onClick={onBack} />
      <SubpageHead eyebrow={eyebrow} title={title} maxWidth="max-w-2xl" />
      <p className="text-xs font-semibold text-[var(--text-tertiary)] mt-6">Effective {EFFECTIVE_DATE}</p>

      <div className="mt-12 space-y-10">
        {sections.map((s, i) => (
          <div key={s.heading}>
            <h2 className="font-heading font-black text-xl flex items-baseline gap-3">
              <span className="text-[var(--dive-blue)] text-sm font-mono">{String(i + 1).padStart(2, "0")}</span>
              {s.heading}
            </h2>
            <div className="mt-3 space-y-3 text-[var(--text-secondary)] leading-relaxed text-[15px]">
              {s.body.map((p, j) => <p key={j}>{p}</p>)}
              {s.list && (
                <ul className="list-disc pl-5 space-y-1.5">
                  {s.list.map((li) => <li key={li}>{li}</li>)}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TERMS_SECTIONS = [
  {
    heading: "Who this applies to",
    body: [
      "By creating an account or using Divve — the web app, mobile experience, or the Divve Bot browser extension — you agree to these Terms. You must be at least 18 years old and legally capable of entering into a contract under Indian law.",
    ],
  },
  {
    heading: "What Divve is — and isn't",
    body: [
      "Divve is a portfolio analysis and diversification-insight tool. It looks through your holdings to show real vs. apparent diversification, a Divve Score, and rupee-specific suggestions.",
      "Divve is not a SEBI-registered investment adviser or stockbroker. Nothing on Divve is personalized investment advice, and Divve never places a trade or moves money on your behalf, under any circumstance. Every investment decision, and every trade, remains entirely yours.",
    ],
  },
  {
    heading: "Connecting your data",
    body: [
      "You can bring your portfolio into Divve via an RBI-licensed Account Aggregator, manual entry, Divve Bot's screen-scan, or a file upload. Every one of these is read-only — Divve cannot initiate a transaction through any of them, and you can disconnect access at any time.",
      "See our Privacy Policy for exactly what's collected and how it's used.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "You're responsible for keeping your login credentials confidential and for the accuracy of the information you provide. Tell us immediately if you suspect unauthorized access to your account.",
    ],
  },
  {
    heading: "Acceptable use",
    body: ["You agree not to:"],
    list: [
      "Reverse-engineer, scrape, or resell access to Divve or its scoring methodology",
      "Upload or connect another person's financial data without their authorization",
      "Use Divve for any unlawful purpose",
    ],
  },
  {
    heading: "No guarantee of outcomes",
    body: [
      "Your Divve Score and suggestions are based on statistical and historical analysis of your holdings — they're a diagnostic, not a prediction. Markets are inherently uncertain, and no diversification approach (including the discipline behind Divve's own design) guarantees future results. Divve is not liable for investment losses arising from decisions you make using it.",
    ],
  },
  {
    heading: "Divve Bot",
    body: [
      "The Divve Bot browser extension only runs on pages you actively visit while it's installed and enabled. It reads visible order and holdings information to generate a real-time nudge — it never executes, modifies, or cancels anything on your broker, bank, or gold app account.",
    ],
  },
  {
    heading: "Intellectual property",
    body: [
      "Divve's brand, scoring methodology, and software are our property. Using Divve gives you a limited, personal, non-transferable license to use the product — nothing more.",
    ],
  },
  {
    heading: "Liability & disclaimers",
    body: [
      "Divve is provided \"as is.\" We don't warrant uninterrupted or error-free availability, and our liability is limited to the fullest extent permitted by applicable law.",
    ],
  },
  {
    heading: "Changes to these terms",
    body: ["We may update these Terms from time to time. We'll notify you through the app or site — continuing to use Divve after that means you accept the update."],
  },
  {
    heading: "Governing law & disputes",
    body: ["These Terms are governed by the laws of India, with courts in Ahmedabad, Gujarat having exclusive jurisdiction."],
  },
  {
    heading: "Contact",
    body: ["Questions about these Terms? Reach us through the Contact Us page or at hello@divve.in."],
  },
];

const PRIVACY_SECTIONS = [
  {
    heading: "What we collect",
    body: ["Depending on how you use Divve, we collect:"],
    list: [
      "Account details — name, email, mobile number",
      "Portfolio data — holdings, quantities, and values via Account Aggregator, manual entry, Divve Bot, or file upload",
      "Usage data — how you interact with the app and extension",
      "Communication data — anything you share via the Contact Us form",
    ],
  },
  {
    heading: "How we use it",
    body: [
      "To compute your Divve Score and real-vs-apparent diversification, generate suggestions personalized to your own risk profile, respond to your questions, and improve the product. Your holdings are never used to place a trade on your behalf.",
    ],
  },
  {
    heading: "Account Aggregator data, specifically",
    body: [
      "Data pulled via the RBI-licensed Account Aggregator framework is read-only and requires your explicit consent for each connection — you can revoke that consent at any time from your AA app. We never see or store your bank or broker login credentials.",
    ],
  },
  {
    heading: "What we never do",
    body: ["We never sell your data. We never share your portfolio details with advertisers. We never use your holdings to trade on your behalf."],
  },
  {
    heading: "Who we share with",
    body: [
      "Only trusted service providers strictly necessary to run Divve — for example, cloud hosting and Account Aggregator infrastructure — under confidentiality obligations, or when required by law.",
    ],
  },
  {
    heading: "Data security",
    body: [
      "Security-first isn't just how we built the diversification approach behind Divve — it's how we built the platform. Data is encrypted in transit and at rest, access is restricted, and our practices are reviewed regularly. No system is 100% immune to risk, but it's treated as a first-class priority here, not an afterthought.",
    ],
  },
  {
    heading: "Data retention",
    body: [
      "We retain your data for as long as your account is active. If you close your account, we delete or anonymize it within 90 days, except where the law requires us to keep it longer.",
    ],
  },
  {
    heading: "Your rights",
    body: ["You can access, correct, export, or delete your data at any time, disconnect any linked account, and opt out of non-essential communications."],
  },
  {
    heading: "Cookies & tracking",
    body: ["We use cookies only for essential site functionality and basic, non-invasive analytics — never for cross-site ad tracking."],
  },
  {
    heading: "Children",
    body: ["Divve is not intended for anyone under 18."],
  },
  {
    heading: "Changes to this policy",
    body: ["We'll notify you of any material change to this policy through the app or site."],
  },
  {
    heading: "Grievance officer",
    body: ["For any privacy concern or grievance: Tushar Dagriya, hello@divve.in."],
  },
];

export function TermsPage({ onBack }) {
  return <LegalPage eyebrow="Terms & Conditions" title="The fine print, in plain language." sections={TERMS_SECTIONS} onBack={onBack} />;
}

export function PrivacyPage({ onBack }) {
  return <LegalPage eyebrow="Privacy Policy" title="Your data, on your terms." sections={PRIVACY_SECTIONS} onBack={onBack} />;
}

// Divve's only paid feature today is the Rs. 99 resilience-score PDF
// (Razorpay-powered — see backend/src/services/paymentService.ts and
// docs/RAZORPAY_SETUP_GUIDE.md). Written specifically around that one
// product, not a generic multi-SKU template, since that's genuinely all
// there is to cover right now — this should be revisited (and this comment
// updated) the day a second paid feature exists.
const REFUND_SECTIONS = [
  {
    heading: "What this policy covers",
    body: [
      "This policy applies to Divve's one paid feature today: the Rs. 99 resilience score PDF report, purchased via Razorpay from your Home screen or Profile. Every other part of Divve — connecting accounts, the Divve Score, Suggestions, X-Ray, Divve Planner, Divve Bot — is free, with nothing to refund.",
    ],
  },
  {
    heading: "It's a digital product, delivered instantly",
    body: [
      "Your report generates and downloads immediately after a successful payment — there's no shipping, no waiting, no separate delivery step that can go wrong. Because of that instant delivery, and in line with how digital goods are generally treated, we don't offer refunds for a report that was generated and downloaded correctly simply because you changed your mind afterward.",
    ],
  },
  {
    heading: "When you ARE entitled to a refund",
    body: ["We'll refund you in full, no argument, for any of these:"],
    list: [
      "You were charged but the report never downloaded, and re-downloading it from Profile still doesn't work",
      "You were charged twice for the same report by mistake",
      "Money was deducted from your bank/card/UPI but Razorpay or Divve never actually marked the payment successful",
      "Any other genuine technical failure on our end that meant you paid without getting a working report",
    ],
  },
  {
    heading: "How to request one",
    body: [
      "Reach us through the Contact Us page or at hello@divve.in with your registered email and roughly when you paid — Razorpay's own payment ID if you have it (from your bank/UPI app's transaction history) helps us find it faster, but isn't required. We'll look into it and get back to you within 2 business days.",
    ],
  },
  {
    heading: "Timeline once approved",
    body: [
      "Approved refunds are issued back to your original payment method (card, UPI, netbanking, whichever you paid with) through Razorpay. Razorpay's own processing typically takes 5-7 business days to reflect, occasionally longer depending on your bank — that part is Razorpay/your bank's timeline, not something Divve can speed up once we've approved it on our end.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: ["We may update this policy as Divve adds more paid features. We'll notify you of any material change through the app or site."],
  },
];

export function RefundPolicyPage({ onBack }) {
  return <LegalPage eyebrow="Refund Policy" title="Fair, and over quickly if something's genuinely wrong." sections={REFUND_SECTIONS} onBack={onBack} />;
}
