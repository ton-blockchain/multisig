import { Accessor, createSignal, SignalOptions } from "solid-js";

export type LocalStorageSignal<T> = [
  Accessor<T>,
  (value: Exclude<T, Function>) => void,
];

export function createLocalStorageSignal<T>(
  key: string,
  initialValue: Exclude<T, Function>,
  serialize: (value: T) => string,
  deserialize: (value: string | undefined) => T,
  options?: SignalOptions<T>,
): LocalStorageSignal<T> {
  const storageValue: T = deserialize(localStorage.getItem(key));

  const [signal, setSignal] = createSignal<T>(storageValue, options);

  const set = (value: Exclude<T, Function>): void => {
    if (typeof value === "undefined" || value === null) {
      localStorage.removeItem(key);
      setSignal(initialValue);
    } else {
      localStorage.setItem(key, serialize(value));
      setSignal(value);
    }
  };

  return [signal, set];
}
