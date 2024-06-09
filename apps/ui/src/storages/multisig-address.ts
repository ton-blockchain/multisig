import { Address } from "@ton/core";
import { isTestnet } from "@/storages/chain";
import { createLocalStorageSignal } from "../utils/create-local-storage-signal";

const storageKey = "multisigAddress";

export const [multisigAddress, setMultisigAddress] =
  createLocalStorageSignal<Address | null>(
    storageKey,
    null,
    (value) =>
      value.toString({
        urlSafe: true,
        bounceable: true,
        testOnly: isTestnet(),
      }),
    (value) => {
      try {
        return Address.parse(value);
      } catch {
        return null;
      }
    },
  );
