import { TonClient4 } from "@ton/ton";
import { createMemo } from "solid-js";
import { isMainnet } from "@/storages/chain";

const MAINNET_ENDPOINT = "https://mainnet-v4.tonhubapi.com";
const TESTNET_ENDPOINT = "https://testnet-v4.tonhubapi.com";

export const endpoint = createMemo(() =>
  isMainnet() ? MAINNET_ENDPOINT : TESTNET_ENDPOINT,
);

export const client = createMemo(
  () => new TonClient4({ endpoint: endpoint() }),
);
