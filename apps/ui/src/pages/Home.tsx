import { Component, onMount } from "solid-js";
import { useNavigation } from "../navigation";
import { multisigAddress } from "../storages/multisig-address";

export const Home: Component = () => {
  const navigation = useNavigation();

  onMount(() => {
    if (multisigAddress()) {
      navigation.toMultisig(
        multisigAddress().toString({ urlSafe: true, bounceable: true }),
      );
    } else {
      navigation.toStartScreen();
    }
  });

  return <div></div>;
};
