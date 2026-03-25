import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minimize2, Maximize2, Eye, EyeOff, RefreshCw, GitBranch, AlertCircle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchGraphData, type NodeType } from "@/lib/graphApi";
import { GraphCanvas, type GraphCanvasHandle, NODE_COLORS } from "@/components/graph/GraphCanvas";
import { GraphChat } from "@/components/graph/GraphChat";
import { AppLayout } from "@/components/layout/AppLayout";

// ─── Node type display names ──────────────────────────────

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  order: "Orders",
  order_item: "Order Items",
  delivery: "Deliveries",
  invoice: "Invoices",
  payment: "Payments",
  customer: "Customers",
  product: "Products",
  journal_entry: "Journal Entries",
};

const ALL_TYPES = Object.keys(NODE_TYPE_LABELS) as NodeType[];

// ─── Page ────────────────────────────────────────────────

export default function Mapping() {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [showGranular, setShowGranular] = useState(true);
  const [highlightNodes, setHighlightNodes] = useState<string[]>([]);
  const [enabledTypes, setEnabledTypes] = useState<Set<NodeType>>(
    new Set(ALL_TYPES)
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();

  const canvasRef = useRef<GraphCanvasHandle>(null);

  // Fetch graph data
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["graphData", refreshKey],
    queryFn: () => fetchGraphData(refreshKey > 0),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: false,
  });

  const handleHighlight = useCallback(
    (nodeIds: string[]) => {
      setHighlightNodes(nodeIds);
      if (nodeIds.length > 0) {
        canvasRef.current?.focusNodes(nodeIds);
      }
    },
    []
  );

  const toggleType = useCallback((type: NodeType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  return (
    <AppLayout>
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-background overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <GitBranch className="h-4 w-4" />
          <span>Mapping</span>
          <span>/</span>
          <span className="text-foreground font-semibold">Order to Cash</span>
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {data.totalNodes} nodes · {data.totalEdges} edges
            </span>
          )}
          <button
            onClick={() => { setRefreshKey((k) => k + 1); refetch(); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Graph area ───────────────────────────────── */}
        <div className="flex-1 relative flex flex-col overflow-hidden">
          {/* Graph controls overlay */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsChatOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium bg-card border border-border rounded-lg px-3 py-1.5 shadow-sm hover:bg-accent transition-colors"
            >
              {isChatOpen ? (
                <><Minimize2 className="h-3.5 w-3.5" /> Minimize</>
              ) : (
                <><Maximize2 className="h-3.5 w-3.5" /> Expand</>
              )}
            </button>

            <button
              onClick={() => setShowGranular((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium bg-card border border-border rounded-lg px-3 py-1.5 shadow-sm hover:bg-accent transition-colors"
            >
              {showGranular ? (
                <><EyeOff className="h-3.5 w-3.5" /> Hide Granular Overlay</>
              ) : (
                <><Eye className="h-3.5 w-3.5" /> Show Granular Overlay</>
              )}
            </button>
          </div>

          {/* Entity type filters */}
          <div className="absolute bottom-4 left-3 z-10 flex flex-wrap gap-1.5 max-w-sm">
            {ALL_TYPES.filter((t) => {
              if (!data) return false;
              return (data.stats[t] ?? 0) > 0;
            }).map((type) => {
              const active = enabledTypes.has(type);
              const color = NODE_COLORS[type];
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 border transition-all ${
                    active
                      ? "border-transparent text-white"
                      : "border-border text-muted-foreground bg-card/80 opacity-60"
                  }`}
                  style={active ? { background: color } : {}}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                    style={{ background: active ? "white" : color }}
                  />
                  {NODE_TYPE_LABELS[type]}
                  {data?.stats[type] !== undefined && (
                    <span className={active ? "opacity-70" : ""}>
                      ({data.stats[type]})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Loading / error state */}
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm text-muted-foreground">Building O2C graph…</p>
            </div>
          )}
          {isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Could not load graph data. Make sure the server is running and
                SAP_DATA_PATH is configured.
              </p>
              <button
                onClick={() => refetch()}
                className="text-xs text-primary underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Canvas */}
          <GraphCanvas
            ref={canvasRef}
            data={data ?? null}
            highlightNodes={highlightNodes}
            showGranular={showGranular}
            enabledTypes={enabledTypes}
          />
        </div>

        {/* ── Chat panel ─────────────────────────────── */}
        {isChatOpen && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden">
            <GraphChat onHighlight={handleHighlight} />
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  );
}
