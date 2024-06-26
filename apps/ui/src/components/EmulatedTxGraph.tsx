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

// Add this function to shorten addresses
const shortenAddress = (address: string) => {
  if (address.length <= 10) return address;
  return `${address.slice(0, 5)}...${address.slice(-5)}`;
};

export function EmulatedTxGraph(props: EmulatedTxGraphProps) {
  let containerRef: HTMLDivElement | undefined;
  const [selectedNode, setSelectedNode] = createSignal<any>(null);
  const [showPopup, setShowPopup] = createSignal(false);

  const initializeCytoscape = () => {
    if (!containerRef || !props.emulated?.transactions) return;

    // Ensure the container has a defined size
    containerRef.style.width = '100%';
    containerRef.style.height = '500px';

    const nodes = props.emulated.transactions.map((tx) => {
      const status = tx.description.type === "generic" &&
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
        ? fromNano(tx.inMessage.info.value.coins)
        : "External";

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
          label: `${tx.lt}`,
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
            "background-color": "#ffffff",
            label: "data(label)",
            color: "#333333",
            "text-valign": "center",
            "text-halign": "center",
            width: 220,
            height: 120,
            shape: "roundrectangle",
            "text-wrap": "wrap",
            "text-max-width": "200px",
            "font-size": "12px",
            "border-width": 1,
            "border-color": "#e2e8f0",
            "text-margin-y": 5,
            content: "data(label)",
            "text-opacity": 1,
            "box-shadow": "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
          },
        },
        {
          selector: "node[status = 'success']",
          style: {
            "background-color": "#f0fff4",
            "border-color": "#48bb78",
            "border-width": 2,
          },
        },
        {
          selector: "node[status = 'failed']",
          style: {
            "background-color": "#fff5f5",
            "border-color": "#f56565",
            "border-width": 2,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#a0aec0",
            "target-arrow-color": "#a0aec0",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#4299e1",
            "background-color": "#ebf8ff",
          },
        },
        {
          selector: "node:active",
          style: {
            "text-opacity": 1,
            "z-index": 9999
          }
        }
      ],
      layout: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 80,
        rankSep: 120,
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
      } as LayoutOptions & DagreLayoutOptions,
    });

    cy.nodes().forEach((node) => {
      const data = node.data();
      node.style('content', `${data.label}\nFrom: ${data.from}\nTo: ${data.to}\nAmount: ${data.amount} TON`);
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
      
      // Highlight the selected node and connected edges
      cy.elements().removeClass("highlighted");
      node.addClass("highlighted");
      node.connectedEdges().addClass("highlighted");
    });

    // Add styles for highlighted elements
    cy.style()
      .selector("node.highlighted")
      .style({
        "background-color": "#ebf8ff",
        "border-width": 3,
        "border-color": "#4299e1",
      })
      .selector("edge.highlighted")
      .style({
        "line-color": "#4299e1",
        width: 2,
      })
      .update();

    onCleanup(() => {
      cy.destroy();
    });
  };

  createEffect(() => {
    if (props.emulated) {
      // Delay initialization to ensure the container is rendered
      setTimeout(initializeCytoscape, 0);
    }
  });

  return (
    <div class="mt-8 mb-8">
      <h3 class="text-lg font-semibold mb-4">Transaction Graph</h3>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "500px" }}
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
