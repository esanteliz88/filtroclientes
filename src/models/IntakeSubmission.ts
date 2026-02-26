import mongoose from 'mongoose';

const IntakeSubmissionSchema = new mongoose.Schema(
  {
    source: { type: String, default: 'filtroclientes', index: true },
    sourceUserId: { type: Number, default: null, index: true },
    companyCodes: { type: [String], default: [], index: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    normalized: { type: mongoose.Schema.Types.Mixed, required: true },
    match: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

export const IntakeSubmission = mongoose.model('IntakeSubmission', IntakeSubmissionSchema);
