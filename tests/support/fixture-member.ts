/**
 * 夹具里按位置取成员：位置不存在说明夹具本身坏了，直接抛出，而不是用非空断言绕过 `noUncheckedIndexedAccess`。
 */
export function fixtureMember<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture member ${index} is missing`);
  return item;
}
