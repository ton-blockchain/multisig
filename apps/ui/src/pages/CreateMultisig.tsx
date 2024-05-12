import {isTestnet} from "@/storages/chain";
import {client} from "@/storages/ton-client";
import {userAddress} from "@/storages/ton-connect";
import {sender} from "@/storages/ton-connect-sender";
import {Address, toNano} from "@ton/core";
import {Multisig, MULTISIG_CODE} from "multisig";
import {Component, createMemo, createSignal, For, Show} from "solid-js";
import {validateUserFriendlyAddress} from "utils";
import {useNavigation} from "../navigation";

enum StateType {
  PROPOSING,
  CONFIRMING,
  CREATING
}

type MultisigProposal = {
  signers: Address[];
  proposers: Address[];
  threshold: number;
};

export const CreateMultisig: Component = () => {
  const navigation = useNavigation();

  const [state, setState] = createSignal<StateType>(StateType.PROPOSING);
  const isProposing = () => state() === StateType.PROPOSING;
  const isConfirming = () => state() === StateType.CONFIRMING;
  const isCreating = () => state() === StateType.CREATING;

  const [signerInputs, setSignerInputs] = createSignal<string[]>([]);
  const [proposerInputs, setProposerInputs] = createSignal<string[]>([]);
  const [thresholdInput, setThresholdInput] = createSignal<string>("");

  const multisigProposal = createMemo((): { ok: true; value: MultisigProposal; } | { ok: false; error: Error } => {
    const ok = (value: MultisigProposal): { ok: true, value: MultisigProposal } => ({ok: true, value: value});
    const error = (error: string): { ok: false, error: Error } => ({ok: false, error: new Error(error)});

    const addressMap: Record<string, boolean> = {};

    const signers: Address[] = [];
    try {
      for (const signer of signerInputs()) {
        const maybeError = validateUserFriendlyAddress(signer, isTestnet());
        if (maybeError) {
          return error(maybeError);
        }

        const address = Address.parseFriendly(signer).address;
        if (addressMap[address.toRawString()]) {
          return error("Duplicate signer" + address.toString());
        }

        addressMap[address.toRawString()] = true;
        signers.push(Address.parse(signer));
      }
    } catch (e) {
      return error("Cannot parse signers");
    }
    if (signers.length === 0) {
      return error("At least one signer is required");
    }

    const proposers: Address[] = [];
    try {
      for (const proposer of proposerInputs()) {
        const maybeError = validateUserFriendlyAddress(proposer, isTestnet());
        if (maybeError) {
          return error(maybeError);
        }

        const address = Address.parseFriendly(proposer).address;
        if (addressMap[address.toRawString()]) {
          return error("Duplicate proposer" + address.toString());
        }

        addressMap[address.toRawString()] = true;
        proposers.push(Address.parse(proposer));
      }
    } catch (e) {
      return error("Cannot parse proposers");
    }

    let threshold: number = 0;
    try {
      threshold = parseInt(thresholdInput());
    } catch (e) {
      return error("Cannot parse threshold");
    }
    if (threshold === null || threshold === undefined || threshold <= 0 || isNaN(threshold) || threshold.toString() !== thresholdInput()) {
      return error("Threshold is invalid");
    }
    if (threshold > signers.length) {
      return error("Threshold is greater than signers count");
    }

    return ok({
      signers,
      proposers,
      threshold,
    });
  });

  const addSignerInput = () => {
    setSignerInputs([...signerInputs(), ""]);
  }
  const deleteSignerInput = (index: number) => {
    setSignerInputs(signerInputs().filter((_, i) => i !== index));
  }
  const updateSignerInput = (index: number, value: string) => {
    setSignerInputs(signerInputs().map((s, i) => i === index ? value : s));
  }

  const addProposerInput = () => {
    setProposerInputs([...proposerInputs(), ""]);
  }
  const deleteProposerInput = (index: number) => {
    setProposerInputs(proposerInputs().filter((_, i) => i !== index));
  }
  const updateProposerInput = (index: number, value: string) => {
    setProposerInputs(proposerInputs().map((s, i) => i === index ? value : s));
  }

  const updateThreshold = (value: string) => {
    setThresholdInput(value);
  }

  const onProposeMultisig = () => {
    if (!isProposing()) {
      return;
    }

    const result = multisigProposal();
    if (result.ok === false) {
      alert(result.error.message);
      return;
    }

    setState(StateType.CONFIRMING);
    return;
  }

  const onCreateMultisig = async () => {
    if (!isConfirming()) {
      return;
    }

    if (!userAddress() || !sender() || !client()) {
      return false;
    }

    const result = multisigProposal();
    if (result.ok === false) {
      alert(result.error.message);
      return;
    }

    setState(StateType.CREATING);

    const {signers, proposers, threshold} = result.value;
    const newMultisig = client().open(Multisig.createFromConfig({
      threshold: threshold,
      signers: signers,
      proposers: proposers,
      allowArbitrarySeqno: true,
    }, MULTISIG_CODE));
    const amount = toNano(1);

    try {
      await newMultisig.sendDeploy(sender(), amount);

      navigation.toMultisig(newMultisig.address.toString({urlSafe: true, bounceable: true, testOnly: isTestnet()}));
    } catch (e) {
      alert("Failed to create multisig: " + e);
    }
  };

  return (
    <div id="newMultisigScreen" class="screen">
      <div class="panel">
        <div class="label">Signers:</div>
        <div id="newMultisig_signersContainer">
          <For each={signerInputs()}>
            {(signer, i) => <div class="address-input">
              <div class="address-input-num">#{i() + 1}.</div>
              <input id={`newMultisig_signer${i()}`} disabled={!isProposing()} value={signer}
                     onInput={(e: Event) => updateSignerInput(i(), (e.target as HTMLInputElement).value)}/>
              <button id={`newMultisig_deleteSigner${i()}`} disabled={!isProposing()}
                      onClick={() => deleteSignerInput(i())}>—
              </button>
            </div>}
          </For>
        </div>
        <button id="newMultisig_addSignerButton" disabled={!isProposing()} onClick={addSignerInput}>Add signer</button>

        <div class="line"></div>

        <div class="label">Proposers:</div>
        <div id="newMultisig_proposersContainer">
          <For each={proposerInputs()}>
            {(proposer, i) => <div class="address-input">
              <div class="address-input-num">#{i() + 1}.</div>
              <input id={`newMultisig_proposer${i()}`} disabled={!isProposing()} value={proposer}
                     onInput={(e: Event) => updateProposerInput(i(), (e.target as HTMLInputElement).value)}/>
              <button id={`newMultisig_deleteProposer${i()}`} disabled={!isProposing()}
                      onClick={() => deleteProposerInput(i())}>—
              </button>
            </div>}
          </For>
        </div>
        <button id="newMultisig_addProposerButton" disabled={!isProposing()} onClick={addProposerInput}>Add proposer
        </button>

        <div class="line"></div>

        <div class="label">Threshold:</div>
        <input id="newMultisig_threshold" disabled={!isProposing()} value={thresholdInput()}
               onInput={(e: Event) => updateThreshold((e.target as HTMLInputElement).value)}/>

        <Show when={isProposing()}>
          <button id="newMultisig_createButton" onClick={onProposeMultisig}>
            Create
          </button>
          <button id="newMultisig_backButton" onClick={navigation.toHome}>
            Back
          </button>
        </Show>
        <Show when={isConfirming()}>
          <button id="newMultisig_createButton" onClick={onCreateMultisig}>
            Confirm
          </button>
          <button id="newMultisig_backButton" onClick={() => setState(StateType.PROPOSING)}>
            Back
          </button>
        </Show>
        <Show when={isCreating()}>
          <button id="newMultisig_createButton" disabled={true}>
            Creating...
          </button>
          <button id="newMultisig_backButton" onClick={() => setState(StateType.PROPOSING)}>
            Back
          </button>
        </Show>
      </div>
    </div>
  );
};
