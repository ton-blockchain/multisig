import {createLocalStorageSignal} from "@/utils/create-local-storage-signal";
import {CHAIN} from '@tonconnect/ui';

const storageKey = "chain";
const defaultValue = CHAIN.MAINNET;

export const [chain, setChain] =
  createLocalStorageSignal<CHAIN | null>(
    storageKey,
    defaultValue,
    (value) => value.toString(),
    (value) => {
      if ([defaultValue, CHAIN.TESTNET].includes(value as CHAIN)) {
        return value as CHAIN;
      }
      return defaultValue;
    }
  );
export const isTestnet = () => chain() === CHAIN.TESTNET;
export const isMainnet = () => chain() === CHAIN.MAINNET;
