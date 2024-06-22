import { createEffect } from "solid-js";
import cytoscape, { LayoutOptions } from "cytoscape";
import dagre, { DagreLayoutOptions } from "cytoscape-dagre";
import { EmulationResult } from "utils/src/getEmulatedTxInfo";

cytoscape.use(dagre);

interface EmulatedTxGraphProps {
  emulated: EmulationResult;
}

export function EmulatedTxGraph(props: EmulatedTxGraphProps) {
  let containerRef: HTMLDivElement | undefined;

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
      return {
        data: {
          id: tx.lt.toString(),
          label: `${tx.lt}\n${status}`,
          status: status,
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
            width: 150,
            height: 120,
            shape: "rectangle",
            "text-wrap": "wrap",
            "text-max-width": "100",
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
      ],
      layout: {
        name: "dagre",
        rankDir: "LR",
        nodeSep: 120,
        rankSep: 200,
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 30,
      } as LayoutOptions & DagreLayoutOptions,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.on("tap", "node", (evt: { target: any }) => {
      const node = evt.target;
      console.log("Tapped node:", node.id(), "Status:", node.data("status"));
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
        style={{ width: "100%", height: "300px" }}
        class="bg-gray-200"
      ></div>
    </div>
  );
}
