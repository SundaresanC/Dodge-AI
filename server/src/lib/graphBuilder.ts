/**
 * Graph Builder — constructs a typed O2C business graph from DuckDB.
 *
 * Graph topology mirrors the real business flow:
 *
 *   Customer ←── Order ──→ OrderItem ──→ Product
 *                  ↓
 *              Delivery
 *                  ↓
 *              Invoice ──→ JournalEntry
 *                  ↓
 *              Payment
 *
 * Strategy: anchor on a sample of top-N orders by net amount, then expand
 * outward through each relationship layer.  Limits are applied at each layer
 * so the total graph stays ≤ ~200 nodes.
 */

import { duckdbQuery } from "./duckdb.js";

// ─── Public types ────────────────────────────────────────

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
}

// ─── Cache ───────────────────────────────────────────────

let _cache: GraphData | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export function invalidateGraphCache(): void {
  _cache = null;
  _cacheTs = 0;
}

/**
 * Returns the current graph cache (or null if not yet built).
 * Used by the chat engine to expand highlight IDs to connected paths.
 */
export function getCachedGraph(): GraphData | null {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;
  return null;
}

// ─── SQL helpers ─────────────────────────────────────────

function safeSqlIn(values: string[]): string {
  return values
    .slice(0, 200)
    .map((v) => `'${String(v).replace(/'/g, "''")}'`)
    .join(",");
}

// ─── Main build function ─────────────────────────────────

