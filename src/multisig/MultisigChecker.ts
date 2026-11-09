import {
    AddressInfo,
    addressToString,
    assert,
    equalsAddressLists
} from "../utils/utils";
import {Address, Cell, Dictionary} from "@ton/core";
import {endParse, Multisig, parseMultisigData} from "./Multisig";
import {MyNetworkProvider, sendToIndex} from "../utils/MyNetworkProvider";
import {Op} from "./Constants";
import {Order} from "./Order";
import {checkMultisigOrder, InactiveOrderAccountError, MultisigOrderInfo, OrderAccount} from "./MultisigOrderChecker";

const HISTORY_PAGE_SIZE = 256;
const HISTORY_PAGE_TIMEOUT_MS = 15_000;
const ORDER_ACCOUNT_BATCH_SIZE = 50;
const ORDER_ACCOUNT_BATCH_TIMEOUT_MS = 15_000;

interface ToncenterMessage {
    decoded_opcode?: string | null;
    opcode?: string | number | null;
    bounced?: boolean | null;
}

interface ToncenterSkippedComputePhase {
    skipped: true;
    reason: string;
}

interface ToncenterVmComputePhase {
    skipped: false;
    success: boolean;
    exit_code: number;
}

type ToncenterComputePhase = ToncenterSkippedComputePhase | ToncenterVmComputePhase;

interface ToncenterActionPhase {
    success: boolean;
}

interface ToncenterTransactionDescription {
    type: string;
    bounce?: unknown | null;
    compute_ph?: ToncenterComputePhase | null;
    action?: ToncenterActionPhase | null;
}

interface ToncenterTransaction {
    description?: ToncenterTransactionDescription | null;
    in_msg?: ToncenterMessage | null;
}

interface ToncenterTrace {
    is_incomplete?: boolean;
    trace_info?: {trace_state: string; transactions: number};
    transactions?: Record<string, ToncenterTransaction> | null;
}

interface ToncenterTracesResponse {
    traces?: ToncenterTrace[] | null;
}

const isSuccessfulToncenterTransaction = (transaction: ToncenterTransaction): boolean => {
    const description = transaction.description;

    switch (description?.type) {
        case 'ord': {
            if (description.bounce != null) return false;

            const computePhase = description.compute_ph;
            if (computePhase?.skipped === true && computePhase.reason !== 'no_state') return false;
            if (computePhase?.skipped === false &&
                (!computePhase.success || (computePhase.exit_code !== 0 && computePhase.exit_code !== 1))) {
                return false;
            }
            if (description.action && !description.action.success) return false;
            return true;
        }
        case 'tick_tock': {
            const computePhase = description.compute_ph;
            if (computePhase?.skipped === true && computePhase.reason !== 'no_state') return false;
            if (computePhase?.skipped === false &&
                (!computePhase.success || (computePhase.exit_code !== 0 && computePhase.exit_code !== 1))) {
                return false;
            }
            if (description.action && !description.action.success) return false;
            return true;
        }
        default:
            return true;
    }
}

const isExcessMessage = (message?: ToncenterMessage | null): boolean => {
    return message?.decoded_opcode === 'excess' ||
        message?.opcode === '0xd53276db' ||
        message?.opcode === 0xd53276db;
}

const isFailedToncenterTransaction = (transaction: ToncenterTransaction): boolean => {
    if (isSuccessfulToncenterTransaction(transaction)) return false;

    const inMsg = transaction.in_msg;
    return !isExcessMessage(inMsg) && !inMsg?.bounced;
}

export type MultisigExecutionResult = 'success' | 'failed';

export const readMultisigExecutionResults = async (hashes: string[], isTestnet: boolean, signal: AbortSignal) => {
    const response: ToncenterTracesResponse = await sendToIndex('traces', {tx_hash: hashes, limit: hashes.length}, isTestnet, signal);
    const results = new Map<string, MultisigExecutionResult>();

    for (const trace of response.traces || []) {
        if (trace.is_incomplete !== false || trace.trace_info?.trace_state !== 'complete' || !trace.transactions) continue;
        const transactions = Object.values(trace.transactions);
        if (transactions.length !== trace.trace_info.transactions) continue;
        const failed = transactions.some(isFailedToncenterTransaction);

        for (const hash of hashes) {
            if (trace.transactions[hash] && results.get(hash) !== 'failed') {
                results.set(hash, failed ? 'failed' : 'success');
            }
        }
    }
    return results;
};

