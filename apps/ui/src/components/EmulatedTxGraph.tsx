import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import cytoscape, { LayoutOptions } from "cytoscape";
import dagre, { DagreLayoutOptions } from "cytoscape-dagre";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { addressToString } from "utils";
import { fromNano } from "@ton/core";
import { isTestnet } from "@/storages/chain";
import { EmulatedTxRow } from "@/components/EmulatedTxRow";
import { Portal } from "solid-js/web";

cytoscape.use(dagre);

interface EmulatedTxGraphProps {
  emulated: EmulationResult;
}

export function EmulatedTxGraph(props: EmulatedTxGraphProps) {
  let containerRef: HTMLDivElement | undefined;
  const [selectedNode, setSelectedNode] = createSignal<any>(null);
  const [showPopup, setShowPopup] = createSignal(false);

  const initializeCytoscape = () => {
    if (!containerRef || !props.emulated?.transactions) return;

    const nodes = props.emulated.transactions.map((tx) => {
      const status =
        // eslint-disable-next-line no-nested-ternary
        tx.description.type === "generic" &&
        tx.description.computePhase.type === "vm" &&
        tx.description.computePhase.success &&
        tx.description.actionPhase?.success
          ? "success"
          : tx.description.type === "generic" &&
              tx.description.computePhase.type === "vm" &&
              !tx.description.computePhase.success
            ? "failed"
            : "unknown";

      const amount = tx.inMessage?.info.type === "internal" 
        ? fromNano(tx.inMessage.info.value.coins) + " TON"
        : "External";

      const shortenAddress = (address: string) => {
        if (address === "External" || address === "Unknown") return address;
        return `${address.slice(0, 4)}...${address.slice(-4)}`;
      };

      const from = tx.inMessage?.info.type === "internal" && tx.inMessage?.info.src 
        ? shortenAddress(addressToString({
          isBounceable: tx.inMessage.info.bounce,
          isTestOnly: isTestnet(),
          address: tx.inMessage.info.src,
        }))
        : "External";

      const to = tx.inMessage?.info.type === "internal" && tx.inMessage?.info.dest
        ? shortenAddress(addressToString({
          isBounceable: tx.inMessage.info.bounce,
          isTestOnly: isTestnet(),
          address: tx.inMessage.info.dest,
        }))
        : "Unknown";

      return {
        data: {
          id: tx.lt.toString(),
          label: `${tx.lt}\n${status}\nFrom: ${from}\nTo: ${to}\nAmount: ${amount}`,
          status: status,
          from: from,
          to: to,
          amount: amount,
        },
      };
    });

    const edges = props.emulated.transactions
      .filter((tx) => tx.parent)
      .map((tx) => ({
        data: {
          id: `${tx.parent.lt}-${tx.lt}`,
          source: tx.parent.lt.toString(),
          target: tx.lt.toString(),
        },
      }));

    const cy = cytoscape({
      container: containerRef,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#0088cc",
            label: "data(label)",
            color: "#ffffff",
            "text-valign": "center",
            "text-halign": "center",
            width: 280,
            height: 220,
            shape: "rectangle",
            "text-wrap": "wrap",
            "text-max-width": "260",
            "font-size": "16px",
          },
        },
        {
          selector: "node[status = 'success']",
          style: {
            "background-color": "#28a745",
          },
        },
        {
          selector: "node[status = 'failed']",
          style: {
            "background-color": "#dc3545",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#0088cc",
            "target-arrow-color": "#0088cc",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#ffd700",
          },
        },
      ],
      layout: {
        name: "dagre",
        rankDir: "LR",
        nodeSep: 220, // Increased to accommodate larger nodes
        rankSep: 320, // Increased to accommodate larger nodes
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 100,
      } as LayoutOptions & DagreLayoutOptions,
    });

    cy.on("tap", (event: any) => {
      if (event.target === cy) {
        setSelectedNode(null);
      }
    });

    cy.on("tap", "node", (evt: { target: any }) => {
      const node = evt.target;
      setSelectedNode(node.data());
      setShowPopup(true);
    });

    onCleanup(() => {
      cy.destroy();
    });
  };

  createEffect(() => {
    if (props.emulated) {
      initializeCytoscape();
    }
  });

  return (
    <div class="mt-8">
      <h3 class="text-lg font-semibold mb-4">Transaction Graph</h3>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "500px", position: "relative" }}
        class="bg-gray-100 rounded-lg shadow-inner"
      ></div>
      <Show when={showPopup() && selectedNode()}>
        <Portal>
          <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div class="bg-white rounded-lg shadow-sm p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-semibold">Transaction Details</h3>
                <button onClick={() => setShowPopup(false)} class="text-gray-500 hover:text-gray-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {(() => {
                const selectedTx = props.emulated.transactions.find(tx => tx.lt.toString() === selectedNode().id);
                return selectedTx ? <EmulatedTxRow item={selectedTx} /> : null;
              })()}
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
