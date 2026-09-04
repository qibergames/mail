const FROM_LINE = /^From /

export function splitMboxMessages(content: string) {
  const messages: string[] = []
  let current: string[] = []

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (FROM_LINE.test(line)) {
      if (current.length) messages.push(current.join('\n').replace(/\n$/, '').replace(/\n>From /g, '\nFrom '))
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) messages.push(current.join('\n').replace(/\n$/, '').replace(/\n>From /g, '\nFrom '))
  return messages.filter((message) => message.trim())
}