const parseNewOrderInitStateBody = (cell: Cell) => {
    const slice = cell.beginParse();
    const multisigAddress = slice.loadAddress();
    const orderId = slice.loadUintBig(256);
    endParse(slice);
    return {
        multisigAddress,
        orderId
    }
}

const parseNewOrderInitState = (cell: Cell) => {
    const slice = cell.beginParse();
    if (slice.loadUint(2) !== 0) throw new Error('invalid init state prefix');
    const code = slice.loadMaybeRef()!;
    const body = slice.loadMaybeRef()!;
    if (slice.loadBoolean()) throw new Error('invalid init state empty libraries');
    endParse(slice);
    return {
        code,
        body: parseNewOrderInitStateBody(body)
    }
}

/**
 * @param outMsg - out msg from toncenter v3
 */
const parseNewOrderOutMsg = (outMsg: any) => {
    const orderAddress = Address.parse(outMsg.destination);
    const initState = Cell.fromBase64(outMsg.init_state.body);
    const parsed = parseNewOrderInitState(initState)

    const body = Cell.fromBase64(outMsg.message_content.body).beginParse();
    assert(body.loadUint(32) === Op.order.init, "invalid op");
    const queryId = body.loadUintBig(64);
    const threshold = body.loadUint(8);
    const signers = body.loadRef().beginParse().loadDictDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Address());
    const expiredAt = body.loadUint(48);
    const order = body.loadRef().beginParse().loadDictDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Cell());
    const isSigner = body.loadUint(1);
    let signerIndex = undefined;
    if (isSigner) {
        signerIndex = body.loadUint(8);
    }

    console.log('OUT', {
        queryId,
        threshold,
        signers,
        expiredAt,
        order,
        isSigner,
        signerIndex,
    })

    endParse(body);

    return {
        orderAddress,
        orderId: parsed.body.orderId,
        creationExpiresAt: expiredAt,
    }
}

export interface LastOrder {
    utime: number,
    lt: bigint;
    transactionHash: string;
    type: 'new' | 'execute' | 'pending' | 'executed';
    executionStatus?: 'checking' | MultisigExecutionResult;
    errorMessage?: string;
    order?: {
        address: AddressInfo;
        id: bigint;
    }
    orderInfo?: MultisigOrderInfo;
    accountInactive?: boolean;
    accountReadFailed?: boolean;
    creationExpiresAt?: number;
}

const readWithDeadline = async <T>(signal: AbortSignal, duration: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, {once: true});
    const timeout = setTimeout(abort, duration);
    try {
        return await read(controller.signal);
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
    }
};

const readOrderAccountBatch = async (orders: LastOrder[], isTestnet: boolean, signal: AbortSignal) => {
    const states = new Map<string, OrderAccount>();
    try {
        const address = orders.map(order => addressToString(order.order.address));
        const {accounts} = await readWithDeadline(signal, ORDER_ACCOUNT_BATCH_TIMEOUT_MS,
            requestSignal => sendToIndex('accountStates', {address, include_boc: true}, isTestnet, requestSignal));
        if (!Array.isArray(accounts)) throw new Error('Invalid order account batch');
        for (const account of accounts) {
            const {address, status, balance, code_boc, data_boc} = account ?? {};
            if (typeof address !== 'string') continue;

            let state: OrderAccount;
            if (status === 'active' && typeof balance === 'string' && typeof code_boc === 'string' && typeof data_boc === 'string') {
                state = {status, balance, code: code_boc, data: data_boc};
            } else if (status === 'frozen' || status === 'uninit' || status === 'nonexist') {
                state = {status};
            } else {
                continue;
            }
            try {
                states.set(Address.parse(address).toRawString(), state);
            } catch {}
        }
    } catch (error) {
        if (!signal.aborted) console.error('Failed to load order account batch', error);
        return undefined;
    }
    return states;
};

export interface MultisigInfo {
    address: AddressInfo;
    multisigContract: Multisig;
    provider: MyNetworkProvider;
    signers: AddressInfo[];
    proposers: AddressInfo[];
    threshold: number;
    allowArbitraryOrderSeqno: boolean;
    nextOderSeqno: bigint;
    tonBalance: bigint;
    lastOrders: LastOrder[];
    stateInitMatches: boolean;
}

export interface MultisigSigningConfig {
    threshold: number;
    signers: Address[];
}

