/**
 * Data Cleaning & Normalization Layer
 *
 * Registers a set of cleaned DuckDB views on top of the raw JSONL-backed
 * entity views.  These normalized views are then PREFERRED by the AI query
 * engine for all analysis work.
 *
 * What the cleaned views fix:
 *  - NULL / missing values replaced with sensible defaults (COALESCE)
 *  - Numeric strings cast to DOUBLE via TRY_CAST (totalNetAmount, netAmount…)
 *  - SAP status codes (A / B / C) decoded to human-readable labels
 *  - Date strings cast to DATE type for proper date arithmetic
 *  - Cancelled billing documents excluded (v_billing_cleaned)
 *  - Products marked for deletion excluded (v_products_cleaned)
 *
 * If a cleaned view fails to register (e.g. the raw view does not exist yet),
 * the failure is logged and startup continues — degraded mode.
 */

import type { DuckDBConnection } from "@duckdb/node-api";

interface ViewDefinition {
  name: string;
  description: string;
  sql: string;
}

// ─── View definitions ─────────────────────────────────────

const CLEANED_VIEW_DEFINITIONS: ViewDefinition[] = [
  {
    name: "v_billing_cleaned",
    description:
      "Active billing documents — cancellations excluded, amounts as DOUBLE, dates as DATE",
    sql: `
      CREATE OR REPLACE VIEW v_billing_cleaned AS
      SELECT
        billingDocument,
        COALESCE(billingDocumentType, 'UNKNOWN')           AS billingDocumentType,
        TRY_CAST(billingDocumentDate AS DATE)              AS billingDate,
        soldToParty,
        COALESCE(TRY_CAST(totalNetAmount AS DOUBLE), 0.0)  AS totalNetAmount,
        COALESCE(transactionCurrency, 'UNKNOWN')           AS currency,
        COALESCE(companyCode, 'UNKNOWN')                   AS companyCode,
        COALESCE(fiscalYear, '')                           AS fiscalYear,
        TRY_CAST(creationDate AS DATE)                     AS creationDate,
        billingDocumentIsCancelled,
        accountingDocument
      FROM billing_document_headers
      WHERE COALESCE(billingDocumentIsCancelled, false) = false
    `,
  },
  {
    name: "v_billing_items_cleaned",
    description:
      "Billing line items — amounts and quantities as DOUBLE, currency normalised",
    sql: `
      CREATE OR REPLACE VIEW v_billing_items_cleaned AS
      SELECT
        billingDocument,
        billingDocumentItem,
        COALESCE(material, 'UNKNOWN')                          AS material,
        COALESCE(TRY_CAST(netAmount AS DOUBLE), 0.0)           AS netAmount,
        COALESCE(TRY_CAST(billingQuantity AS DOUBLE), 0.0)     AS billingQuantity,
        COALESCE(billingQuantityUnit, 'EA')                    AS billingQuantityUnit,
        COALESCE(transactionCurrency, 'UNKNOWN')               AS currency,
        referenceSdDocument,
        referenceSdDocumentItem
      FROM billing_document_items
    `,
  },
  {
    name: "v_sales_orders_cleaned",
    description:
      "Sales orders — status codes decoded to labels, amounts as DOUBLE, dates as DATE",
    sql: `
      CREATE OR REPLACE VIEW v_sales_orders_cleaned AS
      SELECT
        salesOrder,
        COALESCE(salesOrderType, 'UNKNOWN')                    AS salesOrderType,
        soldToParty,
        COALESCE(TRY_CAST(totalNetAmount AS DOUBLE), 0.0)      AS totalNetAmount,
        COALESCE(transactionCurrency, 'UNKNOWN')               AS currency,
        COALESCE(salesOrganization, 'UNKNOWN')                 AS salesOrganization,
        COALESCE(distributionChannel, '')                      AS distributionChannel,
        TRY_CAST(creationDate AS DATE)                         AS orderDate,
        TRY_CAST(requestedDeliveryDate AS DATE)                AS requestedDeliveryDate,
        CASE UPPER(COALESCE(overallDeliveryStatus, ''))
          WHEN 'A' THEN 'Not Delivered'
          WHEN 'B' THEN 'Partially Delivered'
          WHEN 'C' THEN 'Fully Delivered'
          ELSE 'Open / Not Started'
        END                                                    AS deliveryStatusLabel,
        CASE UPPER(COALESCE(overallOrdReltdBillgStatus, ''))
          WHEN 'A' THEN 'Not Billed'
          WHEN 'B' THEN 'Partially Billed'
          WHEN 'C' THEN 'Fully Billed'
          ELSE 'Not Started'
        END                                                    AS billingStatusLabel,
        COALESCE(deliveryBlockReason, '')                      AS deliveryBlockReason,
        COALESCE(headerBillingBlockReason, '')                 AS billingBlockReason,
        COALESCE(customerPaymentTerms, '')                     AS customerPaymentTerms,
        createdByUser
      FROM sales_order_headers
    `,
  },
  {
    name: "v_sales_items_cleaned",
    description:
      "Sales order line items — amounts/quantities as DOUBLE, rejection reason decoded",
    sql: `
      CREATE OR REPLACE VIEW v_sales_items_cleaned AS
      SELECT
        salesOrder,
        salesOrderItem,
        COALESCE(salesOrderItemCategory, 'UNKNOWN')            AS itemCategory,
        COALESCE(material, 'UNKNOWN')                          AS material,
        COALESCE(materialGroup, 'UNKNOWN')                     AS materialGroup,
        COALESCE(TRY_CAST(netAmount AS DOUBLE), 0.0)           AS netAmount,
        COALESCE(TRY_CAST(requestedQuantity AS DOUBLE), 0.0)   AS requestedQuantity,
        COALESCE(requestedQuantityUnit, 'EA')                  AS requestedQuantityUnit,
        COALESCE(transactionCurrency, 'UNKNOWN')               AS currency,
        COALESCE(storageLocation, '')                          AS storageLocation,
        COALESCE(productionPlant, '')                          AS productionPlant,
        COALESCE(salesDocumentRjcnReason, '')                  AS rejectionReason,
        COALESCE(itemBillingBlockReason, '')                   AS billingBlockReason
      FROM sales_order_items
    `,
  },
  {
    name: "v_deliveries_cleaned",
    description:
      "Outbound delivery headers — SAP A/B/C status codes decoded to plain-English labels",
    sql: `
      CREATE OR REPLACE VIEW v_deliveries_cleaned AS
      SELECT
        deliveryDocument,
        COALESCE(shippingPoint, 'UNKNOWN')                     AS shippingPoint,
        TRY_CAST(actualGoodsMovementDate AS DATE)              AS goodsMovementDate,
        TRY_CAST(creationDate AS DATE)                         AS creationDate,
        CASE UPPER(COALESCE(overallGoodsMovementStatus, ''))
          WHEN 'A' THEN 'Not Started'
          WHEN 'B' THEN 'Partially Complete'
          WHEN 'C' THEN 'Complete'
          ELSE 'Unknown'
        END                                                    AS goodsMovementStatus,
        CASE UPPER(COALESCE(overallPickingStatus, ''))
          WHEN 'A' THEN 'Not Picked'
          WHEN 'B' THEN 'Partially Picked'
          WHEN 'C' THEN 'Fully Picked'
          ELSE 'Unknown'
        END                                                    AS pickingStatus,
        CASE UPPER(COALESCE(overallProofOfDeliveryStatus, ''))
          WHEN 'A' THEN 'Not Confirmed'
          WHEN 'B' THEN 'Partially Confirmed'
          WHEN 'C' THEN 'Fully Confirmed'
          ELSE 'Unknown'
        END                                                    AS proofOfDeliveryStatus,
        COALESCE(deliveryBlockReason, '')                      AS deliveryBlockReason,
        COALESCE(headerBillingBlockReason, '')                 AS billingBlockReason
      FROM outbound_delivery_headers
    `,
  },
  {
    name: "v_payments_cleaned",
    description:
      "AR payments — amounts as DOUBLE, cleared vs open status classified, dates as DATE",
    sql: `
      CREATE OR REPLACE VIEW v_payments_cleaned AS
      SELECT
        accountingDocument,
        accountingDocumentItem,
        COALESCE(customer, '')                                    AS customer,
        COALESCE(TRY_CAST(amountInTransactionCurrency AS DOUBLE), 0.0)
                                                                  AS amountInTransactionCurrency,
        COALESCE(TRY_CAST(amountInCompanyCodeCurrency AS DOUBLE), 0.0)
                                                                  AS amountInCompanyCodeCurrency,
        COALESCE(companyCodeCurrency, 'UNKNOWN')                  AS currency,
        TRY_CAST(postingDate AS DATE)                             AS postingDate,
        TRY_CAST(documentDate AS DATE)                            AS documentDate,
        TRY_CAST(clearingDate AS DATE)                            AS clearingDate,
        CASE
          WHEN clearingDate IS NOT NULL THEN 'Cleared'
          ELSE 'Open'
        END                                                       AS paymentStatus,
        COALESCE(fiscalYear, '')                                  AS fiscalYear,
        COALESCE(glAccount, '')                                   AS glAccount,
        COALESCE(invoiceReference, '')                            AS invoiceReference,
        COALESCE(salesDocument, '')                               AS salesDocument,
        COALESCE(companyCode, '')                                 AS companyCode
      FROM payments_accounts_receivable
    `,
  },
  {
    name: "v_products_cleaned",
    description:
      "Active products only — items marked for deletion excluded, weights as DOUBLE",
    sql: `
      CREATE OR REPLACE VIEW v_products_cleaned AS
      SELECT
        product,
        COALESCE(productType, 'UNKNOWN')                         AS productType,
        COALESCE(productGroup, 'UNKNOWN')                        AS productGroup,
        COALESCE(division, 'UNKNOWN')                            AS division,
        COALESCE(baseUnit, 'EA')                                 AS baseUnit,
        COALESCE(TRY_CAST(grossWeight AS DOUBLE), 0.0)           AS grossWeight,
        COALESCE(TRY_CAST(netWeight AS DOUBLE), 0.0)             AS netWeight,
        COALESCE(weightUnit, 'KG')                               AS weightUnit,
        COALESCE(crossPlantStatus, '')                           AS crossPlantStatus,
        COALESCE(industrySector, '')                             AS industrySector,
        TRY_CAST(creationDate AS DATE)                           AS creationDate,
        isMarkedForDeletion
      FROM products
      WHERE COALESCE(isMarkedForDeletion, false) = false
    `,
  },  {
    name: "v_o2c_chain_status",
    description:
      "End-to-end O2C chain status per sales order — links orders, deliveries, invoices, and payments into a single chainStatus: Paid | Billed | Delivered | Order Only",
    sql: `
      CREATE OR REPLACE VIEW v_o2c_chain_status AS
      SELECT
        o.salesOrder,
        o.soldToParty,
        o.totalNetAmount,
        o.currency,
        o.orderDate,
        o.deliveryStatusLabel,
        o.billingStatusLabel,
        COUNT(DISTINCT di.deliveryDocument)           AS deliveryCount,
        COUNT(DISTINCT bi.billingDocument)            AS invoiceCount,
        COUNT(DISTINCT p.accountingDocument)          AS paymentCount,
        CASE
          WHEN COUNT(DISTINCT p.accountingDocument) > 0 THEN 'Paid'
          WHEN COUNT(DISTINCT bi.billingDocument)   > 0 THEN 'Billed'
          WHEN COUNT(DISTINCT di.deliveryDocument)  > 0 THEN 'Delivered'
          ELSE 'Order Only'
        END                                           AS chainStatus
      FROM v_sales_orders_cleaned o
      LEFT JOIN outbound_delivery_items di
             ON di.referenceSdDocument = o.salesOrder
      LEFT JOIN billing_document_items bi
             ON bi.referenceSdDocument = o.salesOrder
      LEFT JOIN v_payments_cleaned p
             ON p.salesDocument = o.salesOrder
      GROUP BY
        o.salesOrder, o.soldToParty, o.totalNetAmount, o.currency,
        o.orderDate, o.deliveryStatusLabel, o.billingStatusLabel
    `,
  },];

