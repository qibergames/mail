export function clampMessageListWidth(width: number, containerWidth: number) {
  return Math.min(Math.max(width, 288), Math.max(288, containerWidth - 320))
}
