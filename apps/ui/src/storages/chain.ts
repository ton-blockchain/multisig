import {CHAIN} from '@tonconnect/ui';
import {createSignal} from "solid-js";

export const [chain, setChain] = createSignal<CHAIN>(CHAIN.TESTNET);
export const isTestnet = () => chain() === CHAIN.TESTNET;
export const isMainnet = () => chain() === CHAIN.MAINNET;