// ─── Registry ─────────────────────────────────────────────

const _cleanedViews: string[] = [];

/** Returns the names of successfully registered cleaned views. */
export function getCleanedViewNames(): string[] {
  return [..._cleanedViews];
}

/**
 * Returns a Markdown context block describing the available cleaned views.
 * This is injected into the AI system prompt so it prefers clean data.
 */
export function getNormalizationContext(): string {
  if (_cleanedViews.length === 0) return "";

  const descriptions = _cleanedViews
    .map((v) => {
      const def = CLEANED_VIEW_DEFINITIONS.find((d) => d.name === v);
      return `- **${v}** — ${def?.description ?? ""}`;
    })
    .join("\n");

  return `
## Cleaned / Normalized Views (ALWAYS PREFER these over raw tables)

${descriptions}

These views have already handled all data quality issues:
- NULL values replaced with sensible defaults (COALESCE)
- Numeric fields cast to DOUBLE (totalNetAmount, netAmount, amounts…)
- SAP status codes (A/B/C) decoded to human-readable English labels
- Date strings cast to DATE type for proper STRFTIME / DATE_TRUNC use
- Cancelled billing documents excluded from v_billing_cleaned
- Products marked for deletion excluded from v_products_cleaned

**RULE: Use v_billing_cleaned instead of billing_document_headers.**
**RULE: Use v_sales_orders_cleaned instead of sales_order_headers.**
**RULE: Use v_sales_items_cleaned instead of sales_order_items.**
**RULE: Use v_deliveries_cleaned instead of outbound_delivery_headers.**
**RULE: Use v_payments_cleaned instead of payments_accounts_receivable.**
**RULE: Use v_products_cleaned instead of products.**
`;
}

/**
 * Registers all cleaned views in the given DuckDB connection.
 * Should be called once during startup, after raw SAP views are registered.
 * Individual failures are logged but do not abort startup.
 */
export async function registerCleanedViews(
  conn: DuckDBConnection
): Promise<void> {
  for (const view of CLEANED_VIEW_DEFINITIONS) {
    try {
      await conn.run(view.sql.trim());
      _cleanedViews.push(view.name);
    } catch (err) {
      console.warn(
        `⚠️  Could not register cleaned view '${view.name}':`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (_cleanedViews.length > 0) {
    console.log(
      `✅ Data normalization layer ready — ${_cleanedViews.length}/${CLEANED_VIEW_DEFINITIONS.length} cleaned views registered`
    );
  } else {
    console.warn(
      "⚠️  No cleaned views were registered — raw tables will be used instead"
    );
  }
}
