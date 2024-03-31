import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode, Slice,
    toNano
} from '@ton/core';
import {JettonWallet} from './JettonWallet';
import {Op} from './JettonConstants';
import {assert} from "../utils/utils";

export type JettonMinterContent = {
    uri: string
};
export type JettonMinterConfig = {
    admin: Address,
    wallet_code: Cell,
    jetton_content: Cell | JettonMinterContent
};
export type JettonMinterConfigFull = {
    supply: bigint,
    admin: Address,
    transfer_admin: Address | null,
    wallet_code: Cell,
    jetton_content: Cell | JettonMinterContent
}

export type LockType = 'unlock' | 'out' | 'in' | 'full';

export const LOCK_TYPES = ['unlock', 'out', 'in', 'full'];

export const lockTypeToInt = (lockType: LockType): number => {
    switch (lockType) {
        case 'unlock':
            return 0;
        case 'out':
            return 1;
        case 'in':
            return 2;
        case 'full':
            return 3;
        default:
            throw new Error("Invalid argument!");
    }
}

export const intToLockType = (lockType: number): LockType => {
    switch (lockType) {
        case 0:
            return 'unlock';
        case 1:
            return 'out';
        case 2:
            return 'in';
        case 3:
            return 'full';
        default:
            throw new Error("Invalid argument!");
    }
}

export function endParse(slice: Slice) {
    if (slice.remainingBits > 0 || slice.remainingRefs > 0) {
        throw new Error('remaining bits in data');
    }
}

export function jettonMinterConfigCellToConfig(config: Cell): JettonMinterConfigFull {
    const sc = config.beginParse()
    const parsed: JettonMinterConfigFull = {
        supply: sc.loadCoins(),
        admin: sc.loadAddress(),
        transfer_admin: sc.loadMaybeAddress(),
        wallet_code: sc.loadRef(),
        jetton_content: sc.loadRef()
    };
    endParse(sc);
    return parsed;
}

export function parseJettonMinterData(data: Cell): JettonMinterConfigFull {
    return jettonMinterConfigCellToConfig(data);
}

export function jettonMinterConfigFullToCell(config: JettonMinterConfigFull): Cell {
    const content = config.jetton_content instanceof Cell ? config.jetton_content : jettonContentToCell(config.jetton_content);
    return beginCell()
        .storeCoins(config.supply)
        .storeAddress(config.admin)
        .storeAddress(config.transfer_admin)
        .storeRef(config.wallet_code)
        .storeRef(content)
        .endCell()
}

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
    const content = config.jetton_content instanceof Cell ? config.jetton_content : jettonContentToCell(config.jetton_content);
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.admin)
        .storeAddress(null) // Transfer admin address
        .storeRef(config.wallet_code)
        .storeRef(content)
        .endCell();
}

export function jettonContentToCell(content: JettonMinterContent) {
    return beginCell()
        .storeStringTail(content.uri) //Snake logic under the hood
        .endCell();
}

