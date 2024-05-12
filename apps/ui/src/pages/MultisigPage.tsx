import {isTestnet} from "@/storages/chain";
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
  Match,
  onCleanup,
  onMount,
  Switch,
} from "solid-js";
import { MultisigIndex } from "../components/MultisigIndex";

function fetchMultisig(
  multisigAddress: string,
  options: { refetching?: boolean } = {},
): Promise<MultisigInfo> {
  const isFirst = !options.refetching;
  return checkMultisig(
    Address.parseFriendly(multisigAddress),
    MULTISIG_CODE,
    MULTISIG_ORDER_CODE,
    isTestnet(),
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
    if ((loading() || !multisigInfo.latest) && multisigInfo.error) {
      if (multisigInfo.error instanceof Error) {
        setError(multisigInfo.error.toString());
      } else {
        setError(multisigInfo.error);
      }
      setLoading(false);
    }
    if (loading() && !multisigInfo.loading) {
      setLoading(false);
    }
    if (!loading() && error() && multisigInfo.latest) {
      setError(null);
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
      <Switch fallback={<MultisigIndex info={multisigInfo.latest} />}>
        <Match when={error()}>
          <div id="errorScreen" class="screen">
            <div class="panel">
              <div class="error">{error()}</div>
            </div>
          </div>
        </Match>
        <Match when={loading()}>
          <div id="loadingScreen" class="screen">
            <div class="loading"></div>
          </div>
        </Match>
      </Switch>
    </>
  );
};
