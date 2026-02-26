import type { App } from '../app.js';
import { oauthRoutes } from './oauth.js';
import { adminRoutes } from './admin.js';
import { protectedRoutes } from './protected.js';

export async function registerRoutes(app: App) {
  await app.register(oauthRoutes, { prefix: '/oauth' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(protectedRoutes, { prefix: '/api' });
}
