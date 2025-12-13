import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../db/pool';
import { Accrual, Invoice, InvoiceWithLines, AccrualStatus, InvoiceStatus, AuditAction } from '../../types';
import { NotFoundError, BadRequestError, ConflictError } from '../../lib/errors';
import { logAuditEvent, AuditContext } from '../audit';
import { GetAccrualsQuery, GenerateInvoiceInput, VoidAccrualInput } from './billing.schema';

/**
 * Get accruals for an organization
 */
export async function getOrgAccruals(
  orgId: string,
  queryParams: GetAccrualsQuery
): Promise<Accrual[]> {
  const { period_start, period_end, status, limit, offset } = queryParams;

  let sql = 'SELECT * FROM accruals WHERE org_id = $1';
  const params: unknown[] = [orgId];
  let paramIndex = 2;

  if (period_start) {
    sql += ` AND created_at >= $${paramIndex}::date`;
    params.push(period_start);
    paramIndex++;
  }

  if (period_end) {
    sql += ` AND created_at <= ($${paramIndex}::date + interval '1 day')`;
    params.push(period_end);
    paramIndex++;
  }

  if (status) {
    sql += ` AND status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await query<Accrual>(sql, params);
  return result.rows;
}

/**
 * Get accrual by ID
 */
export async function getAccrualById(accrualId: string): Promise<Accrual | null> {
  const result = await query<Accrual>(
    'SELECT * FROM accruals WHERE accrual_id = $1',
    [accrualId]
  );
  return result.rows[0] || null;
}

/**
 * Void an accrual (e.g., case was cancelled after acceptance)
 */
export async function voidAccrual(
  accrualId: string,
  input: VoidAccrualInput,
  auditContext: AuditContext
): Promise<Accrual> {
  return withTransaction(async (client) => {
    const accrualResult = await client.query<Accrual>(
      'SELECT * FROM accruals WHERE accrual_id = $1 FOR UPDATE',
      [accrualId]
    );

    if (accrualResult.rows.length === 0) {
      throw new NotFoundError('Accrual', accrualId);
    }

    const accrual = accrualResult.rows[0];

    if (accrual.status !== AccrualStatus.ACCRUED) {
      throw new BadRequestError(`Cannot void accrual with status ${accrual.status}`);
    }

    const updateResult = await client.query<Accrual>(
      `UPDATE accruals SET status = 'VOIDED', void_reason = $1
       WHERE accrual_id = $2 RETURNING *`,
      [input.reason, accrualId]
    );

    const updatedAccrual = updateResult.rows[0];

    // Audit log
    await logAuditEvent({
      ...auditContext,
      action: AuditAction.ACCRUAL_VOIDED,
      target_type: 'accrual',
      target_id: accrualId,
      payload: { reason: input.reason },
    });

    return updatedAccrual;
  });
}

/**
 * Generate invoice for a period
 */
export async function generateInvoice(
  orgId: string,
  input: GenerateInvoiceInput,
  auditContext: AuditContext
): Promise<InvoiceWithLines> {
  return withTransaction(async (client) => {
    // Check for existing invoice overlapping this period
    const existingResult = await client.query<Invoice>(
      `SELECT * FROM invoices
       WHERE org_id = $1
       AND NOT (period_end < $2::date OR period_start > $3::date)
       AND status != 'DRAFT'`,
      [orgId, input.period_start, input.period_end]
    );

    if (existingResult.rows.length > 0) {
      throw new ConflictError('An invoice already exists for this period');
    }

    // Get uninvoiced accruals in the period
    const accrualsResult = await client.query<Accrual>(
      `SELECT * FROM accruals
       WHERE org_id = $1
       AND status = 'ACCRUED'
       AND created_at >= $2::date
       AND created_at <= ($3::date + interval '1 day')
       FOR UPDATE`,
      [orgId, input.period_start, input.period_end]
    );

    if (accrualsResult.rows.length === 0) {
      throw new BadRequestError('No uninvoiced accruals found in this period');
    }

    const accruals = accrualsResult.rows;
    const totalAmount = accruals.reduce((sum, a) => sum + a.amount, 0);

    // Create invoice
    const invoiceId = uuidv4();
    const invoiceResult = await client.query<Invoice>(
      `INSERT INTO invoices (invoice_id, org_id, period_start, period_end, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'DRAFT')
       RETURNING *`,
      [invoiceId, orgId, input.period_start, input.period_end, totalAmount]
    );

    const invoice = invoiceResult.rows[0];

    // Create invoice lines and update accrual status
    const lines: { accrual_id: string; amount: number }[] = [];

    for (const accrual of accruals) {
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, accrual_id, amount)
         VALUES ($1, $2, $3)`,
        [invoiceId, accrual.accrual_id, accrual.amount]
      );

      await client.query(
        `UPDATE accruals SET status = 'INVOICED' WHERE accrual_id = $1`,
        [accrual.accrual_id]
      );

      lines.push({ accrual_id: accrual.accrual_id, amount: accrual.amount });
    }

    // Audit log
    await logAuditEvent({
      ...auditContext,
      actor_org_id: orgId,
      action: AuditAction.INVOICE_GENERATED,
      target_type: 'invoice',
      target_id: invoiceId,
      payload: {
        period_start: input.period_start,
        period_end: input.period_end,
        total_amount: totalAmount,
        accrual_count: accruals.length,
      },
    });

    return {
      ...invoice,
      lines,
    };
  });
}

