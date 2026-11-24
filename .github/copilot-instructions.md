# Instrucciones del proyecto

- Usar Node.js 22, TypeScript estricto y módulos ESM con Fastify 5.
- Usar Prisma 6 y PostgreSQL para persistencia; gestionar cambios de esquema mediante migraciones.
- Validar entradas y configuración con Zod 3; no registrar contraseñas, hashes, secretos, tokens ni códigos TOTP.
- Usar bcryptjs para contraseñas, otplib 12 para TOTP y qrcode-terminal para la configuración local de autenticación.
- Mantener los secretos fuera del repositorio y de la imagen; documentar únicamente nombres de variables y ejemplos sin secretos reales.
- Mantener compatibilidad con los scripts de package.json y con la imagen Node 22: punto de entrada `src/index.ts`, esquema `prisma/schema.prisma`, seed `prisma/seed.ts` y configuración de autenticación `scripts/setup-auth.ts`.
- El despliegue con Compose ejecuta `prisma migrate deploy` antes de iniciar la aplicación y espera a que PostgreSQL esté disponible.
- Añadir pruebas con Vitest y respetar las configuraciones de ESLint y Prettier.