/**
 * Wakeflow Foundation / Data：读一个对象自己的字符串数据属性（open-items L4）。
 *
 * 只看自有属性的描述符，不触发 getter：用来从别的模块抛出的错误上取 `code` 与 `reason` 这样的短记号。
 * 此前在四个治理模块里各有一份逐字节相同的私有副本。
 */
export function ownString(value, key) {
    if (typeof value !== "object" || value === null)
        return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
        ? descriptor.value
        : null;
}
