import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp, Landmark, Users } from "lucide-react";
import { BackLink, SubpageHead } from "./SubpageChrome";
import tusharPhoto from "../../assets/tushar-dagriya.webp";

const CREDENTIALS = [
  { Icon: TrendingUp, text: "8+ years hands-on investing & trading" },
  { Icon: Landmark, text: "1.5 years as an arbitrageur and quant" },
  { Icon: Users, text: "Managed real portfolios" },
];

// Best-effort years derived from what's known (8+ years total, 1.5 of them
// at GIFT City, "recent" geopolitical stress) rather than exact dates on
// record — worth a quick pass from Tushar himself to tighten before this
// goes live, same as the rest of this page's biographical content.
const TIMELINE = [
  { year: "2018", title: "Where it started", body: "Starts investing seriously — and soon after, begins helping family and friends manage their own portfolios too.", side: "left" },
  { year: "2021–22", title: "The institutional lens", body: "1.5 years as an arbitrageur at a financial institution in GIFT City, Ahmedabad — spotting mispriced, over-concentrated risk stops being a checklist item and becomes instinct.", side: "right" },
  { year: "2024–25", title: "The pattern repeats", body: "Across the portfolios he's managing, the same story keeps showing up: people certain they're diversified, quietly concentrated in the same handful of companies without ever knowing it.", side: "left" },
  { year: "2025", title: "The proof point", body: "That diversification-first, security-first discipline holds — those portfolios reach an all-time high even through recent geopolitical market stress, while plenty of \"diversified\" portfolios nearby don't.", side: "right" },
  { year: "2026", title: "Divve goes live", body: "The instinct becomes a product. Divve launches — so it doesn't have to live in just one person's head anymore.", side: "left" },
];

function TimelineEntry({ year, title, body }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.4 }}>
      <p className="text-sm font-black text-[var(--dive-blue)] tracking-wide">{year}</p>
      <p className="font-heading font-black text-lg mt-1">{title}</p>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-2">{body}</p>
    </motion.div>
  );
}

const BELIEFS = [
  { title: "Verify, don't assume.", body: "Diversification you can verify beats diversification you assume — a portfolio full of different tickers isn't automatically a portfolio full of different risks." },
  { title: "Built for the headline you didn't see coming.", body: "Markets don't warn you before the shock. A portfolio's real job is to survive the one you never saw coming — not just the ones you planned for." },
  { title: "The instinct, without the trading desk.", body: "You shouldn't need 8 years on a desk to get the same concentration instinct one gives you. That instinct is exactly what Divve was built to hand you." },
];

