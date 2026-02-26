import mongoose from 'mongoose';

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    code: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active', index: true }
  },
  { timestamps: true }
);

export const Company = mongoose.model('Company', CompanySchema);
