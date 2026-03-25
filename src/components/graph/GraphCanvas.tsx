import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { GraphData, GraphNode, NodeType } from "@/lib/graphApi";

// ─── Constants ───────────────────────────────────────────

export const NODE_COLORS: Record<NodeType, string> = {
  order: "#3b82f6",
  order_item: "#93c5fd",
  delivery: "#22c55e",
  invoice: "#f59e0b",
  payment: "#a855f7",
  customer: "#ec4899",
  product: "#14b8a6",
  journal_entry: "#ef4444",
};

const NODE_RADIUS: Record<NodeType, number> = {
  order: 9,
  order_item: 4,
  delivery: 7,
  invoice: 8,
  payment: 6,
  customer: 11,
  product: 5,
  journal_entry: 6,
};

// ─── Force simulation types ───────────────────────────────

interface SimNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

// ─── Physics ──────────────────────────────────────────────

function runSimStep(
  simNodes: SimNode[],
  simEdges: { source: string; target: string }[],
  alpha: number
): void {
  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

  // Repulsion between nodes
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.max(1, Math.sqrt(distSq));
      if (dist > 300) continue;
      const k2 = 3500;
      const force = k2 / distSq;
      const fx = (dx / dist) * force * alpha;
      const fy = (dy / dist) * force * alpha;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Spring attraction along edges
  for (const e of simEdges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const target = 110;
    const stretch = (dist - target) * 0.07 * alpha;
    const fx = (dx / dist) * stretch;
    const fy = (dy / dist) * stretch;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Entity-type clustering: pull each node toward its group centroid (O(n))
  const typeCentroid = new Map<NodeType, { sx: number; sy: number; count: number }>();
  for (const n of simNodes) {
    const c = typeCentroid.get(n.type) ?? { sx: 0, sy: 0, count: 0 };
    c.sx += n.x; c.sy += n.y; c.count++;
    typeCentroid.set(n.type, c);
  }
  for (const n of simNodes) {
    const c = typeCentroid.get(n.type);
    if (!c || c.count < 2) continue;
    const cx = c.sx / c.count;
    const cy = c.sy / c.count;
    const dx = cx - n.x;
    const dy = cy - n.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    n.vx += (dx / dist) * Math.min(dist, 60) * 0.018 * alpha;
    n.vy += (dy / dist) * Math.min(dist, 60) * 0.018 * alpha;
  }

  // Center gravitational pull
  for (const n of simNodes) {
    n.vx += (0 - n.x) * 0.02 * alpha;
    n.vy += (0 - n.y) * 0.02 * alpha;
  }

  // Integrate
  for (const n of simNodes) {
    if (n.fx !== undefined) {
      n.x = n.fx;
      n.y = n.fy!;
    } else {
      n.vx *= 0.74;
      n.vy *= 0.74;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

// ─── Props ────────────────────────────────────────────────

interface Props {
  data: GraphData | null;
  highlightNodes: string[];
  showGranular: boolean;
  enabledTypes: Set<NodeType>;
}

export interface GraphCanvasHandle {
  focusNodes(ids: string[]): void;
}

// ─── Component ────────────────────────────────────────────

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(
  { data, highlightNodes, showGranular, enabledTypes },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Simulation state (refs to avoid re-render on every tick)
  const simNodesRef = useRef<SimNode[]>([]);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const alphaRef = useRef(0);
  const rafRef = useRef<number>(0);

  // View transform
  const transformRef = useRef({ x: 0, y: 0, scale: 0.85 });

  // Drag state
  const dragRef = useRef<{
    type: "pan" | "node";
    nodeId?: string;
    startScreenX: number;
    startScreenY: number;
    startTransX: number;
    startTransY: number;
    startNodeX: number;
    startNodeY: number;
  } | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [tooltipScreen, setTooltipScreen] = useState({ x: 0, y: 0 });
  const [connectionCount, setConnectionCount] = useState(0);
  const [selectedNeighborIds, setSelectedNeighborIds] = useState<Set<string>>(new Set());

  // Mutable render-state ref — draw reads from this, giving draw() stable identity
  // ([] deps). This prevents the physics simulation from restarting every time
  // selectedNode, highlightNodes, or filters change (critical performance fix).
  const renderStateRef = useRef<{
    data: GraphData | null;
    highlightNodes: string[];
    showGranular: boolean;
    enabledTypes: Set<NodeType>;
    selectedNode: GraphNode | null;
    selectedNeighborIds: Set<string>;
  }>({ data, highlightNodes, showGranular, enabledTypes, selectedNode, selectedNeighborIds: new Set() });

  // O(1) node lookup — rebuilt whenever data changes
  const nodeByIdRef = useRef<Map<string, GraphNode>>(new Map());

  // Build edge connection count map
  const connectionMap = useRef<Map<string, number>>(new Map());

  // ── Canvas draw ────────────────────────────────────────
  // Reads all render state from renderStateRef.current — stable identity ([] deps)
  // so UI changes (node click, highlight, filter) never restart the simulation.
  const draw = useCallback(() => {
    const { data, highlightNodes, showGranular, enabledTypes, selectedNode, selectedNeighborIds } =
      renderStateRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas || !data) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const { x: tx, y: ty, scale } = transformRef.current;
    ctx.save();
    ctx.translate(tx + width / 2, ty + height / 2);
    ctx.scale(scale, scale);

    const visibleTypes = enabledTypes;
    const granularHidden = !showGranular;

    // Build position map and O(1) lookups for this frame
    const posMap = new Map<string, { x: number; y: number }>();
    for (const sn of simNodesRef.current) {
      posMap.set(sn.id, { x: sn.x, y: sn.y });
    }
    const nodeById = nodeByIdRef.current;
    const highlightSet = new Set(highlightNodes);
    const hasActiveHighlight = highlightSet.size > 0;

    // Draw edges — two passes when highlighting: dimmed first, highlighted on top
    for (const edge of data.edges) {
      const srcNode = nodeById.get(edge.source);
      const tgtNode = nodeById.get(edge.target);
      if (!srcNode || !tgtNode) continue;
      if (!visibleTypes.has(srcNode.type) || !visibleTypes.has(tgtNode.type)) continue;
      if (granularHidden && (srcNode.type === "order_item" || tgtNode.type === "order_item")) continue;

      const sp = posMap.get(edge.source);
      const tp = posMap.get(edge.target);
      if (!sp || !tp) continue;

      const isEdgeHighlighted =
        highlightSet.has(edge.source) && highlightSet.has(edge.target);
      const isNeighborEdge =
        !isEdgeHighlighted &&
        selectedNode != null &&
        (edge.source === selectedNode.id || edge.target === selectedNode.id);

      // Skip highlighted edges in first pass — draw them on top later
      if (isEdgeHighlighted) continue;

      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.strokeStyle = isNeighborEdge
        ? "rgba(148, 163, 184, 0.55)"
        : hasActiveHighlight
        ? "rgba(147, 197, 253, 0.06)"
        : "rgba(147, 197, 253, 0.22)";
      ctx.lineWidth = isNeighborEdge ? 1.8 / scale : 1.0 / scale;
      ctx.stroke();
    }

    // Second pass: draw highlighted edges on top with prominence
    if (hasActiveHighlight) {
      for (const edge of data.edges) {
        const srcNode = nodeById.get(edge.source);
        const tgtNode = nodeById.get(edge.target);
        if (!srcNode || !tgtNode) continue;
        if (!visibleTypes.has(srcNode.type) || !visibleTypes.has(tgtNode.type)) continue;

        if (!(highlightSet.has(edge.source) && highlightSet.has(edge.target))) continue;

        const sp = posMap.get(edge.source);
        const tp = posMap.get(edge.target);
        if (!sp || !tp) continue;

        // Glow under the edge
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
        ctx.lineWidth = 6 / scale;
        ctx.stroke();

        // Main edge line
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
        ctx.lineWidth = 2.5 / scale;
        ctx.stroke();

        // Arrow tip
        const tgtR = NODE_RADIUS[tgtNode.type] / scale;
        const angle = Math.atan2(tp.y - sp.y, tp.x - sp.x);
        const arrowX = tp.x - tgtR * Math.cos(angle);
        const arrowY = tp.y - tgtR * Math.sin(angle);
        const ar = 9 / scale;
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
          arrowX - ar * Math.cos(angle - Math.PI / 6),
          arrowY - ar * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          arrowX - ar * Math.cos(angle + Math.PI / 6),
          arrowY - ar * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
        ctx.fill();

        // Edge label
        const mx = (sp.x + tp.x) / 2;
        const my = (sp.y + tp.y) / 2;
        const fontSize = Math.min(10, Math.max(6, 8 / scale));
        ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
        ctx.fillText(edge.label, mx, my - 4 / scale);
      }
    }

    // Draw nodes
    for (const node of data.nodes) {
      if (!visibleTypes.has(node.type)) continue;
      if (granularHidden && node.type === "order_item") continue;

      const pos = posMap.get(node.id);
      if (!pos) continue;

      const baseR = NODE_RADIUS[node.type];
      const r = baseR / scale;
      const color = NODE_COLORS[node.type];
      const isHighlighted = highlightSet.has(node.id);
      const isNeighbor = !isHighlighted && selectedNeighborIds.has(node.id);
      const isSelected = selectedNode?.id === node.id;

      // Dim non-highlighted nodes when a highlight set is active
      const isDimmed = hasActiveHighlight && !isHighlighted && !isSelected;

      // Outer glow / halo for special nodes
      if (isHighlighted) {
        // Animated-looking glow ring
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, (baseR + 10) / scale, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, (baseR + 5) / scale, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(251, 191, 36, 0.22)";
        ctx.fill();
      } else if (isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, (baseR + 5) / scale, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fill();
      } else if (isNeighbor) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, (baseR + 5) / scale, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(148, 163, 184, 0.15)";
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
      ctx.globalAlpha = isDimmed ? 0.15 : 1;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border ring
      if (isSelected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5 / scale;
        ctx.stroke();
      } else if (isHighlighted) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2.5 / scale;
        ctx.stroke();
      } else if (isNeighbor) {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.7)";
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();
      }

      // Label on highlighted nodes so the flow is readable
      if (isHighlighted && scale > 0.25) {
        const label = node.label.length > 24
          ? node.label.slice(0, 22) + "…"
          : node.label;
        const fontSize = Math.min(11, Math.max(7, 9 / scale));
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        // Background pill for readability
        const textW = ctx.measureText(label).width;
        const pillH = fontSize + 4 / scale;
        const pillY = pos.y - (baseR + 14) / scale;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.beginPath();
        const pillR = 3 / scale;
        const pillX = pos.x - textW / 2 - 4 / scale;
        const pw = textW + 8 / scale;
        ctx.roundRect(pillX, pillY - pillH / 2, pw, pillH, pillR);
        ctx.fill();
        // Label text
        ctx.fillStyle = "#fbbf24";
        ctx.fillText(label, pos.x, pillY + fontSize * 0.35);
      }

      // Label on selected node for quick identification
      if (isSelected && !isHighlighted && scale > 0.25) {
        const label = node.label.length > 24
          ? node.label.slice(0, 22) + "…"
          : node.label;
        const fontSize = Math.min(11, Math.max(7, 9 / scale));
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        const textW = ctx.measureText(label).width;
        const pillH = fontSize + 4 / scale;
        const pillY = pos.y - (baseR + 14) / scale;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.beginPath();
        const pillR = 3 / scale;
        const pillX = pos.x - textW / 2 - 4 / scale;
        const pw = textW + 8 / scale;
        ctx.roundRect(pillX, pillY - pillH / 2, pw, pillH, pillR);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, pos.x, pillY + fontSize * 0.35);
      }
    }

    // Draw entity cluster labels at group centroids (visible at moderate zoom)
    if (scale > 0.35) {
      const centroids = new Map<NodeType, { sx: number; sy: number; count: number }>();
      for (const node of data.nodes) {
        if (!visibleTypes.has(node.type)) continue;
        if (granularHidden && node.type === "order_item") continue;
        const p = posMap.get(node.id);
        if (!p) continue;
        const c = centroids.get(node.type) ?? { sx: 0, sy: 0, count: 0 };
        c.sx += p.x; c.sy += p.y; c.count++;
        centroids.set(node.type, c);
      }
      const CLUSTER_LABEL: Partial<Record<NodeType, string>> = {
        customer: "Customers", order: "Orders", delivery: "Deliveries",
        invoice: "Invoices", payment: "Payments", product: "Products",
        journal_entry: "Journal Entries",
      };
      for (const [type, c] of centroids) {
        if (c.count < 2) continue;
        const label = CLUSTER_LABEL[type];
        if (!label) continue;
        const cx = c.sx / c.count;
        const cy = c.sy / c.count - 30 / scale;
        const fontSize = Math.min(13, Math.max(8, 11 / scale));
        ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = `${NODE_COLORS[type]}60`;
        ctx.fillText(label, cx, cy);
      }
    }

    ctx.restore();
  }, []); // Stable identity — no closure deps, reads exclusively from renderStateRef

  // ── Animation loop ────────────────────────────────────
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    // Build O(1) lookup maps
    nodeByIdRef.current = new Map(data.nodes.map((n) => [n.id, n]));
    const cm = new Map<string, number>();
    for (const e of data.edges) {
      cm.set(e.source, (cm.get(e.source) ?? 0) + 1);
      cm.set(e.target, (cm.get(e.target) ?? 0) + 1);
    }
    connectionMap.current = cm;

    // Init sim nodes spread by entity type for better initial clustering
    const typeOrder: NodeType[] = ["customer", "order", "delivery", "invoice", "payment", "journal_entry", "product", "order_item"];
    const spread = Math.min(data.nodes.length * 4, 480);
    simNodesRef.current = data.nodes.map((n) => {
      const typeFraction = Math.max(0, typeOrder.indexOf(n.type)) / typeOrder.length;
      const angle = typeFraction * 2 * Math.PI + (Math.random() - 0.5) * 0.6;
      return {
        id: n.id,
        type: n.type,
        x: spread * Math.cos(angle) + (Math.random() - 0.5) * 60,
        y: spread * Math.sin(angle) + (Math.random() - 0.5) * 60,
        vx: 0,
        vy: 0,
      };
    });
    simNodeMapRef.current = new Map(simNodesRef.current.map(n => [n.id, n]));

    const simEdges = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    alphaRef.current = 1.0;

    let framesSinceLastDraw = 0;

    function tick() {
      const alpha = alphaRef.current;
      if (alpha <= 0.005) {
        draw();
        return;
      }
      runSimStep(simNodesRef.current, simEdges, alpha);
      alphaRef.current *= 0.988;

      framesSinceLastDraw++;
      if (framesSinceLastDraw >= 2) {
        draw();
        framesSinceLastDraw = 0;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [data, draw]);

  // Keep renderStateRef in sync and trigger a manual redraw when the simulation
  // has settled. useLayoutEffect runs synchronously before paint so renderStateRef
  // is always fresh when draw() reads it.
  useLayoutEffect(() => {
    renderStateRef.current = { data, highlightNodes, showGranular, enabledTypes, selectedNode, selectedNeighborIds };
    if (alphaRef.current <= 0.005) draw();
  }, [data, highlightNodes, showGranular, enabledTypes, selectedNode, selectedNeighborIds, draw]);

  // ── Canvas resize ─────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  // ── Hit test (world coords) ───────────────────────────
  const hitTest = useCallback(
    (screenX: number, screenY: number): GraphNode | null => {
      if (!canvasRef.current || !data) return null;
      const { width, height } = canvasRef.current;
      const { x: tx, y: ty, scale } = transformRef.current;
      const wx = (screenX - tx - width / 2) / scale;
      const wy = (screenY - ty - height / 2) / scale;

      let closest: GraphNode | null = null;
      let minDist = Infinity;

      for (const node of data.nodes) {
        const sn = simNodeMapRef.current.get(node.id);
        if (!sn) continue;
        const dx = sn.x - wx;
        const dy = sn.y - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitRadius = NODE_RADIUS[node.type] * 1.6;
        if (dist < hitRadius && dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }
      return closest;
    },
    [data]
  );

  // ── Mouse events ─────────────────────────────────────
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const hit = hitTest(sx, sy);
      if (hit) {
        // Node drag
        const sn = simNodeMapRef.current.get(hit.id);
        if (sn) {
          dragRef.current = {
            type: "node",
            nodeId: hit.id,
            startScreenX: sx,
            startScreenY: sy,
            startTransX: 0,
            startTransY: 0,
            startNodeX: sn.x,
            startNodeY: sn.y,
          };
          sn.fx = sn.x;
          sn.fy = sn.y;
        }
      } else {
        // Pan
        dragRef.current = {
          type: "pan",
          startScreenX: sx,
          startScreenY: sy,
          startTransX: transformRef.current.x,
          startTransY: transformRef.current.y,
          startNodeX: 0,
          startNodeY: 0,
        };
      }
    },
    [hitTest]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (dragRef.current.type === "pan") {
        transformRef.current.x =
          dragRef.current.startTransX + (sx - dragRef.current.startScreenX);
        transformRef.current.y =
          dragRef.current.startTransY + (sy - dragRef.current.startScreenY);
        // Move tooltip with canvas pan if a node is selected
        const { selectedNode } = renderStateRef.current;
        if (selectedNode) {
          const panSn = simNodeMapRef.current.get(selectedNode.id);
          if (panSn) {
            const canvas = canvasRef.current!;
            const { x: tx, y: ty, scale } = transformRef.current;
            setTooltipScreen({
              x: panSn.x * scale + tx + canvas.width / 2,
              y: panSn.y * scale + ty + canvas.height / 2,
            });
          }
        }
      } else if (dragRef.current.type === "node" && dragRef.current.nodeId) {
        const sn = simNodeMapRef.current.get(dragRef.current.nodeId);
        if (sn) {
          const { scale } = transformRef.current;
          sn.fx =
            dragRef.current.startNodeX +
            (sx - dragRef.current.startScreenX) / scale;
          sn.fy =
            dragRef.current.startNodeY +
            (sy - dragRef.current.startScreenY) / scale;
          sn.x = sn.fx;
          sn.y = sn.fy;
          // Move tooltip with dragged node if it's the selected node
          const { selectedNode } = renderStateRef.current;
          if (selectedNode && dragRef.current.nodeId === selectedNode.id) {
            const canvas = canvasRef.current!;
            const { x: tx, y: ty } = transformRef.current;
            setTooltipScreen({
              x: sn.x * scale + tx + canvas.width / 2,
              y: sn.y * scale + ty + canvas.height / 2,
            });
          }
        }
        // Reheat slightly so connected nodes adjust
        if (alphaRef.current < 0.1) alphaRef.current = 0.1;
      }
      draw();
    },
    [draw]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const didMove =
        Math.abs(e.clientX - rect.left - dragRef.current.startScreenX) > 4 ||
        Math.abs(e.clientY - rect.top - dragRef.current.startScreenY) > 4;

      if (dragRef.current.type === "node" && dragRef.current.nodeId) {
        const sn = simNodeMapRef.current.get(dragRef.current.nodeId);
        if (sn && !didMove) {
          // Click (not drag): release pin so node rejoins the simulation
          delete sn.fx;
          delete sn.fy;
        }
        // Dragged: keep pinned — user placed it intentionally
      }

      if (!didMove && dragRef.current.type === "node" && dragRef.current.nodeId) {
        const nodeId = dragRef.current.nodeId;
        const { data } = renderStateRef.current;
        if (data) {
          const node = nodeByIdRef.current.get(nodeId) ?? null;
          if (node) {
            const isDeselect = renderStateRef.current.selectedNode?.id === nodeId;
            setSelectedNode(isDeselect ? null : node);
            setTooltipScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            setConnectionCount(connectionMap.current.get(nodeId) ?? 0);
            if (isDeselect) {
              setSelectedNeighborIds(new Set());
            } else {
              // Highlight immediate neighbors for context
              const nids = new Set<string>();
              for (const edge of data.edges) {
                if (edge.source === nodeId) nids.add(edge.target);
                if (edge.target === nodeId) nids.add(edge.source);
              }
              setSelectedNeighborIds(nids);
            }
          }
        }
      } else if (!didMove && dragRef.current.type === "pan") {
        setSelectedNode(null);
        setSelectedNeighborIds(new Set());
      }

      dragRef.current = null;
    },
    []
  );

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { width, height } = canvasRef.current!;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const { x: tx, y: ty, scale } = transformRef.current;
    const newScale = Math.min(4, Math.max(0.15, scale * factor));
    // Zoom towards cursor
    const cx = tx + width / 2;
    const cy = ty + height / 2;
    transformRef.current = {
      x: mx - (mx - cx) * (newScale / scale) - width / 2,
      y: my - (my - cy) * (newScale / scale) - height / 2,
      scale: newScale,
    };
    // Move tooltip with zoom if a node is selected
    const { selectedNode } = renderStateRef.current;
    if (selectedNode) {
      const zoomSn = simNodeMapRef.current.get(selectedNode.id);
      if (zoomSn) {
        const { x: ntx, y: nty, scale: ns } = transformRef.current;
        setTooltipScreen({
          x: zoomSn.x * ns + ntx + width / 2,
          y: zoomSn.y * ns + nty + height / 2,
        });
      }
    }
    draw();
  }, [draw]);

  // ── Imperative handle ─────────────────────────────────
  useImperativeHandle(ref, () => ({
    focusNodes(ids: string[]) {
      if (!canvasRef.current || ids.length === 0) return;
      const { width, height } = canvasRef.current;
      const positions = simNodesRef.current.filter((n) => ids.includes(n.id));
      if (positions.length === 0) {
        // Some highlight IDs may not be in the graph — log and bail
        console.warn("[GraphCanvas] focusNodes: none of the IDs found in sim:", ids.slice(0, 5));
        return;
      }

      // Compute bounding box of all target nodes
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of positions) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const bboxW = maxX - minX + 120; // padding
      const bboxH = maxY - minY + 120;

      // Zoom to fit: scale so the bounding box fits in 70% of the viewport
      const fitScale = Math.min(
        (width * 0.7) / Math.max(bboxW, 1),
        (height * 0.7) / Math.max(bboxH, 1)
      );
      const newScale = Math.min(2.5, Math.max(0.3, fitScale));

      transformRef.current = {
        x: -cx * newScale,
        y: -cy * newScale,
        scale: newScale,
      };
      draw();
    },
  }));

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      />

      {/* Node tooltip */}
      {selectedNode && (
        <NodeTooltip
          node={selectedNode}
          connections={connectionCount}
          screenX={tooltipScreen.x}
          screenY={tooltipScreen.y}
          onClose={() => { setSelectedNode(null); setSelectedNeighborIds(new Set()); }}
        />
      )}

      {/* Empty / loading state overlay */}
      {!data && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-muted-foreground text-sm animate-pulse">
            Loading graph…
          </p>
        </div>
      )}
    </div>
  );
});

