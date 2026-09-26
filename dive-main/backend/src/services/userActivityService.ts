import { FilterQuery, Types } from "mongoose";
import { ActivityEvent, IActivityEvent } from "../models/ActivityEvent";
import { User } from "../models/User";
import { ACTIVITY_TYPES, activityGroup, activityLabel, ActivityGroup } from "./activityCatalog";

/**
 * The admin "User Activity" page's data (separate from the staff-only Audit Log):
 * what users did in the app, filterable by user, event type/group and date, and
 * exportable as CSV. Reads the ActivityEvent stream — raw rows expire after
 * ACTIVITY_EVENT_RETENTION_DAYS (default 180), so this is a recent-history view,
 * not a permanent archive.
 */

export const EXPORT_ROW_LIMIT = 10_000;

export interface UserActivityFilters {
  // A user id (24 hex chars) or part of an email address.
  user?: string;
  types?: string[];
  group?: ActivityGroup;
  from?: Date;
  to?: Date;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const IST_OFFSET = "+05:30";

// A date-only value ("2026-09-26") means the whole of that day in IST — the
// admins' day — rather than UTC, so "today" matches what they see on the clock.
export function parseFilterDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${IST_OFFSET}` : value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// null = the user filter matched nobody (so the result is empty, not "everyone").
async function resolveUserIds(user: string | undefined): Promise<Types.ObjectId[] | null | undefined> {
  const q = user?.trim();
  if (!q) return undefined;
  if (OBJECT_ID.test(q)) return [new Types.ObjectId(q)];
  const matches = await User.find({ email: { $regex: escapeRegex(q.toLowerCase()) } }).select("_id").limit(50).lean();
  return matches.length ? matches.map((m) => m._id as Types.ObjectId) : null;
}

async function buildFilter(f: UserActivityFilters): Promise<FilterQuery<IActivityEvent> | null> {
  const filter: FilterQuery<IActivityEvent> = {};

  const ids = await resolveUserIds(f.user);
  if (ids === null) return null;
  if (ids) filter.userId = { $in: ids };

  let types = f.types?.filter(Boolean);
  if (f.group) {
    const inGroup = Object.entries(ACTIVITY_TYPES).filter(([, info]) => info.group === f.group).map(([t]) => t);
    types = types?.length ? types.filter((t) => inGroup.includes(t)) : inGroup;
  }
  if (types) filter.type = { $in: types };

  if (f.from || f.to) {
    filter.ts = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  }
  return filter;
}

// "reason: wrong_password · tried: t***@divve.in" — a short, safe one-line
// reading of an event's props, for the table.
export function summarizeProps(props: unknown): string {
  if (!props || typeof props !== "object") return "";
  const parts = Object.entries(props as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  const text = parts.join(" · ");
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

export interface ActivityRow {
  id: string;
  ts: Date;
  type: string;
  label: string;
  group: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  ip: string | null;
  userAgent: string | null;
  props: Record<string, unknown> | null;
  summary: string;
}

async function toRows(events: Array<IActivityEvent & { _id: Types.ObjectId }>): Promise<ActivityRow[]> {
  const ids = [...new Set(events.filter((e) => e.userId).map((e) => String(e.userId)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("email name").lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return events.map((e) => {
    const u = e.userId ? byId.get(String(e.userId)) : undefined;
    return {
      id: String(e._id),
      ts: e.ts,
      type: e.type,
      label: activityLabel(e.type),
      group: activityGroup(e.type),
      userId: e.userId ? String(e.userId) : null,
      // A user who was deleted since keeps their event but no longer resolves.
      userEmail: u?.email ?? null,
      userName: u?.name ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      props: (e.props as Record<string, unknown> | undefined) ?? null,
      summary: summarizeProps(e.props),
    };
  });
}

export async function queryUserActivity(f: UserActivityFilters, page: number, limit: number): Promise<{ events: ActivityRow[]; page: number; limit: number; total: number; totalPages: number }> {
  const filter = await buildFilter(f);
  if (!filter) return { events: [], page, limit, total: 0, totalPages: 1 };
  const [total, events] = await Promise.all([
    ActivityEvent.countDocuments(filter),
    ActivityEvent.find(filter)
      .sort({ ts: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { events: await toRows(events as never), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// Every type this page can filter by: the ones in the catalog plus any other type
// actually present in the data (so nothing recorded is unfilterable).
export async function listActivityTypes(): Promise<Array<{ type: string; label: string; group: string }>> {
  const present = (await ActivityEvent.distinct("type")) as string[];
  const all = [...new Set([...Object.keys(ACTIVITY_TYPES), ...present])].sort((a, b) => activityLabel(a).localeCompare(activityLabel(b)));
  return all.map((type) => ({ type, label: activityLabel(type), group: activityGroup(type) }));
}

// ---- CSV export ------------------------------------------------------------

// A spreadsheet treats a cell starting with = + - @ (or a tab/CR) as a FORMULA — a
// user-controlled value (their browser's user-agent, say) could run something on
// the admin's machine when opened. Prefix such cells with an apostrophe.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = ["time_ist", "time_utc", "type", "event", "group", "user_id", "user_email", "user_name", "ip", "user_agent", "details"];

const istString = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);

export async function exportUserActivityCsv(f: UserActivityFilters, rowLimit: number = EXPORT_ROW_LIMIT): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const filter = await buildFilter(f);
  if (!filter) return { csv: `${CSV_HEADER.join(",")}\r\n`, rowCount: 0, truncated: false };
  // One extra row tells us whether the cap cut something off.
  const events = await ActivityEvent.find(filter).sort({ ts: -1, _id: -1 }).limit(rowLimit + 1).lean();
  const truncated = events.length > rowLimit;
  const rows = await toRows((truncated ? events.slice(0, rowLimit) : events) as never);
  const lines = rows.map((r) =>
    [istString(r.ts), r.ts.toISOString(), r.type, r.label, r.group, r.userId, r.userEmail, r.userName, r.ip, r.userAgent, r.props ? JSON.stringify(r.props) : ""].map(csvCell).join(",")
  );
  return { csv: [CSV_HEADER.join(","), ...lines].join("\r\n") + "\r\n", rowCount: rows.length, truncated };
}
