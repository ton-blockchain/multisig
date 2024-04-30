import { useParams } from "@solidjs/router";
import { Address, fromNano } from "@ton/core";
import { LastOrder, MultisigInfo } from "multisig";
import { For, JSXElement } from "solid-js";
import { useNavigation } from "src/navigation";
import { addressToString } from "utils";
import { setMultisigAddress } from "@/storages/multisig-address";
import { tonConnectUI } from "@/storages/ton-connect";

export function MultisigIndex({ info }: { info: MultisigInfo }): JSXElement {
  const navigation = useNavigation();
  const params = useParams();

  const onSwitchMultisig = () => {
    setMultisigAddress(null);
    navigation.toHome();
  };

  return (
    <div id="multisigScreen" class="screen">
      <div class="panel">
        <div>
          <div class="label">Multisig Address:</div>

          <div id="mulisig_address" class="value">
            <a
              href={`https://tonviewer.com/${params.address}`}
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
            <div id="multisig_signersList"></div>

            <div class="label">Proposers:</div>
            <div id="multisig_proposersList"></div>

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

          <button id="multisig_createNewOrderButton" class="btn-primary">
            Create new order
          </button>

          <OrdersList info={info} />
        </div>
      </div>
    </div>
  );
}

function OrdersList({ info }: { info: MultisigInfo }): JSXElement {
  const userAccount = tonConnectUI().account;
  const userAddress = userAccount.address
    ? Address.parse(userAccount.address)
    : undefined;

  return (
    <div id="mainScreen_ordersList">
      <For each={info.lastOrders}>
        {(lastOrder) => {
          if (lastOrder?.errorMessage?.startsWith("Contract not active")) {
            return <></>;
          }

          if (lastOrder?.errorMessage?.startsWith("Failed")) {
            return (
              <div
                class="multisig_lastOrder"
                order-id={lastOrder.order.id}
                order-address={addressToString(lastOrder.order.address)}
              >
                <span class="orderListItem_title">
                  Failed Order #{lastOrder.order.id.toString(10)}
                </span>{" "}
                — Execution error
              </div>
            );
          }

          if (lastOrder?.errorMessage) {
            return (
              <div
                class="multisig_lastOrder"
                order-id={lastOrder.order.id}
                order-address={addressToString(lastOrder.order.address)}
              >
                <span class="orderListItem_title">
                  Invalid Order #{lastOrder.order.id.toString(10)}
                </span>{" "}
                — {lastOrder.errorMessage}
              </div>
            );
          }

          const isExpired = lastOrder.orderInfo
            ? new Date().getTime() > lastOrder.orderInfo.expiresAt.getTime()
            : false;
          const actionText = isExpired
            ? "Expired order "
            : formatOrderType(lastOrder);

          let signerText = "";
          if (lastOrder.type === "pending" && userAddress) {
            const myIndex = lastOrder.orderInfo.signers.findIndex((signer) =>
              signer.address.equals(userAddress),
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
            <div
              class="multisig_lastOrder"
              order-id={lastOrder.order.id}
              order-address={addressToString(lastOrder.order.address)}
            >
              <span class="orderListItem_title">
                {actionText} #{lastOrder.order.id.toString()}
                {signerText || <></>}
                {userAddress?.toString()}
              </span>
            </div>
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
