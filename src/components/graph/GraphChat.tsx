import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Trash2, RotateCcw, Plus, MessageSquare, RefreshCw } from "lucide-react";
import {
  sendGraphChat,
  fetchSessions,
  fetchSessionMessages,
  clearChatHistory,
  type GraphChatResponse,
  type ChatSession,
  type ChatInput,
} from "@/lib/graphApi";

// ─── Types ───────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  data?: Record<string, unknown>[];
  highlightNodes?: string[];
  confidence?: "high" | "medium" | "low";
  timestamp: Date;
}

interface Props {
  onHighlight: (nodeIds: string[]) => void;
}

// ─── Suggested queries ────────────────────────────────────

const SUGGESTED_QUERIES = [
  "Trace invoice 91150187",
  "Which products have the most billing documents?",
  "Orders delivered but not billed",
  "Top 5 customers by total invoice amount",
];

// ─── Session helpers ──────────────────────────────────────

const SESSION_STORAGE_KEY = "graph-chat-session-id";

function createFreshSessionId(): string {
  const id = crypto.randomUUID();
  sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

const WELCOME_MSG: ChatMessage = {
  id: "welcome",
  role: "agent",
  text: "Hi! Ask anything about your **Order-to-Cash** data.\n\nI can trace documents, find broken flows, or run analytics across your SAP pipeline.",
  timestamp: new Date(),
};

// ─── Component ────────────────────────────────────────────

export function GraphChat({ onHighlight }: Props) {
  const [tab, setTab] = useState<"chat" | "history">("chat");
  const [sessionId, setSessionId] = useState(createFreshSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MSG]);
  const [input, setInput] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Load current session messages from server on mount / session switch
  const { data: sessionData, isError: sessionLoadError, refetch: refetchSession } = useQuery({
    queryKey: ["graph-chat-session", sessionId],
    queryFn: () => fetchSessionMessages(sessionId),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
    enabled: !!sessionId,
  });

  // Hydrate messages from session data (once per session load)
  useEffect(() => {
    if (!sessionData?.messages?.length) {
      setSessionLoaded(true);
      return;
    }
    const restored: ChatMessage[] = [WELCOME_MSG];
    let lastHighlightNodes: string[] = [];
    for (const m of sessionData.messages) {
      restored.push({
        id: m.id + "-q",
        role: "user",
        text: m.query,
        timestamp: new Date(m.createdAt),
      });
      const hlNodes = Array.isArray(m.highlightNodes) ? m.highlightNodes as string[] : [];
      restored.push({
        id: m.id + "-a",
        role: "agent",
        text: m.answer,
        data: undefined,
        highlightNodes: hlNodes,
        confidence: m.confidence,
        timestamp: new Date(m.createdAt),
      });
      if (hlNodes.length > 0) lastHighlightNodes = hlNodes;
    }
    setMessages(restored);
    setSessionLoaded(true);
    // Restore last highlight state from loaded session
    if (lastHighlightNodes.length > 0) onHighlight(lastHighlightNodes);
  }, [sessionData, onHighlight]);

  // Build conversation context from current messages (last 6 turns)
  const buildContext = useCallback((): ChatInput["context"] => {
    const turns = messages
      .filter((m) => m.id !== "welcome")
      .slice(-6)
      .map((m) => ({
        role: m.role as "user" | "agent",
        content: m.text.slice(0, 300),
      }));
    return turns.length > 0 ? turns : undefined;
  }, [messages]);

  const mutation = useMutation({
    mutationFn: sendGraphChat,
    onSuccess: (result: GraphChatResponse) => {
      // If backend assigned a sessionId, update ours
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId);
        sessionStorage.setItem(SESSION_STORAGE_KEY, result.sessionId);
      }
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        text: result.answer,
        data: result.data?.slice(0, 10),
        highlightNodes: result.highlight_nodes,
        confidence: result.confidence,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      if (result.highlight_nodes?.length > 0) onHighlight(result.highlight_nodes);
      // Refresh sessions & current session in background
      qc.invalidateQueries({ queryKey: ["graph-chat-sessions"] });
      qc.invalidateQueries({ queryKey: ["graph-chat-session", sessionId] });
    },
    onError: (error: unknown) => {
      const errMsg =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: string }).message)
          : "Something went wrong. Please check your connection and try again.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: `⚠️ ${errMsg}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  const clearMutation = useMutation({
    mutationFn: clearChatHistory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["graph-chat-sessions"] });
      qc.invalidateQueries({ queryKey: ["graph-chat-session"] });
      // Reset to fresh state
      handleNewChat();
    },
  });

  const handleSubmit = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q || mutation.isPending) return;
      setTab("chat");
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: q, timestamp: new Date() },
      ]);
      setInput("");
      mutation.mutate({ query: q, sessionId, context: buildContext() });
    },
    [mutation, sessionId, buildContext]
  );

  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, newId);
    setSessionId(newId);
    setMessages([WELCOME_MSG]);
    setInput("");
    setTab("chat");
    setSessionLoaded(true);
    onHighlight([]);
  }, [onHighlight]);

  const handleSwitchSession = useCallback(
    (sid: string) => {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
      setSessionId(sid);
      setMessages([WELCOME_MSG]);
      setSessionLoaded(false);
      setTab("chat");
    },
    []
  );

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-focus input on mount and after new chat
  useEffect(() => {
    if (sessionLoaded) inputRef.current?.focus();
  }, [sessionLoaded, sessionId]);

  // External suggest-query events (from graph canvas)
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (q) handleSubmit(q);
    };
    window.addEventListener("graph-suggest-query", handler);
    return () => window.removeEventListener("graph-suggest-query", handler);
  }, [handleSubmit]);

  // Sidebar session events (new chat + switch session)
  useEffect(() => {
    const onNewChat = () => handleNewChat();
    const onSwitch = (e: Event) => {
      const sid = (e as CustomEvent<string>).detail;
      if (sid) handleSwitchSession(sid);
    };
    window.addEventListener("sidebar-new-chat", onNewChat);
    window.addEventListener("sidebar-switch-session", onSwitch);
    return () => {
      window.removeEventListener("sidebar-new-chat", onNewChat);
      window.removeEventListener("sidebar-switch-session", onSwitch);
    };
  }, [handleNewChat, handleSwitchSession]);

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-0 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-background">F</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-none">FlowMind AI</p>
              <p className="text-xs text-muted-foreground mt-0.5">O2C Intelligence · Order to Cash</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary border border-border rounded-md px-1.5 py-0.5 transition-colors"
              title="Start a new chat session"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">
                {mutation.isPending ? "Thinking…" : "Online"}
              </span>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 -mb-px">
          {(["chat", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "history" && <History className="h-3 w-3" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat tab ───────────────────────────────────── */}
      {tab === "chat" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
            {!sessionLoaded && !sessionLoadError && (
              <p className="text-xs text-muted-foreground text-center py-4 animate-pulse">
                Loading conversation…
              </p>
            )}
            {sessionLoadError && (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-destructive">Failed to load conversation.</p>
                <button
                  onClick={() => refetchSession()}
                  className="text-xs text-primary hover:underline flex items-center gap-1 mx-auto"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}
            {sessionLoaded && messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}

            {mutation.isPending && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
                </div>
                Analyzing…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {sessionLoaded && messages.length === 1 && (
            <div className="px-4 pb-2 space-y-1.5 shrink-0">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSubmit(q)}
                  className="w-full text-left text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:border-primary/40 hover:text-foreground hover:bg-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-1 shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmit(input); }}
              className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Analyze your data..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                disabled={mutation.isPending}
              />
              <button
                type="submit"
                disabled={!input.trim() || mutation.isPending}
                className="h-6 w-12 rounded-lg bg-foreground text-background text-xs font-medium disabled:opacity-40 transition-opacity"
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── History tab ────────────────────────────────── */}
      {tab === "history" && (
        <SessionsPanel
          activeSessionId={sessionId}
          onSwitchSession={handleSwitchSession}
          onNewChat={handleNewChat}
          onClearAll={() => clearMutation.mutate()}
        />
      )}
    </div>
  );
}

// ─── Sessions Panel ───────────────────────────────────────

function SessionsPanel({
  activeSessionId,
  onSwitchSession,
  onNewChat,
  onClearAll,
}: {
  activeSessionId: string;
  onSwitchSession: (sid: string) => void;
  onNewChat: () => void;
  onClearAll: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["graph-chat-sessions"],
    queryFn: fetchSessions,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
  });

  const sessions: ChatSession[] = data?.sessions ?? [];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewChat}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Chat
          </button>
          {sessions.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Delete ALL chat sessions? This cannot be undone.")) onClearAll();
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {isLoading && (
          <p className="text-xs text-muted-foreground text-center py-8 animate-pulse">
            Loading sessions…
          </p>
        )}
        {isError && (
          <p className="text-xs text-destructive text-center py-8">
            Could not load sessions.
          </p>
        )}
        {!isLoading && !isError && sessions.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-xs text-muted-foreground">
              No chat history yet.
            </p>
            <button
              onClick={onNewChat}
              className="text-xs text-primary hover:underline"
            >
              Start a conversation
            </button>
          </div>
        )}
        {sessions.map((s) => (
          <SessionCard
            key={s.sessionId}
            session={s}
            isActive={s.sessionId === activeSessionId}
            onClick={() => onSwitchSession(s.sessionId)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  isActive,
  onClick,
}: {
  session: ChatSession;
  isActive: boolean;
  onClick: () => void;
}) {
  const date = new Date(session.lastActivity);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 space-y-1 transition-colors ${
        isActive
          ? "border-primary/50 bg-primary/5"
          : "border-border bg-card hover:border-primary/30 hover:bg-accent/50"
      }`}
    >
      <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
        {session.firstQuery || "New conversation"}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {session.messageCount} message{session.messageCount !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] text-muted-foreground">{timeStr}</span>
      </div>
      {isActive && (
        <span className="inline-block text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">
          Active
        </span>
      )}
    </button>
  );
}

// ─── Chat Bubble ─────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm">
          {message.text}
        </div>
      </div>
    );
  }

  const lines = message.text.split("\n").filter(Boolean);

  return (
    <div className="flex items-start gap-2">
      <div className="h-7 w-7 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-bold text-background">D</span>
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm text-foreground leading-relaxed">
          {lines.map((line, i) => (
            <p key={i} className={line.startsWith("**") ? "" : ""}>
              <MarkdownLine text={line} />
            </p>
          ))}
        </div>

        {/* Inline data table (max 5 cols × 8 rows) */}
        {message.data && message.data.length > 0 && (
          <DataPreview rows={message.data} />
        )}

        {/* Highlight summary */}
        {message.highlightNodes && message.highlightNodes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            ✦ {message.highlightNodes.length} related document{message.highlightNodes.length !== 1 ? "s" : ""} highlighted on the graph
          </p>
        )}

        <p className="text-[10px] text-muted-foreground/60">
          {message.timestamp.toLocaleTimeString()}
          {message.confidence && (
            <span
              className={`ml-2 px-1 rounded ${
                message.confidence === "high"
                  ? "text-green-500"
                  : message.confidence === "medium"
                  ? "text-yellow-500"
                  : "text-red-400"
              }`}
            >
              {message.confidence}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function MarkdownLine({ text }: { text: string }) {
  // Lightweight bold + italic parser: **text** and _text_
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith("_") && p.endsWith("_") ? (
          <em key={i} className="text-muted-foreground">{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/** Convert snake_case / camelCase column names to friendly labels */
function humanizeColumn(col: string): string {
  const labels: Record<string, string> = {
    material: "Product",
    billing_document_count: "Billing Documents",
    billing_count: "Billing Documents",
    billingDocument: "Billing Document",
    salesOrder: "Sales Order",
    deliveryDocument: "Delivery",
    businessPartner: "Customer",
    soldToParty: "Customer",
    accountingDocument: "Journal Entry",
    total: "Total Amount",
    totalNetAmount: "Net Amount",
    total_net_amount: "Net Amount",
    invoice_count: "Invoices",
    order_count: "Orders",
    delivery_count: "Deliveries",
    payment_count: "Payments",
    qty: "Quantity",
    quantity: "Quantity",
    orderQuantity: "Order Qty",
    netAmount: "Net Amount",
    grossAmount: "Gross Amount",
    creationDate: "Created",
    billingDate: "Billing Date",
    deliveryDate: "Delivery Date",
    documentDate: "Document Date",
    customerName: "Customer Name",
    productDescription: "Description",
    materialDescription: "Description",
    overallStatus: "Status",
    deliveryStatus: "Delivery Status",
    billingStatus: "Billing Status",
    salesOrganization: "Sales Org",
    plant: "Plant",
  };
  if (labels[col]) return labels[col];
  return col
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const num = Number(val);
  if (!isNaN(num) && typeof val === "number") {
    if (Number.isInteger(num)) return num.toLocaleString();
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(val).slice(0, 40);
}

function DataPreview({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0]).slice(0, 5);
  const displayRows = rows.slice(0, 10);

  return (
    <div className="overflow-x-auto rounded-lg border border-border mt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            {cols.map((c) => (
              <th
                key={c}
                className="px-2 py-1.5 text-left font-semibold text-muted-foreground truncate max-w-[120px]"
              >
                {humanizeColumn(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr
              key={i}
              className={`border-t border-border ${i === 0 ? "bg-primary/5 font-medium" : ""}`}
            >
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-2 py-1.5 text-foreground truncate max-w-[120px]"
                >
                  {formatCellValue(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 10 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground/60 border-t border-border bg-muted/30">
          Showing 10 of {rows.length} results
        </div>
      )}
    </div>
  );
}
