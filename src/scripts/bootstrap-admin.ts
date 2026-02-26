import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { loadEnv } from '../config/env.js';
import { Client } from '../models/Client.js';

type Args = {
  clientId: string;
  secret?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { clientId: 'admin' };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === '--client-id' && next) {
      out.clientId = next;
      i += 1;
      continue;
    }

    if (token === '--secret' && next) {
      out.secret = next;
      i += 1;
      continue;
    }
  }

  return out;
}

async function main() {
  dotenv.config();
  const env = loadEnv();
  const args = parseArgs(process.argv.slice(2));

  await mongoose.connect(env.MONGO_URI);

  const exists = await Client.findOne({ clientId: args.clientId }).lean();
  if (exists) {
    console.error(`Client '${args.clientId}' already exists.`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const rawSecret = args.secret ?? crypto.randomBytes(24).toString('hex');
  const secretHash = await bcrypt.hash(rawSecret, 12);

  await Client.create({
    clientId: args.clientId,
    secretHash,
    scopes: ['admin', 'read', 'write'],
    permissions: [
      { method: 'GET', path: '/api/.*' },
      { method: 'POST', path: '/api/.*' }
    ],
    isAdmin: true,
    status: 'active'
  });

  console.log('Admin client created successfully. Save this secret now:');
  console.log(`client_id: ${args.clientId}`);
  console.log(`client_secret: ${rawSecret}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