// ─── Node Tooltip ─────────────────────────────────────────

const TYPE_LABELS: Record<NodeType, string> = {
  order: "Sales Order",
  order_item: "Order Item",
  delivery: "Delivery",
  invoice: "Invoice",
  payment: "Payment",
  customer: "Customer",
  product: "Product",
  journal_entry: "Journal Entry",
};

const HIDDEN_PROPS = new Set(["salesOrder", "billingDocument", "deliveryDocument"]);

function NodeTooltip({
  node,
  connections,
  screenX,
  screenY,
  onClose,
}: {
  node: GraphNode;
  connections: number;
  screenX: number;
  screenY: number;
  onClose: () => void;
}) {
  const color = NODE_COLORS[node.type];
  const entries = Object.entries(node.properties).filter(
    ([k, v]) => v !== null && v !== "" && !HIDDEN_PROPS.has(k)
  );

  // Keep tooltip visible inside canvas
  const left = Math.min(screenX + 12, window.innerWidth - 300);
  const top = Math.min(screenY - 10, window.innerHeight - 400);

  return (
    <div
      className="absolute z-20 w-72 rounded-xl border border-border bg-card shadow-2xl text-xs overflow-hidden"
      style={{ left, top }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderBottom: `2px solid ${color}20`, background: `${color}12` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          <span className="font-semibold text-foreground">{TYPE_LABELS[node.type]}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground leading-none"
        >
          ✕
        </button>
      </div>

      {/* Properties */}
      <div className="max-h-72 overflow-y-auto px-3 py-2 space-y-0.5">
        <div className="flex justify-between py-0.5">
          <span className="text-muted-foreground font-medium">Entity:</span>
          <span className="text-foreground">{TYPE_LABELS[node.type]}</span>
        </div>
        {entries.slice(0, 12).map(([k, v]) => (
          <div key={k} className="flex justify-between py-0.5 gap-2">
            <span className="text-muted-foreground font-medium shrink-0 capitalize">
              {k.replace(/([A-Z])/g, " $1").trim()}:
            </span>
            <span className="text-foreground text-right truncate max-w-[160px]">
              {formatPropValue(v)}
            </span>
          </div>
        ))}
        {entries.length > 12 && (
          <p className="text-muted-foreground italic pt-1">
            Additional fields hidden for readability
          </p>
        )}
        <div className="flex justify-between py-0.5 pt-2 border-t border-border mt-1">
          <span className="text-muted-foreground font-medium">Connections:</span>
          <span className="font-semibold text-foreground">{connections}</span>
        </div>
      </div>
    </div>
  );
}

function formatPropValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  const s = String(v);
  // Format ISO dates
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
