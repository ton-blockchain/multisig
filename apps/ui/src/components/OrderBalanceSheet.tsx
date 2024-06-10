import { Address, TupleItemSlice } from "@ton/core";
import { Accessor, createResource, For } from "solid-js";
import { Account } from "tonapi-sdk-js";
import { fromUnits, GetAccount, ParsedBlockchainTransaction } from "utils";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { tonapiClient } from "@/storages/ton-client";
import { multisigAddress } from "@/storages/multisig-address";
import { isTestnet } from "@/storages/chain";

type BalanceSheetRow = {
  assetAddress: string;
  assetName: string;
  toAddress: string;
  amount: bigint;
  isMe: boolean;
  decimals: number;
};

type AssetInfo = {
  assetName: string;
  amount: bigint;
  decimals: number;
};

type TransposeBalanceSheetRow = {
  address: string;
  isMe: boolean;
  account: Account;
  balances: Record<string, AssetInfo>;
};

async function replaceJettonWallets({
  emulated,
}: {
  emulated: EmulationResult;
}): Promise<{ rows: TransposeBalanceSheetRow[]; keys: string[] }> {
  const tonsMapLocal = new Map();
  // console.log("transactions", transactions());
  if (!emulated?.transactions) {
    return { rows: [], keys: [] };
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

  const keys: Set<string> = new Set();
  const transposeRowsMap: Map<string, TransposeBalanceSheetRow> = new Map();
  await Promise.all(
    rows.map(async (row) => {
      const account = await GetAccount.load({
        address: Address.parse(row.toAddress),
        isTestnet: isTestnet(),
      });

      // add account to transposeRows map
      if (!transposeRowsMap.has(row.toAddress)) {
        transposeRowsMap.set(row.toAddress, {
          address: row.toAddress,
          isMe: row.isMe,
          account: account,
          balances: {},
        });
      }

      // add asset to transposeRows map
      const balances = transposeRowsMap.get(row.toAddress).balances;
      if (balances[row.assetName]) {
        throw new Error("Unexpected duplicate asset");
      }
      balances[row.assetName] = {
        assetName: row.assetName,
        amount: row.amount,
        decimals: row.decimals,
      };

      // add asset to keys
      keys.add(row.assetName);
    }),
  );

  // transpose rows to table address/asset
  /*
    | Address | TON | JETTON1 | JETTON2 |
    |---------|-----|---------|---------|
    | 0x123   | 100 | 200     | 300     |
    | 0x456   | 400 | 500     | 600     |
  */

  return {
    rows: Array.from(transposeRowsMap.values()),
    keys: Array.from(keys),
  };
}

export function OrderBalanceSheet({
  emulated,
}: {
  emulated: Accessor<EmulationResult>;
}) {
  // const myAddress = multisigAddress();
  // const [tonsMap, setTonsMap] = createSignal(new Map<string, bigint>());

  const [jettonComputedSheets] = createResource(
    emulated,
    () => replaceJettonWallets({ emulated: emulated() }),
    {},
  );

  // console.log("tonsMap", tonsMap.entries());

  return (
    <div>
      <h1 class={"text-2xl font-bold"}>Order Balance Sheet</h1>

      <table class="table-fixed border-separate border-spacing-0 border border-slate-500">
        <thead>
          <tr>
            <th class="border border-slate-600 px-2 text-left h-4">Address</th>
            <For each={jettonComputedSheets()?.keys ?? []}>
              {(key) => {
                return (
                  <th class="border border-slate-600 px-2 text-right h-4">
                    {key}
                  </th>
                );
              }}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={jettonComputedSheets()?.rows ?? []}>
            {({ isMe, address, account, balances }) => {
              const keys = jettonComputedSheets().keys;
              const friendlyAddress = Address.parse(address).toString({
                urlSafe: true,
                bounceable: !account.is_wallet,
              });

              return (
                <tr>
                  <td class="border border-slate-600 px-2 text-left">
                    <a
                      href={`https://tonviewer.com/${friendlyAddress}`}
                      target={"_blank"}
                    >
                      {isMe ? <b>Multisig</b> : <pre>{friendlyAddress}</pre>}
                    </a>
                    <div>
                      {account.interfaces?.join(", ") ?? "unknown contract"}
                    </div>
                  </td>
                  <For each={keys}>
                    {(key) => {
                      const assetInfo = balances[key];
                      if (!assetInfo) {
                        return <td class="border border-slate-600 px-2"></td>;
                      }

                      let amount = fromUnits(
                        assetInfo.amount.toString(),
                        assetInfo.decimals,
                      );

                      // add 0 after dot if needed
                      if (amount.indexOf(".") !== -1) {
                        const [left, right] = amount.split(".");
                        amount = `${left}.${right.padEnd(assetInfo.decimals, "0")}`;
                      }

                      return (
                        <td class="border border-slate-600 px-2 text-right">
                          {amount}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
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
