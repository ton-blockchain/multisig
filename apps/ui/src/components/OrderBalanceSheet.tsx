import { Address, TupleItemSlice } from "@ton/core";
import { Accessor, createResource, For } from "solid-js";
import { Account } from "tonapi-sdk-js";
import { fromUnits, GetAccount, IsTxGenericSuccess } from "utils";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { tonapiClient } from "@/storages/ton-client";
import { multisigAddress } from "@/storages/multisig-address";
import { isTestnet } from "@/storages/chain";
import { VerifiedIcon } from "./VerifiedIcon";

type BalanceSheetRow = {
  assetAddress: string;
  assetName: string;
  toAddress: string;
  amount: bigint;
  isMe: boolean;
  decimals: number;
  isVerified: boolean;
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
}): Promise<{
  rows: TransposeBalanceSheetRow[];
  keys: Record<string, { name: string; decimals: number; isVerified: boolean }>;
}> {
  const tonsMapLocal = new Map();
  // console.log("transactions", transactions());
  if (!emulated?.transactions) {
    return { rows: [], keys: {} };
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
            isVerified: true,
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
          isVerified: jetton.verification === "whitelist",
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

  const keys: Record<
    string,
    {
      name: string;
      decimals: number;
      isVerified: boolean;
    }
  > = {};
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
      keys[row.assetName] = {
        name: row.assetName,
        decimals: row.decimals,
        isVerified: row.isVerified,
      };
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
    keys: keys,
  };
}

export function OrderBalanceSheet({
  emulated,
}: {
  emulated: Accessor<EmulationResult>;
}) {
  const [jettonComputedSheets] = createResource(
    emulated,
    () => replaceJettonWallets({ emulated: emulated() }),
    {},
  );

  return (
    <div class="my-8">
      <h2 class="text-2xl font-bold mb-4">Order Balance Sheet</h2>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse bg-white shadow-sm rounded-lg overflow-hidden">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">
                Address
              </th>
              <For each={Object.keys(jettonComputedSheets()?.keys ?? {})}>
                {(key) => (
                  <th class="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                    <div class="flex items-center justify-end space-x-1">
                      <span>{jettonComputedSheets()?.keys[key].name}</span>
                      {jettonComputedSheets()?.keys[key].isVerified && (
                        <VerifiedIcon className="w-4 h-4 text-transparent" />
                      )}
                    </div>
                  </th>
                )}
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
                  <tr class="border-t border-gray-200 hover:bg-gray-50 transition-colors">
                    <td class="px-4 py-3">
                      <a
                        href={`https://tonviewer.com/${friendlyAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {isMe ? (
                          <span class="font-semibold">Multisig</span>
                        ) : (
                          <span class="font-mono text-sm">
                            {friendlyAddress}
                          </span>
                        )}
                      </a>
                      <div class="text-xs text-gray-500 mt-1">
                        {account.interfaces?.join(", ") ?? "Unknown contract"}
                      </div>
                    </td>
                    <For each={Object.keys(keys)}>
                      {(key) => {
                        const assetInfo = balances[key];
                        if (!assetInfo) {
                          return (
                            <td class="px-4 py-3 text-right text-gray-400">
                              -
                            </td>
                          );
                        }

                        let amount = fromUnits(
                          assetInfo.amount.toString(),
                          assetInfo.decimals,
                        );

                        if (amount.indexOf(".") !== -1) {
                          const [left, right] = amount.split(".");
                          amount = `${left}.${right.padEnd(assetInfo.decimals, "0")}`;
                        }

                        return (
                          <td class="px-4 py-3 text-right font-mono">
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
    </div>
  );
}