export const checkMultisig = async (
    multisigAddress: AddressInfo,
    multisigCode: Cell,
    isTestnet: boolean,
    needAdditionalGetMethodChecks: boolean,
    options: {
        signal?: AbortSignal;
        onSigningConfigRead?: (config: MultisigSigningConfig, lastTransactionLt: bigint | undefined) => void;
    } = {},
): Promise<MultisigInfo> => {

    // Account State and Data

    const result = await sendToIndex('account', {address: addressToString(multisigAddress)}, isTestnet, options.signal);
    assert(result.status === 'active', "Contract not active. If you have just created a multisig it should appear within ~30 seconds.");

    assert(Cell.fromBase64(result.code).equals(multisigCode), 'The contract code DOES NOT match the multisig code from this repository');

    const tonBalance = result.balance;

    const data = Cell.fromBase64(result.data);
    const parsedData = parseMultisigData(data);

    if (parsedData.allowArbitraryOrderSeqno) {
        assert(parsedData.nextOderSeqno === BigInt(0), 'invalid nextOrderSeqno for allowArbitraryOrderSeqno');
    }

    const signers = parsedData.signers;
    const proposers = parsedData.proposers;

    assert(signers.length === parsedData.signersCount, 'invalid signersCount');
    assert(parsedData.threshold > 0, 'threshold <= 0');
    assert(parsedData.threshold <= parsedData.signersCount, 'invalid threshold');

    if (options.onSigningConfigRead) {
        const rawLt = result.last_transaction_lt;
        const lastTransactionLt = typeof rawLt === 'string' && /^\d+$/.test(rawLt) ? BigInt(rawLt) : undefined;
        options.onSigningConfigRead({threshold: parsedData.threshold, signers}, lastTransactionLt);
    }

    // Get-methods

    const multisigContract = Multisig.createFromAddress(multisigAddress.address);

    const provider = new MyNetworkProvider(multisigAddress.address, isTestnet);

    if (needAdditionalGetMethodChecks) {
        const getData = await multisigContract.getMultisigData(provider);

        if (parsedData.allowArbitraryOrderSeqno) {
            assert(getData.nextOrderSeqno === BigInt(-1), "nextOderSeqno doesn't match");
        } else {
            assert(getData.nextOrderSeqno === parsedData.nextOderSeqno, "nextOderSeqno doesn't match");
        }
        assert(getData.threshold === BigInt(parsedData.threshold), "threshold doesn't match");
        assert(equalsAddressLists(getData.signers, parsedData.signers), 'invalid signers');
        assert(equalsAddressLists(getData.proposers, parsedData.proposers), 'invalid proposers');
    }

    // State Init

    const multisigAddress2 = Multisig.createFromConfig({
        threshold: parsedData.threshold,
        signers: parsedData.signers,
        proposers: parsedData.proposers,
        allowArbitrarySeqno: parsedData.allowArbitraryOrderSeqno
    }, multisigCode)

    const stateInitMatches = multisigAddress2.address.equals(multisigAddress.address);


    const multisigInfo: MultisigInfo = {
        address: multisigAddress,
        multisigContract,
        provider,
        signers: signers.map(address => ({address, isBounceable: false, isTestOnly: isTestnet, formatResolved: false})),
        proposers: proposers.map(address => ({address, isBounceable: false, isTestOnly: isTestnet, formatResolved: false})),
        threshold: parsedData.threshold,
        allowArbitraryOrderSeqno: parsedData.allowArbitraryOrderSeqno,
        nextOderSeqno: parsedData.nextOderSeqno,
        tonBalance,
        lastOrders: [],
        stateInitMatches
    }

    return multisigInfo;
}

export interface MultisigHistoryCursor {
    endLt: bigint;
    expectedLt: bigint;
}

