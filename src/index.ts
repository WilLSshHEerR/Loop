import { env } from './config/env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();
  const shutdown = async () => {
    try {
      await app.close();
    } catch {
      app.log.error('Error al cerrar el servidor');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch {
    app.log.error('No se pudo iniciar el servidor');
    await shutdown();
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('No se pudo iniciar la aplicación');
  process.exitCode = 1;
});