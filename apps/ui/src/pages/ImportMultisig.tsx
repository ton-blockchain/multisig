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
    const value = (e.target as HTMLInputElement).value;
    setMultisig(value);

    // Проверяем, является ли введенное значение валидным адресом
    try {
      Address.parse(value);
      // Если адрес валиден, автоматически импортируем его
      onImportMultisig();
    } catch (error) {
      // Если адрес невалиден, ничего не делаем
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "Enter") {
      e.preventDefault();
      onImportMultisig();
    }
  };

  return (
    <div id="importScreen" class="screen">
      <div>Enter multisig address:</div>
      <input
        id="import_input"
        type="text"
        value={multisig()}
        onInput={onInput}
        onKeyDown={handleKeyPress}
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
