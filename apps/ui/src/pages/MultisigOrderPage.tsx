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
  Show,
  Switch,
} from "solid-js";
import {
  addressToString,
  cn,
  getEmulatedTxInfo,
  IsTxGenericSuccess,
  equalsMsgAddresses,
  getTonClient4,
} from "utils";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import qrcode from "qrcode-generator";
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
import { userAddress } from "@/storages/ton-connect";
import { YouBadge } from "@/components/YouBadge";

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

  let blockSeqno = undefined;
  if (orderInfo.isExecuted) {
    const orderId = order.lastOrders.find(o => o?.order?.id === orderInfo.orderId);
    if (orderId) {
      const client = await getTonClient4(isTestnet());
      const block = await client.getBlockByUtime(orderId.utime);
      blockSeqno = block.shards.find(p => p.workchain === -1).seqno;
    }
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

  const data = await getEmulatedTxInfo(msgCell, true, isTestnet(), blockSeqno);

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
    console.log(
      multisigInfo?.latest, 
      params.orderId, 
      multisigInfo?.latest &&
      multisigInfo.latest.order?.lastOrders.find(
        (o) => o?.order?.id === BigInt(params.orderId),
      )
    );

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

  const APPROVE_PAYLOAD = createMemo(() => {
    if (!order()) {
      return "";
    }
    return order().order.address.address.toString({
      urlSafe: true,
      bounceable: true,
    });
    // return `ton://transfer/${order().order.address.address.toString({
    //   urlSafe: true,
    //   bounceable: true,
    // })}?amount=100000000&text=approve`;
  });

  const qrCodeSvg = createMemo(() => {
    const qr = qrcode(0, "L");
    qr.addData(APPROVE_PAYLOAD());
    qr.make();
    return qr.createSvgTag(4);
  });

  return (
    <Switch
      fallback={
        <div id="multisigScreen" class="screen">
          <div class="panel">
            <button 
              id="order_backButton_top" 
              onClick={goToMultisigPage} 
              class="mb-6 flex items-center text-[#0088cc] hover:text-[#006699] transition-colors duration-200"
            >
              <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
              </svg>
              Back to Multisig
            </button>
            <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div class="mb-4">
                <div class="text-sm text-gray-500 mb-1">Order ID:</div>
                <div id="order_id" class="text-lg font-medium">
                  #{order().order.id.toString()}
                </div>
              </div>
              
              <div class="mb-4">
                <div class="text-sm text-gray-500 mb-1">Order Address:</div>
                <div id="order_address" class="text-lg font-medium break-all">
                  <a
                    href={`https://tonviewer.com/${order().order.address.address.toString({
                      urlSafe: true,
                      bounceable: true,
                    })}`}
                    target="_blank"
                    class="text-blue-500 hover:text-blue-700 transition-colors duration-200"
                  >
                    {order().order.address.address.toString({
                      urlSafe: true,
                      bounceable: true,
                    })}
                  </a>
                </div>
              </div>

              <div class="mb-4">
                <div class="text-sm text-gray-500 mb-1">Signers:</div>
                <div id="order_signersList" class="space-y-2">
                  <Show when={order() && order().orderInfo}>
                    <For each={order().orderInfo.signers}>
                      {(signer, index) => {
                        const signerAddress = signer.address.toString({urlSafe: true, bounceable: false});
                        return (
                          <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                            <div class="flex items-center">
                              <span class="text-gray-600 mr-2">#{index() + 1}</span>
                              <a href={`https://tonviewer.com/${signerAddress}`} target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 transition-colors duration-200">{signerAddress}</a>
                              {equalsMsgAddresses(signer.address, userAddress()) && <YouBadge />}
                            </div>
                            <div>
                              {order().orderInfo.approvalsMask & (1 << index()) 
                                ? <span class="text-green-500">✅ Approved</span> 
                                : <span class="text-red-500">❌ Not approved</span>
                              }
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>

              <div>
                <div class="text-sm text-gray-500 mb-1">Approvals:</div>
                <div id="order_approvals" class="text-lg font-medium">
                  <Show 
                    when={order() && order()?.orderInfo}
                    fallback="Loading..."
                  >
                    {order().orderInfo.approvalsNum} / {order().orderInfo.threshold}
                    {order().orderInfo.isExecuted && " (Executed)"}
                  </Show>
                </div>
              </div>
            </div>
            <div class="flex items-center my-4">
              <div class="flex-1 flex justify-center items-center">
                <button
                  id="order_approveButton"
                  class={cn(
                    "bg-[#0088cc] text-white",
                    emulationErrored() && "bg-red-500",
                  )}
                  onClick={sendApprove}
                >
                  Approve
                </button>
              </div>
              <div class="w-px bg-gray-300 h-20 mx-4"></div>
              <div class="flex-1 flex justify-center items-center">
                <div innerHTML={qrCodeSvg()} />
              </div>
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



