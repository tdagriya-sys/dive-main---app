import { Schema, model, Document, Types } from "mongoose";

/**
 * One record per issued refresh token (keyed by the `jti` embedded in the
 * JWT itself, not the raw token — nothing about a refresh token is stored
 * that would let anyone reconstruct or replay it from the DB alone). Backs
 * server-side revocation (logout, single-use rotation on `/auth/refresh`)
 * and reuse detection: `verifyRefreshToken`'s JWT signature check alone
 * can't tell "still valid" apart from "was valid, already used/logged out,
 * now being replayed" — this collection is what makes that distinction
 * possible.
 */
export interface IRefreshToken extends Document {
  jti: string;
  userId: Types.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    jti: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User", index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Kept around (not deleted) until its own expiry even after being revoked —
// a revoked-but-still-present record is exactly what lets a later replay of
// the same token be recognized as reuse rather than looking identical to a
// token that simply never existed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>("RefreshToken", refreshTokenSchema);
