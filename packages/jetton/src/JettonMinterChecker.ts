import {
  AddressInfo,
  addressToString,
  assert,
  MyNetworkProvider,
  sendToIndex,
} from "utils";
import {
  Address,
  beginCell,
  Builder,
  Cell,
  Dictionary,
  DictionaryValue,
  Slice,
} from "@ton/core";
import { sha256 } from "@ton/crypto";
import { JettonMinter } from "./JettonMinter";

export const defaultJettonKeys = [
  "uri",
  "name",
  "description",
  "image",
  "image_data",
  "symbol",
  "decimals",
  "amount_style",
];

const contentValue: DictionaryValue<string> = {
  serialize: (src: string, builder: Builder) => {
    builder.storeRef(
      beginCell().storeUint(0, 8).storeStringTail(src).endCell(),
    );
  },
  parse: (src: Slice) => {
    const sc = src.loadRef().beginParse();
    const prefix = sc.loadUint(8);
    if (prefix === 0) {
      return sc.loadStringTail();
    }
    if (prefix === 1) {
      // Not really tested, but feels like it should work
      const chunkDict = Dictionary.loadDirect(
        Dictionary.Keys.Uint(32),
        Dictionary.Values.Cell(),
        sc,
      );
      return chunkDict
        .values()
        .map((x) => x.beginParse().loadStringTail())
        .join("");
    }

    throw new Error(`Unknown content format indicator: ${prefix}`);
  },
};

export const parseContentCell = async (content: Cell) => {
  const cs = content.beginParse();
  const contentType = cs.loadUint(8);
  if (contentType === 1) {
    const noData = cs.remainingBits === 0;
    if (noData && cs.remainingRefs === 0) {
      throw new Error("No data in content cell!");
    } else {
      const contentUrl = noData ? cs.loadStringRefTail() : cs.loadStringTail();
      return contentUrl;
    }
  } else if (contentType === 0) {
    const contentDict = Dictionary.load(
      Dictionary.Keys.BigUint(256),
      contentValue,
      cs,
    );
    const contentMap: { [key: string]: string } = {};

    for (const name of defaultJettonKeys) {
      // I know we should pre-compute hashed keys for known values... just not today.
      const dictKey = BigInt(`0x${(await sha256(name)).toString("hex")}`);
      const dictValue = contentDict.get(dictKey);
      if (dictValue !== undefined) {
        contentMap[name] = dictValue;
      }
    }
    return contentMap;
  } else {
    throw new Error(`Unknown content format indicator:${contentType}`);
  }
};

interface JettonMinterInfo {
  tonBalance: bigint;
  jettonMinterContract: JettonMinter;
  adminAddress: Address;
  nextAdminAddress: undefined | null | Address;
  decimals?: number;
  metadataUrl?: string;
}

export const checkJettonMinter = async (
  jettonMinterAddress: AddressInfo,
  isTestnet: boolean,
  needNextAdmin: boolean,
): Promise<JettonMinterInfo> => {
  // Account State and Data

  const result = await sendToIndex(
    "account",
    { address: addressToString(jettonMinterAddress) },
    isTestnet,
  );
  assert(result.status === "active", "Contract not active");

  const tonBalance = result.balance;

  // Get-methods

  const provider = new MyNetworkProvider(
    jettonMinterAddress.address,
    isTestnet,
  );

  const jettonMinterContract: JettonMinter = JettonMinter.createFromAddress(
    jettonMinterAddress.address,
  );
  const getData = await jettonMinterContract.getJettonData(provider);

  let decimals: number;
  let metadataUrl: string;
  const parsedContent = await parseContentCell(getData.content);
  if (parsedContent instanceof String) {
    metadataUrl = parsedContent as string;
  } else {
    const contentMap = parsedContent as {
      [key: string]: string;
    };
    metadataUrl = contentMap.uri;
    const decimalsString = contentMap.decimals;
    if (decimalsString !== undefined) {
      decimals = parseInt(decimalsString, 10);
      if (isNaN(decimals)) {
        throw new Error("invalid decimals");
      }
    }
  }

  let nextAdminAddress;

  if (needNextAdmin) {
    nextAdminAddress = await jettonMinterContract.getNextAdminAddress(provider);
  }

  return {
    tonBalance,
    jettonMinterContract,
    adminAddress: getData.adminAddress,
    nextAdminAddress: nextAdminAddress,
    decimals,
    metadataUrl,
  };
};
