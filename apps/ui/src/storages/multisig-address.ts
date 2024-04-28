import { Address } from "@ton/core";
import { createLocalStorageSignal } from "../utils/create-local-storage-signal";

const storageKey = "multisigAddress";

export const [multisigAddress, setMultisigAddress] =
  createLocalStorageSignal<Address | null>(
    storageKey,
    null,
    (value) => value.toString({ urlSafe: true, bounceable: true }),
    (value) => {
      try {
        return Address.parse(value);
      } catch {
        return null;
      }
    },
  );
