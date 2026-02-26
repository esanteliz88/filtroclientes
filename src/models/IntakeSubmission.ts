import mongoose from 'mongoose';

const IntakeSubmissionSchema = new mongoose.Schema(
  {
    source: { type: String, default: 'filtroclientes', index: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    normalized: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

export const IntakeSubmission = mongoose.model('IntakeSubmission', IntakeSubmissionSchema);
