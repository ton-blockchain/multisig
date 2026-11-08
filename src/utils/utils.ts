import {Address} from "@ton/core";
import {sendToIndex} from "./MyNetworkProvider";

export interface AddressInfo {
    isBounceable: boolean;
    isTestOnly: boolean;
    address: Address;
    formatResolved?: boolean;
}

export const base64toHex = (base64: string): string => {
    return Buffer.from(base64, 'base64').toString('hex');
}

export const validateUserFriendlyAddress = (s: string, isTestnet: boolean): string | null => {
    if (Address.isFriendly(s)) {
        const address = Address.parseFriendly(s);
        if (address.isTestOnly && !isTestnet) {
            return "Please enter mainnet address";
        } else {
            return null;
        }
    } else {
        return 'Invalid address';
    }
}

export const explorerUrl = (address: string, isTestnet: boolean) => {
    Address.parseFriendly(address); // check validity
    return (isTestnet ? 'https://testnet.tonscan.org/address/' : 'https://tonscan.org/address/') + address;
}

const checkedAddressFormat = (friendly: unknown, address: Address, isTestnet: boolean): AddressInfo | undefined => {
    if (typeof friendly !== 'string') return;
    try {
        const parsed = Address.parseFriendly(friendly);
        if (parsed.address.equals(address) && parsed.isTestOnly === isTestnet) {
            return {...parsed, formatResolved: true};
        }
    } catch {}
}

export const getAddressFormats = async (addresses: Address[], isTestnet: boolean, previous: (string | undefined)[] = []): Promise<AddressInfo[]> => {
    const fallback = addresses.map((address, index) => ({
        ...(checkedAddressFormat(previous[index], address, isTestnet) || {
            address, isBounceable: false, isTestOnly: isTestnet
        }),
        formatResolved: false,
    }));
    if (!addresses.length) return fallback;

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const entries = new Map<string, AddressInfo>();
    const formatted = () => addresses.map((address, index) =>
        entries.get(address.toRawString()) || fallback[index]
    );
    const rawAddresses = Array.from(new Set(addresses.map(address => address.toRawString())));
    const request = async () => {
        const batches: Promise<void>[] = [];
        const batchSize = 500;
        const loadBatch = async (batch: string[]) => {
            try {
                const book = await sendToIndex('addressBook', {address: batch}, isTestnet, controller.signal);
                for (const [key, entry] of Object.entries(book)) {
                    try {
                        const parsedKey = Address.parse(key);
                        if (!Address.isFriendly(key) && key.toUpperCase() !== parsedKey.toRawString().toUpperCase()) continue;
                        const valid = checkedAddressFormat((entry as {user_friendly?: unknown})?.user_friendly, parsedKey, isTestnet);
                        if (valid) entries.set(parsedKey.toRawString(), valid);
                    } catch {}
                }
            } catch {}
        };
        for (let offset = 0; offset < rawAddresses.length; offset += batchSize) {
            batches.push(loadBatch(rawAddresses.slice(offset, offset + batchSize)));
        }
        await Promise.all(batches);
        return formatted();
    };
    try {
        return await Promise.race([
            request(),
            new Promise<AddressInfo[]>(resolve => {
                timeout = setTimeout(() => {
                    controller.abort();
                    resolve(formatted());
                }, 10_000);
            })
        ]);
    } catch {
        return fallback;
    } finally {
        clearTimeout(timeout);
    }
}

export const getAddressFormat = async (address: Address, isTestnet: boolean, previous?: string): Promise<AddressInfo> =>
    (await getAddressFormats([address], isTestnet, [previous]))[0];

export const makeAddressLink = (address: AddressInfo, isTestnet = address.isTestOnly) => {
    const addressString = addressToString({...address, isTestOnly: isTestnet});
    const url = explorerUrl(addressString, isTestnet);
    const title = address.formatResolved === false ? ' title="Account format unavailable; showing a fallback address"' : '';
    return `<a href="${url}" target="_blank"${title}>${addressString}</a>`;
}

interface DisplayAddressRequest {
    address: Address;
    isTestnet: boolean;
    isCurrent: () => boolean;
    promise: Promise<void>;
}

const displayAddressRequests = new WeakMap<HTMLElement, DisplayAddressRequest>();

export const setDisplayAddress = async (node: HTMLElement, address: Address, isTestnet: boolean, isCurrent: () => boolean): Promise<void> => {
    if (!isCurrent()) return;
    const pending = displayAddressRequests.get(node);
    if (pending && pending.address.equals(address) && pending.isTestnet === isTestnet && pending.isCurrent()) {
        return pending.promise;
    }
    const previous = checkedAddressFormat(node.dataset.displayAddress, address, isTestnet);
    const fallback: AddressInfo = {...(previous || {address, isBounceable: false, isTestOnly: isTestnet}), formatResolved: false};
    node.innerHTML = makeAddressLink(fallback, isTestnet);
    node.dataset.displayAddress = addressToString(fallback);
    const request: DisplayAddressRequest = {
        address, isTestnet, isCurrent,
        promise: getAddressFormat(address, isTestnet, node.dataset.displayAddress).then(formatted => {
            if (displayAddressRequests.get(node) === request && isCurrent()) {
                node.innerHTML = makeAddressLink(formatted, isTestnet);
                node.dataset.displayAddress = addressToString(formatted);
            }
        }).finally(() => {
            if (displayAddressRequests.get(node) === request) displayAddressRequests.delete(node);
        }),
    };
    displayAddressRequests.set(node, request);
    return request.promise;
}

export const addressToString = (address: AddressInfo) => {
    return address.address.toString({
        bounceable: address.isBounceable,
        testOnly: address.isTestOnly
    })
}

export const equalsMsgAddresses = (a: Address | null, b: Address | null) => {
    if (!a) return !b;
    if (!b) return !a;
    return a.equals(b);
}

export const equalsAddressLists = (a: Address[], b: Address[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!a[i].equals(b[i])) return false;
    }
    return true;
}

export const assert = (condition: boolean, error: string) => {
    if (!condition) {
        console.error(error);
        throw new Error(error);
    }
}

export const sanitizeHTML = (text: string): string => {
    const d = document.createElement('div');
    d.innerText = text;
    return d.innerHTML;
}
