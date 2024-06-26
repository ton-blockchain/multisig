import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import cytoscape, { LayoutOptions } from "cytoscape";
import dagre, { DagreLayoutOptions } from "cytoscape-dagre";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";
import { addressToString } from "utils";
import { fromNano } from "@ton/core";
import { isTestnet } from "@/storages/chain";
import { EmulatedTxRow } from "@/components/EmulatedTxRow";

cytoscape.use(dagre);

interface EmulatedTxGraphProps {
  emulated: EmulationResult;
}

export function EmulatedTxGraph(props: EmulatedTxGraphProps) {
  let containerRef: HTMLDivElement | undefined;
  const [selectedNode, setSelectedNode] = createSignal<any>(null);

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
    });

    // Add zoom controls
    const zoomIn = () => cy.zoom(cy.zoom() * 1.2);
    const zoomOut = () => cy.zoom(cy.zoom() / 1.2);
    const resetZoom = () => cy.fit();

    const zoomInBtn = document.createElement("button");
    zoomInBtn.innerHTML = "+";
    zoomInBtn.onclick = zoomIn;
    containerRef?.appendChild(zoomInBtn);

    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.innerHTML = "-";
    zoomOutBtn.onclick = zoomOut;
    containerRef?.appendChild(zoomOutBtn);

    const resetBtn = document.createElement("button");
    resetBtn.innerHTML = "Reset";
    resetBtn.onclick = resetZoom;
    containerRef?.appendChild(resetBtn);

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
      <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Transaction Details</h3>
        <Show when={selectedNode()} fallback={<p>Select a transaction to view details</p>}>
          {(node) => {
            const selectedTx = props.emulated.transactions.find(tx => tx.lt.toString() === node().id);
            return selectedTx ? <EmulatedTxRow item={selectedTx} /> : null;
          }}
        </Show>
      </div>
    </div>
  );
}

