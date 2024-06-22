import { useParams } from "@solidjs/router";
import {
  Address,
  beginCell,
  internal,
  storeMessageRelaxed,
  toNano,
} from "@ton/core";
import {
  checkMultisig,
  checkMultisigOrder,
  MULTISIG_CODE,
  MULTISIG_ORDER_CODE,
  MultisigInfo,
  MultisigOrderInfo,
  Op,
} from "multisig";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Switch,
} from "solid-js";
import {
  addressToString,
  cn,
  getEmulatedTxInfo,
  IsTxGenericSuccess,
} from "utils";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { tonConnectUI } from "@/storages/ton-connect";
import {
  multisigAddress,
  setMultisigAddress,
} from "@/storages/multisig-address";
import { isTestnet } from "@/storages/chain";
import { OrderBalanceSheet } from "@/components/OrderBalanceSheet";
import { useNavigation } from "@/navigation";
import { EmulatedTxRow } from "@/components/EmulatedTxRow";
import { EmulatedTxGraph } from "@/components/EmulatedTxGraph";

async function fetchMultisig(
  {
    // eslint-disable-next-line @typescript-eslint/no-shadow
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
  setMultisigAddress(Address.parse(multisigAddress));

  return { order: multisig, orderInfo };
}

async function fetchOrder({
  // eslint-disable-next-line @typescript-eslint/no-shadow
  multisigAddress,
  order,
  orderInfo,
}: {
  multisigAddress: string;
  order: MultisigInfo;
  orderInfo: MultisigOrderInfo;
}): Promise<EmulationResult> {
  if (!order) {
    return undefined;
  }

  const balance = BigInt(orderInfo.tonBalance);
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

  const data = await getEmulatedTxInfo(msgCell, true, isTestnet());

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

  const emulationErrored = createMemo(() => {
    return emulatedOrder()?.transactions.some((tx) => !IsTxGenericSuccess(tx));
  });

  const navigation = useNavigation();

  const goToMultisigPage = () => {
    navigation.toMultisig(
      multisigAddress().toString({ urlSafe: true, bounceable: true }),
    );
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

              <div class="flex items-center my-4">
                <button
                  id="order_approveButton"
                  class={cn(
                    "bg-[#0088cc] text-white mx-auto",
                    emulationErrored() && "bg-red-500",
                  )}
                  onClick={sendApprove}
                >
                  Approve
                </button>
              </div>

              <div id="order_approveNote">
                or just send 0.1 TON with "approve" text comment to order
                address.
              </div>

              <OrderBalanceSheet emulated={emulatedOrder} />

              <EmulatedTxGraph emulated={emulatedOrder()} />

              <div class={"flex flex-col gap-4"}>
                <For each={emulatedOrder()?.transactions}>
                  {(item) => <EmulatedTxRow item={item} />}
                </For>
              </div>
            </div>
            <button id="order_backButton" onClick={goToMultisigPage}>
              Back
            </button>
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
