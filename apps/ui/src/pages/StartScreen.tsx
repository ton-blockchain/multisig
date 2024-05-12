import {Component} from "solid-js";
import {useNavigation} from "../navigation";

export const StartScreen: Component = () => {
  const navigation = useNavigation();

  return (
    <div id="startScreen" class="screen">
      <button id="createMultisigButton" onClick={navigation.toCreateMultisig}>
        Create new multisig
      </button>
      <button id="importMultisigButton" onClick={navigation.toImportMultisig}>
        Import multisig
      </button>
    </div>
  );
};
