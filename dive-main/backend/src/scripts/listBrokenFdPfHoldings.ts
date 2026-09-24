import { connectDb, disconnectDb } from "../db/connect";
import { Holding } from "../models/Holding";
import { User } from "../models/User";
import { FdPfHoldingLean, fdPfFieldProblems, isFdPfHoldingBroken } from "../services/holdingValuationService";

/**
 * READ-ONLY audit — lists every FD/PF holding the daily valuation job can't
 * reprice, and why. A holding is "broken" when its stored fields make the
 * compound-interest maths come out as "not a number" (say an FD with no
 * `startMonth`); the job skips those (and logs them) rather than letting one
 * bad record stop everyone else's repricing, so they just sit there with a
 * frozen value until someone fixes the record. This finds them.
 *
 * It decides with the SAME function the job uses (recomputeFdPfHolding in
 * holdingValuationService.ts), so it can't disagree with what the job does.
 * It only ever READS — no holding is modified, no user is touched. Covers all
 * users, Premium or not: a Freemium user's broken holding isn't repriced
 * today, but would break the moment they upgrade.
 *
 *   npm run audit-fd-pf-holdings              # readable list
 *   npm run audit-fd-pf-holdings -- --json    # the same as JSON
 */

export interface BrokenFdPfHolding {
  holdingId: string;
  userId: string;
  userEmail: string | null;
  assetClass: "FD" | "PF";
  name: string;
  problems: string[];
  extraFields: Record<string, unknown>;
}

export async function findBrokenFdPfHoldings(): Promise<{ scanned: number; broken: BrokenFdPfHolding[] }> {
  const holdings = (await Holding.find({ assetClass: { $in: ["FD", "PF"] } }).lean()) as unknown as Array<FdPfHoldingLean & { name: string }>;
  const brokenHoldings = holdings.filter((h) => isFdPfHoldingBroken(h));

  const users = await User.find({ _id: { $in: brokenHoldings.map((h) => h.userId) } }).select("email").lean();
  const emailById = new Map(users.map((u) => [String(u._id), u.email]));

  const broken: BrokenFdPfHolding[] = brokenHoldings.map((h) => ({
    holdingId: String(h._id),
    userId: String(h.userId),
    userEmail: emailById.get(String(h.userId)) ?? null,
    assetClass: h.assetClass,
    name: h.name,
    problems: fdPfFieldProblems(h),
    extraFields: h.extraFields,
  }));
  return { scanned: holdings.length, broken };
}

export function printReadable(scanned: number, broken: BrokenFdPfHolding[]): void {
  // eslint-disable-next-line no-console
  console.log(`Scanned ${scanned} FD/PF holding(s); ${broken.length} can't be repriced.\n`);
  broken.forEach((b, i) => {
    // eslint-disable-next-line no-console
    console.log(`${i + 1}. ${b.assetClass} "${b.name}"`);
    // eslint-disable-next-line no-console
    console.log(`   holding id : ${b.holdingId}`);
    // eslint-disable-next-line no-console
    console.log(`   user       : ${b.userEmail ?? "(user not found)"} (${b.userId})`);
    // eslint-disable-next-line no-console
    console.log(`   problem    : ${b.problems.length ? b.problems.join("; ") : "value comes out as not-a-number (no single field identified)"}\n`);
  });
  if (broken.length) {
    // eslint-disable-next-line no-console
    console.log("Fix: the user can re-save the holding from their own Holdings screen with the missing details (staff impersonation is read-only, so staff can't edit it for them), or the record can be deleted if it's junk.");
    // eslint-disable-next-line no-console
    console.log("Until fixed, the daily job leaves that holding's value unchanged. Nothing was modified by this report.");
  }
}

// Allows `npm run audit-fd-pf-holdings` (add `-- --json` for JSON output).
if (require.main === module) {
  const asJson = process.argv.includes("--json");
  connectDb()
    .then(() => findBrokenFdPfHoldings())
    .then(({ scanned, broken }) => {
      // eslint-disable-next-line no-console
      if (asJson) console.log(JSON.stringify({ scanned, broken }, null, 2));
      else printReadable(scanned, broken);
    })
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
