import {
    Address,
    Cell,
    Contract,
    ContractGetMethodResult,
    ContractProvider,
    ContractState,
    OpenedContract,
    Sender,
    SendMode,
    Transaction,
    TupleItem
} from "@ton/core";
import {TonClient} from "@ton/ton";

const API_KEY = 'd843619b379084d133f061606beecbf72ae2bf60e0622e808f2a3f631673599b';

type IndexQueryPrimitive = string | number | bigint | boolean;
type IndexQueryValue = IndexQueryPrimitive | IndexQueryPrimitive[];

export const sendToIndex = async (method: string, params: Record<string, IndexQueryValue>, isTestnet: boolean, signal?: AbortSignal) => {
    const mainnetRpc = 'https://toncenter.com/api/v3/';
    const testnetRpc = 'https://testnet.toncenter.com/api/v3/';
    const rpc = isTestnet ? testnetRpc : mainnetRpc;

    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
    };

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                query.append(key, String(item));
            }
        } else {
            query.append(key, String(value));
        }
    }

    const response = await fetch(rpc + method + '?' + query, {
        method: 'GET',
        headers: headers,
        signal,
    });
    if (!response.ok) throw new Error(`Toncenter HTTP ${response.status}`);
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('Invalid Toncenter response');
    }
    if (json.error) {
        throw new Error(json.error);
    }
    return json;
}

export class MyNetworkProvider implements ContractProvider {
    private contractAddress: Address;
    private isTestnet: boolean;
    private tonClient: TonClient;

    constructor(contractAddress: Address, isTestnet: boolean) {
        this.contractAddress = contractAddress;
        this.isTestnet = isTestnet;
        this.tonClient = new TonClient({
            endpoint: isTestnet ? 'https://testnet.toncenter.com/api/v2/jsonRPC' : 'https://toncenter.com/api/v2/jsonRPC',
            apiKey: API_KEY
        });
    }

    getState(): Promise<ContractState> {
        throw new Error("Method not implemented.");
    }

    get(name: string, args: TupleItem[]): Promise<ContractGetMethodResult> {
        return this.tonClient.runMethod(this.contractAddress, name, args);
    }

    external(message: Cell): Promise<void> {
        throw new Error("Method not implemented.");
    }

    internal(via: Sender, args: {
        value: string | bigint;
        bounce?: boolean;
        sendMode?: SendMode;
        body?: string | Cell;
    }): Promise<void> {
        throw new Error("Method not implemented.");
    }

    open<T extends Contract>(contract: T): OpenedContract<T> {
        throw new Error("Method not implemented.");
    }

    getTransactions(address: Address, lt: bigint, hash: Buffer, limit?: number): Promise<Transaction[]> {
        throw new Error("Method not implemented.");
    }

}
