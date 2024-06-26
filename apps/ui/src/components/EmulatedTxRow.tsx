import {
  Address,
  Cell,
  ExternalAddress,
  TransactionComputePhase,
} from "@ton/core";
import { Accessor, createMemo, createResource } from "solid-js";
import { Account } from "tonapi-sdk-js";
import {
  ParsedBlockchainTransaction,
  IsTxGenericSuccess,
  GetAccount,
  cn,
  fromUnits,
} from "utils";
import { isTestnet } from "@/storages/chain";
import { AddressLink } from "./AddressLink";
import { ChevronDownIcon } from "./Icons/ChevronDownIcon";

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
  const isTxSuccess = createMemo(() => IsTxGenericSuccess(item));

  const [fromAccount] = createResource(
    { address: from, isTestnet: isTestnet() },
    (k) =>
      k.address instanceof Address
        ? GetAccount.load(
            k as unknown as { address: Address; isTestnet: boolean },
          )
        : undefined,
  );

  const [toAccount] = createResource(
    { address: to, isTestnet: isTestnet() },
    (k) =>
      k.address instanceof Address
        ? GetAccount.load(
            k as unknown as { address: Address; isTestnet: boolean },
          )
        : undefined,
  );

  const computePhase = () => {
    if (item.description.type === "generic") {
      return item.description.computePhase;
    }
    return null;
  };

  return (
    <details
      class={cn(
        "group p-4 border rounded-xl mb-4",
        !isTxSuccess() && "bg-red-200",
      )}
    >
      <summary class="flex flex-col gap-2 cursor-pointer select-none">
        <div class="flex justify-between items-center">
          <span class="font-semibold">Transaction</span>
          <div class="flex items-center gap-2">
            <span
              class={cn(
                "text-sm",
                isTxSuccess() ? "text-green-600" : "text-red-600",
              )}
            >
              {isTxSuccess() ? "Success" : "Failed"}
            </span>
            <ChevronDownIcon class="w-5 h-5 transition-transform group-open:rotate-180" />
          </div>
        </div>
        <AddressInfo label="From" address={from} account={fromAccount} />
        <AddressInfo label="To" address={to} account={toAccount} />
        <TransactionDetails item={item} />
      </summary>

      <div class="mt-4 space-y-4">
        <ComputePhaseDetails phase={computePhase()} />
        <ActionPhaseDetails item={item} />
        <ParsedDetails item={item} />
      </div>
    </details>
  );
}

function AddressInfo({
  label,
  address,
  account,
}: {
  label: string;
  address: Address | ExternalAddress | string;
  account: Accessor<Account>;
}) {
  return (
    <div class="bg-gray-100 p-2 rounded">
      <div class="flex flex-wrap items-center gap-1">
        <span>{label}:</span>
        <AddressLink
          address={address?.toString()}
          account={account}
          className="break-all"
        />
      </div>
      {account() && (
        <div class="text-sm text-gray-600 mt-1">
          Interfaces: {account()?.interfaces?.join(", ") ?? "Unknown contract"}
        </div>
      )}
    </div>
  );
}

function TransactionDetails({ item }: { item: ParsedBlockchainTransaction }) {
  return (
    <div class="space-y-1 text-sm">
      <div>
        Amount:{" "}
        {item.inMessage.info.type === "internal"
          ? `${fromUnits(item.inMessage.info.value.coins.toString(), 9)} TON`
          : "External"}
      </div>
      <div>Out Messages: {item.outMessagesCount}</div>
      <div>Parsed Action: {item?.parsed?.internal}</div>
    </div>
  );
}

function ComputePhaseDetails({ phase }: { phase: TransactionComputePhase }) {
  if (!phase) return null;
  return (
    <details class="bg-gray-50 p-2 rounded">
      <summary class="cursor-pointer select-none font-medium">
        Compute Phase
      </summary>
      <div class="mt-2 space-y-1 text-sm">
        <div>Type: {phase.type}</div>
        {phase.type === "vm" && (
          <>
            <div>Exit Code: {phase.exitCode}</div>
            <div>Gas Used: {phase.gasUsed.toString()}</div>
            <div>Gas Limit: {phase.gasLimit.toString()}</div>
          </>
        )}
      </div>
    </details>
  );
}

function ActionPhaseDetails({ item }: { item: ParsedBlockchainTransaction }) {
  if (item.description.type !== "generic" || !item.description.actionPhase) return null;
  const { actionPhase } = item.description;
  return (
    <details class="bg-gray-50 p-2 rounded">
      <summary class="cursor-pointer select-none font-medium">
        Action Phase
      </summary>
      <div class="mt-2 space-y-1 text-sm">
        <div>Success: {actionPhase.success ? "Yes" : "No"}</div>
        <div>Result Code: {actionPhase.resultCode}</div>
        <div>Total Actions: {actionPhase.totalActions}</div>
        <div>Total Fwd Fees: {actionPhase.totalFwdFees?.toString()}</div>
      </div>
    </details>
  );
}

function ParsedDetails({ item }: { item: ParsedBlockchainTransaction }) {
  return (
    <details class="bg-gray-50 p-2 rounded">
      <summary class="cursor-pointer select-none font-medium">
        Parsed Details
      </summary>
      <div class="mt-2 text-sm overflow-x-auto">
        <pre>{TonStringifier(item.parsed)}</pre>
      </div>
    </details>
  );
}
