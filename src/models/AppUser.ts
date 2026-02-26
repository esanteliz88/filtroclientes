import mongoose from 'mongoose';

const AppUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'company_admin', 'company_user'],
      required: true,
      index: true
    },
    companyCode: { type: String, default: null, index: true },
    externalUserId: { type: Number, default: null, index: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true }
  },
  { timestamps: true }
);

export const AppUser = mongoose.model('AppUser', AppUserSchema);
export type AppUserDoc = mongoose.InferSchemaType<typeof AppUserSchema>;
