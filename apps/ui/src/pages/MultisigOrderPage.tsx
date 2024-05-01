import { useParams } from "@solidjs/router";
import { Address, beginCell, internal, storeMessageRelaxed } from "@ton/core";
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
import { IS_TESTNET } from "@/utils/is-testnet";
import { getEmulatedTxInfo } from "@/utils/getEmulatedTxInfo";

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
    IS_TESTNET,
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

  const data = await getEmulatedTxInfo(msgCell, true);
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

function TxRow({ item }: { item: BlockchainTransaction }) {
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
    </div>
  );
}