export async function buildGraphData(orderLimit = 35): Promise<GraphData> {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;

  const t0 = Date.now();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();

  function addNode(node: GraphNode): void {
    if (!seenNodeIds.has(node.id)) {
      seenNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  function addEdge(
    src: string,
    tgt: string,
    type: EdgeType,
    label: string
  ): void {
    if (!seenNodeIds.has(src) || !seenNodeIds.has(tgt)) return;
    const id = `${src}→${tgt}`;
    if (!seenEdgeIds.has(id)) {
      seenEdgeIds.add(id);
      edges.push({ id, source: src, target: tgt, type, label });
    }
  }

  // ── Layer 1: Anchor orders ────────────────────────────
  const ordersRows = (
    await duckdbQuery(`
      SELECT salesOrder, soldToParty,
             COALESCE(TRY_CAST(totalNetAmount AS DOUBLE), 0) AS totalNetAmount,
             orderDate, deliveryStatusLabel, billingStatusLabel,
             currency, salesOrderType
      FROM v_sales_orders_cleaned
      ORDER BY totalNetAmount DESC NULLS LAST
      LIMIT ${orderLimit}
    `)
  ).rows;

  const orderIds = ordersRows.map((r) => String(r.salesOrder));
  const soldToParties = [
    ...new Set(ordersRows.map((r) => String(r.soldToParty)).filter(Boolean)),
  ];

  for (const r of ordersRows) {
    addNode({
      id: `order:${r.salesOrder}`,
      type: "order",
      label: `Order ${r.salesOrder}`,
      properties: r,
    });
  }

  if (orderIds.length === 0) {
    return {
      nodes: [],
      edges: [],
      stats: {},
      buildTimeMs: Date.now() - t0,
    };
  }

  const orderInSql = safeSqlIn(orderIds);

  // ── Layer 2: Customers ────────────────────────────────
  if (soldToParties.length > 0) {
    const custRows = (
      await duckdbQuery(`
        SELECT businessPartner,
               COALESCE(businessPartnerName, businessPartner) AS name,
               businessPartnerCategory, creationDate
        FROM business_partners
        WHERE businessPartner IN (${safeSqlIn(soldToParties)})
        LIMIT 40
      `)
    ).rows;

    for (const r of custRows) {
      addNode({
        id: `customer:${r.businessPartner}`,
        type: "customer",
        label: String(r.name),
        properties: r,
      });
    }
    for (const r of ordersRows) {
      addEdge(
        `order:${r.salesOrder}`,
        `customer:${r.soldToParty}`,
        "order_customer",
        "sold to"
      );
    }
  }

  // ── Layer 3: Order items + products ───────────────────
  const itemRows = (
    await duckdbQuery(`
      SELECT salesOrder, salesOrderItem, material, materialGroup,
             netAmount, requestedQuantity, requestedQuantityUnit, currency
      FROM v_sales_items_cleaned
      WHERE salesOrder IN (${orderInSql})
      LIMIT ${orderLimit * 4}
    `)
  ).rows;

  const materialIds = [
    ...new Set(
      itemRows
        .map((r) => String(r.material))
        .filter((m) => m && m !== "UNKNOWN")
    ),
  ];

  for (const r of itemRows) {
    const itemId = `order_item:${r.salesOrder}_${r.salesOrderItem}`;
    addNode({
      id: itemId,
      type: "order_item",
      label: `Item ${r.salesOrderItem}`,
      properties: r,
    });
    addEdge(
      `order:${r.salesOrder}`,
      itemId,
      "order_item",
      "has item"
    );
  }

  if (materialIds.length > 0) {
    const prodRows = (
      await duckdbQuery(`
        SELECT product, productGroup, baseUnit, productOldId, productType, division
        FROM products
        WHERE product IN (${safeSqlIn(materialIds.slice(0, 40))})
        LIMIT 40
      `)
    ).rows;

    for (const r of prodRows) {
      addNode({
        id: `product:${r.product}`,
        type: "product",
        label: String(r.productOldId || r.product),
        properties: r,
      });
    }
    for (const r of itemRows) {
      addEdge(
        `order_item:${r.salesOrder}_${r.salesOrderItem}`,
        `product:${r.material}`,
        "item_product",
        "product"
      );
    }
  }

  // ── Layer 4: Deliveries ───────────────────────────────
  const delivRows = (
    await duckdbQuery(`
      SELECT DISTINCT di.deliveryDocument,
             d.shippingPoint, d.goodsMovementDate, d.goodsMovementStatus,
             d.pickingStatus, d.proofOfDeliveryStatus
      FROM outbound_delivery_items di
      JOIN v_deliveries_cleaned d ON di.deliveryDocument = d.deliveryDocument
      WHERE di.referenceSdDocument IN (${orderInSql})
      LIMIT ${orderLimit * 2}
    `)
  ).rows;

  const deliveryIds = delivRows.map((r) => String(r.deliveryDocument));

  for (const r of delivRows) {
    addNode({
      id: `delivery:${r.deliveryDocument}`,
      type: "delivery",
      label: `Delivery ${r.deliveryDocument}`,
      properties: r,
    });
  }

  // Order → Delivery edges (via delivery items)
  if (deliveryIds.length > 0) {
    const diLinkRows = (
      await duckdbQuery(`
        SELECT deliveryDocument, referenceSdDocument
        FROM outbound_delivery_items
        WHERE deliveryDocument IN (${safeSqlIn(deliveryIds)})
          AND referenceSdDocument IN (${orderInSql})
        LIMIT 300
      `)
    ).rows;

    for (const r of diLinkRows) {
      addEdge(
        `order:${r.referenceSdDocument}`,
        `delivery:${r.deliveryDocument}`,
        "order_delivery",
        "delivered via"
      );
    }

    // ── Layer 5: Invoices for deliveries ──────────────
    const delivInSql = safeSqlIn(deliveryIds);

    const invRows = (
      await duckdbQuery(`
        SELECT DISTINCT bi.billingDocument,
               bh.totalNetAmount, bh.soldToParty, bh.accountingDocument,
               bh.currency, bh.billingDate, bh.billingDocumentType
        FROM billing_document_items bi
        JOIN v_billing_cleaned bh ON bi.billingDocument = bh.billingDocument
        WHERE bi.referenceSdDocument IN (${delivInSql})
        LIMIT ${orderLimit * 2}
      `)
    ).rows;

    const invoiceBillingIds = invRows.map((r) => String(r.billingDocument));
    const invoiceAccountingIds = [
      ...new Set(
        invRows
          .map((r) => String(r.accountingDocument))
          .filter(Boolean)
      ),
    ];

    for (const r of invRows) {
      addNode({
        id: `invoice:${r.billingDocument}`,
        type: "invoice",
        label: `Invoice ${r.billingDocument}`,
        properties: r,
      });
    }

    // Delivery → Invoice edges
    if (invoiceBillingIds.length > 0) {
      const biLinkRows = (
        await duckdbQuery(`
          SELECT billingDocument, referenceSdDocument
          FROM billing_document_items
          WHERE billingDocument IN (${safeSqlIn(invoiceBillingIds)})
          LIMIT 300
        `)
      ).rows;

      for (const r of biLinkRows) {
        if (deliveryIds.includes(String(r.referenceSdDocument))) {
          addEdge(
            `delivery:${r.referenceSdDocument}`,
            `invoice:${r.billingDocument}`,
            "delivery_invoice",
            "billed as"
          );
        }
      }
    }

    // ── Layer 6: Journal entries for invoices ─────────
    if (invoiceAccountingIds.length > 0) {
      const acctInSql = safeSqlIn(invoiceAccountingIds.slice(0, 60));

      const jeRows = (
        await duckdbQuery(`
          SELECT DISTINCT accountingDocument, referenceDocument,
                 amountInTransactionCurrency, transactionCurrency,
                 postingDate, accountingDocumentType, glAccount
          FROM journal_entry_items_accounts_receivable
          WHERE accountingDocument IN (${acctInSql})
          LIMIT ${orderLimit * 2}
        `)
      ).rows;

      const acctDocToInvoice = new Map<string, string>();
      for (const r of invRows) {
        acctDocToInvoice.set(String(r.accountingDocument), String(r.billingDocument));
      }

      for (const r of jeRows) {
        const jeId = `journal_entry:${r.accountingDocument}`;
        if (!seenNodeIds.has(jeId)) {
          addNode({
            id: jeId,
            type: "journal_entry",
            label: `JE ${r.accountingDocument}`,
            properties: r,
          });
        }
        const invoiceBillingDoc = acctDocToInvoice.get(String(r.accountingDocument));
        if (invoiceBillingDoc) {
          addEdge(
            `invoice:${invoiceBillingDoc}`,
            jeId,
            "invoice_journal",
            "posted to"
          );
        }
      }

      // ── Layer 7: Payments for invoices ────────────
      const payRows = (
        await duckdbQuery(`
          SELECT DISTINCT accountingDocument, customer,
                 amountInTransactionCurrency, currency, paymentStatus,
                 postingDate, clearingDate
          FROM v_payments_cleaned
          WHERE accountingDocument IN (${acctInSql})
          LIMIT ${orderLimit * 2}
        `)
      ).rows;

      for (const r of payRows) {
        const payId = `payment:${r.accountingDocument}`;
        if (!seenNodeIds.has(payId)) {
          addNode({
            id: payId,
            type: "payment",
            label: `Payment ${r.accountingDocument}`,
            properties: r,
          });
        }
        const invoiceBillingDoc = acctDocToInvoice.get(String(r.accountingDocument));
        if (invoiceBillingDoc) {
          addEdge(
            `invoice:${invoiceBillingDoc}`,
            payId,
            "invoice_payment",
            "paid via"
          );
        }
      }
    }
  }

  // ── Build stats ───────────────────────────────────────
  const stats: Partial<Record<NodeType, number>> = {};
  for (const node of nodes) {
    stats[node.type] = (stats[node.type] ?? 0) + 1;
  }

  const result: GraphData = {
    nodes,
    edges,
    stats,
    buildTimeMs: Date.now() - t0,
  };

  _cache = result;
  _cacheTs = Date.now();

  return result;
}

// ─── Trace a single document through the O2C chain ───────

export interface TraceResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  docNumber: string;
  docType: string;
  found: boolean;
}

export async function traceDocument(docNumber: string): Promise<TraceResult> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  function addNode(n: GraphNode) {
    if (!seenNodes.has(n.id)) { seenNodes.add(n.id); nodes.push(n); }
  }
  function addEdge(src: string, tgt: string, type: EdgeType, label: string) {
    if (!seenNodes.has(src) || !seenNodes.has(tgt)) return;
    const id = `${src}→${tgt}`;
    if (!seenEdges.has(id)) {
      seenEdges.add(id);
      edges.push({ id, source: src, target: tgt, type, label });
    }
  }

  const safe = docNumber.replace(/'/g, "''");

  // Try to identify document type by querying each table
  let docType = "unknown";

  // Check if it's a billing document
  const billingCheck = (
    await duckdbQuery(`
      SELECT billingDocument, totalNetAmount, soldToParty, accountingDocument,
             billingDocumentType, currency, billingDate
      FROM v_billing_cleaned
      WHERE billingDocument = '${safe}'
      LIMIT 1
    `)
  ).rows;

  if (billingCheck.length > 0) {
    docType = "invoice";
    const bRow = billingCheck[0];
    addNode({
      id: `invoice:${safe}`,
      type: "invoice",
      label: `Invoice ${safe}`,
      properties: bRow,
    });

    // → Journal Entry
    if (bRow.accountingDocument) {
      const jeRows = (
        await duckdbQuery(`
          SELECT accountingDocument, referenceDocument, amountInTransactionCurrency,
                 transactionCurrency, postingDate, glAccount
          FROM journal_entry_items_accounts_receivable
          WHERE accountingDocument = '${String(bRow.accountingDocument).replace(/'/g, "''")}'
          LIMIT 5
        `)
      ).rows;
      for (const je of jeRows) {
        addNode({ id: `journal_entry:${je.accountingDocument}`, type: "journal_entry", label: `JE ${je.accountingDocument}`, properties: je });
        addEdge(`invoice:${safe}`, `journal_entry:${je.accountingDocument}`, "invoice_journal", "posted to");
      }

      // → Payment
      const payRows = (
        await duckdbQuery(`
          SELECT accountingDocument, customer, amountInTransactionCurrency,
                 currency, paymentStatus, postingDate
          FROM v_payments_cleaned
          WHERE accountingDocument = '${String(bRow.accountingDocument).replace(/'/g, "''")}'
          LIMIT 3
        `)
      ).rows;
      for (const pay of payRows) {
        addNode({ id: `payment:${pay.accountingDocument}`, type: "payment", label: `Payment ${pay.accountingDocument}`, properties: pay });
        addEdge(`invoice:${safe}`, `payment:${pay.accountingDocument}`, "invoice_payment", "paid via");
      }
    }

    // ← Delivery
    const delivRows = (
      await duckdbQuery(`
        SELECT DISTINCT bi.referenceSdDocument AS deliveryDoc,
               d.goodsMovementStatus, d.pickingStatus
        FROM billing_document_items bi
        LEFT JOIN v_deliveries_cleaned d ON bi.referenceSdDocument = d.deliveryDocument
        WHERE bi.billingDocument = '${safe}'
        LIMIT 5
      `)
    ).rows;
    for (const d of delivRows) {
      addNode({ id: `delivery:${d.deliveryDoc}`, type: "delivery", label: `Delivery ${d.deliveryDoc}`, properties: d });
      addEdge(`delivery:${d.deliveryDoc}`, `invoice:${safe}`, "delivery_invoice", "billed as");

      // ← Order
      const orderRows = (
        await duckdbQuery(`
          SELECT DISTINCT di.referenceSdDocument AS salesOrder,
                 so.salesOrderType, so.soldToParty, so.totalNetAmount
          FROM outbound_delivery_items di
          LEFT JOIN v_sales_orders_cleaned so ON di.referenceSdDocument = so.salesOrder
          WHERE di.deliveryDocument = '${String(d.deliveryDoc).replace(/'/g, "''")}'
          LIMIT 3
        `)
      ).rows;
      for (const o of orderRows) {
        addNode({ id: `order:${o.salesOrder}`, type: "order", label: `Order ${o.salesOrder}`, properties: o });
        addEdge(`order:${o.salesOrder}`, `delivery:${d.deliveryDoc}`, "order_delivery", "delivered via");

        // ← Customer
        if (o.soldToParty) {
          const custRows = (
            await duckdbQuery(`
              SELECT businessPartner, COALESCE(businessPartnerName, businessPartner) AS name
              FROM business_partners WHERE businessPartner = '${String(o.soldToParty).replace(/'/g, "''")}'
              LIMIT 1
            `)
          ).rows;
          for (const c of custRows) {
            addNode({ id: `customer:${c.businessPartner}`, type: "customer", label: String(c.name), properties: c });
            addEdge(`order:${o.salesOrder}`, `customer:${c.businessPartner}`, "order_customer", "sold to");
          }
        }
      }
    }
  } else {
    // Check order
    const orderCheck = (
      await duckdbQuery(`
        SELECT salesOrder, soldToParty, totalNetAmount, deliveryStatusLabel, billingStatusLabel
        FROM v_sales_orders_cleaned WHERE salesOrder = '${safe}' LIMIT 1
      `)
    ).rows;

    if (orderCheck.length > 0) {
      docType = "order";
      const oRow = orderCheck[0];
      addNode({ id: `order:${safe}`, type: "order", label: `Order ${safe}`, properties: oRow });

      // → Delivery
      const delivRows = (
        await duckdbQuery(`
          SELECT DISTINCT di.deliveryDocument, d.goodsMovementStatus, d.pickingStatus
          FROM outbound_delivery_items di
          LEFT JOIN v_deliveries_cleaned d ON di.deliveryDocument = d.deliveryDocument
          WHERE di.referenceSdDocument = '${safe}' LIMIT 5
        `)
      ).rows;
      for (const d of delivRows) {
        addNode({ id: `delivery:${d.deliveryDocument}`, type: "delivery", label: `Delivery ${d.deliveryDocument}`, properties: d });
        addEdge(`order:${safe}`, `delivery:${d.deliveryDocument}`, "order_delivery", "delivered via");

        // → Invoice
        const invRows = (
          await duckdbQuery(`
            SELECT DISTINCT bi.billingDocument, bh.totalNetAmount, bh.accountingDocument
            FROM billing_document_items bi
            JOIN v_billing_cleaned bh ON bi.billingDocument = bh.billingDocument
            WHERE bi.referenceSdDocument = '${String(d.deliveryDocument).replace(/'/g, "''")}'
            LIMIT 3
          `)
        ).rows;
        for (const inv of invRows) {
          addNode({ id: `invoice:${inv.billingDocument}`, type: "invoice", label: `Invoice ${inv.billingDocument}`, properties: inv });
          addEdge(`delivery:${d.deliveryDocument}`, `invoice:${inv.billingDocument}`, "delivery_invoice", "billed as");

          if (inv.accountingDocument) {
            const acctSafe = String(inv.accountingDocument).replace(/'/g, "''");
            const jeRows = (
              await duckdbQuery(`
                SELECT DISTINCT accountingDocument, referenceDocument, amountInTransactionCurrency
                FROM journal_entry_items_accounts_receivable
                WHERE accountingDocument = '${acctSafe}' LIMIT 3
              `)
            ).rows;
            for (const je of jeRows) {
              addNode({ id: `journal_entry:${je.accountingDocument}`, type: "journal_entry", label: `JE ${je.accountingDocument}`, properties: je });
              addEdge(`invoice:${inv.billingDocument}`, `journal_entry:${je.accountingDocument}`, "invoice_journal", "posted to");
            }

            const payRows = (
              await duckdbQuery(`
                SELECT DISTINCT accountingDocument, amountInTransactionCurrency, paymentStatus
                FROM v_payments_cleaned WHERE accountingDocument = '${acctSafe}' LIMIT 3
              `)
            ).rows;
            for (const pay of payRows) {
              addNode({ id: `payment:${pay.accountingDocument}`, type: "payment", label: `Payment ${pay.accountingDocument}`, properties: pay });
              addEdge(`invoice:${inv.billingDocument}`, `payment:${pay.accountingDocument}`, "invoice_payment", "paid via");
            }
          }
        }
      }

      // Customer
      if (oRow.soldToParty) {
        const custRows = (
          await duckdbQuery(`
            SELECT businessPartner, COALESCE(businessPartnerName, businessPartner) AS name
            FROM business_partners WHERE businessPartner = '${String(oRow.soldToParty).replace(/'/g, "''")}'
            LIMIT 1
          `)
        ).rows;
        for (const c of custRows) {
          addNode({ id: `customer:${c.businessPartner}`, type: "customer", label: String(c.name), properties: c });
          addEdge(`order:${safe}`, `customer:${c.businessPartner}`, "order_customer", "sold to");
        }
      }
    }
  }

  return {
    nodes,
    edges,
    docNumber,
    docType,
    found: nodes.length > 0,
  };
}

// ─── Broken flow detection ────────────────────────────────

export interface BrokenFlowResult {
  type: string;
  description: string;
  records: Record<string, unknown>[];
}

export async function detectBrokenFlows(
  flowType: "undelivered" | "unbilled" | "unpaid" | "all" = "all"
): Promise<BrokenFlowResult[]> {
  const results: BrokenFlowResult[] = [];

  if (flowType === "undelivered" || flowType === "all") {
    const rows = (
      await duckdbQuery(`
        SELECT so.salesOrder, so.soldToParty, so.totalNetAmount, so.orderDate,
               so.deliveryStatusLabel
        FROM v_sales_orders_cleaned so
        WHERE so.deliveryStatusLabel IN ('Not Delivered', 'Open / Not Started')
        LIMIT 20
      `)
    ).rows;
    results.push({
      type: "Orders Not Delivered",
      description: `${rows.length} orders have been placed but not yet delivered.`,
      records: rows,
    });
  }

  if (flowType === "unbilled" || flowType === "all") {
    const rows = (
      await duckdbQuery(`
        SELECT so.salesOrder, so.soldToParty, so.totalNetAmount, so.orderDate,
               so.deliveryStatusLabel, so.billingStatusLabel
        FROM v_sales_orders_cleaned so
        WHERE so.deliveryStatusLabel = 'Fully Delivered'
          AND so.billingStatusLabel IN ('Not Billed', 'Not Started')
        LIMIT 20
      `)
    ).rows;
    results.push({
      type: "Delivered But Not Billed",
      description: `${rows.length} orders were fully delivered but have no billing document.`,
      records: rows,
    });
  }

  if (flowType === "unpaid" || flowType === "all") {
    const rows = (
      await duckdbQuery(`
        SELECT b.billingDocument, b.soldToParty, b.totalNetAmount, b.billingDate
        FROM v_billing_cleaned b
        LEFT JOIN v_payments_cleaned p ON p.accountingDocument = b.accountingDocument
        WHERE p.accountingDocument IS NULL
        LIMIT 20
      `)
    ).rows;
    results.push({
      type: "Invoiced But Not Paid",
      description: `${rows.length} billing documents have no associated payment record.`,
      records: rows,
    });
  }

  return results;
}
