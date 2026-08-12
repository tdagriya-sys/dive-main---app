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
  };
}
