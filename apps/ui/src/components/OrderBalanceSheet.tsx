import { ParsedBlockchainTransaction, fromUnits } from "utils";
import { Accessor, For, createResource } from "solid-js";
import { Address, TupleItemSlice } from "@ton/core";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { multisigAddress } from "@/storages/multisig-address";
import { tonapiClient } from "@/storages/ton-client";

type BalanceSheetRow = {
  assetAddress: string;
  assetName: string;
  toAddress: string;
  amount: bigint;
  isMe: boolean;
  decimals: number;
};
async function replaceJettonWallets({
  emulated,
}: {
  emulated: EmulationResult;
}) {
  const tonsMapLocal = new Map();
  // console.log("transactions", transactions());
  if (!emulated?.transactions) {
    return [];
  }
  for (const [i, tx] of emulated.transactions.entries()) {
    console.log("Processing tx", tx);
    if (
      // tx.inMessage.info.type !== "external-in" &&
      tx.inMessage.info.type !== "internal"
    )
      continue;

    const currentAddress = tx.inMessage.info.dest.toRawString();
    const tonAddress = `ton/${currentAddress}`;
    if (tx.inMessage.info.type === "internal" && i > 0) {
      tonsMapLocal.set(
        tonAddress,
        (tonsMapLocal.get(tonAddress) || 0n) + tx.inMessage.info.value.coins,
      );
    }
    // first calculate tons
    for (const [, message] of tx.outMessages) {
      if (message.info.type === "internal") {
        tonsMapLocal.set(
          tonAddress,
          (tonsMapLocal.get(tonAddress) || 0n) - message.info.value.coins,
        );
      }
    }

    if (tx?.parsed?.internal === "jetton_transfer" && IsTxGenericSuccess(tx)) {
      if (tx.inMessage.info.type !== "internal") {
        throw new Error("Unexpected internal message type");
      }
      const jettonAddress = `${tx.inMessage.info.dest.toRawString()}/${tx.inMessage.info.src.toRawString()}`;
      tonsMapLocal.set(
        jettonAddress,
        (tonsMapLocal.get(jettonAddress) || 0n) - tx.parsed.data.amount,
      );
    }

    if (
      tx?.parsed?.internal === "jetton_internal_transfer" &&
      IsTxGenericSuccess(tx)
    ) {
      if (tx.inMessage.info.type !== "internal") {
        throw new Error("Unexpected internal message type");
      }
      const parent = tx.parent;
      if (
        !parent ||
        parent?.description.type !== "generic" ||
        parent?.parsed?.internal !== "jetton_transfer"
      ) {
        throw new Error("Unexpected parent type");
      }
      if (!(parent.parsed.data.destination instanceof Address)) {
        throw new Error("Unexpected destination type");
      }
      const jettonAddress = `${tx.inMessage.info.dest.toRawString()}/${(parent.parsed.data.destination as Address).toRawString()}`;
      tonsMapLocal.set(
        jettonAddress,
        (tonsMapLocal.get(jettonAddress) || 0n) + tx.parsed.data.amount,
      );
    }
  }

  console.log("replaceJettonWallets");
  const promises: Promise<BalanceSheetRow>[] = [];
  for (const [address, balance] of tonsMapLocal.entries()) {
    promises.push(
      (async () => {
        const [assetAddress, toAddress] = address.split("/");

        console.log("check address", toAddress, multisigAddress());
        if (assetAddress === "ton") {
          return {
            assetAddress: assetAddress,
            assetName: "TON",
            toAddress: toAddress,
            amount: balance,
            isMe:
              multisigAddress() &&
              Address.parse(toAddress).equals(multisigAddress()),
            decimals: 9,
          };
        }

        const jettonWalletInfo = await emulated.blockchain.runGetMethod(
          Address.parse(assetAddress),
          "get_wallet_data",
          [],
        );
        console.log("jettonWalletInfo", jettonWalletInfo);
        if (jettonWalletInfo.stack.length !== 4) {
          throw new Error("Unexpected stack length");
        }
        const jettonWalletMasterAddress = (
          jettonWalletInfo.stack[2] as TupleItemSlice
        ).cell
          .beginParse()
          .loadAddress();

        // const jettonMasterTonapi =
        //   await tonapiClient().blockchain.execGetMethodForBlockchainAccount(
        //     jettonWalletMasterAddress.toString(),
        //     "",
        //   );
        const jetton = await tonapiClient().jettons.getJettonInfo(
          jettonWalletMasterAddress.toString(),
        );
        console.log("jetton", jetton);

        return {
          assetAddress: assetAddress,
          assetName: jetton.metadata.name,
          toAddress: toAddress,
          amount: balance,
          decimals: Number(jetton.metadata.decimals),
          isMe:
            multisigAddress() &&
            Address.parse(toAddress).equals(multisigAddress()),
        };

        // promises.push({
        //   tonAddress: assetAddress,
        //   jettonAddress: toAddress,
        //   jettonBalance,
        // });
      })(),
    );
  }
  const rows = await Promise.all(promises);
  return rows;
}

export function OrderBalanceSheet({
  emulated,
}: {
  emulated: Accessor<EmulationResult>;
}) {
  // const myAddress = multisigAddress();
  // const [tonsMap, setTonsMap] = createSignal(new Map<string, bigint>());

  const [jettonComputedSheets] = createResource(
    { emulated: emulated() },
    replaceJettonWallets,
    {},
  );

  // console.log("tonsMap", tonsMap.entries());

  return (
    <div>
      <h1>Order Balance Sheet</h1>
      <For each={jettonComputedSheets()}>
        {({ assetName, toAddress, amount: balance, isMe, decimals }) => (
          <div>
            <div class={isMe ? "me" : "not_me"}>
              Address: {assetName} {isMe ? "Multisig" : toAddress}
            </div>
            <div>Balance: {fromUnits(balance.toString(), decimals)}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function IsTxGenericSuccess(tx: ParsedBlockchainTransaction) {
  if (tx.description.type !== "generic") {
    return false;
  }

  if (tx.description.aborted) {
    return false;
  }

  if (
    tx.description.computePhase.type !== "vm" ||
    tx.description.computePhase.exitCode !== 0
  ) {
    return false;
  }

  if (tx.description.actionPhase.resultCode !== 0) {
    return false;
  }

  return true;
}
