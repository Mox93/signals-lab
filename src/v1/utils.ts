export function assert(
  value: unknown,
  message?: string | Error
): asserts value {
  if (!value) {
    throw typeof message === "string" ? Error(message) : message;
  }
}

export abstract class Callable extends Function {
  // @ts-ignore
  // We don't need to call super since we're not using the this keyword
  constructor() {
    const fn = (...args: unknown[]) =>
      (fn as unknown as Callable)._call(...args);

    return Object.setPrototypeOf(fn, new.target.prototype);
  }

  protected _call(..._: unknown[]): unknown {
    throw new Error("not implemented");
  }
}

export function counter() {
  let index = 0;
  return () => index++;
}

export function generateId() {
  return Math.random().toString(36).slice(2);
}
