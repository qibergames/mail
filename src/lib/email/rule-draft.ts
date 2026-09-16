import type { AppDatabase } from '@/db'
import { askJudgment } from './typesafe'

export type RuleDraft = {
  matchField: 'sender' | 'recipient' | 'title' | 'content'
  matchOperator: 'contains' | 'exact' | 'starts_with' | 'ends_with'
  matchValue: string
  action: 'store' | 'spam' | 'trash'
  folderId: string | null
}

type Folder = { id: string; name: string }

const NONE = 'none'

/**
 * Values the rule could match on, taken from the sentence itself. The model selects one rather than writing
 * it, so the rule always matches text the user actually typed.
 */
export function candidateValues(sentence: string) {
  const quoted = [...sentence.matchAll(/["“”'‘’„]([^"“”'‘’„]{2,80})["“”'‘’„]/g)].map((match) => match[1].trim())
  const addresses = sentence.match(/[^\s<>",;:@]+@[a-z0-9.-]*[a-z0-9]/gi) ?? []
  const domains = sentence.match(/(?<![\w@])(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w@])/gi) ?? []
  const words = (sentence.match(/[\p{L}\p{N}][\p{L}\p{N}.+-]{2,}/gu) ?? []).filter((word) => word.length >= 4)
  return [...new Set([...quoted, ...addresses, ...domains, ...words].map((value) => value.trim()).filter(Boolean))].slice(0, 12)
}

/**
 * Turns "put the Stripe receipts in Accounting" into a rule the user can review and save. Returns null when
 * nothing is confident enough to prefill, so the form stays empty rather than wrong.
 */
export async function draftRule(env: CloudflareEnv, db: AppDatabase, sentence: string, folders: Array<Folder>): Promise<RuleDraft | null> {
  const values = candidateValues(sentence)
  if (!values.length) return null
  const answers = await askJudgment(env, db, { rule_request: sentence, candidate_values: values, folders: folders.map((folder) => folder.name) }, {
    match_field: {
      type: 'choice',
      instructions: 'Which part of an incoming email does this rule talk about? Reference `.rule_request`.',
      criteria: { sender: 'Who the mail comes from', recipient: 'Which address it was sent to', title: 'The subject line', content: 'The body text' },
    },
    match_operator: {
      type: 'choice',
      instructions: 'How should the value be compared to that part of the email?',
      criteria: { contains: 'The part contains the value anywhere', exact: 'The part is exactly the value', starts_with: 'The part begins with the value', ends_with: 'The part ends with the value, as for an address on a domain' },
    },
    action: {
      type: 'choice',
      instructions: 'What should happen to a matching email?',
      criteria: { store: 'Keep it, filing it into a folder', spam: 'Treat it as spam', trash: 'Move it to the trash' },
    },
    match_value: {
      type: 'choice',
      instructions: 'Which candidate is the text the rule should match on? Reference `.candidate_values`.',
      criteria: Object.fromEntries(values.map((value) => [value, `Match on "${value}"`])),
    },
    ...(folders.length
      ? {
          folder: {
            type: 'choice',
            instructions: 'Which folder should a matching email be filed into? Reference `.folders`.',
            criteria: { ...Object.fromEntries(folders.map((folder) => [folder.name, `The folder "${folder.name}"`])), [NONE]: 'No folder was named' },
          },
        }
      : {}),
  })
  if (!answers) return null

  const pick = <T extends string>(id: string, allowed: ReadonlyArray<T>, minimum = 0.4): T | null => {
    const answer = answers[id]
    return answer?.type === 'choice' && answer.confidence >= minimum && allowed.includes(answer.choice as T) ? answer.choice as T : null
  }
  const matchField = pick('match_field', ['sender', 'recipient', 'title', 'content'] as const)
  const action = pick('action', ['store', 'spam', 'trash'] as const)
  const matchValue = pick('match_value', values)
  if (!matchField || !action || !matchValue) return null
  const folderName = pick('folder', [...folders.map((folder) => folder.name), NONE] as const)
  return {
    matchField,
    matchOperator: pick('match_operator', ['contains', 'exact', 'starts_with', 'ends_with'] as const) ?? 'contains',
    matchValue,
    action,
    folderId: action === 'store' ? folders.find((folder) => folder.name === folderName)?.id ?? null : null,
  }
}
