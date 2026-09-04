import sharp from 'sharp'

const icons = [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
] as const

await Promise.all(icons.map(([path, size]) => sharp('public/icon.svg').resize(size, size).png().toFile(path)))
await sharp('public/icon.svg').resize(512, 512).flatten({ background: '#2563eb' }).png().toFile('public/icon-maskable-512.png')