export const readMultisigHistoryPage = async (
    multisigAddress: AddressInfo,
    multisigOrderCode: Cell,
    isTestnet: boolean,
    signal: AbortSignal,
    cursor?: MultisigHistoryCursor,
    afterLt?: bigint,
) => {
    const query = {
        account: addressToString(multisigAddress),
        limit: HISTORY_PAGE_SIZE,
        sort: 'desc',
        ...(cursor ? {end_lt: cursor.endLt} : {}),
        ...(afterLt !== undefined ? {start_lt: afterLt + 1n} : {}),
    };
    const {transactions} = await readWithDeadline(signal, HISTORY_PAGE_TIMEOUT_MS,
        requestSignal => sendToIndex('transactions', query, isTestnet, requestSignal));
    if (!Array.isArray(transactions) || (cursor && cursor.expectedLt !== 0n && transactions.length === 0)) {
        throw new Error('Incomplete multisig transaction history');
    }

    const lastOrders: LastOrder[] = [];
    let endLt = cursor?.endLt;
    let expectedLt = cursor?.expectedLt ?? 0n;
    for (const tx of transactions) {
        const lt = BigInt(tx.lt);
        const previousLt = BigInt(tx.prev_trans_lt);
        if ((endLt !== undefined && lt > endLt) || (expectedLt !== 0n && lt !== expectedLt)
            || previousLt < 0n || previousLt >= lt
            || (afterLt !== undefined && (lt <= afterLt || (previousLt !== 0n && previousLt < afterLt)))) {
            throw new Error('Incomplete multisig transaction history');
        }
        endLt = lt - 1n;
        expectedLt = previousLt;

        if (!tx.in_msg?.message_content?.body) continue;

        const inBody = Cell.fromBase64(tx.in_msg.message_content.body);
        const inBodySlice = inBody.beginParse();
        if (inBodySlice.remainingBits < 32) {
            continue;
        }
        const op = inBodySlice.loadUint(32);

        if (op === 0x75097f5d) { // execute
            try {
                const queryId = inBodySlice.loadUintBig(64);
                const orderId = inBodySlice.loadUintBig(256);
                const orderAddress = Address.parse(tx.in_msg.source);

                const multisigOrderToCheck = Order.createFromConfig({
                    multisig: multisigAddress.address,
                    orderSeqno: orderId
                }, multisigOrderCode);


                if (!orderAddress.equals(multisigOrderToCheck.address)) {
                    throw new Error('fake order');
                }

                lastOrders.push({
                    utime: tx.now,
                    lt,
                    transactionHash: tx.hash,
                    type: 'execute',
                    order: {
                        address: {
                            address: orderAddress,
                            isBounceable: true,
                            isTestOnly: isTestnet
                        },
                        id: orderId
                    }
                })

            } catch (e: any) {
                lastOrders.push({
                    utime: tx.now,
                    lt,
                    transactionHash: tx.hash,
                    type: 'execute',
                    errorMessage: e.message
                })
            }

        } else if (op === 0xf718510f) { // new_order
            try {
                if (tx.out_msgs.length !== 1) throw new Error('invalid out messages');
                const outMsg = tx.out_msgs[0];
                const {orderAddress, orderId, creationExpiresAt} = parseNewOrderOutMsg(outMsg);

                const multisigOrderToCheck = Order.createFromConfig({
                    multisig: multisigAddress.address,
                    orderSeqno: orderId
                }, multisigOrderCode);


                if (!orderAddress.equals(multisigOrderToCheck.address)) {
                    throw new Error('fake order');
                }

                const queryId = inBodySlice.loadUintBig(64);
                inBodySlice.skip(256);
                const isSigner = inBodySlice.loadUint(1);
                const index = inBodySlice.loadUint(8);
                const expiredAt = inBodySlice.loadUint(48);
                const order = inBodySlice.loadRef().beginParse().loadDictDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Cell());

                endParse(inBodySlice);

                console.log('IN', {
                    queryId,
                    orderId,
                    orderAddress: orderAddress.toString(),
                    isSigner,
                    index,
                    expiredAt,
                    order
                })

                lastOrders.push({
                    utime: tx.now,
                    lt,
                    transactionHash: tx.hash,
                    type: 'new',
                    creationExpiresAt,
                    order: {
                        address: {
                            address: orderAddress,
                            isBounceable: true,
                            isTestOnly: isTestnet
                        },
                        id: orderId
                    }
                })

            } catch (e: any) {
                console.log(e);
                lastOrders.push({
                    utime: tx.now,
                    lt,
                    transactionHash: tx.hash,
                    type: 'new',
                    errorMessage: 'Invalid new order: ' + e.message
                })
            }
        }
    }

    const reachedKnownHead = afterLt !== undefined && expectedLt === afterLt;
    const hasMore = !reachedKnownHead && (transactions.length >= HISTORY_PAGE_SIZE || expectedLt !== 0n);
    return {
        head: transactions.length ? BigInt(transactions[0].lt) : undefined,
        next: hasMore ? {endLt, expectedLt} : null,
        events: lastOrders,
    };
};

export interface MultisigOrderEvents {
    latest: LastOrder;
    execution?: LastOrder;
}

