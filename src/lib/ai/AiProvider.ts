export type AiClassification = {
  score: number;
  opportunity: string;
  suggestedChannel: 'EMAIL' | 'WHATSAPP_MANUAL' | 'PHONE_MANUAL';
  notes: string;
};

export type AiDraft = {
  subject: string;
  body: string;
};

export interface AiProvider {
  classifyProspect(prospect: unknown): Promise<AiClassification>;
  generateDraft(prospect: unknown, objective: string): Promise<AiDraft>;
}
