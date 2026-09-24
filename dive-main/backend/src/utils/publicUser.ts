import { User } from "../models/User";

// Shared shape returned to the frontend for the logged-in user — strips
// passwordHash and any other internal-only fields. Used by every endpoint
// that can change or re-issue the current user (auth, profile, password).
export function publicUser(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    age: user.age,
    preferences: user.preferences,
    portfolio: user.portfolio,
    plannerState: user.plannerState,
    hasSeenWalkthrough: user.hasSeenWalkthrough,
    // null for every ordinary user — the frontend router (Phase 0.4) uses
    // this alone to decide "send this session to /admin". The admin panel's
    // OWN screens read their granted permissions from a dedicated endpoint,
    // not from this shape.
    staffRole: user.staffRole,
  };
}
