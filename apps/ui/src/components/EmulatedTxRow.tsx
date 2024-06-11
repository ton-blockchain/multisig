import { Address, Cell } from "@ton/core";
import { createMemo, createResource } from "solid-js";
import {
  ParsedBlockchainTransaction,
  IsTxGenericSuccess,
  GetAccount,
  cn,
  fromUnits,
} from "utils";
import { isTestnet } from "@/storages/chain";
import { AddressLink } from "./AddressLink";

const TonStringifier = (input: unknown) =>
  JSON.stringify(
    input,
    (key, value) => {
      if (value instanceof Cell) {
        return value.toBoc().toString("base64");
      }
      if (value?.type === "Buffer") {
        return Buffer.from(value.data).toString("base64");
      }
      if (value instanceof Address) {
        return value.toString();
      }
      return value;
    },
    2,
  );

export function EmulatedTxRow({ item }: { item: ParsedBlockchainTransaction }) {
  const to = item?.inMessage?.info?.dest;
  const from = item?.inMessage?.info?.src ?? "external";

  let computeExit = 0;
  if (item.description.type === "generic") {
    if (item.description.computePhase.type === "vm") {
      computeExit = item.description.computePhase.exitCode;
    }
  }

  const isTxSuccess = createMemo(() => IsTxGenericSuccess(item));

  const [fromAccount] = createResource(
    {
      address: from,
      isTestnet: isTestnet(),
    },
    (k) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      k.address instanceof Address ? GetAccount.load(k as any) : undefined,
  );
  const [toAccount] = createResource(
    {
      address: to,
      isTestnet: isTestnet(),
    },
    (k) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      k.address instanceof Address ? GetAccount.load(k as any) : undefined,
  );
  return (
    <details
      class={cn("p-4 border rounded-xl", !isTxSuccess() && "bg-red-200")}
    >
      <summary class="flex flex-col gap-2 cursor-pointer select-none">
        <div>Transaction</div>
        <div class="bg-gray-100 p-2 rounded">
          <div>
            From:{" "}
            <AddressLink address={from.toString()} account={fromAccount} />
          </div>
          {fromAccount() && (
            <div>
              Interfaces:{" "}
              {fromAccount()?.interfaces?.join(", ") ?? "Unknown contract"}
            </div>
          )}
        </div>
        <div class="bg-gray-100 p-2 rounded">
          <div>
            To: <AddressLink address={to?.toString()} account={toAccount} />
          </div>
          {toAccount() && (
            <div>
              Interfaces:{" "}
              {toAccount()?.interfaces?.join(", ") ?? "Unknown contract"}
            </div>
          )}
        </div>
        <div>
          Amount:{" "}
          {item.inMessage.info.type === "internal"
            ? `${fromUnits(item.inMessage.info.value.coins.toString(), 9)} TON`
            : ""}
        </div>
        <div>OutMessagesCount: {item.outMessagesCount}</div>
        <div>Compute Exit: {computeExit}</div>
        <div>Parsed Action: {item?.parsed?.internal}</div>
        <div class="mx-auto text-2xl open:hidden">•••</div>
      </summary>

      <blockquote>
        Parsed:
        <div class={"text-sm overflow-x-auto"}>
          <pre>{TonStringifier(item.parsed)}</pre>
        </div>
      </blockquote>
    </details>
  );
}
