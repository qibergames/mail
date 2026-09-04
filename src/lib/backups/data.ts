const TABLES = [
  'users', 'domains', 'mailboxes', 'mailbox_aliases', 'auto_reply_deliveries', 'mailbox_access',
  'contacts', 'folders', 'api_keys', 'messages', 'message_attachments', 'outbound_jobs',
  'email_templates', 'calendar_events', 'routing_rules', 'webhooks', 'webhook_deliveries',
  'session', 'account', 'verification', 'audit_logs', 'backup_settings', 'backups',
  'app_settings', 'push_subscriptions',
] as const

type Row = Record<string, string | number | boolean | null>
type BackupDocument = { format: 'qibermail-database-backup'; version: 1; createdAt: string; tables: Record<string, Array<Row>> }

export async function exportDatabase(db: D1Database) {
  const tables: Record<string, Array<Row>> = {}
  for (const table of TABLES) tables[table] = (await db.prepare(`SELECT * FROM ${table}`).all<Row>()).results
  return new TextEncoder().encode(JSON.stringify({ format: 'qibermail-database-backup', version: 1, createdAt: new Date().toISOString(), tables } satisfies BackupDocument))
}

export async function restoreDatabase(db: D1Database, content: ArrayBuffer) {
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(content)) } catch { throw new Error('Invalid QiberMail backup') }
  if (!value || typeof value !== 'object') throw new Error('Invalid QiberMail backup')
  const candidate = value as { format?: unknown; version?: unknown; tables?: unknown }
  if (candidate.format !== 'qibermail-database-backup' || candidate.version !== 1 || !candidate.tables || typeof candidate.tables !== 'object') throw new Error('Invalid QiberMail backup')
  const tables = candidate.tables as Record<string, unknown>
  if (!TABLES.every((table) => Array.isArray(tables[table]))) throw new Error('Invalid QiberMail backup')
  for (const table of TABLES) for (const row of tables[table] as Array<unknown>) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${table} row`)
    const columns = Object.keys(row)
    if (!columns.length || columns.some((column) => !/^[a-z_]+$/.test(column))) throw new Error(`Invalid ${table} row`)
  }
  for (const table of [...TABLES].reverse()) await db.prepare(`DELETE FROM ${table}`).run()
  for (const table of TABLES) {
    for (const row of tables[table] as Array<unknown>) {
      const record = row as Row
      const columns = Object.keys(record)
      await db.prepare(`INSERT INTO ${table} (${columns.map((column) => `\`${column}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map((column) => record[column])).run()
    }
  }
}
