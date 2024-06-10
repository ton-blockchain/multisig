import { Address } from "@ton/core";
import { getTonapi, sendToIndex } from "./api";

export interface AddressInfo {
  isBounceable: boolean;
  isTestOnly: boolean;
  address: Address;
}

export const validateUserFriendlyAddress = (
  s: string,
  isTestnet: boolean,
): string | null => {
  if (Address.isFriendly(s)) {
    const address = Address.parseFriendly(s);
    if (address.isTestOnly && !isTestnet) {
      return "Please enter mainnet address";
    }
    return null;
  }
  return "Invalid address";
};

export const explorerUrl = (address: string, isTestnet: boolean): string => {
  Address.parseFriendly(address); // check validity
  return (
    (isTestnet ? "https://testnet.tonviewer.com/" : "https://tonviewer.com/") +
    address
  );
};

const addressCache: { [key: string]: string } = {};
const addressNameCache: { [key: string]: string } = {};

export const getAddressFormat = async (
  address: Address,
  isTestnet: boolean,
): Promise<AddressInfo> => {
  const raw = address.toRawString();

  let friendly = addressCache[raw];
  if (!friendly) {
    const result = await sendToIndex(
      "addressBook",
      { address: raw },
      isTestnet,
    );
    friendly = result[raw].user_friendly;
    addressCache[raw] = friendly;
  }

  return Address.parseFriendly(friendly);
};

export const getAddressName = async (
  address: Address,
  isTestnet: boolean,
): Promise<string> => {
  const raw = address.toRawString();

  let friendly = addressNameCache[raw];
  if (!friendly) {
    const tonapi = getTonapi(isTestnet);
    const result = await tonapi.accounts.getAccount(raw);
    friendly = result.name ?? result.address;
    addressNameCache[raw] = friendly;
  }

  return friendly;
};

export const addressToString = (address: AddressInfo): string => {
  return address.address.toString({
    bounceable: address.isBounceable,
    testOnly: address.isTestOnly,
  });
};

export const makeAddressLink = (address: AddressInfo): string => {
  const addressString = addressToString(address);
  const url = explorerUrl(addressString, address.isTestOnly);
  return `<a href="${url}" target="_blank">${addressString}</a>`;
};

export const formatAddressAndUrl = async (
  address: Address,
  isTestnet: boolean,
): Promise<string> => {
  const f = await getAddressFormat(address, isTestnet);
  return makeAddressLink(f);
};

export const equalsMsgAddresses = (
  a: Address | null,
  b: Address | null,
): boolean => {
  if (!a) return !b;
  if (!b) return !a;
  return a.equals(b);
};

export const equalsAddressLists = (a: Address[], b: Address[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!a[i].equals(b[i])) return false;
  }
  return true;
};

export const assert = (condition: boolean, error: string): void => {
  if (!condition) {
    console.error(error);
    throw new Error(error);
  }
};

export const sanitizeHTML = (text: string): string => {
  const d = document.createElement("div");
  d.innerText = text;
  return d.innerHTML;
};

export function bigIntToBuffer(data: bigint | undefined): Buffer {
  if (!data) {
    return Buffer.from([]);
  }
  const hexStr = data.toString(16);
  const pad = hexStr.padStart(64, "0");
  const hashHex = Buffer.from(pad, "hex");

  return hashHex;
}
