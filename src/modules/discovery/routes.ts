import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError, empty, installErrorHandler, parse, serializable, text } from '../prospects/shared.js';
import { GooglePlacesDiscoverySource } from './GooglePlacesDiscoverySource.js';

const searchSchema = z.object({
  text: text(200),
  city: text(200).optional(),
  state: text(200).optional(),
  category: text(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
}).strict();

const source = new GooglePlacesDiscoverySource();

let dailyCount = 0;
let dailyKey = '';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function consumeRequest() {
  const key = todayKey();
  if (dailyKey !== key) {
    dailyKey = key;
    dailyCount = 0;
  }
  if (dailyCount >= env.PLACES_DAILY_REQUEST_LIMIT) {
    throw new ApiError(429, 'DISCOVERY_LIMIT', 'Daily Google Places request limit reached');
  }
  dailyCount += 1;
}

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  installErrorHandler(app);

  app.post('/search', async (request) => {
    parse(empty, request.params);
    parse(empty, request.query);
    const query = parse(searchSchema, request.body);

    consumeRequest();
    const discovered = await source.search(query);

    const saved = await serializable(async (tx) => {
      const results = [];
      for (const place of discovered) {
        if (!place.googlePlaceId) continue;
        const existing = await tx.prospect.findUnique({ where: { googlePlaceId: place.googlePlaceId } });
        const prospect = existing
          ? await tx.prospect.update({
              where: { id: existing.id },
              data: {
                businessName: place.businessName,
                category: place.category ?? existing.category,
                address: place.address ?? existing.address,
                city: place.city ?? existing.city,
                state: place.state ?? existing.state,
                phone: place.phone ?? existing.phone,
                websiteUrl: place.websiteUrl ?? existing.websiteUrl,
                googleMapsUrl: place.googleMapsUrl ?? existing.googleMapsUrl,
                rating: place.rating ?? existing.rating,
                reviewsCount: place.reviewsCount ?? existing.reviewsCount,
                source: 'GOOGLE_PLACES',
                lastRefreshedAt: new Date(),
                contactChannelHint: place.websiteUrl ? 'EMAIL' : place.phone ? 'PHONE_MANUAL' : 'PHONE_MANUAL',
              },
            })
          : await tx.prospect.create({
              data: {
                businessName: place.businessName,
                category: place.category,
                address: place.address,
                city: place.city,
                state: place.state,
                phone: place.phone,
                websiteUrl: place.websiteUrl,
                googleMapsUrl: place.googleMapsUrl,
                googlePlaceId: place.googlePlaceId,
                rating: place.rating,
                reviewsCount: place.reviewsCount,
                source: 'GOOGLE_PLACES',
                lastRefreshedAt: new Date(),
                contactChannelHint: place.websiteUrl ? 'EMAIL' : 'PHONE_MANUAL',
              },
            });

        await tx.auditLog.create({
          data: {
            action: existing ? 'REFRESHED' : 'DISCOVERED',
            entity: 'Prospect',
            entityId: prospect.id,
            metadata: { source: 'GOOGLE_PLACES', googlePlaceId: place.googlePlaceId },
          },
        });
        results.push(prospect);
      }
      return results;
    });

    return { source: 'GOOGLE_PLACES', count: saved.length, items: saved };
  });
};
