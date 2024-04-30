import { TonConnectUI } from "@tonconnect/ui";
import { createSignal } from "solid-js";

export const [tonConnectUI, setTonConnectUI] =
  createSignal<TonConnectUI | null>(null);
