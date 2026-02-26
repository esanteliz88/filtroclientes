import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
  app.log.info(`API listening on ${app.config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
