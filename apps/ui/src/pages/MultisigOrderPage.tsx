import { useParams } from "@solidjs/router";
import {
  Address,
  Cell,
  beginCell,
  internal,
  storeMessageRelaxed,
  toNano,
} from "@ton/core";
import {
  MultisigInfo,
  checkMultisig,
  MULTISIG_CODE,
  MULTISIG_ORDER_CODE,
  checkMultisigOrder,
  MultisigOrderInfo,
  Op,
} from "multisig";
import {
  For,
  Match,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";
import { BlockchainTransaction } from "@ton/sandbox";
import { parseInternal } from "@truecarry/tlb-abi";
import { type ParsedBlockchainTransaction, getEmulatedTxInfo } from "utils/src/getEmulatedTxInfo";
import { isTestnet } from "@/storages/chain";

import {
  addressToString,
} from "utils";
import { tonConnectUI } from "@/storages/ton-connect";

const TonStringifier = (input: unknown) =>
  JSON.stringify(
    input,
    (key, value) => {
      if (value instanceof Cell) {
        return value.toBoc().toString("base64");
      }
      if (value?.type === "Buffer") {
        return Buffer.from(value.data).toString("base64");
      }
      if (value instanceof Address) {
        return value.toString();
      }
      return value;
    },
    2,
  );

async function fetchMultisig(
  {
    multisigAddress,
    orderId,
  }: {
    multisigAddress: string;
    orderId: string;
  },
  options: { refetching?: boolean } = {},
): Promise<{ order: MultisigInfo; orderInfo: MultisigOrderInfo }> {
  const isFirst = !options.refetching;
  const multisig = await checkMultisig(
    Address.parseFriendly(multisigAddress),
    MULTISIG_CODE,
    MULTISIG_ORDER_CODE,
    isTestnet(),
    "aggregate",
    isFirst,
  );

  const order = multisig.lastOrders.find(
    (o) => o?.order?.id === BigInt(orderId),
  );

  const orderInfo = await checkMultisigOrder(
    order.order.address,
    MULTISIG_ORDER_CODE,
    multisig,
    false,
    true,
  );

  return { order: multisig, orderInfo };
}

async function fetchOrder({
  multisigAddress,
  order,
  orderInfo,
}: {
  multisigAddress: string;
  order: MultisigInfo;
  orderInfo: MultisigOrderInfo;
}) {
  if (!order) {
    return [];
  }

  const balance = orderInfo.tonBalance;

  const msg = internal({
    to: Address.parse(multisigAddress),
    body: beginCell()
      .storeUint(Op.multisig.execute, 32)
      .storeUint(0, 64)
      .storeUint(orderInfo.orderId, 256)
      .storeUint(Math.floor(orderInfo.expiresAt.getTime() / 1000), 48)
      .storeUint(orderInfo.threshold, 8)
      .storeBuffer(orderInfo.signersCell.hash())
      .storeRef(orderInfo.orderCell)
      .endCell(),
    value: balance,
  });
  msg.info.src = orderInfo.address.address;

  const msgCell = beginCell().store(storeMessageRelaxed(msg)).endCell();

  const data: Array<ParsedBlockchainTransaction> = await getEmulatedTxInfo(
    msgCell,
    true,
    isTestnet(),
  );

  return data;
}

export function MultisigOrderPage() {
  const params = useParams();
  const addressQuery = () => params.address;
  const orderIdQuery = () => params.orderId;

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [multisigInfo] = createResource(
    { multisigAddress: addressQuery(), orderId: orderIdQuery() },
    fetchMultisig,
    {},
  );

  const order = createMemo(() => {
    return (
      multisigInfo?.latest &&
      multisigInfo.latest.order?.lastOrders.find(
        (o) => o?.order?.id === BigInt(params.orderId),
      )
    );
  });

  const [emulatedOrder] = createResource(
    () => ({
      multisigAddress: addressQuery(),
      order: multisigInfo?.latest?.order,
      orderInfo: multisigInfo?.latest?.orderInfo,
    }),
    fetchOrder,
  );

  createEffect(() => {
    if (loading() && multisigInfo.error) {
      setError(multisigInfo.error);
    }
    if (loading() && !multisigInfo.loading) {
      setLoading(false);
    }
  });

  const sendApprove = () => {
    const myAddress = Address.parse(tonConnectUI().account?.address);
    if (!myAddress) {
      return;
    }

    const mySignerIndex = order().orderInfo.signers.findIndex((address) =>
      address.address.equals(myAddress),
    );

    if (mySignerIndex === -1) {
      return;
    }

    const DEFAULT_AMOUNT = toNano("0.1"); // 0.1 TON
    const orderAddressString = addressToString(order().orderInfo.address);
    const amount = DEFAULT_AMOUNT.toString();
    const payload = beginCell()
      .storeUint(0, 32)
      .storeStringTail("approve")
      .endCell()
      .toBoc()
      .toString("base64");

    console.log({ orderAddressString, amount });

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
      messages: [
        {
          address: orderAddressString,
          amount: amount,
          payload: payload, // raw one-cell BoC encoded in Base64
        },
      ],
    };

    tonConnectUI().sendTransaction(transaction);
  };

  return (
    <Switch
      fallback={
        <div id="multisigScreen" class="screen">
          <div class="panel">
            <div>
              <div class="label">Order ID:</div>
              <div id="order_id" class="value">
                #{order().order.id.toString()}
              </div>
              <div class="label">Order Address:</div>
              <div id="order_address" class="value">
                <a
                  href={`https://tonviewer.com/${order().order.address.address.toString(
                    {
                      urlSafe: true,
                      bounceable: true,
                    },
                  )}`}
                  target="_blank"
                >
                  {order().order.address.address.toString({
                    urlSafe: true,
                    bounceable: true,
                  })}
                </a>
              </div>

              <button
                id="order_approveButton"
                class="btn-primary"
                onClick={sendApprove}
              >
                Approve
              </button>

              <div id="order_approveNote">
                or just send 0.1 TON with "approve" text comment to order
                address.
              </div>

              <div>
                <For each={emulatedOrder()}>
                  {(item) => <TxRow item={item} />}
                </For>
              </div>
            </div>
            <button id="order_backButton">Back</button>
          </div>
        </div>
      }
    >
      <Match when={loading()}>
        <div id="loadingScreen" class="screen">
          <div class="loading"></div>
        </div>
      </Match>
      <Match when={error()}>
        <div id="errorScreen" class="screen">
          <div class="panel">
            <div class="error">{error()}</div>
          </div>
        </div>
      </Match>
      <Match when={!order()}>
        <div id="errorScreen" class="screen">
          <div class="panel">
            <div class="error">Order not found</div>
          </div>
        </div>
      </Match>
    </Switch>
  );
}

function TxRow({ item }: { item: ParsedBlockchainTransaction }) {
  const to = item?.inMessage?.info?.dest;
  const from = item?.inMessage?.info?.src ?? "external";

  let computeExit = 0;
  if (item.description.type === "generic") {
    if (item.description.computePhase.type === "vm") {
      computeExit = item.description.computePhase.exitCode;
    }
  }
  return (
    <div>
      <div>Transaction</div>
      <div>From: {from.toString()}</div>
      <div>To: {to?.toString()}</div>

      <div>
        Amount:{" "}
        {item.inMessage.info.type === "internal"
          ? item.inMessage.info.value.coins.toString()
          : ""}
      </div>
      <div>OutMessagesCount: {item.outMessagesCount}</div>
      <div>Compute Exit: {computeExit}</div>
      <div>
        Parsed: <pre>{TonStringifier(item.parsed)}</pre>
      </div>
    </div>
  );
}