export const mergeMultisigOrderEvents = (orders: Record<string, MultisigOrderEvents>, events: LastOrder[]) => {
    const changed: Record<string, MultisigOrderEvents> = {};
    for (const event of events) {
        if (event.errorMessage) continue;
        const id = event.order.id.toString();
        const entry = changed[id] ?? orders[id];
        const latest = !entry || event.lt > entry.latest.lt ? event : entry.latest;
        let execution = entry?.execution;
        if (event.type === 'execute' && (!execution || event.lt > execution.lt)) execution = event;
        if (latest !== entry?.latest || execution !== entry?.execution) changed[id] = {latest, execution};
    }
    return changed;
};

export const readMultisigOrders = async (
    events: MultisigOrderEvents[],
    multisigInfo: MultisigInfo,
    multisigOrderCode: Cell,
    isTestnet: boolean,
    signal: AbortSignal,
    options: {previousRows?: ReadonlyMap<string, LastOrder>; batchEndpoint?: {available: boolean}} = {},
): Promise<LastOrder[]> => {
    const {previousRows, batchEndpoint = {available: true}} = options;
    const executedOrder = (event: LastOrder): LastOrder => ({...event, type: 'executed', executionStatus: 'checking'});
    const entries = events.map(({latest, execution}) => {
        const hasNewCreation = multisigInfo.allowArbitraryOrderSeqno && latest.type === 'new';
        const order: LastOrder = execution && !hasNewCreation ? executedOrder(execution) : {...latest, type: 'pending'};
        return {order, execution, previous: previousRows?.get(latest.order.id.toString())};
    });
    const getOrderInfo = async (lastOrder: LastOrder, execution?: LastOrder, account?: OrderAccount, previous?: LastOrder) => {
        const readOrder = (state?: OrderAccount, requestSignal = signal) => checkMultisigOrder(lastOrder.order.address,
            multisigOrderCode, multisigInfo, isTestnet, false, false, requestSignal, state);
        const readSingle = () => readWithDeadline(signal, ORDER_ACCOUNT_BATCH_TIMEOUT_MS, requestSignal => readOrder(undefined, requestSignal));
        try {
            const orderInfo = await (account ? readOrder(account).catch(error => {
                if (signal.aborted || account.status !== 'active') throw error;
                return readSingle();
            }) : readSingle());
            if (execution && orderInfo.isExecuted) return executedOrder(execution);
            lastOrder.orderInfo = orderInfo;
            const isExpired = (new Date()).getTime() > orderInfo.expiresAt.getTime();
            if (isExpired) {
                lastOrder.type = 'executed';
            } else if (orderInfo.isMismatchSigners || orderInfo.isMismatchThreshold) {
                lastOrder.type = 'executed';
                lastOrder.errorMessage = 'Multisig signers or threshold do not match order';
            }
        } catch (e) {
            const accountInactive = e instanceof InactiveOrderAccountError;
            const executionUnchanged = !execution || previous?.transactionHash === execution.transactionHash;
            if (previous && (!accountInactive || (previous.accountInactive && executionUnchanged))) {
                const accountReadFailed = !accountInactive;
                return Boolean(previous.accountReadFailed) === accountReadFailed ? previous : {...previous, accountReadFailed};
            }
            if (accountInactive) {
                if (execution) return {...executedOrder(execution), accountInactive: true};
                lastOrder.accountInactive = true;
            } else {
                lastOrder.accountReadFailed = true;
            }
            lastOrder.type = 'executed';
            lastOrder.errorMessage = e.message;
        }
        return lastOrder;
    };
    const pending = entries.filter(({order}) => order.type === 'pending');
    for (let offset = 0; offset < pending.length && !signal.aborted; offset += ORDER_ACCOUNT_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + ORDER_ACCOUNT_BATCH_SIZE);
        let states: Map<string, OrderAccount> | undefined;
        if (batchEndpoint.available && (batch.length > 1 || batch[0].previous)) {
            states = await readOrderAccountBatch(batch.map(({order}) => order), isTestnet, signal);
            batchEndpoint.available = states !== undefined;
        }
        if (signal.aborted) break;
        await Promise.all(batch.map(async entry => {
            const account = states?.get(entry.order.order.address.address.toRawString());
            entry.order = await getOrderInfo(entry.order, entry.execution, account, entry.previous);
        }));
    }
    return entries.map(({order}) => order);
};
