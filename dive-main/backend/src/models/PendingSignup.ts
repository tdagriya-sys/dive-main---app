import { Schema, model, Document } from "mongoose";

/**
 * Holds signup form data between `POST /signup/start` (OTP sent) and
 * `POST /signup/verify` (OTP confirmed, User document actually created).
 */
export interface IPendingSignup extends Document {
  mobile: string;
  name: string;
  email: string;
  age: number;
  passwordHash: string;
  expiresAt: Date;
  createdAt: Date;
}

const pendingSignupSchema = new Schema<IPendingSignup>(
  {
    mobile: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    age: { type: Number, required: true },
    passwordHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingSignup = model<IPendingSignup>("PendingSignup", pendingSignupSchema);
