import { and, asc, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/db'
import { domains, folders, mailboxAliases, mailboxes, routingRules } from '@/db/schema'
import { normalizeLocalPart, parseAddress } from './address'

type MatchInput = { to: string; from?: string | null; subject?: string | null; content?: string | null }
type Rule = typeof routingRules.$inferSelect

export type RoutingDecision = {
  action: 'store' | 'forward' | 'reject'
  mailbox?: typeof mailboxes.$inferSelect & { hostname: string }
  forwardTo?: string
  keepCopy?: boolean
  rejectReason?: string
  ruleId?: string
}

function fieldValues(rule: Rule, input: MatchInput) {
  if (rule.matchField === 'content') return [input.content]
  if (rule.matchField === 'title') return [input.subject]
  if (rule.matchField === 'sender') return [input.from]
  if (rule.matchField === 'recipient') return [input.to]
  return [input.from, input.to]
}

export function matchesRule(rule: Pick<Rule, 'pattern' | 'matchField' | 'matchOperator' | 'matchValue'>, input: MatchInput) {
  const expected = (rule.matchValue || rule.pattern).trim()
  if (expected === '*') return true
  if (!expected) return false

  return fieldValues(rule as Rule, input).some((raw) => {
    if (!raw) return false
    const value = raw.toLowerCase()
    const target = expected.toLowerCase()
    if (rule.matchOperator === 'exact') return value === target
    if (rule.matchOperator === 'starts_with') return value.startsWith(target)
    if (rule.matchOperator === 'ends_with') return value.endsWith(target)
    if (rule.matchOperator === 'regex') {
      try {
        return new RegExp(expected, 'i').test(raw)
      } catch {
        return false
      }
    }
    return value.includes(target)
  })
}

type ForwardCandidate = Pick<Rule, 'action' | 'forwardTo' | 'keepCopy' | 'pattern' | 'matchField' | 'matchOperator' | 'matchValue'>

/**
 * The forward rule that also applies to an address with its own mailbox: it must keep a copy, name the
 * address rather than be a catch-all, and match the recipient. Mail the mailbox itself sends is not forwarded.
 */
export function copyForwardRule<T extends ForwardCandidate>(rules: T[], to: string) {
  return rules.find((rule) => rule.action === 'forward' && rule.forwardTo && rule.keepCopy && (rule.matchValue || rule.pattern).trim() !== '*' && matchesRule(rule, { to }))
}

async function mailboxForAddress(db: AppDatabase, domainId: string, local: string) {
  const normalized = normalizeLocalPart(local)
  const direct = await db.select().from(mailboxes).where(and(eq(mailboxes.domainId, domainId), eq(mailboxes.disabled, false)))
  const found = direct.find((mailbox) => normalizeLocalPart(mailbox.localPart) === normalized)
  if (found) return found

  const aliases = await db
    .select({ alias: mailboxAliases.localPart, mailbox: mailboxes })
    .from(mailboxAliases)
    .innerJoin(mailboxes, eq(mailboxAliases.mailboxId, mailboxes.id))
    .where(and(eq(mailboxAliases.domainId, domainId), eq(mailboxes.disabled, false)))
  return aliases.find((item) => normalizeLocalPart(item.alias) === normalized)?.mailbox ?? null
}

export async function resolveInbound(db: AppDatabase, to: string, from?: string): Promise<RoutingDecision | null> {
  const address = parseAddress(to)
  if (!address) return null
  const domain = (await db.select().from(domains).where(and(eq(domains.hostname, address.domain), eq(domains.status, 'active'))).limit(1)).at(0)
  if (!domain) return null

  const rules = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.domainId, domain.id), eq(routingRules.scope, 'domain'), eq(routingRules.enabled, true)))
    .orderBy(desc(routingRules.priority), asc(routingRules.createdAt))
  const input = { to, from }

  const reject = rules.find((rule) => rule.action === 'reject' && matchesRule(rule, input))
  if (reject) return { action: 'reject', rejectReason: reject.rejectReason || undefined, ruleId: reject.id }

  const mailbox = await mailboxForAddress(db, domain.id, address.local)
  if (mailbox) {
    const target = { ...mailbox, hostname: domain.hostname }
    // An address with its own mailbox is always delivered there; a matching forward rule sends it on too.
    const copy = copyForwardRule(rules, to)
    if (copy?.forwardTo) return { action: 'forward', forwardTo: copy.forwardTo, keepCopy: true, mailbox: target, ruleId: copy.id }
    return { action: 'store', mailbox: target }
  }

  for (const rule of rules) {
    if (!matchesRule(rule, input)) continue
    if (rule.action === 'forward' && rule.forwardTo) {
      const target = rule.mailboxId
        ? (await db.select().from(mailboxes).where(and(eq(mailboxes.id, rule.mailboxId), eq(mailboxes.disabled, false))).limit(1)).at(0)
        : undefined
      return {
        action: 'forward',
        forwardTo: rule.forwardTo,
        keepCopy: Boolean(rule.keepCopy && target),
        mailbox: target ? { ...target, hostname: domain.hostname } : undefined,
        ruleId: rule.id,
      }
    }
    if (rule.action === 'store' && rule.mailboxId) {
      const target = (await db.select().from(mailboxes).where(and(eq(mailboxes.id, rule.mailboxId), eq(mailboxes.disabled, false))).limit(1)).at(0)
      if (target) return { action: 'store', mailbox: { ...target, hostname: domain.hostname }, ruleId: rule.id }
    }
  }
  return null
}

export async function resolveDestination(db: AppDatabase, mailboxId: string, input: MatchInput) {
  const rules = await db
    .select()
    .from(routingRules)
    .where(and(eq(routingRules.mailboxId, mailboxId), eq(routingRules.scope, 'mailbox'), eq(routingRules.enabled, true)))
    .orderBy(desc(routingRules.priority), asc(routingRules.createdAt))

  for (const rule of rules) {
    if (!matchesRule(rule, input)) continue
    if (rule.action === 'spam' || rule.action === 'trash') return { status: rule.action, folderId: null }
    if (rule.folderId) {
      const folder = (await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, rule.folderId), eq(folders.mailboxId, mailboxId))).limit(1)).at(0)
      if (folder) return { status: 'received', folderId: folder.id }
    }
  }
  return { status: 'received', folderId: null }
}
