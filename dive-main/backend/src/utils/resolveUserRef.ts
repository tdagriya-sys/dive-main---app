import { Types } from "mongoose";
import { User, IUser } from "../models/User";

// Shared by every admin endpoint that accepts "a Mongo _id OR an email
// address" for a target user (the grant-complimentary and usage-grant forms
// — see admin/screens/Subscriptions.jsx's GrantForm) — a real ObjectId is
// unambiguous (an email never parses as one), so this dispatches on that
// rather than requiring a separate "which kind is this" flag from the caller.
export async function resolveUserRef(userIdOrEmail: string): Promise<IUser | null> {
  const value = userIdOrEmail.trim();
  if (Types.ObjectId.isValid(value)) {
    const byId = await User.findOne({ _id: value, staffRole: null });
    if (byId) return byId;
  }
  return User.findOne({ email: value.toLowerCase(), staffRole: null });
}
