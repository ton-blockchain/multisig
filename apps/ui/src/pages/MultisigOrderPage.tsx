import { useParams } from "@solidjs/router";
import { Address } from "@ton/core";
import {
  MultisigInfo,
  checkMultisig,
  MULTISIG_CODE,
  MULTISIG_ORDER_CODE,
} from "multisig";
import {
  Match,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";
import { IS_TESTNET } from "@/utils/is-testnet";

function fetchMultisig(
  multisigAddress: string,
  options: { refetching?: boolean } = {},
): Promise<MultisigInfo> {
  const isFirst = !options.refetching;
  return checkMultisig(
    Address.parseFriendly(multisigAddress),
    MULTISIG_CODE,
    MULTISIG_ORDER_CODE,
    IS_TESTNET,
    "aggregate",
    isFirst,
  );
}

export function MultisigOrderPage() {
  const params = useParams();
  const addressQuery = () => params.address;

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [multisigInfo] = createResource(addressQuery, fetchMultisig, {});

  console.log("o", multisigInfo?.latest?.lastOrders, params.orderId);
  const order = createMemo(() => {
    console.log("createComputed", multisigInfo()?.lastOrders);
    return (
      multisigInfo?.latest &&
      multisigInfo.latest.lastOrders.find(
        (o) => o?.order?.id === BigInt(params.orderId),
      )
    );
  });

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