export default function OurStoryPage({ onBack, onGetStarted }) {
  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 md:py-20" data-testid="story-page">
      <BackLink onClick={onBack} />

      <SubpageHead
        eyebrow="Our Story"
        title={<>Built by someone who's <span className="text-gold-gradient">seen the gap</span> — from the inside.</>}
        lede="Divve didn't start as a feature list. It started as a pattern one person kept noticing, portfolio after portfolio — people who were sure they were diversified, and weren't."
      />

      <motion.p
        initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5, delay: 0.1 }}
        className="font-heading font-black text-2xl sm:text-3xl leading-snug mt-14 max-w-3xl"
      >
        "Most people don't lose ground because they picked badly. They lose it because they never knew how concentrated they already were."
      </motion.p>

      {/* Founder */}
      <div className="mt-16 grid md:grid-cols-[1fr_1.5fr] gap-10 md:gap-16 items-start">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5 }}
          className="rounded-2xl border border-[var(--border-light)] bg-[var(--surface-card)] p-7"
        >
          <img src={tusharPhoto} alt="Tushar Dagriya, Founder of Divve"
            className="w-full aspect-square rounded-2xl object-cover object-top bg-[var(--surface-card-hover)]" />
          <h3 className="font-heading font-black text-xl mt-5">Tushar Dagriya</h3>
          <p className="text-sm text-[var(--dive-blue)] font-bold mt-1">Founder, Divve</p>
          <div className="w-8 h-px bg-[var(--border)] my-5" />
          <ul className="space-y-3.5">
            {CREDENTIALS.map((c) => (
              <li key={c.text} className="flex items-start gap-2.5 text-sm text-[var(--text-secondary)] leading-relaxed">
                <c.Icon size={15} className="text-[var(--dive-blue)] shrink-0 mt-0.5" />
                {c.text}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5, delay: 0.1 }}
          className="space-y-6 text-[var(--text-secondary)] leading-relaxed text-base sm:text-lg"
        >
          <p>
            Tushar spent over eight years in the markets before founding Divve — including a year and a half as an arbitrageur at a financial institution in GIFT City, Ahmedabad, where spotting mispriced risk wasn't optional. It was the job.
          </p>
          <p>
            Alongside the desk, he was quietly doing something most fund managers never do: personally supporting the investment portfolios of family and friends, following the same rule every time — <span className="font-bold text-[var(--text-primary)]">diversification-first, security-first</span>. Spread the risk before you chase the return.
          </p>
          <p>
            That discipline held up — those portfolios reached an all-time-high value even through recent geopolitical market stress, while plenty of "well-diversified" portfolios nearby were quietly riding on the same handful of companies, without their owners ever realizing it.
          </p>
          <p className="font-bold text-[var(--text-primary)]">
            That contradiction — investors who genuinely believed they were spread out, finding out too late that they weren't — is the exact problem Divve exists to solve.
          </p>
        </motion.div>
      </div>

      {/* How the idea became Divve */}
      <div className="mt-20 md:mt-28 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5 }}>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)]">How the idea became Divve</span>
          <h2 className="font-heading font-black text-3xl sm:text-4xl leading-tight tracking-tight mt-3">
            An instinct, turned into a score anyone can read.
          </h2>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-6 space-y-5 text-[var(--text-secondary)] leading-relaxed text-base sm:text-lg"
        >
          <p>
            Every experienced trader eventually develops a feel for concentration risk — the ability to glance at a portfolio and sense when too much of it is quietly riding on one company, one sector, one bet, no matter how many different tickers are on the page. Tushar had that instinct. Almost no retail investor gets the chance to build one, and no product existed to hand it to them.
          </p>
          <p>
            Divve is that instinct, systemized. Instead of relying on a trained eye, it looks through every holding you own — funds, bonds, ETFs, direct stock — and traces each one back to its real issuer, turning years of hands-on portfolio discipline into a plain 0–100 score anyone can read in seconds. The goal was never to predict the market. It was to make sure you're never blindsided by a concentration you didn't know you had.
          </p>
        </motion.div>
      </div>

      {/* Where we are — a vertical, alternating-side timeline. The
          connecting line is a single flex-1 segment inside each row's own
          center cell (dot on top, line filling the rest of that row's
          height) rather than one absolutely-positioned line spanning the
          whole block — rows have uneven heights (only one side has text
          per row), so a single fixed-position line would need pixel math
          against content it can't measure in advance; letting each row's
          own segment stretch to fill its row keeps the line continuous
          automatically, however tall any given entry turns out to be. */}
      <div className="mt-20 md:mt-28 max-w-4xl mx-auto" data-testid="story-timeline">
        <motion.p initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5 }}
          className="text-center text-xs font-bold uppercase tracking-[0.2em] text-[var(--dive-blue)]"
        >
          Where we are
        </motion.p>

        <div className="mt-12">
          {TIMELINE.map((t, i) => (
            <div key={t.year} className="grid grid-cols-[1fr_28px_1fr] gap-x-6 sm:gap-x-10">
              <div className={`text-right ${i < TIMELINE.length - 1 ? "pb-14" : ""}`}>
                {t.side === "left" && <TimelineEntry {...t} />}
              </div>
              <div className="flex flex-col items-center">
                <span className="w-4 h-4 rounded-full border-2 border-[var(--dive-blue)] bg-[var(--wrapper-bg)] shrink-0 mt-1" />
                {i < TIMELINE.length - 1 && <span className="w-px flex-1 bg-[var(--border)]" />}
              </div>
              <div className={i < TIMELINE.length - 1 ? "pb-14" : ""}>
                {t.side === "right" && <TimelineEntry {...t} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Beliefs */}
      <div className="grid sm:grid-cols-3 gap-6 mt-16">
        {BELIEFS.map((b, i) => (
          <motion.div
            key={b.title}
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.4, delay: i * 0.1 }}
            className="rounded-2xl border border-[var(--border-light)] bg-[var(--surface-card)] p-6"
          >
            <p className="font-heading font-black text-lg leading-snug text-gold-gradient">{b.title}</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-3">{b.body}</p>
          </motion.div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-20 md:mt-24 text-center">
        <h2 className="font-heading font-black text-3xl sm:text-4xl tracking-tight">
          See your own gap, before it costs you.
        </h2>
        <button data-testid="story-cta-btn" onClick={onGetStarted}
          className="mt-8 gold-btn rounded-full px-8 py-4 font-bold inline-flex items-center gap-2 transition-transform hover:scale-[1.03]">
          Get started free <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
