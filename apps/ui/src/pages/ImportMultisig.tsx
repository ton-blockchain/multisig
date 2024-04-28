import { Address } from "@ton/core";
import { Component, createSignal } from "solid-js";
import { useNavigation } from "../navigation";
import { setMultisigAddress } from "../storages/multisig-address";

export const ImportMultisig: Component = () => {
  const navigation = useNavigation();
  const [multisig, setMultisig] = createSignal<string>("");

  const onImportMultisig = () => {
    if (multisig()) {
      setMultisigAddress(Address.parse(multisig()));
      navigation.toMultisig(multisig());
    }
  };

  const onInput = (e: Event) => {
    setMultisig((e.target as HTMLInputElement).value);
  };

  return (
    <div id="importScreen" class="screen">
      <div>Enter multisig address:</div>
      <input
        id="import_input"
        type="text"
        value={multisig()}
        onInput={onInput}
        required={true}
      />
      <button id="import_okButton" onClick={onImportMultisig}>
        Import
      </button>
      <button id="import_backButton" onClick={navigation.toHome}>
        Back
      </button>
    </div>
  );
};
