# Loop — gestión de prospectos y aprobaciones

API de prospectos y aprobación de mensajes con Node.js 22, Fastify 5, Prisma 6 y PostgreSQL. La autenticación utiliza usuario y contraseña.

## Requisitos y configuración local

Se requieren Node.js 22.12 o posterior dentro de la versión 22, npm y PostgreSQL 16 accesible. Las variables disponibles están en [.env.example](.env.example). Crear una copia local y mantenerla fuera del control de versiones:

```sh
cp .env.example .env
chmod 600 .env
npm install
npm run setup:auth
```

El Dockerfile necesita el archivo de bloqueo que genera `npm install`. `setup:auth` requiere terminal interactiva, pide usuario y contraseña sin mostrar esta última y crea un hash bcrypt y un secreto JWT si no existe uno. No genera ni imprime códigos QR ni solicita TOTP. Si se confirma el reemplazo de una configuración previa, cambia el usuario y el hash, aunque conserva el secreto JWT existente.

Completar los demás valores en `.env`; el siguiente fragmento describe **marcadores**, no valores válidos listos para producción:

```dotenv
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
DATABASE_URL=postgresql://<USUARIO_URL>:<PASSWORD_URL>@127.0.0.1:5432/<BASE>?schema=public
CORS_ORIGIN=https://<ORIGEN_AUTORIZADO>
OWNER_USERNAME=<GENERADO_POR_SETUP_AUTH>
OWNER_PASSWORD_HASH='<GENERADO_POR_SETUP_AUTH>'
JWT_SECRET=<GENERADO_POR_SETUP_AUTH>
POSTGRES_USER=<USUARIO_POSTGRES>
POSTGRES_PASSWORD=<PASSWORD_POSTGRES>
POSTGRES_DB=<BASE_POSTGRES>
```

Codificar como URL los caracteres especiales del usuario y la contraseña en `DATABASE_URL`. El script guarda `OWNER_PASSWORD_HASH` entre comillas simples para que Compose no interprete los signos `$`. Conservar el valor íntegro sin mostrarlo ni compartirlo. El origen CORS debe ser el origen exacto del cliente autorizado, no `*`. No publicar el archivo ni introducir valores reales en ejemplos, logs o imágenes.

Con PostgreSQL operativo y una base nueva:

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

Para producción compilada: `npm run build` y después `npm start`. Las pruebas se ejecutan con `npm test` y el análisis estático con `npm run lint`. Para generar el cliente Prisma sin compilar la aplicación, usar `npx prisma generate`.

## Docker Compose

