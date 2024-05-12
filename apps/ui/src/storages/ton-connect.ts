import {chain} from "@/storages/chain";
import {Address} from "@ton/core";
import {CHAIN, ConnectedWallet, TonConnectUI} from "@tonconnect/ui";
import {createEffect, createMemo, createSignal, onCleanup} from "solid-js";

export const [tonConnectUI, setTonConnectUI] =
  createSignal<TonConnectUI | null>(null);

export const [connectedWallet, setConnectedWallet] = createSignal<ConnectedWallet | null>(null);

export const userAddress = createMemo(() => {
  const wallet = connectedWallet();
  return wallet ? Address.parse(wallet.account.address) : null;
});

export const userFriendlyAddress = createMemo(() => {
  const address = userAddress();
  return address ? address.toString({urlSafe: true, bounceable: false, testOnly: chain() === CHAIN.TESTNET}) : null;
});

createEffect(() => {
  const currentTonConnectUi = tonConnectUI();
  if (!currentTonConnectUi) {
    setConnectedWallet(null);
    return;
  }

  setConnectedWallet(currentTonConnectUi.wallet as ConnectedWallet | null);
  const unsubscribe = currentTonConnectUi.onStatusChange(
    (wallet: ConnectedWallet | null) => setConnectedWallet(wallet));

  onCleanup(() => unsubscribe());
});
