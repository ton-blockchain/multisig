import { useParams } from "@solidjs/router";
import { fromNano } from "@ton/core";
import { MultisigInfo } from "multisig";
import { JSXElement } from "solid-js";
import { useNavigation } from "src/navigation";
import { setMultisigAddress } from "@/storages/multisig-address";

export function MultisigIndex({ info }: { info: MultisigInfo }): JSXElement {
  const navigation = useNavigation();
  const params = useParams();

  const onSwitchMultisig = () => {
    setMultisigAddress(null);
    navigation.toHome();
  };

  return (
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
              {fromNano(info.tonBalance)}
            </div>
          </div>

          <div>
            <div class="label">Threshold:</div>
            <div id="multisig_threshold" class="value">
              {info.threshold}
            </div>

            <div class="label">Signers:</div>
            <div id="multisig_signersList"></div>

            <div class="label">Proposers:</div>
            <div id="multisig_proposersList"></div>

            <div class="label">Order ID:</div>
            <div id="multisig_orderId" class="value">
              {info.allowArbitraryOrderSeqno
                ? "Arbitrary"
                : info.nextOderSeqno.toString()}
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
  );
}
