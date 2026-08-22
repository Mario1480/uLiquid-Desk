export function createLazyUliqService<T extends object>(factory: () => T): T {
  let instance: T | null = null;
  return new Proxy({} as T, {
    get(_target, property) {
      instance ??= factory();
      const value = Reflect.get(instance, property);
      return typeof value === "function" ? value.bind(instance) : value;
    }
  });
}
