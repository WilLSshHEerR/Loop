# Fase 3 — Descubrimiento de prospectos y preparación con Gemini

Objetivo: buscar prospectos, guardarlos, clasificarlos y preparar borradores sin enviar correos ni realizar acciones externas automáticas.

## Fuente elegida

Google Places API (New), utilizando Text Search. No se implementará scraping de Google Maps. Campos iniciales: nombre, dirección, categoría, teléfono, sitio web, rating, reseñas y `googlePlaceId`. `googlePlaceId` será el identificador principal.

## 1. Preparación del entorno

- [ ] Añadir `GEMINI_API_KEY` al `.env`, sin compartir ni subir el valor.
- [ ] Añadir `GEMINI_MODEL` al `.env` con el modelo autorizado.
- [x] Añadir nombres de variables a `.env.example` sin valores reales.
- [ ] Añadir las variables al servicio `app` de `docker-compose.yml`.
- [ ] Validar las nuevas variables mediante Zod.
- [ ] Prohibir valores vacíos y registrar solo nombres de variables, nunca claves ni respuestas privadas.

## 2. Cliente de Gemini

- [ ] Crear `src/modules/ai/gemini.ts`.
- [ ] Instalar el SDK oficial compatible con Node.js 22.
- [ ] Mantener llamadas de Gemini exclusivamente en el backend.
- [ ] Crear prompts versionados y centralizados.
- [ ] Limitar entrada y salida por tamaño y duración.
- [ ] Añadir timeout y reintentos controlados.
- [ ] Registrar uso estimado sin guardar contenido personal innecesario.
- [ ] No exponer la API key al frontend.

## 3. Buscador de prospectos

- [x] Crear `src/modules/discovery/routes.ts`.
- [ ] Crear `POST /discovery/search` para recibir ciudad, categoría y términos permitidos.
- [ ] Validar todas las entradas con Zod.
- [x] Fuente aprobada y documentada: Google Places API (New), Text Search.
- [ ] Respetar robots.txt, términos, cuotas y límites de solicitudes.
- [ ] Añadir control de concurrencia y reintentos.
- [ ] No extraer ni almacenar datos sensibles fuera de los campos previstos.
- [ ] Registrar un resumen mínimo de origen, sin usuarios ni credenciales.

## 4. Modelo de datos

- [ ] Usar `source`, `lastRefreshedAt` y `googlePlaceId` para origen, frescura y deduplicación.
- [ ] Evitar duplicados por `googlePlaceId`.
- [ ] Definir clave alternativa para resultados sin Google Place ID.
- [ ] Añadir estado de validación del prospecto si es necesario.
- [ ] Mantener migraciones de Prisma para cada cambio.

## 5. Clasificación con Gemini

- [ ] Crear `POST /ai/classify-prospect/:prospectId`.
- [ ] Enviar al modelo nombre, categoría, ciudad y estado público disponible.
- [ ] Pedir clasificación estructurada en JSON validado por Zod.
- [ ] Guardar score, notas y posibles oportunidades sin reemplazar datos manuales.
- [ ] Marcar el resultado como generado por IA.
- [ ] Mantener auditoría de la generación.
- [ ] Permitir reprocesar solo de forma manual.

## 6. Generación de borradores

- [ ] Crear `POST /conversations/:conversationId/messages/:messageId/generate`.
- [ ] Usar únicamente datos necesarios del prospecto.
- [ ] Generar asunto y cuerpo como borrador.
- [ ] Mantener `status=DRAFT` y `aiGenerated=true`.
- [ ] No cambiar a `PENDING_APPROVAL` automáticamente.
- [ ] Permitir que el propietario revise y edite antes de aprobar.
- [ ] No enviar correos ni abrir sockets de proveedores externos.

## 7. Supresiones y cumplimiento

- [ ] Antes de clasificar o crear borradores, comprobar `DO_NOT_CONTACT`.
- [ ] Comprobar coincidencias por email o teléfono en `Suppression`.
- [ ] Registrar todos los bloqueos en auditoría.
- [ ] Añadir motivo de base legal y consentimiento si se implementa captación.
- [ ] Crear mecanismo de baja en fases posteriores.
- [ ] Revisar LFPDPPP y políticas aplicables antes de producción.

## 8. Pruebas

- [ ] Mockear Gemini y no hacer llamadas reales en las pruebas.
- [ ] Probar búsqueda válida e inválida.
- [ ] Probar deduplicación por `googlePlaceId`.
- [ ] Probar clasificación con respuesta JSON válida e inválida.
- [ ] Probar creación de borrador sin envío.
- [ ] Probar bloqueo por `DO_NOT_CONTACT`.
- [ ] Probar bloqueo por supresión.
- [ ] Mantener 28 pruebas mínimas y agregar casos nuevos.

## 9. Seguridad

- [ ] Mantener la API key fuera del repositorio y del frontend.
- [ ] Sanitizar respuestas de Gemini antes de guardar HTML o texto ejecutable.
- [ ] Validar esquema de salida con Zod.
- [ ] Aplicar límites globales y por usuario.
- [ ] Limitar el contexto enviado al proveedor.
- [ ] No registrar prompts o cuerpos con datos personales completos.
- [ ] Rotar la clave si fue expuesta.

## 10. Panel web

- [ ] Añadir formulario de búsqueda de prospectos.
- [ ] Mostrar fuente, puntuación y estado de validación.
- [ ] Añadir acción manual `Clasificar con Gemini`.
- [ ] Mostrar borrador generado antes de pedir aprobación.
- [ ] Permitir edición y rechazo de borradores.
- [ ] Mantener siempre un botón o flujo de aprobación humana.
- [ ] Mostrar claramente que el sistema no enviará automáticamente.

## 11. Integración posterior de correo

- [ ] Esperar hasta aprobación explícita del borrador.
- [ ] Integrar proveedor de correo únicamente después de probar el modo sandbox.
- [ ] Cambiar estado a `SENT` o `FAILED` según resultado real.
- [ ] Registrar mensaje, proveedor e identificador externo sin secretos.
- [ ] Respetar reintentos, cuotas y bajas.
- [ ] No implementar esta sección hasta aprobar Fase 3.

## 12. Entrega

- [ ] Actualizar `.env.example`.
- [ ] Actualizar README en español.
- [ ] Ejecutar build, pruebas y lint.
- [ ] Ejecutar Docker Compose.
- [ ] Prueba manual con proveedor mock o sandbox.
- [ ] Revisar logs y datos personales.
- [ ] Crear commit y publicar en GitHub.
