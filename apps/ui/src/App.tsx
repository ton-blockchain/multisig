import { Route, Router } from "@solidjs/router";
import { TonConnectUI } from "@tonconnect/ui";
import { Component, onMount } from "solid-js";
import "../css/main.css";
import { Home } from "./pages/Home";
import { ImportMultisig } from "./pages/ImportMultisig";
import { MultisigPage } from "./pages/MultisigPage";
import { StartScreen } from "./pages/StartScreen";
import { setTonConnectUI } from "./storages/ton-connect";
import { MultisigOrderPage } from "./pages/MultisigOrderPage";

export const App: Component = () => {
  onMount(() => {
    const tonConnectUI = new TonConnectUI({
      manifestUrl: "https://multisig.ton.org/tonconnect-manifest.json",
      buttonRootId: "tonConnectButton",
    });

    setTonConnectUI(tonConnectUI);
  });

  return (
    <>
      <div id="header">
        <a href="https://ton.org">
          <div id="header_logo"></div>
        </a>
        <div id="header_title">Multisig</div>
        <div id="header_grow"></div>

        <div id="tonConnectButton"></div>
      </div>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/multisig/:address" component={MultisigPage} />
        <Route
          path="/multisig/:address/:orderId"
          component={MultisigOrderPage}
        />
        <Route path="/start" component={StartScreen} />
        <Route path="/import-multisig" component={ImportMultisig} />
      </Router>
    </>
  );
};
