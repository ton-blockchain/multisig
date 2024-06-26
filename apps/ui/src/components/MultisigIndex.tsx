/* eslint-disable no-alert */
import { A, useParams } from "@solidjs/router";
import { fromNano } from "@ton/core";
import { LastOrder, MultisigInfo } from "multisig";
import {
  For,
  JSXElement,
  Match,
  Show,
  Switch,
  createResource,
  createMemo,
} from "solid-js";
import { useNavigation } from "src/navigation";
import { addressToString, cn, equalsMsgAddresses } from "utils";
import { userAddress } from "@/storages/ton-connect";
import { setMultisigAddress } from "@/storages/multisig-address";
import { isTestnet } from "@/storages/chain";
import { YouBadge } from "@/components/YouBadge";

async function fetchTonPrice(): Promise<number> {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
    );
    const data = await response.json();
    return data["the-open-network"].usd;
  } catch (error) {
    console.error("Error fetching TON price:", error);
    return 0;
  }
}

export function MultisigIndex({ info }: { info: MultisigInfo }): JSXElement {
  const navigation = useNavigation();
  const params = useParams();

  const onSwitchMultisig = () => {
    setMultisigAddress(null);
    navigation.toHome();
  };

  const createNewOrder = () => {
    alert("Use TonDevWallet to create a new order");
  };

  const [tonPrice] = createResource(fetchTonPrice);

  const tonBalanceUsd = createMemo(() => {
    if (!tonPrice()) return 0;
    return parseFloat(fromNano(info.tonBalance)) * tonPrice();
  });

  return (
    <div id="multisigScreen" class="screen">
      <div class="panel bg-white rounded-lg shadow-sm p-6">
        <div class="mb-6">
          <div class="text-sm text-gray-500 mb-1">Multisig Address:</div>
          <div id="mulisig_address" class="text-lg font-medium break-all">
            <a
              href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${params.address}`}
              target="_blank"
              class="text-blue-500 hover:text-blue-700 transition-colors duration-200"
            >
              {params.address}
            </a>
          </div>
          <button
            id="multisig_logoutButton"
            onClick={onSwitchMultisig}
            class="mt-2 text-[#0088cc] hover:text-[#006699] transition-colors duration-200"
          >
            Switch to another multisig
          </button>
        </div>

        <div id="multisig_error"></div>

        <div id="multisig_content">
          <div class="mb-6">
            <div class="text-sm text-gray-500 mb-1">TON Balance:</div>
            <div id="multisig_tonBalance" class="text-lg font-medium">
              {fromNano(info.tonBalance)} TON
              <Show when={tonPrice() > 0}>
                <span class="text-sm text-gray-500 ml-2">
                  (${tonBalanceUsd().toFixed(2)} USD)
                </span>
              </Show>
            </div>
          </div>

          <div class="mb-6">
            <div class="text-sm text-gray-500 mb-1">Threshold:</div>
            <div id="multisig_threshold" class="text-lg font-medium">
              {info.threshold} / {info.signers.length}
            </div>
          </div>

          <div class="mb-6">
            <div class="text-sm text-gray-500 mb-1">Signers:</div>
            <div id="multisig_signersList" class="space-y-2">
              <For each={info.signers}>
                {(signer, i) => {
                  const signerAddress = signer.address.toString({
                    urlSafe: true,
                    bounceable: false,
                    testOnly: isTestnet(),
                  });

                  return (
                    <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div class="flex items-center">
                        <span class="text-gray-600 mr-2">#{i() + 1}</span>
                        <a
                          href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${signerAddress}`}
                          target="_blank"
                          class="text-blue-500 hover:text-blue-700 transition-colors duration-200"
                        >
                          {signerAddress}
                        </a>
                      </div>
                      {equalsMsgAddresses(signer.address, userAddress()) && (
                        <YouBadge />
                      )}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>

          <div class="mb-6">
            <div class="text-sm text-gray-500 mb-1">Proposers:</div>
            <div id="multisig_proposersList" class="space-y-2">
              <For each={info.proposers}>
                {(proposer, i) => {
                  const proposerAddress = proposer.address.toString({
                    urlSafe: true,
                    bounceable: false,
                    testOnly: isTestnet(),
                  });

                  return (
                    <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div class="flex items-center">
                        <span class="text-gray-600 mr-2">#{i() + 1}</span>
                        <a
                          href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${proposerAddress}`}
                          target="_blank"
                          class="text-blue-500 hover:text-blue-700 transition-colors duration-200"
                        >
                          {proposerAddress}
                        </a>
                      </div>
                      {equalsMsgAddresses(proposer.address, userAddress()) && (
                        <YouBadge />
                      )}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>

          <div class="mb-6">
            <div class="text-sm text-gray-500 mb-1">Order ID:</div>
            <div id="multisig_orderId" class="text-lg font-medium">
              {info.allowArbitraryOrderSeqno
                ? "Arbitrary"
                : info.nextOderSeqno.toString()}
            </div>
          </div>

          <button
            id="multisig_updateButton"
            class="mb-6 text-[#0088cc] hover:text-[#006699] transition-colors duration-200"
          >
            Change multisig configuration
          </button>

          <button
            id="multisig_createNewOrderButton"
            class="w-full bg-[#0088cc] text-white py-2 px-4 rounded-full hover:bg-[#006699] transition-colors duration-200"
            onClick={createNewOrder}
          >
            Create new order
          </button>

          <OrdersList info={info} />
        </div>
      </div>
    </div>
  );
}

function OrdersList({ info }: { info: MultisigInfo }): JSXElement {
  return (
    <div id="mainScreen_ordersList" class="mt-6 space-y-2">
      <For each={info.lastOrders}>
        {(lastOrder) => {
          if (lastOrder?.errorMessage?.startsWith("Contract not active")) {
            return <></>;
          }

          const isExpired = lastOrder.orderInfo
            ? new Date().getTime() > lastOrder.orderInfo.expiresAt.getTime()
            : false;
          const actionText = isExpired
            ? "Expired order "
            : formatOrderType(lastOrder);

          let signerText = "";
          if (lastOrder.type === "pending" && userAddress()) {
            const myIndex = lastOrder.orderInfo.signers.findIndex((signer) =>
              signer.address.equals(userAddress()),
            );
            if (myIndex > -1) {
              const mask = 1 << myIndex;
              const isSigned = lastOrder.orderInfo.approvalsMask & mask;

              signerText = isSigned
                ? " — You approved"
                : ` — You haven't approved yet`;
            }
          }

          const errorMessages = lastOrder?.orderInfo?.errors?.join(", ");

          return (
            <A
              class={cn(
                "block bg-gray-50 p-3 rounded hover:bg-gray-100 transition-colors duration-200",
                lastOrder.orderInfo.isExecuted && "bg-green-50",
                lastOrder.orderInfo.errors?.length > 0 && "bg-red-50",
              )}
              order-id={lastOrder.order.id}
              order-address={addressToString(lastOrder.order.address)}
              href={`/multisig/${info.address.address.toString({
                bounceable: true,
                urlSafe: true,
              })}/${lastOrder.order.id.toString()}`}
            >
              <Switch>
                <Match when={errorMessages}>
                  <span class="font-medium text-red-500">
                    Invalid Order #{lastOrder.order.id.toString(10)}
                  </span>
                  <span class="text-gray-600"> — {errorMessages}</span>
                </Match>
                <Match when={lastOrder?.errorMessage?.startsWith("Failed")}>
                  <span class="font-medium text-red-500">
                    Failed Order #{lastOrder.order.id.toString(10)}
                  </span>
                  <span class="text-gray-600"> — Execution error</span>
                </Match>
                <Match when={lastOrder?.errorMessage}>
                  <span class="font-medium text-red-500">
                    Invalid Order #{lastOrder.order.id.toString(10)}
                  </span>
                  <span class="text-gray-600"> — {lastOrder.errorMessage}</span>
                </Match>
                <Match when={!lastOrder?.errorMessage}>
                  <span class="font-medium">
                    {actionText} #{lastOrder.order.id.toString()}
                  </span>
                  <span class="text-gray-600">{signerText}</span>
                </Match>
              </Switch>
            </A>
          );
        }}
      </For>
    </div>
  );
}

function formatOrderType(lastOrder: LastOrder): string {
  switch (lastOrder.type) {
    case "new":
      return "New order";
    case "execute":
      return "Execute order";
    case "pending":
      return "Pending order";
    case "executed":
      return "Executed order";
    default:
      throw new Error(`unknown order type ${lastOrder.type}`);
  }
}
