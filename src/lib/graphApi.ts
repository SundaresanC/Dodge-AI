import { fetchApi } from "./api";

// ─── Types ───────────────────────────────────────────────

export type NodeType =
  | "order"
  | "order_item"
  | "delivery"
  | "invoice"
  | "payment"
  | "customer"
  | "product"
  | "journal_entry";

export type EdgeType =
  | "order_customer"
  | "order_delivery"
  | "order_item"
  | "item_product"
  | "delivery_invoice"
  | "invoice_journal"
  | "invoice_payment";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Partial<Record<NodeType, number>>;
  buildTimeMs: number;
  totalNodes: number;
  totalEdges: number;
}

export interface GraphChatResponse {
  answer: string;
  data: Record<string, unknown>[];
  entities_involved: string[];
  highlight_nodes: string[];
  confidence: "high" | "medium" | "low";
  error: string | null;
  intent: string;
  sessionId?: string;
}

export interface ConversationTurn {
  role: "user" | "agent";
  content: string;
}

export interface ChatInput {
  query: string;
  sessionId?: string;
  context?: ConversationTurn[];
}

// ─── API calls ───────────────────────────────────────────

export async function fetchGraphData(refresh = false): Promise<GraphData> {
  const params = refresh ? "?refresh=true" : "";
  return fetchApi<GraphData>(`/graph/data${params}`);
}

export async function sendGraphChat(input: ChatInput): Promise<GraphChatResponse> {
  return fetchApi<GraphChatResponse>("/graph/chat", {
    method: "POST",
    body: input,
  });
}

// ─── Chat history ─────────────────────────────────────────

export interface ChatHistoryItem {
  id: string;
  sessionId?: string;
  query: string;
  answer: string;
  intent: string;
  confidence: "high" | "medium" | "low";
  highlightNodes: string[];
  entitiesInvolved: string[];
  createdAt: string;
}

export interface ChatHistoryPage {
  items: ChatHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function fetchChatHistory(page = 1, limit = 30): Promise<ChatHistoryPage> {
  return fetchApi<ChatHistoryPage>(`/graph/chat/history?page=${page}&limit=${limit}`);
}

export async function clearChatHistory(): Promise<{ deleted: number }> {
  return fetchApi<{ deleted: number }>("/graph/chat/history", { method: "DELETE" });
}

// ─── Chat sessions ────────────────────────────────────────

export interface ChatSession {
  sessionId: string;
  messageCount: number;
  firstQuery: string;
  lastActivity: string;
  startedAt: string;
}

export interface SessionMessage {
  id: string;
  query: string;
  answer: string;
  intent: string;
  confidence: "high" | "medium" | "low";
  highlightNodes: string[];
  entitiesInvolved: string[];
  createdAt: string;
}

export async function fetchSessions(): Promise<{ sessions: ChatSession[] }> {
  return fetchApi<{ sessions: ChatSession[] }>("/graph/chat/sessions");
}

export async function fetchSessionMessages(
  sessionId: string
): Promise<{ sessionId: string; messages: SessionMessage[] }> {
  return fetchApi<{ sessionId: string; messages: SessionMessage[] }>(
    `/graph/chat/session/${encodeURIComponent(sessionId)}`
  );
}
