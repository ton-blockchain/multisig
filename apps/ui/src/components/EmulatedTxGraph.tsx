import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import cytoscape, { LayoutOptions } from "cytoscape";
import dagre, { DagreLayoutOptions } from "cytoscape-dagre";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { addressToString } from "utils";
import { Address, fromNano } from "@ton/core";
import { isTestnet } from "@/storages/chain";
import { EmulatedTxRow } from "@/components/EmulatedTxRow";
import { Portal } from "solid-js/web";
import { GetAccount } from "utils";

cytoscape.use(dagre);

interface EmulatedTxGraphProps {
  emulated: EmulationResult;
}

function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Add this function to shorten addresses and get interfaces
const getAddressInfo = async (address: Address) => {
  const account = await GetAccount.load({
    address: address,
    isTestnet: isTestnet(),
  });
  return {
    shortAddress: shortenAddress(addressToString({
      isBounceable: true,
      isTestOnly: isTestnet(),
      address: address,
    })),
    interfaces: account?.interfaces?.join(", ") ?? "Unknown contract"
  };
};

export function EmulatedTxGraph(props: EmulatedTxGraphProps) {
  let containerRef: HTMLDivElement | undefined;
  const [selectedNode, setSelectedNode] = createSignal<any>(null);
  const [showPopup, setShowPopup] = createSignal(false);

  const initializeCytoscape = async () => {
    if (!containerRef || !props.emulated?.transactions) return;

    // Ensure the container has a defined size
    containerRef.style.width = '100%';
    containerRef.style.height = '500px';

    const nodes = await Promise.all(props.emulated.transactions.map(async (tx) => {
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

      const fromInfo = tx.inMessage?.info.type === "internal" && tx.inMessage?.info.src 
        ? await getAddressInfo(tx.inMessage.info.src)
        : { shortAddress: "External", interfaces: "External message" };

      const toInfo = tx.inMessage?.info.type === "internal" && tx.inMessage?.info.dest
        ? await getAddressInfo(tx.inMessage.info.dest)
        : { shortAddress: "Unknown", interfaces: "Unknown" };

      const messageType = tx.inMessage?.info.type === "internal" ? "Internal" : "External";

      // Use tx.parsed.internal directly for the transaction type
      const transactionType = tx.parsed?.internal ?? null;

      return {
        data: {
          id: tx.lt.toString(),
          label: `${tx.lt}`,
          status: status,
          from: fromInfo.shortAddress,
          fromInterfaces: fromInfo.interfaces,
          to: toInfo.shortAddress,
          toInterfaces: toInfo.interfaces,
          amount: amount,
          messageType: messageType,
          transactionType: transactionType,
        },
      };
    }));

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
          selector: 'node',
          style: {
            'background-color': '#f7fafc', // Light gray background
            'label': 'data(content)',
            'color': '#4a5568', // Dark gray text
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 240,
            'height': 140,
            'shape': 'roundrectangle',
            'text-wrap': 'wrap',
            'text-max-width': '220px',
            'font-size': '11px',
            'font-family': 'Inter, sans-serif', // Assuming you're using Inter font
            'font-weight': 400,
            'line-height': 1.4,
            'border-width': 1,
            'border-color': '#e2e8f0',
            'text-margin-y': 5,
            'padding': '10px',
            'text-outline-width': 1,
            'text-outline-color': '#ffffff',
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#999',
            'target-arrow-color': '#999',
            'target-arrow-shape': 'triangle',
            'curve-style': 'straight'
          }
        }
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 80,
        rankSep: 120,
        fit: true,
        padding: 50,
      } as LayoutOptions & DagreLayoutOptions,
      minZoom: 0.1,
      maxZoom: 2,
      zoomingEnabled: true,
      userZoomingEnabled: true,
      panningEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      autoungrabify: true,
      autounselectify: true,
    });

    // Update the node content to include the transaction type only if it's not empty
    cy.nodes().forEach((node) => {
      const data = node.data();
      let content = `Transaction ${data.label}\n` +
                    `From: ${data.from}\n` +
                    `(${data.fromInterfaces})\n` +
                    `To: ${data.to}\n` +
                    `(${data.toInterfaces})\n` +
                    `Amount: ${data.amount} TON`;
      if (data.transactionType) {
        content += `\nMessage: ${data.transactionType}`;
      } else {
        content += `\nMessage: ${data.messageType}`;
      }
      node.data('content', content);
    });

    // Fit the graph to the container and set initial zoom
    cy.fit();
    const initialZoom = cy.zoom();
    cy.zoom({
      level: Math.min(initialZoom, 1), // Limit initial zoom to 1 (100%)
      renderedPosition: { x: containerRef.clientWidth / 2, y: containerRef.clientHeight / 2 }
    });

    // Remove the previous pan event handler
    // Instead, add event listeners for zoom and pan end
    let panTimeout: number | null = null;
    cy.on('zoom pan', () => {
      clearTimeout(panTimeout);
      panTimeout = setTimeout(() => {
        const elements = cy.elements();
        const extent = cy.extent();
        const bb = elements.boundingBox();

        // Check if the graph is completely out of view
        if (bb.x2 < extent.x1 || bb.x1 > extent.x2 || bb.y2 < extent.y1 || bb.y1 > extent.y2) {
          cy.fit(elements, 50); // Fit with padding
        }
      }, 250); // Adjust this delay as needed
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