export class JettonMinter implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
    }

    static createFromAddress(address: Address) {
        return new JettonMinter(address);
    }

    static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
        const data = jettonMinterConfigToCell(config);
        const init = {code, data};
        return new JettonMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(Op.top_up, 32).storeUint(0, 64).endCell(),
        });
    }

    static mintMessage(to: Address, jetton_amount: bigint, from: Address | null, response: Address | null, customPayload: Cell | null, forward_ton_amount: bigint, total_ton_amount: bigint) {
        const mintMsg = beginCell().storeUint(Op.internal_transfer, 32)
            .storeUint(0, 64)
            .storeCoins(jetton_amount)
            .storeAddress(from)
            .storeAddress(response)
            .storeCoins(forward_ton_amount)
            .storeMaybeRef(customPayload)
            .endCell();
        return beginCell().storeUint(Op.mint, 32).storeUint(0, 64) // op, queryId
            .storeAddress(to)
            .storeCoins(total_ton_amount)
            .storeRef(mintMsg)
            .endCell();
    }

    static parseMintInternalMessage(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.internal_transfer) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const fromAddress = slice.loadAddress();
        const responseAddress = slice.loadAddress();
        const forwardTonAmount = slice.loadCoins();
        const inRef = slice.loadBit();
        const forwardPayload = inRef ? slice.loadRef().beginParse() : slice;

        endParse(slice);
        return {
            queryId,
            jettonAmount,
            fromAddress,
            responseAddress,
            forwardTonAmount,
            forwardPayload
        }
    }

    static parseMintMessage(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.mint) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const toAddress = slice.loadAddress();
        const tonAmount = slice.loadCoins();
        const mintMsg = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            toAddress,
            tonAmount,
            internalMessage: this.parseMintInternalMessage(mintMsg.beginParse())
        }
    }

    static topUpMessage() {
        return beginCell().storeUint(Op.top_up, 32).storeUint(0, 64) // op, queryId
            .endCell();
    }

    static parseTopUp(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.top_up) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        endParse(slice);
        return {
            queryId,
        }
    }

    static changeAdminMessage(newOwner: Address) {
        return beginCell().storeUint(Op.change_admin, 32).storeUint(0, 64) // op, queryId
            .storeAddress(newOwner)
            .endCell();
    }

    static parseChangeAdmin(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.change_admin) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newAdminAddress = slice.loadAddress();
        endParse(slice);
        return {
            queryId,
            newAdminAddress
        }
    }

    static claimAdminMessage(query_id: bigint = 0n) {
        return beginCell().storeUint(Op.claim_admin, 32).storeUint(query_id, 64).endCell();
    }

    static parseClaimAdmin(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.claim_admin) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        endParse(slice);
        return {
            queryId
        }
    }

    static changeContentMessage(content:  JettonMinterContent) {
        const contentString = content.uri;
        return beginCell().storeUint(Op.change_metadata_url, 32).storeUint(0, 64) // op, queryId
            .storeStringTail(contentString)
            .endCell();
    }

    static parseChangeContent(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.change_metadata_url) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newMetadataUrl = slice.loadStringTail();
        endParse(slice);
        return {
            queryId,
            newMetadataUrl
        }
    }

    static lockWalletMessage(lock_address: Address, lock: number, amount: bigint, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(lock_address)
            .storeCoins(amount)
            .storeRef(beginCell().storeUint(Op.set_status, 32).storeUint(query_id, 64).storeUint(lock, 4).endCell())
            .endCell();
    }

    static parseSetStatus(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.set_status) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newStatus = slice.loadUint(4);
        endParse(slice);
        return {
            queryId,
            newStatus
        }
    }

    static parseCallTo(slice: Slice, refPrser: (slice: Slice) => any) {
        const op = slice.loadUint(32);
        if (op !== Op.call_to) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const toAddress = slice.loadAddress();
        const tonAmount = slice.loadCoins();
        const ref = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            toAddress,
            tonAmount,
            action: refPrser(ref.beginParse())
        }
    }

    static forceTransferMessage(transfer_amount: bigint,
                                to: Address,
                                from: Address,
                                response_address: Address,
                                custom_payload: Cell | null,
                                forward_amount: bigint,
                                forward_payload: Cell | null,
                                value: bigint,
                                query_id: bigint = 0n) {

        const transferMessage = JettonWallet.transferMessage(transfer_amount,
            to,
            response_address,
            custom_payload,
            forward_amount,
            forward_payload);
        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(from)
            .storeCoins(value)
            .storeRef(transferMessage)
            .endCell();
    }

    static parseTransfer(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.transfer) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const toAddress = slice.loadAddress();
        const responseAddress = slice.loadAddress();
        const customPayload = slice.loadMaybeRef();
        const forwardTonAmount = slice.loadCoins();
        const inRef = slice.loadBit();
        const forwardPayload = inRef ? slice.loadRef().beginParse() : slice;

        return {
            queryId,
            jettonAmount,
            toAddress,
            responseAddress,
            customPayload,
            forwardTonAmount,
            forwardPayload
        }
    }

    static forceBurnMessage(burn_amount: bigint,
                            to: Address,
                            response: Address | null,
                            value: bigint,
                            query_id: bigint | number = 0) {

        return beginCell().storeUint(Op.call_to, 32).storeUint(query_id, 64)
            .storeAddress(to)
            .storeCoins(value)
            .storeRef(JettonWallet.burnMessage(burn_amount, response, null))
            .endCell()
    }

    static parseBurn(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.burn) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const jettonAmount = slice.loadCoins();
        const responseAddress = slice.loadAddress();
        const customPayload = slice.loadMaybeRef();
        endParse(slice);
        return {
            queryId,
            jettonAmount,
            responseAddress,
            customPayload,
        }
    }

    static upgradeMessage(new_code: Cell, new_data: Cell, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.upgrade, 32).storeUint(query_id, 64)
            .storeRef(new_data)
            .storeRef(new_code)
            .endCell();
    }

    static parseUpgrade(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.upgrade) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newData = slice.loadRef();
        const newCode = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            newData,
            newCode
        }
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        const res = await provider.get('get_wallet_address', [{
            type: 'slice',
            cell: beginCell().storeAddress(owner).endCell()
        }])
        assert(res.stack.remaining === 1, "invalid get_wallet_address result");
        return res.stack.readAddress()
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);
        assert(res.stack.remaining === 5, "invalid get_jetton_data result");
        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();
        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode,
        };
    }
    async getNextAdminAddress(provider: ContractProvider) {
        const res = await provider.get('get_next_admin_address', []);
        assert(res.stack.remaining === 1, "invalid get_next_admin_address result");
        return res.stack.readAddressOpt();
    }
}
