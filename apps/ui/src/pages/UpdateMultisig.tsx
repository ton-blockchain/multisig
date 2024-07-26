import { Address, toNano } from "@ton/core";
import {
  Component,
  createSignal,
  For,
  Show,
  Switch,
  Match,
  createEffect,
  createResource,
  onCleanup,
  onMount,
} from "solid-js";

import {
  checkMultisig,
  MULTISIG_CODE,
  MULTISIG_ORDER_CODE,
  MultisigInfo,
  Multisig,
} from "multisig";
import { useParams } from "@solidjs/router";
import { useNavigation } from "../navigation";
import { isTestnet } from "@/storages/chain";
import { tonConnectUI, userAddress } from "@/storages/ton-connect";
import { sender } from "@/storages/ton-connect-sender";
import { client } from "@/storages/ton-client";
import {
  multisigAddress,
  setMultisigAddress,
} from "@/storages/multisig-address";

enum StateType {
  PROPOSING,
  CONFIRMING,
  UPDATING,
}

type MultisigUpdate = {
  signers: Address[];
  proposers: Address[];
  threshold: number;
};

const fetchMultisig = (
  multisigAddressFetch: string,
  options: { refetching?: boolean } = {},
): Promise<MultisigInfo> => {
  const isFirst = !options.refetching;
  setMultisigAddress(Address.parse(multisigAddressFetch));
  return checkMultisig(
    Address.parseFriendly(multisigAddressFetch),
    MULTISIG_CODE,
    MULTISIG_ORDER_CODE,
    isTestnet(),
    "aggregate",
    isFirst,
  );
};

