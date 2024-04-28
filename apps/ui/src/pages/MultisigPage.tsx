import { useParams } from "@solidjs/router";
import { Address, fromNano } from "@ton/core";
import {
  checkMultisig,
  MULTISIG_CODE,
  MULTISIG_ORDER_CODE,
  MultisigInfo,
} from "multisig";
import {
  Component,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useNavigation } from "../navigation";
import { setMultisigAddress } from "../storages/multisig-address";
import { IS_TESTNET } from "../utils/is-testnet";

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

export const MultisigPage: Component = () => {
  const navigation = useNavigation();
  const params = useParams();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  const onSwitchMultisig = () => {
    setMultisigAddress(null);
    navigation.toHome();
  };

  const addressQuery = () => params.address;

  const [multisigInfo, { refetch }] = createResource(
    addressQuery,
    fetchMultisig,
    {},
  );

  createEffect(() => {
    if (loading() && multisigInfo.error) {
      setError(multisigInfo.error);
    }
    if (loading() && !multisigInfo.loading) {
      setLoading(false);
    }
  });

  onMount(() => {
    const interval = setInterval(() => {
      if (multisigInfo.loading) return;

      refetch();
    }, 30000);

    onCleanup(() => {
      clearInterval(interval);
    });
  });

  return (
    <>
      <Show when={loading()}>
        <div id="loadingScreen" class="screen">
          <div class="loading"></div>
        </div>
      </Show>
      <Show when={!loading()}>
        <Show when={error()}>
          <div id="errorScreen" class="screen">
            <div class="panel">
              <div class="error">{error()}</div>
            </div>
          </div>
        </Show>
        <Show when={!error()}>
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
                    {fromNano(multisigInfo.latest.tonBalance)}
                  </div>
                </div>

                <div>
                  <div class="label">Threshold:</div>
                  <div id="multisig_threshold" class="value">
                    {multisigInfo.latest.threshold}
                  </div>

                  <div class="label">Signers:</div>
                  <div id="multisig_signersList"></div>

                  <div class="label">Proposers:</div>
                  <div id="multisig_proposersList"></div>

                  <div class="label">Order ID:</div>
                  <div id="multisig_orderId" class="value">
                    {multisigInfo.latest.allowArbitraryOrderSeqno
                      ? "Arbitrary"
                      : multisigInfo.latest.nextOderSeqno.toString()}
                  </div>

                  <button id="multisig_updateButton">
                    Change multisig configuration
                  </button>
                </div>

                <button id="multisig_createNewOrderButton" class="btn-primary">
                  Create new order
                </button>

                <div id="mainScreen_ordersList"></div>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </>
  );
};
