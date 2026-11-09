export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: string;
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
}

export interface ChatSession {
  id: string;
  phoneNumber: string;
  botActive: boolean;
  lastInteraction: string;
}

export interface StoredMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "OPERATOR" | "SYSTEM";
  content: string;
  createdAt: string;
}

export interface SessionPayload {
  session: ChatSession;
  messages: StoredMessage[];
}

export interface ApartmentContext {
  id: string;
  title: string;
  description: string;
  pricePerNight: number;
  capacity: number;
  features: string[];
}

export interface IaRequest {
  message: string;
  phone: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  apartments: ApartmentContext[];
}

export interface IaResponse {
  reply: string;
  intent: "greeting" | "question" | "reservation" | "off_topic";
  handoff: boolean;
  model: string;
}