export const UpdateMultisig: Component = () => {
  const navigation = useNavigation();
  const params = useParams();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

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

  const [state, setState] = createSignal<StateType>(StateType.PROPOSING);
  const [signerInputs, setSignerInputs] = createSignal<string[]>([]);
  const [proposerInputs, setProposerInputs] = createSignal<string[]>([]);
  const [thresholdInput, setThresholdInput] = createSignal<string>("");
  const [orderIdInput, setOrderIdInput] = createSignal<string>("");

  const initializeInputs = () => {
    if (multisigInfo.latest) {
      setSignerInputs(
        multisigInfo.latest.signers.map((signer) => signer.address.toString()),
      );
      setProposerInputs(
        multisigInfo.latest.proposers.map((proposer) =>
          proposer.address.toString(),
        ),
      );
      setThresholdInput(multisigInfo.latest.threshold.toString());
    }
  };

  createEffect(() => {
    if (multisigInfo.latest) {
      initializeInputs();
    }
  });

  const addSignerInput = () => {
    setSignerInputs([...signerInputs(), ""]);
  };

  const updateSignerInput = (index: number, value: string) => {
    const newInputs = [...signerInputs()];
    newInputs[index] = value;
    setSignerInputs(newInputs);
  };

  const deleteSignerInput = (index: number) => {
    const newInputs = signerInputs().filter((_, i) => i !== index);
    setSignerInputs(newInputs);
  };

  const addProposerInput = () => {
    setProposerInputs([...proposerInputs(), ""]);
  };

  const updateProposerInput = (index: number, value: string) => {
    const newInputs = [...proposerInputs()];
    newInputs[index] = value;
    setProposerInputs(newInputs);
  };

  const deleteProposerInput = (index: number) => {
    const newInputs = proposerInputs().filter((_, i) => i !== index);
    setProposerInputs(newInputs);
  };

  const validateMultisigUpdate = ():
    | { ok: true; value: MultisigUpdate }
    | { ok: false; error: string } => {
    const signers = signerInputs().filter((input) => input.trim() !== "");
    const proposers = proposerInputs().filter((input) => input.trim() !== "");
    const threshold = parseInt(thresholdInput(), 10);

    // Check for empty inputs
    if (signers.length === 0) {
      return { ok: false, error: "At least one signer is required" };
    }
    if (proposers.length === 0) {
      return { ok: false, error: "At least one proposer is required" };
    }
    if (isNaN(threshold) || threshold <= 0) {
      return { ok: false, error: "Invalid threshold value" };
    }

    // Check for duplicate addresses
    const uniqueSigners = new Set(signers);
    const uniqueProposers = new Set(proposers);
    if (
      uniqueSigners.size !== signers.length ||
      uniqueProposers.size !== proposers.length
    ) {
      return { ok: false, error: "Duplicate addresses are not allowed" };
    }

    // Check if the threshold is valid for the number of signers
    if (threshold > signers.length) {
      return {
        ok: false,
        error: "Threshold cannot be greater than the number of signers",
      };
    }

    return {
      ok: true,
      value: {
        signers: signers.map(Address.parse),
        proposers: proposers.map(Address.parse),
        threshold,
      },
    };
  };

  const onProposeUpdate = () => {
    const result = validateMultisigUpdate();
    if (result.ok === false) {
      setErrorMessage(result.error);
      return;
    }
    setState(StateType.CONFIRMING);
  };

  const onConfirmUpdate = async () => {
    if (!userAddress() || !sender() || !client()) {
      setErrorMessage("Please connect your wallet");
      return;
    }

    const result = validateMultisigUpdate();
    if (result.ok === false) {
      setErrorMessage(result.error);
      return;
    }

    setState(StateType.UPDATING);

    const { signers, proposers, threshold } = result.value;
    const orderId = BigInt(orderIdInput());

    try {
      // Add this line to define expireAt
      const expireAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const myAddress = userAddress();
      const mySignerIndex = signers.findIndex((signer) =>
        signer.equals(myAddress),
      );
      const myProposerIndex = proposers.findIndex((proposer) =>
        proposer.equals(myAddress),
      );
      const isSigner = mySignerIndex !== -1;

      const actions = Multisig.packOrder([
        {
          type: "update",
          threshold: threshold,
          signers: signers,
          proposers: proposers,
        },
      ]);
      const message = Multisig.newOrderMessage(
        actions,
        expireAt,
        isSigner,
        isSigner ? mySignerIndex : myProposerIndex,
        orderId,
        0n,
      );
      const messageBase64 = message.toBoc().toString("base64");

      const multisigAddressString = multisigAddress().toString();
      const amount = toNano("0.2").toString();

      const transactionToSent = {
        multisigAddress: Address.parseFriendly(multisigAddressString).address,
        orderId: orderId,
        message: {
          address: multisigAddressString,
          amount: amount,
          payload: messageBase64, // raw one-cell BoC encoded in Base64
        },
      };

      await tonConnectUI().sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
        messages: [transactionToSent.message],
      });

      navigation.toMultisig(
        multisigAddress().toString({ urlSafe: true, bounceable: true }),
      );
    } catch (e) {
      setErrorMessage(`Failed to update multisig: ${e}`);
      setState(StateType.PROPOSING);
    }
  };

  return (
    <div id="updateMultisigScreen" class="screen">
      <Switch
        fallback={
          <div class="panel">
            {errorMessage() && <div class="error">{errorMessage()}</div>}
            <div class="label">Order ID:</div>
            <input
              id="updateMultisig_orderId"
              disabled={state() !== StateType.PROPOSING}
              value={orderIdInput()}
              onInput={(e) => setOrderIdInput(e.target.value)}
            />

            <div class="label">Signers:</div>
            <div id="updateMultisig_signersContainer">
              <For each={signerInputs()}>
                {(signer, i) => (
                  <div class="address-input">
                    <div class="address-input-num">#{i() + 1}.</div>
                    <input
                      id={`updateMultisig_signer${i()}`}
                      disabled={state() !== StateType.PROPOSING}
                      value={signer}
                      onInput={(e) => updateSignerInput(i(), e.target.value)}
                    />
                    <button
                      id={`updateMultisig_deleteSigner${i()}`}
                      disabled={state() !== StateType.PROPOSING}
                      onClick={() => deleteSignerInput(i())}
                    >
                      —
                    </button>
                  </div>
                )}
              </For>
            </div>
            <button
              id="updateMultisig_addSignerButton"
              disabled={state() !== StateType.PROPOSING}
              onClick={addSignerInput}
            >
              Add signer
            </button>

            <div class="line"></div>

            <div class="label">Proposers:</div>
            <div id="updateMultisig_proposersContainer">
              <For each={proposerInputs()}>
                {(proposer, i) => (
                  <div class="address-input">
                    <div class="address-input-num">#{i() + 1}.</div>
                    <input
                      id={`updateMultisig_proposer${i()}`}
                      disabled={state() !== StateType.PROPOSING}
                      value={proposer}
                      onInput={(e) => updateProposerInput(i(), e.target.value)}
                    />
                    <button
                      id={`updateMultisig_deleteProposer${i()}`}
                      disabled={state() !== StateType.PROPOSING}
                      onClick={() => deleteProposerInput(i())}
                    >
                      —
                    </button>
                  </div>
                )}
              </For>
            </div>
            <button
              id="updateMultisig_addProposerButton"
              disabled={state() !== StateType.PROPOSING}
              onClick={addProposerInput}
            >
              Add proposer
            </button>

            <div class="line"></div>

            <div class="label">Threshold:</div>
            <input
              id="updateMultisig_threshold"
              disabled={state() !== StateType.PROPOSING}
              value={thresholdInput()}
              onInput={(e) => setThresholdInput(e.target.value)}
            />

            <Show when={state() === StateType.PROPOSING}>
              <button
                id="updateMultisig_updateButton"
                onClick={onProposeUpdate}
              >
                Update
              </button>
              <button
                id="updateMultisig_backButton"
                onClick={() =>
                  navigation.toMultisig(
                    multisigAddress().toString({
                      urlSafe: true,
                      bounceable: true,
                    }),
                  )
                }
              >
                Back
              </button>
            </Show>
            <Show when={state() === StateType.CONFIRMING}>
              <button
                id="updateMultisig_updateButton"
                onClick={onConfirmUpdate}
              >
                Confirm
              </button>
              <button
                id="updateMultisig_backButton"
                onClick={() => setState(StateType.PROPOSING)}
              >
                Back
              </button>
            </Show>
            <Show when={state() === StateType.UPDATING}>
              <button id="updateMultisig_updateButton" disabled={true}>
                Updating...
              </button>
              <button
                id="updateMultisig_backButton"
                onClick={() => setState(StateType.PROPOSING)}
              >
                Back
              </button>
            </Show>
          </div>
        }
      >
        <Match when={error()}>
          <div class="panel">
            <div class="error">{error()}</div>
          </div>
        </Match>
        <Match when={loading()}>
          <div class="panel">
            <div class="loading"></div>
          </div>
        </Match>
      </Switch>
    </div>
  );
};
