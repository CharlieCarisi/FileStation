export const __name = (target, name) =>
  Object.defineProperty(target, "name", { value: name, configurable: true });
