import { env } from '../../config/env.js';
import type { DiscoveryQuery, DiscoverySource, DiscoveredProspect } from './DiscoverySource.js';

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryTypeDisplayName?: { text?: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
};

function getComponent(place: Place, type: 'locality' | 'administrative_area_level_1') {
  const component = place.addressComponents?.find((item) => item.types?.includes(type));
  return component?.longText ?? component?.shortText;
}

export class GooglePlacesDiscoverySource implements DiscoverySource {
  async search(query: DiscoveryQuery): Promise<DiscoveredProspect[]> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places no está configurado');
    }

    const textQuery = [query.text, query.category, query.city, query.state].filter(Boolean).join(', ');
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.addressComponents',
      },
      body: JSON.stringify({ textQuery, pageSize: Math.min(query.limit, 20) }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Google Places respondió con estado ${response.status}`);
    }

    const payload = await response.json() as { places?: Place[] };
    return (payload.places ?? []).map((place) => ({
      businessName: place.displayName?.text?.trim() || 'Sin nombre',
      category: place.primaryTypeDisplayName?.text,
      address: place.formattedAddress,
      city: getComponent(place, 'locality'),
      state: getComponent(place, 'administrative_area_level_1'),
      phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber,
      websiteUrl: place.websiteUri,
      googleMapsUrl: place.googleMapsUri,
      googlePlaceId: place.id,
      rating: place.rating,
      reviewsCount: place.userRatingCount,
      source: 'GOOGLE_PLACES',
    })).filter((place) => Boolean(place.googlePlaceId));
  }
}