Se requieren Docker Engine y Compose con el daemon en ejecución. Completar `.env`, generar las credenciales interactivamente y asegurar que `package-lock.json` exista. Para Compose, `DATABASE_URL` debe apuntar al host `postgres`, al puerto interno 5432 y a la misma base y credenciales que `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`. Los cambios de estas variables no reconfiguran automáticamente una base ya inicializada en el volumen.

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 app
```

Compose espera el healthcheck de PostgreSQL, ejecuta `prisma migrate deploy` y después inicia la aplicación. La API solo se publica en `127.0.0.1:${PORT:-3000}` del host; PostgreSQL no publica un puerto. El volumen `postgres_data` persiste los datos. No usar `docker compose down -v` salvo que se pretenda destruir el volumen y exista un respaldo comprobado. Revisar los logs sin divulgar datos personales o secretos.

## Migraciones y seed

La migración inicial está diseñada para una base nueva. En desarrollo, `npm run db:migrate` ejecuta `prisma migrate dev`. Compose ejecuta `migrate deploy` al arrancar. Para una base existente con otro esquema se requiere un plan de migración y un respaldo previo.

`npm run db:seed` crea cinco prospectos ficticios con identificadores estables y direcciones `.invalid`, sin modificar los que ya tengan esos identificadores. No es necesario para producción; revisar su compatibilidad con el esquema antes de ejecutarlo.

El seed usa `tsx`, dependencia de desarrollo eliminada de la imagen final. No se puede asumir que `npm run db:seed` funcione dentro del contenedor de producción. Para usarlo, ejecutarlo desde un entorno controlado con dependencias de desarrollo y conexión autorizada a la base; el puerto de PostgreSQL no está publicado por Compose. No exponerlo públicamente solo para cargar datos de ejemplo.

## Contrato de API

Los ejemplos son ficticios.

### Autenticación

1. `POST /auth/login`: `{ "username": "<USUARIO>", "password": "<CONTRASEÑA>" }`. Devuelve `accessToken` y `refreshToken`.
2. En rutas protegidas, enviar `Authorization: Bearer <ACCESS_TOKEN>`.
3. `POST /auth/refresh`, con `{ "refreshToken": "<REFRESH_TOKEN>" }`, renueva los tokens y consume el refresh anterior.

### Prospectos

- `POST /prospects`: crear un prospecto. Ejemplo de campos: `{ "businessName": "Empresa ficticia", "category": "Comercio", "address": "Calle de ejemplo 1", "city": "Madrid", "state": "Madrid", "email": "demo@example.invalid", "phone": "+12025550123", "status": "NEW" }`.
- `GET /prospects` y `GET /prospects/:id`: listar y obtener por identificador UUID. El listado admite `page`, `limit`, `status`, `websiteStatus`, `q`, `category`, `city`, `state`, `email` y `phone`.
- `PATCH /prospects/:id` y `DELETE /prospects/:id`: modificar y eliminar. Por ejemplo, el estado puede cambiar a `QUALIFIED`.

`businessName` es obligatorio al crear; los demás campos de negocio admitidos son `category`, `address`, `city`, `state`, `phone`, `email`, `websiteUrl`, `googleMapsUrl`, `googlePlaceId`, `rating`, `reviewsCount`, `websiteStatus`, `score`, `status`, `source` y `notes`. Los campos opcionales de texto y contacto admiten `null`; los URL deben ser HTTP(S), `rating` va de 0 a 5 y `reviewsCount` es un entero no negativo. El correo se normaliza a minúsculas. Se permiten prospectos sin contacto.

Los estados de prospecto son `NEW`, `QUALIFIED`, `DRAFTED`, `PENDING_APPROVAL`, `CONTACTED`, `REPLIED`, `CALL_SCHEDULED`, `PROPOSAL_SENT`, `WON`, `LOST` y `DO_NOT_CONTACT`; el estado inicial es `NEW`. `websiteStatus` admite `NONE`, `SLOW`, `NOT_MOBILE_FRIENDLY`, `OUTDATED`, `OK` y `UNKNOWN`, con `UNKNOWN` por defecto. No confundir estados de prospecto con decisiones de mensajes.

### Aprobaciones de mensajes

- `GET /approvals/pending`: consultar mensajes `PENDING_APPROVAL`, incluyendo conversación y prospecto; admite `page` y `limit`.
- `POST /approvals/:messageId/approve`: aprobar el **mensaje** identificado por UUID `messageId`; sin cuerpo o con `{}`.
- `POST /approvals/:messageId/reject`: rechazar ese mensaje; sin cuerpo o con `{}`.

Solo se decide un mensaje pendiente. La aprobación se bloquea cuando el prospecto de la conversación está en `DO_NOT_CONTACT` o su correo electrónico o teléfono aparece en supresiones. El email se compara sin distinguir mayúsculas y el teléfono literalmente. Rechazar no consulta supresiones. La decisión cambia únicamente el estado del mensaje, sin modificar `approvedAt`, y crea un registro de auditoría en una transacción serializable de Prisma. Se reintentan hasta tres veces los conflictos transaccionales. Aprobar un mensaje no implica que se envíe. No hay endpoints de gestión de supresiones ni de creación de mensajes.

Los listados devuelven `{ "items": [], "total": 0, "page": 1, "limit": 20 }`. `page` admite 1–100000 y `limit` 1–100; por defecto son 1 y 20. Las entradas son estrictas. Las rutas de datos devuelven errores como `{ "error": { "code": "...", "message": "..." } }`: 400 para validación, 404 para inexistentes y 409 para conflictos, estado incompatible, `DO_NOT_CONTACT` o supresión.

### Conversaciones y borradores

- `POST /conversations`: crea una conversación vinculada a `prospectId`; admite `channel` (`EMAIL`, `WHATSAPP`, `FACEBOOK`, `INSTAGRAM`) y `status` opcional.
- `GET /conversations`: lista conversaciones con `page`, `limit`, `prospectId`, `channel`, `status` y `q`.
- `GET /conversations/:conversationId`: obtiene una conversación con sus mensajes.
- `PATCH /conversations/:conversationId`: modifica `channel` o `status`.
- `DELETE /conversations/:conversationId`: elimina la conversación y sus mensajes por relación en cascada.
- `GET /conversations/:conversationId/messages`: lista mensajes con `page`, `limit`, `status`, `direction` y `q`.
- `POST /conversations/:conversationId/messages`: crea un mensaje en `DRAFT` con `direction` (`IN` o `OUT`), `subject`, `body` y `aiGenerated` opcional.
- `PATCH /conversations/:conversationId/messages/:messageId`: modifica únicamente un mensaje en `DRAFT`.
- `POST /conversations/:conversationId/messages/:messageId/request-approval`: cambia un borrador a `PENDING_APPROVAL` y registra auditoría.
- `POST /conversations/messages/:messageId/request-approval`: variante directa para solicitar aprobación por ID de mensaje.

Los borradores pueden modificarse antes de solicitar aprobación. Al pasar a `PENDING_APPROVAL`, no se envían ni generan automáticamente con IA. La aprobación posterior sigue las reglas de supresión y `DO_NOT_CONTACT` descritas abajo.

## Ubuntu: recomendaciones de operación segura

- Mantener Ubuntu y sus paquetes actualizados; instalar Docker desde fuentes oficiales y restringir el acceso administrativo. La pertenencia al grupo `docker` equivale prácticamente a privilegios de root.
- Usar una cuenta administrativa individual con SSH por clave; deshabilitar acceso remoto por contraseña y root solo después de comprobar un acceso alternativo. Abrir únicamente los puertos necesarios en el firewall.
- Mantener API y PostgreSQL sin exposición directa a Internet. Para acceso remoto, colocar delante un proxy inverso mantenido con HTTPS, certificados válidos, límites de tamaño y tasa, y una política CORS restrictiva. Compose ya vincula la API a loopback.
- Proteger `.env` con permisos restrictivos y copias cifradas; mantener secretos fuera de imágenes, repositorios, historiales de shell, monitorización y logs. La imagen excluye `.env` del contexto y ejecuta la aplicación como usuario sin privilegios.
- Planificar rotación de credenciales, supervisión, actualización de imágenes y restauraciones ensayadas. Confirmar configuración de IP/proxy antes de depender del bloqueo por IP.

## Respaldo y restauración

Realizar respaldos periódicos cifrados fuera del servidor, con acceso mínimo y retención definida. Probar restauraciones en un entorno aislado. Ejemplo para la base de Compose: el archivo de salida contiene datos sensibles y debe protegerse; crear primero un directorio de respaldo privado.

```sh
umask 077
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup.dump
```

Para restaurar **sobre una base de destino preparada y autorizada**, detener primero todas las escrituras y verificar el archivo y el destino. El siguiente comando reemplaza objetos existentes y puede destruir datos; no ejecutarlo sin validar el procedimiento y el respaldo:

```sh
docker compose stop app
docker compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' < backup.dump
docker compose start app
```

Si la restauración falla, investigar antes de volver a iniciar la aplicación. Verificar esquema y datos, aplicar las migraciones necesarias y revisar la compatibilidad de versiones. Respaldar por separado los secretos necesarios para recuperar el acceso, cifrados y con una política de acceso distinta a los datos.

## Limitaciones y pruebas

- Las pruebas de rutas usan `inject` y un Prisma simulado: no demuestran integridad SQL, aislamiento real, reversión transaccional ni concurrencia entre procesos. Complementarlas con pruebas sobre PostgreSQL antes de producción.
- Zod 3 presenta una vulnerabilidad de agotamiento de memoria para colecciones sobredimensionadas; la corrección publicada requiere Zod 4. Las entradas actuales no aceptan colecciones y Fastify limita el tamaño del cuerpo, pero se recomienda evaluar la actualización antes de producción.
- El bloqueo por IP y la rotación de refresh se almacenan en memoria del proceso: se pierden al reiniciar y no se comparten entre réplicas. Un proxy mal configurado puede agrupar clientes en una IP o permitir suplantarla. No existe revocación persistente de tokens.
- El acceso es de propietario único; no hay roles ni autorización granular. La auditoría almacenada en la base no es inmutable frente a acceso directo a ella.
- Una supresión insertada después de aprobar no revierte la decisión. Los procesos externos deben aplicar una política de concurrencia compatible y comprobar nuevamente las supresiones antes de cualquier envío.