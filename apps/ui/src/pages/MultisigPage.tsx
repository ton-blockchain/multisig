import { useParams } from "@solidjs/router";
import { Address } from "@ton/core";
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
import { MultisigIndex } from "../components/MultisigIndex";
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
  const params = useParams();

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

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
          <MultisigIndex info={multisigInfo.latest} />
        </Show>
      </Show>
    </>
  );
};
