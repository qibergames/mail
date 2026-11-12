const hungarianWords = new Set(['a', 'az', 'és', 'hogy', 'nem', 'is', 'egy', 'ez', 'meg', 'de', 'van', 'már', 'csak', 'még', 'kell', 'vagy', 'mint', 'itt', 'ha', 'szia', 'köszönöm', 'üdv', 'üdvözlettel', 'kérlek', 'igen'])
const englishWords = new Set(['the', 'and', 'to', 'of', 'is', 'that', 'it', 'for', 'you', 'with', 'this', 'on', 'are', 'be', 'have', 'not', 'will', 'can', 'hi', 'hello', 'thanks', 'please', 'regards'])

/**
 * Best-effort language of a message body, for the Content-Language header.
 * Gmail and others otherwise guess, and short Hungarian messages get flagged as English.
 * Returns undefined when unsure: no header beats a wrong one.
 */
export function detectLanguage(text: string): 'hu' | 'en' | undefined {
  // Quoted reply text says nothing about the language of the new message.
  const own = text.split('\n').filter((line) => !line.trimStart().startsWith('>')).join('\n').toLowerCase()
  if (/[őű]/.test(own)) return 'hu'
  const words = own.match(/\p{L}+/gu) ?? []
  let hu = /[áéíóöúü]/.test(own) ? 2 : 0
  let en = 0
  for (const word of words) {
    if (hungarianWords.has(word)) hu += 1
    if (englishWords.has(word)) en += 1
  }
  if (hu >= 2 && hu > en) return 'hu'
  if (en >= 2 && en > hu) return 'en'
  return undefined
}
