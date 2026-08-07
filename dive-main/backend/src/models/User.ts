import { Schema, model, Document, Types } from "mongoose";

export interface IPreferences {
  risk: "Conservative" | "Balanced" | "Aggressive";
  returnExpectation: string;
  diversificationGoal: string;
  preferredCategories: string[];
  excludedCategories: string[];
}

export interface IPortfolioMeta {
  lastSyncedAt: Date | null;
  sources: string[];
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  mobile: string;
  email: string;
  age: number;
  passwordHash: string;
  personalDetails: Record<string, unknown>;
  portfolio: IPortfolioMeta;
  preferences: IPreferences;
  createdAt: Date;
  updatedAt: Date;
}

const preferencesSchema = new Schema<IPreferences>(
  {
    risk: { type: String, enum: ["Conservative", "Balanced", "Aggressive"], default: "Balanced" },
    returnExpectation: { type: String, default: "Moderate" },
    diversificationGoal: { type: String, default: "High" },
    preferredCategories: { type: [String], default: [] },
    excludedCategories: { type: [String], default: [] },
  },
  { _id: false }
);

const portfolioMetaSchema = new Schema<IPortfolioMeta>(
  {
    lastSyncedAt: { type: Date, default: null },
    sources: { type: [String], default: [] },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    age: { type: Number, required: true, min: 18 },
    passwordHash: { type: String, required: true },
    personalDetails: { type: Schema.Types.Mixed, default: {} },
    portfolio: { type: portfolioMetaSchema, default: () => ({ lastSyncedAt: null, sources: [] }) },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
