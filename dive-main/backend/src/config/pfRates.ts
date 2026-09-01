// Government-declared Provident Fund interest rates — unlike an FD's bank-
// chosen rate (genuinely free user entry), PPF/EPF/VPF rates are public and
// set by the Central Government / EPFO respectively, on a knowable but
// infrequent schedule. Used to pre-fill a new PF holding's interest rate
// (still user-editable — a stored holding keeps whatever rate was actually
// in force when it was entered, and doesn't retroactively update).
//
// There is no live feed for this — these are manually maintained, same
// convention as every other static reference table in this codebase (see
// docs/DIVE_SCORE_MODEL.md §5 on why hand-curated data is preferred over an
// unverifiable/fabricated source here).
//
// PPF: reviewed quarterly by the Ministry of Finance — 7.1% p.a. has been
// unchanged since the Apr-Jun 2020 quarter, the longest stable run in the
// scheme's history.
// EPF/VPF: reviewed annually by EPFO's Central Board of Trustees, notified
// by the Ministry of Labour & Employment — 8.25% p.a. for FY2025-26
// (retained from FY2024-25).
//
// Last verified: 2026-09-01.
export const PF_DECLARED_RATES: Record<"PPF" | "EPF" | "VPF", number> = {
  PPF: 7.1,
  EPF: 8.25,
  VPF: 8.25, // VPF accrues at the same declared rate as EPF proper.
};
