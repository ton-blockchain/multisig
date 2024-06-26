/* eslint-disable no-alert */
import { A, useParams } from "@solidjs/router";
import { fromNano } from "@ton/core";
import { LastOrder, MultisigInfo } from "multisig";
import { For, JSXElement, Match, Show, Switch } from "solid-js";
import { useNavigation } from "src/navigation";
import { addressToString, equalsMsgAddresses } from "utils";
import { userAddress } from "@/storages/ton-connect";
import { setMultisigAddress } from "@/storages/multisig-address";
import { isTestnet } from "@/storages/chain";
import { YouBadge } from "@/components/YouBadge";

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

  return (
    <div id="multisigScreen" class="screen">
      <div class="panel">
        <div>
          <div class="label">Multisig Address:</div>

          <div id="mulisig_address" class="value">
            <a
              href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${params.address}`}
              target={"_blank"}
            >
              {params.address}
            </a>
          </div>

          <button id="multisig_logoutButton" onClick={onSwitchMultisig}>
            Switch to another multisig
          </button>
        </div>

        <div id="multisig_error"></div>

        <div id="multisig_content">
          <div>
            <div class="label">TON Balance:</div>
            <div id="multisig_tonBalance" class="value">
              {fromNano(info.tonBalance)}
            </div>
          </div>

          <div>
            <div class="label">Threshold:</div>
            <div id="multisig_threshold" class="value">
              {info.threshold}
            </div>

            <div class="label">Signers:</div>
            <div id="multisig_signersList">
              <For each={info.signers}>
                {(signer, i) => {
                  const signerAddress = signer.address.toString({
                    urlSafe: true,
                    bounceable: false,
                    testOnly: isTestnet(),
                  });

                  return (
                    <div>
                      #{i() + 1} —{" "}
                      <a
                        href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${signerAddress}`}
                        target="_blank"
                      >
                        {signerAddress}
                      </a>
                      {equalsMsgAddresses(signer.address, userAddress()) && <YouBadge />}
                    </div>
                  );
                }}
              </For>
            </div>

            <div class="label">Proposers:</div>
            <div id="multisig_proposersList">
              <For each={info.proposers}>
                {(proposer, i) => {
                  const proposerAddress = proposer.address.toString({
                    urlSafe: true,
                    bounceable: false,
                    testOnly: isTestnet(),
                  });

                  return (
                    <div>
                      #{i() + 1} —{" "}
                      <a
                        href={`https://${isTestnet() ? "testnet." : ""}tonviewer.com/${proposerAddress}`}
                        target="_blank"
                      >
                        {proposerAddress}
                      </a>
                      {equalsMsgAddresses(proposer.address, userAddress()) ? (
                        <div class="badge">It's you</div>
                      ) : (
                        ""
                      )}
                    </div>
                  );
                }}
              </For>
            </div>

            <div class="label">Order ID:</div>
            <div id="multisig_orderId" class="value">
              {info.allowArbitraryOrderSeqno
                ? "Arbitrary"
                : info.nextOderSeqno.toString()}
            </div>

            <button id="multisig_updateButton">
              Change multisig configuration
            </button>
          </div>

          <button
            id="multisig_createNewOrderButton"
            class="btn-primary"
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
    <div id="mainScreen_ordersList">
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

          return (
            <A
              class="multisig_lastOrder"
              order-id={lastOrder.order.id}
              order-address={addressToString(lastOrder.order.address)}
              href={`/multisig/${info.address.address.toString({
                bounceable: true,
                urlSafe: true,
              })}/${lastOrder.order.id.toString()}`}
            >
              <Switch>
                <Match when={lastOrder?.errorMessage?.startsWith("Failed")}>
                  <span class="orderListItem_title">
                    Failed Order #{lastOrder.order.id.toString(10)}
                  </span>{" "}
                  — Execution error
                </Match>
                <Match when={lastOrder?.errorMessage}>
                  <span class="orderListItem_title">
                    Invalid Order #{lastOrder.order.id.toString(10)}
                  </span>{" "}
                  — {lastOrder.errorMessage}
                </Match>
              </Switch>

              <Show when={!lastOrder?.errorMessage}>
                <span class="orderListItem_title">
                  {actionText} #{lastOrder.order.id.toString()}
                  {signerText || <></>}
                  {/* {userAddress?.toString()} */}
                </span>
              </Show>
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
