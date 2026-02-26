import type { App } from '../app.js';
import mongoose from 'mongoose';

export async function registerDb(app: App) {
  await mongoose.connect(app.config.MONGO_URI);
  app.log.info('MongoDB connected');
}