/**
 * Get invoices for an organization
 */
export async function getOrgInvoices(
  orgId: string,
  limit = 50,
  offset = 0
): Promise<Invoice[]> {
  const result = await query<Invoice>(
    `SELECT * FROM invoices WHERE org_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  );
  return result.rows;
}

/**
 * Get invoice by ID with lines
 */
export async function getInvoiceById(invoiceId: string): Promise<InvoiceWithLines | null> {
  const invoiceResult = await query<Invoice>(
    'SELECT * FROM invoices WHERE invoice_id = $1',
    [invoiceId]
  );

  if (invoiceResult.rows.length === 0) {
    return null;
  }

  const invoice = invoiceResult.rows[0];

  const linesResult = await query<{ accrual_id: string; amount: number }>(
    'SELECT accrual_id, amount FROM invoice_lines WHERE invoice_id = $1',
    [invoiceId]
  );

  return {
    ...invoice,
    lines: linesResult.rows,
  };
}

/**
 * Update invoice status (e.g., DRAFT -> SENT -> PAID)
 */
export async function updateInvoiceStatus(
  invoiceId: string,
  newStatus: InvoiceStatus,
  auditContext: AuditContext
): Promise<Invoice> {
  const result = await query<Invoice>(
    'UPDATE invoices SET status = $1 WHERE invoice_id = $2 RETURNING *',
    [newStatus, invoiceId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  return result.rows[0];
}

/**
 * Get billing summary for an organization
 */
export async function getOrgBillingSummary(orgId: string): Promise<{
  total_accrued: number;
  total_invoiced: number;
  total_voided: number;
  pending_accruals: number;
  pending_amount: number;
}> {
  const result = await query<{
    status: AccrualStatus;
    count: string;
    total: string;
  }>(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
     FROM accruals WHERE org_id = $1 GROUP BY status`,
    [orgId]
  );

  const summary = {
    total_accrued: 0,
    total_invoiced: 0,
    total_voided: 0,
    pending_accruals: 0,
    pending_amount: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const total = parseInt(row.total, 10);

    switch (row.status) {
      case AccrualStatus.ACCRUED:
        summary.total_accrued = total;
        summary.pending_accruals = count;
        summary.pending_amount = total;
        break;
      case AccrualStatus.INVOICED:
        summary.total_invoiced = total;
        break;
      case AccrualStatus.VOIDED:
        summary.total_voided = total;
        break;
    }
  }

  return summary;
}
