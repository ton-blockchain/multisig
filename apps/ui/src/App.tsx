import {CreateMultisig} from "@/pages/CreateMultisig";
import {isTestnet, setChain} from "@/storages/chain";
import {Route, Router} from "@solidjs/router";
import {CHAIN, TonConnectUI} from "@tonconnect/ui";
import {Component, onMount, Show} from "solid-js";
import "../css/main.css";
import {Home} from "./pages/Home";
import {ImportMultisig} from "./pages/ImportMultisig";
import {MultisigOrderPage} from "./pages/MultisigOrderPage";
import {MultisigPage} from "./pages/MultisigPage";
import {StartScreen} from "./pages/StartScreen";
import {setTonConnectUI} from "./storages/ton-connect";

export const App: Component = () => {
  onMount(() => {
    const tonConnectUI = new TonConnectUI({
      manifestUrl: "https://multisig.ton.org/tonconnect-manifest.json",
      buttonRootId: "tonConnectButton",
    });

    setTonConnectUI(tonConnectUI);
  });

  const onChainChange = (chain: CHAIN) => {
    setChain(chain);
    window.location.reload();
  }

  return (
    <>
      <Show when={isTestnet()}>
        <div class="testnet-badge">
          ATTENTION! This is the test network — don’t send real Toncoin!
        </div>
      </Show>

      <div id="header">
        <a href="/">
          <div id="header_logo"></div>
        </a>
        <div id="header_title">
          Multisig&nbsp;
          <small>
            <Show when={isTestnet()}>
              <a onClick={() => onChainChange(CHAIN.MAINNET)}>Switch to Mainnet</a>
            </Show>
            <Show when={!isTestnet()}>
              <a onClick={() => onChainChange(CHAIN.TESTNET)}>Switch to Testnet</a>
            </Show>
          </small>
        </div>
        <div id="header_grow"></div>

        <div id="tonConnectButton"></div>
      </div>
      <Router>
        <Route path="/" component={Home}/>
        <Route path="/multisig/:address" component={MultisigPage}/>
        <Route
          path="/multisig/:address/:orderId"
          component={MultisigOrderPage}
        />
        <Route path="/start" component={StartScreen}/>
        <Route path="/create-multisig" component={CreateMultisig}/>
        <Route path="/import-multisig" component={ImportMultisig}/>
      </Router>
    </>
  );
};
