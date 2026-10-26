import {
    AddressInfo,
    addressToString,
    assert,
    equalsAddressLists,
    getAddressFormats
} from "../utils/utils";
import {Address, Cell, Dictionary} from "@ton/core";
import {endParse, Multisig, parseMultisigData} from "./Multisig";
import {MyNetworkProvider, sendToIndex} from "../utils/MyNetworkProvider";
import {Op} from "./Constants";
import {Order} from "./Order";
import {checkMultisigOrder, MultisigOrderInfo} from "./MultisigOrderChecker";

const TRACE_BATCH_SIZE = 50;

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
    const queryId = body.loadUint(64);
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
        orderId: parsed.body.orderId
    }
}

export interface LastOrder {
    utime: number,
    transactionHash: string;
    type: 'new' | 'execute' | 'pending' | 'executed';
    executionStatus?: 'checking' | 'success' | 'failed';
    errorMessage?: string;
    order?: {
        address: AddressInfo;
        id: bigint;
    }
    orderInfo?: MultisigOrderInfo;
}

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

export const checkMultisig = async (
    multisigAddress: AddressInfo,
    multisigCode: Cell,
    multisigOrderCode: Cell,
    isTestnet: boolean,
    lastOrdersMode: 'none' | 'history' | 'aggregate',
    needAdditionalGetMethodChecks: boolean,
): Promise<MultisigInfo> => {

    // Account State and Data

    const result = await sendToIndex('account', {address: addressToString(multisigAddress)}, isTestnet);
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

    const formatsPromise = getAddressFormats([...signers, ...proposers], isTestnet);

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

    // Last Orders

    let lastOrders: LastOrder[] = [];

    if (lastOrdersMode !== 'none') {

        const result = await sendToIndex('transactions', {account: addressToString(multisigAddress), limit: 256}, isTestnet);

        for (const tx of result.transactions) {
            if (!tx.in_msg.message_content) continue;
            if (!tx.in_msg.message_content.body) continue;

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
                        transactionHash: tx.hash,
                        type: 'execute',
                        errorMessage: e.message
                    })
                }

            } else if (op === 0xf718510f) { // new_order
                try {
                    if (tx.out_msgs.length !== 1) throw new Error('invalid out messages');
                    const outMsg = tx.out_msgs[0];
                    const {orderAddress, orderId} = parseNewOrderOutMsg(outMsg);

                    const multisigOrderToCheck = Order.createFromConfig({
                        multisig: multisigAddress.address,
                        orderSeqno: orderId
                    }, multisigOrderCode);


                    if (!orderAddress.equals(multisigOrderToCheck.address)) {
                        throw new Error('fake order');
                    }

                    const queryId = inBodySlice.loadUint(64);
                    const _orderId = inBodySlice.loadUint(256);
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
                        transactionHash: tx.hash,
                        type: 'new',
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
                        transactionHash: tx.hash,
                        type: 'new',
                        errorMessage: 'Invalid new order: ' + e.message
                    })
                }
            }
        }

        if (lastOrdersMode === 'aggregate') {
            const lastOrdersMap: {[key: string]: LastOrder} = {};
            for (let lastOrder of lastOrders) {
                if (lastOrder.errorMessage) continue;

                const orderId = lastOrder.order.id.toString();

                if (!lastOrdersMap[orderId]) {
                    lastOrdersMap[orderId] = {
                        utime: lastOrder.utime,
                        transactionHash: lastOrder.transactionHash,
                        type: lastOrder.type === 'new' ? 'pending' : 'executed',
                        order: lastOrder.order
                    }
                } else {
                    if (lastOrdersMap[orderId].type !== 'executed' && lastOrder.type === 'execute') {
                        lastOrdersMap[orderId].utime = lastOrder.utime;
                        lastOrdersMap[orderId].type = 'executed';
                    }
                }
            }

            lastOrders = Object.values(lastOrdersMap);


            const executedOrders = lastOrders.filter(lastOrder => lastOrder.type === 'executed');
            const transactionHashes = [...new Set(executedOrders.map(lastOrder => lastOrder.transactionHash))];
            const resolvedHashes = new Set<string>();
            const failedHashes = new Set<string>();

            const getTraceBatch = async (batch: string[]): Promise<void> => {
                const result: ToncenterTracesResponse = await sendToIndex('traces', {tx_hash: batch, limit: batch.length}, isTestnet);

                for (const trace of result.traces || []) {
                    if (trace.is_incomplete) continue;

                    const transactions = trace.transactions || {};
                    const failed = Object.values(transactions).some(isFailedToncenterTransaction);

                    for (const transactionHash of batch) {
                        if (transactions[transactionHash]) {
                            resolvedHashes.add(transactionHash);
                            if (failed) failedHashes.add(transactionHash);
                        }
                    }
                }
            }

            const getTraceBatchPromises: Promise<void>[] = [];
            for (let offset = 0; offset < transactionHashes.length; offset += TRACE_BATCH_SIZE) {
                const batch = transactionHashes.slice(offset, offset + TRACE_BATCH_SIZE);
                getTraceBatchPromises.push(getTraceBatch(batch));
            }

            const getOrderInfo = async (lastOrder: LastOrder) => {
                if (lastOrder.type === 'pending') {
                    try {
                        const orderInfo = await checkMultisigOrder(lastOrder.order.address, multisigOrderCode, multisigInfo, isTestnet, false, false);
                        lastOrder.orderInfo = orderInfo;
                        const isExpired = (new Date()).getTime() > orderInfo.expiresAt.getTime();
                        if (isExpired) {
                            lastOrder.type = 'executed';
                        } else if (orderInfo.isMismatchSigners || orderInfo.isMismatchThreshold) {
                            lastOrder.type = 'executed';
                            lastOrder.errorMessage = 'Multisig signers or threshold do not match order';
                        }
                    } catch (e) {
                        lastOrder.type = 'executed';
                        lastOrder.errorMessage = e.message;
                    }
                }
            }

            const getOrderInfoPromises: Promise<void>[] = [];

            for (const lastOrder of lastOrders) {
                getOrderInfoPromises.push(getOrderInfo(lastOrder));
            }

            const traceBatchResults = await Promise.allSettled(getTraceBatchPromises);
            for (const result of traceBatchResults) {
                if (result.status === 'rejected') {
                    console.error('Failed to load transaction trace batch', result.reason);
                }
            }
            await Promise.all(getOrderInfoPromises);

            for (const lastOrder of executedOrders) {
                if (!resolvedHashes.has(lastOrder.transactionHash)) {
                    lastOrder.executionStatus = 'checking';
                } else if (failedHashes.has(lastOrder.transactionHash)) {
                    lastOrder.executionStatus = 'failed';
                    lastOrder.errorMessage = 'Failed';
                } else {
                    lastOrder.executionStatus = 'success';
                }
            }

            lastOrders = lastOrders.sort((a, b) => {
                if (a.type === b.type) {
                    return b.utime - a.utime;
                } else {
                    if (a.type === 'pending') return -1;
                    return 1;
                }
            });
        }
    }

    const formatted = await formatsPromise;
    multisigInfo.signers = formatted.slice(0, signers.length);
    multisigInfo.proposers = formatted.slice(signers.length);
    multisigInfo.lastOrders = lastOrders;

    return multisigInfo;
}
