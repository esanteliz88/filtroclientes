import mongoose from 'mongoose';

const PermissionSchema = new mongoose.Schema(
  {
    method: { type: String, required: true },
    path: { type: String, required: true }
  },
  { _id: false }
);

const ClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    secretHash: { type: String, required: true },
    companyCodes: { type: [String], default: [], index: true },
    scopes: { type: [String], default: [] },
    permissions: { type: [PermissionSchema], default: [] },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' }
  },
  { timestamps: true }
);

export const Client = mongoose.model('Client', ClientSchema);
export type ClientDoc = mongoose.InferSchemaType<typeof ClientSchema>;
