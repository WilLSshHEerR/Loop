export type DiscoveryQuery = {
  text: string;
  city?: string;
  state?: string;
  category?: string;
  limit: number;
};

export type DiscoveredProspect = {
  businessName: string;
  category?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  websiteUrl?: string;
  googleMapsUrl?: string;
  googlePlaceId?: string;
  rating?: number;
  reviewsCount?: number;
  source: string;
};

export interface DiscoverySource {
  search(query: DiscoveryQuery): Promise<DiscoveredProspect[]>;
}
