import {Address, beginCell, Cell, fromNano, SendMode, storeMessageRelaxed, toNano} from "@ton/core";
import {THEME, TonConnectUI} from '@tonconnect/ui'
import {
    AddressInfo,
    addressToString,
    base64toHex,
    equalsAddressLists,
    equalsMsgAddresses,
    getAddressFormats,
    makeAddressLink,
    setDisplayAddress,
    validateUserFriendlyAddress
} from "./utils/utils";
import {
    checkMultisig, LastOrder, mergeMultisigOrderEvents, MultisigExecutionResult, MultisigHistoryCursor, MultisigInfo,
    MultisigOrderEvents, MultisigSigningConfig, readMultisigExecutionResults, readMultisigHistoryPage, readMultisigOrders
} from "./multisig/MultisigChecker";
import {checkMultisigOrder, getMultisigOrderMismatch, MultisigOrderInfo} from "./multisig/MultisigOrderChecker";
import {JettonMinter, LOCK_TYPES, LockType, lockTypeToDescription, lockTypeToInt} from "./jetton/JettonMinter";
import {Multisig} from "./multisig/Multisig";
import {toUnits} from "./utils/units";
import {checkJettonMinter} from "./jetton/JettonMinterChecker";
import {storeStateInit} from "@ton/core/src/types/StateInit";
import {MyNetworkProvider, sendToIndex} from "./utils/MyNetworkProvider";
import {Order} from "./multisig/Order";
import {JettonWallet} from "./jetton/JettonWallet";
import {
    SINGLE_NOMINATOR_POOL_OP_CHANGE_VALIDATOR_ADDRESS,
    SINGLE_NOMINATOR_POOL_OP_WITHDRAW,
    VESTING_INTERNAL_TRANSFER
} from "./multisig/Constants";

// UI COMMON

const $ = (selector: string): HTMLElement | null => document.querySelector(selector);

const $$ = (selector: string): NodeListOf<HTMLElement> => document.querySelectorAll(selector);

const toggle = (element: HTMLElement, isVisible: boolean): void => {
    element.style.display = isVisible ? 'flex' : 'none';
}

const YOU_BADGE: string = ` <div class="badge">It's you</div>`

// URL STATE

const clearUrlState = (): void => {
    if (window.history.state !== '') {
        window.history.pushState('', 'TON Multisig', '#');
    }
}

const pushUrlState = (multisigAddress: string, orderId?: bigint): void => {
    let url = multisigAddress;
    if (orderId !== undefined) {
        url += '/' + orderId;
    }
    if (window.history.state !== url) {
        window.history.pushState(url, 'TON Multisig - ' + url, '#' + url);
    }
}

// TESTNET, LANGUAGE

const browserLang: string = navigator.language;
const lang: 'ru' | 'en' = (browserLang === 'ru-RU') || (browserLang === 'ru') || (browserLang === 'be-BY') || (browserLang === 'be') || (browserLang === 'kk-KZ') || (browserLang === 'kk') ? 'ru' : 'en';

const IS_TESTNET: boolean = window.location.href.indexOf('testnet=true') > -1;

if (IS_TESTNET) {
    $('.testnet-badge').style.display = 'block';
    document.body.classList.add('testnet-padding');
}

export const formatContractAddress = (address: Address): string => {
    return address.toString({bounceable: true, testOnly: IS_TESTNET});
}

// SCREEN

type ScreenType =
    'startScreen'
    | 'importScreen'
    | 'multisigScreen'
    | 'newOrderScreen'
    | 'orderScreen'
    | 'newMultisigScreen'
    | 'loadingScreen';

let currentScreen: ScreenType = 'startScreen';

const showScreen = (name: ScreenType): void => {
    const screens = ['startScreen', 'importScreen', 'multisigScreen', 'newOrderScreen', 'orderScreen', 'newMultisigScreen', 'loadingScreen']
    currentScreen = name;
    for (const screen of screens) {
        toggle($('#' + screen), screen === name);
    }

    switch (currentScreen) {
        case 'startScreen':
            clearMultisig();
            clearOrder();
            clearUrlState();
            break;
        case 'importScreen':
            ($('#import_input') as HTMLInputElement).value = '';
            break;
        case 'newOrderScreen':
            newOrderClear();
            break;
        case 'newMultisigScreen':
            newMultisigClear();
            break;
    }
}

const goHome = (): void => {
    if (currentScreen === 'startScreen' || currentScreen === 'loadingScreen' || currentScreen === 'multisigScreen') {
        return;
    }
    if (currentScreen === 'importScreen' || (currentScreen === 'newMultisigScreen' && !currentMultisigInfo)) {
        newMultisigClear();
        showScreen('startScreen');
    } else {
        clearOrder();
        newOrderClear();
        newMultisigClear();
        pushUrlState(currentMultisigAddress);
        showScreen('multisigScreen');
    }
}

$('#header_logo').addEventListener('click', () => goHome());
$('#header_title').addEventListener('click', () => goHome());

// TONCONNECT

let myAddress: Address | null;

const tonConnectUI = new TonConnectUI({
    manifestUrl: 'https://multisig.ton.org/tonconnect-manifest.json',
    buttonRootId: 'tonConnectButton'
});

tonConnectUI.uiOptions = {
    uiPreferences: {
        theme: THEME.LIGHT
    }
};

const tonConnectUnsubscribe = tonConnectUI.onStatusChange(info => {
    approvalNotice = undefined;
    if (info === null) { // wallet disconnected
        myAddress = null;
    } else if (info.account) {
        myAddress = Address.parseRaw(info.account.address);
    }

    if (currentMultisigAddress && currentMultisigInfo) {
        renderCurrentMultisigInfo();
    }

    if (currentOrderInfo) {
        renderCurrentOrderInfo();
    }
});

// START SCREEN

$('#createMultisigButton').addEventListener('click', () => {
    showNewMultisigScreen('create');
});

$('#importMultisigButton').addEventListener('click', () => {
    showScreen('importScreen');
});

// IMPORT SCREEN

$('#import_okButton').addEventListener('click', () => {
    const address = ($('#import_input') as HTMLInputElement).value;
    const error = validateUserFriendlyAddress(address, IS_TESTNET);
    if (error) {
        alert(error);
    } else {
        setMultisigAddress(address);
    }
});

$('#import_backButton').addEventListener('click', () => {
    showScreen('startScreen')
});

const transactionExplorerUrl = (hash: string): string =>
    `${IS_TESTNET ? 'https://testnet.tonscan.org' : 'https://tonscan.org'}/tx/${base64toHex(hash)}`;

// MULTISIG SCREEN

const MULTISIG_CODE = Cell.fromBase64("te6cckECEgEABJUAART/APSkE/S88sgLAQIBYgIDAsrQM9DTAwFxsJJfA+D6QDAi10nAAJJfA+AC0x8BIMAAkl8E4AHTPwHtRNDT/wEB0wcBAdTTBwEB9ATSAAEB0SiCEPcYUQ+64w8FREPIUAYBy/9QBAHLBxLMAQHLB/QAAQHKAMntVAQFAgEgDA0BnjgG0/8BKLOOEiCE/7qSMCSWUwW68uPw4gWkBd4B0gABAdMHAQHTLwEB1NEjkSaRKuJSMHj0Dm+h8uPvHscF8uPvIPgjvvLgbyD4I6FUbXAGApo2OCaCEHUJf126jroGghCjLFm/uo6p+CgYxwXy4GUD1NEQNBA2RlD4AH+OjSF49HxvpSCRMuMNAbPmWxA1UDSSNDbiUFQT4w1AFVAzBAoJAdT4BwODDPlBMAODCPlBMPgHUAahgSf4AaBw+DaBEgZw+DaggSvscPg2oIEdmHD4NqAipgYioIEFOSagJ6Bw+DgjpIECmCegcPg4oAOmBliggQbgUAWgUAWgQwNw+DdZoAGgHL7y4GT4KFADBwK4AXACyFjPFgEBy//JiCLIywH0APQAywDJcCH5AHTIywISygfL/8nQyIIQnHP7olgKAssfyz8mAcsHUlDMUAsByy8bzCoBygAKlRkBywcIkTDiECRwQImAGIBQ2zwRCACSjkXIWAHLBVAFzxZQA/oCVHEjI+1E7UXtR59byFADzxfJE3dQA8trzMztZ+1l7WR0f+0RmHYBy2vMAc8X7UHt8QHy/8kB+wDbBgLiNgTT/wEB0y8BAdMHAQHT/wEB1NH4KFAFAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQG8cF8uBlJvkAGrpRk74ZsPLgZgf4I77y4G9EFFBW+AB/jo0hePR8b6UgkTLjDQGz5lsRCgH6AtdM0NMfASCCEPE4Hlu6jmqCEB0M+9O6jl5sRNMHAQHUIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsISDCAPLgbiPCAPLgbVMwu/LgbQH0BCF/cI4XURJ49HxvpTIhmVMCuvLgZwKkAt4BsxLmbCEw0VUjkTDi4w0LABAw0wfUAvsA0QFDv3T/aiaGn/gIDpg4CA6mmDgID6AmkAAIDoiBqvgoD8EdDA4CAWYPEADC+AcDgwz5QTADgwj5QTD4B1AGoYEn+AGgcPg2gRIGcPg2oIEr7HD4NqCBHZhw+DagIqYGIqCBBTkmoCegcPg4I6SBApgnoHD4OKADpgZYoIEG4FAFoFAFoEMDcPg3WaABoADxsMr7UTQ0/8BAdMHAQHU0wcBAfQE0gABAdEjf3COF1ESePR8b6UyIZlTArry4GcCpALeAbMS5mwhUjC68uBsIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsITAiwgDy4G4kwgDy4G1SQ7vy4G0BkjN/kQPiA4AFZsMn+CgBAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQgEQhCAmMFqAYchWwszwXcsN9YFccUdYcFZ8q18EnjQLz1klHzYNH/nQ==");
const MULTISIG_ORDER_CODE = Cell.fromBase64('te6cckEBAQEAIwAIQgJjBagGHIVsLM8F3LDfWBXHFHWHBWfKtfBJ40C89ZJR80AoJo0=');

let currentMultisigAddress: string | undefined = undefined;
let currentMultisigInfo: MultisigInfo | undefined = undefined;
interface MultisigHistory {
    controller: AbortController;
    head?: bigint;
    older?: MultisigHistoryCursor | null;
    archiveEndLt?: bigint;
    deltaIncomplete?: boolean;
    loadingOlder: boolean;
    updates: Promise<void>;
    events: Record<string, MultisigOrderEvents>;
    rows: Record<string, LastOrder>;
    traceQueue: Map<string, bigint>;
}
let currentMultisigHistory: MultisigHistory | undefined;
let updateMultisigTimeoutId: any = -1;
let multisigRevision = 0;
let multisigSigningReadId = 0;
let currentMultisigSigningConfig: (MultisigSigningConfig & {readId: number; lastTransactionLt: bigint | undefined}) | undefined;
const TRACE_BATCH_SIZE = 50;
const TRACE_BATCH_TIMEOUT_MS = 15_000;
const multisigExecutionResults = new Map<string, MultisigExecutionResult>();
let multisigTraceRequest: AbortController | undefined;

const clearMultisig = (): void => {
    multisigRevision++;
    currentMultisigAddress = undefined;
    currentMultisigInfo = undefined;
    currentMultisigSigningConfig = undefined;
    currentMultisigHistory?.controller.abort();
    currentMultisigHistory = undefined;
    multisigTraceRequest?.abort();
    multisigTraceRequest = undefined;
    clearTimeout(updateMultisigTimeoutId);
}

const onMultisigSigningConfigRead = (revision: number) => {
    const readId = ++multisigSigningReadId;
    return (config: MultisigSigningConfig, lastTransactionLt: bigint | undefined): void => {
        if (revision !== multisigRevision) return;
        const current = currentMultisigSigningConfig;
        if (current?.lastTransactionLt !== undefined) {
            if (lastTransactionLt === undefined || lastTransactionLt <= current.lastTransactionLt) return;
        } else if (lastTransactionLt === undefined && current && readId < current.readId) {
            return;
        }
        currentMultisigSigningConfig = {...config, readId, lastTransactionLt};
        const history = currentMultisigHistory;
        if (history && (lastTransactionLt ?? 0n) > (history.head ?? 0n)) history.deltaIncomplete = true;
        renderOrderMismatch();
    };
};

const formatMultisigExecutionStatus = (status: LastOrder['executionStatus']): string => {
    if (status === 'checking') return ' — Checking transaction status…';
    if (status === 'failed') return ' — Execution error';
    return '';
};

const renderCurrentMultisigInfo = (): void => {
    const {
        tonBalance,
        threshold,
        signers,
        proposers,
        allowArbitraryOrderSeqno,
        nextOderSeqno,
        lastOrders
    } = currentMultisigInfo;

    // Render Multisig Info

    $('#multisig_tonBalance').innerText = fromNano(tonBalance) + ' GRAM';

    $('#multisig_threshold').innerText = threshold + '/' + signers.length;

    $('#multisig_orderId').innerText = allowArbitraryOrderSeqno ? 'Arbitrary' : nextOderSeqno.toString();

    // Signers

    let signersHTML = '';
    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i];
        const addressString = makeAddressLink(signer, IS_TESTNET);
        signersHTML += (`<div>#${i + 1} — ${addressString}${equalsMsgAddresses(signer.address, myAddress) ? YOU_BADGE : ''}</div>`);
    }
    $('#multisig_signersList').innerHTML = signersHTML;

    // Proposers

    if (proposers.length > 0) {
        let proposersHTML = '';
        for (let i = 0; i < proposers.length; i++) {
            const proposer = proposers[i];
            const addressString = makeAddressLink(proposer, IS_TESTNET)
            proposersHTML += (`<div>#${i + 1} — ${addressString}${equalsMsgAddresses(proposer.address, myAddress) ? YOU_BADGE : ''}</div>`);
        }
        $('#multisig_proposersList').innerHTML = proposersHTML;
    } else {
        $('#multisig_proposersList').innerHTML = 'No proposers';
    }

    // Render Last Orders
    const formatOrderType = (lastOrder: LastOrder): string => {
        switch (lastOrder.type) {
            case 'new':
                return 'New order';
            case 'execute':
                return 'Execute order';
            case 'pending':
                return 'Pending order';
            case 'executed':
                return 'Executed order'
        }
        throw new Error('unknown order type ' + lastOrder.type);
    }

    const formatOrder = (lastOrder: LastOrder): string => {
        if (lastOrder.executionStatus === 'failed') {
            return `<div class="multisig_lastOrder" order-id="${lastOrder.order.id}" order-address="${addressToString(lastOrder.order.address)}"><span class="orderListItem_title">Failed Order #${lastOrder.order.id}</span><span class="orderListItem_executionStatus">${formatMultisigExecutionStatus('failed')}</span> — <a href="${transactionExplorerUrl(lastOrder.transactionHash)}" target="_blank">Tx Link</a></div>`;
        }
        if (lastOrder.errorMessage) {
            if (lastOrder.errorMessage.startsWith('Contract not active')) return ``;
            return `<div class="multisig_lastOrder" order-id="${lastOrder.order.id}" order-address="${addressToString(lastOrder.order.address)}"><span class="orderListItem_title">Invalid Order #${lastOrder.order.id}</span> — ${lastOrder.errorMessage}</div>`;
        } else {
            const isExpired = lastOrder.orderInfo ? (new Date()).getTime() > lastOrder.orderInfo.expiresAt.getTime() : false;
            const actionText = isExpired ? 'Expired order ' : formatOrderType(lastOrder);
            let text = `<span class="orderListItem_title">${actionText} #${lastOrder.order.id}</span>`;

            if (lastOrder.type === 'pending' && !isExpired) {
                text += ` — ${lastOrder.orderInfo.approvalsNum}/${lastOrder.orderInfo.threshold}`;
            }

            if (lastOrder.type === 'pending' && myAddress) {
                const myIndex = lastOrder.orderInfo.signers.findIndex(signer => signer.address.equals(myAddress));
                if (myIndex > -1) {
                    const mask = 1n << BigInt(myIndex);
                    const isSigned = lastOrder.orderInfo.approvalsMask & mask;

                    text += isSigned ? ' — You approved' : ` — You haven't approved yet`;
                }
            }

            if (lastOrder.type === 'executed') {
                text += `<span class="orderListItem_executionStatus">${formatMultisigExecutionStatus(lastOrder.executionStatus)}</span> — <a href="${transactionExplorerUrl(lastOrder.transactionHash)}" target="_blank">Tx Link</a>`;
            }

            return `<div class="multisig_lastOrder" order-id="${lastOrder.order.id}" order-address="${addressToString(lastOrder.order.address)}">${text}</div>`;
        }
    }

    let lastOrdersHTML = '';
    let wasPending = false;
    let wasExecuted = false;

    for (const lastOrder of lastOrders) {
        if (lastOrder.type == 'executed') {
            if (!wasExecuted) {
                lastOrdersHTML += '<div class="label">Old orders:</div>'
                wasExecuted = true;
            }
        } else if (lastOrder.type === 'pending') {
            if (!wasPending) {
                lastOrdersHTML += '<div class="label">Pending orders:</div>'
                wasPending = true;
            }
        }

        lastOrdersHTML += formatOrder(lastOrder);
    }

    $('#mainScreen_ordersList').innerHTML = lastOrdersHTML;

    $$('.multisig_lastOrder').forEach(div => {
        div.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).tagName === 'A') return; // tx link
            const attributes = (e.currentTarget as HTMLElement).attributes;
            const orderAddressString = attributes.getNamedItem('order-address').value;
            const orderId = BigInt(attributes.getNamedItem('order-id').value);
            setOrderId(orderId, orderAddressString);
        })
    });
}

const applyMultisigExecutionResults = (lastOrders: LastOrder[]): LastOrder[] => {
    const updated: LastOrder[] = [];
    for (const order of lastOrders) {
        if (order.executionStatus !== 'checking') continue;
        const result = multisigExecutionResults.get(order.transactionHash);
        if (!result) continue;
        order.executionStatus = result;
        updated.push(order);
    }
    return updated;
};

const updateMultisigExecutionResults = async (
    history: MultisigHistory, orders: LastOrder[], isCurrent: () => boolean,
): Promise<void> => {
    for (const order of orders) {
        if (order.executionStatus === 'checking') history.traceQueue.set(order.transactionHash, order.lt);
    }
    if (multisigTraceRequest) return;
    const attempted = new Set<string>();
    for (; history.traceQueue.size && isCurrent(); ) {
        const hashes = [...history.traceQueue]
            .filter(([hash]) => !attempted.has(hash) && !multisigExecutionResults.has(hash))
            .sort((a, b) => Number(b[1] - a[1]))
            .map(([hash]) => hash);
        history.traceQueue.clear();
        for (const hash of hashes) attempted.add(hash);

        for (let offset = 0; offset < hashes.length && isCurrent(); offset += TRACE_BATCH_SIZE) {
            const controller = new AbortController();
            multisigTraceRequest = controller;
            const timeout = setTimeout(() => controller.abort(), TRACE_BATCH_TIMEOUT_MS);
            try {
                const batch = hashes.slice(offset, offset + TRACE_BATCH_SIZE);
                const results = await readMultisigExecutionResults(batch, IS_TESTNET, controller.signal);
                if (!isCurrent()) return;

                for (const [hash, result] of results) multisigExecutionResults.set(hash, result);
                for (const order of applyMultisigExecutionResults(currentMultisigInfo.lastOrders)) {
                    const row = $(`#mainScreen_ordersList .multisig_lastOrder[order-id="${order.order.id}"]`);
                    const status = row?.querySelector('.orderListItem_executionStatus');
                    if (status) status.textContent = formatMultisigExecutionStatus(order.executionStatus);
                    const title = row?.querySelector('.orderListItem_title');
                    if (title && order.executionStatus === 'failed') title.textContent = `Failed Order #${order.order.id}`;
                }
            } catch (error) {
                if (isCurrent()) console.error('Failed to load transaction trace batch', error);
            } finally {
                clearTimeout(timeout);
                if (multisigTraceRequest === controller) multisigTraceRequest = undefined;
            }
        }
    }
};

const queueMultisigOrders = (history: MultisigHistory, update: () => void | Promise<void>) => {
    const result = history.updates.then(update);
    history.updates = result.then(() => undefined, () => undefined);
    return result;
};

const preserveOrderOnReadFailure = (order: LastOrder, previous?: LastOrder): LastOrder =>
    order.accountReadFailed && previous ? {...previous, accountReadFailed: true} : order;

const publishMultisigOrders = (
    info: MultisigInfo, history: MultisigHistory, orders: LastOrder[], isCurrent: () => boolean, olderPage = false,
): void => {
    const traceOrders = olderPage ? orders.filter(order => {
        const previous = history.rows[order.order.id.toString()];
        return !previous?.executionStatus || previous.transactionHash !== order.transactionHash;
    }) : orders;
    for (const order of orders) history.rows[order.order.id.toString()] = order;
    const now = Date.now();
    for (const [id, row] of Object.entries(history.rows)) {
        if (row.type === 'pending' && row.orderInfo?.expiresAt.getTime() < now) {
            history.rows[id] = {...row, type: 'executed'};
        }
    }
    info.lastOrders = Object.values(history.rows).sort((a, b) => {
        if (a.type === b.type) return b.utime - a.utime;
        return a.type === 'pending' ? -1 : 1;
    });
    currentMultisigInfo = info;
    applyMultisigExecutionResults(info.lastOrders);
    renderCurrentMultisigInfo();
    void updateMultisigExecutionResults(history, olderPage ? traceOrders : info.lastOrders, isCurrent);
};

const isArchivedAccountUnavailable = (history: MultisigHistory, id: string): boolean => {
    const row = history.rows[id];
    return (row?.accountInactive === true || row?.accountReadFailed === true)
        && history.archiveEndLt !== undefined && history.events[id].latest.lt <= history.archiveEndLt;
};

const sameOrderConfig = (a: MultisigInfo, b: MultisigInfo): boolean =>
    a.threshold === b.threshold && equalsAddressLists(a.signers.map(signer => signer.address), b.signers.map(signer => signer.address));

const refreshArchivedUnavailableOrders = async (
    history: MultisigHistory, batchEndpoint: {available: boolean}, isCurrent: () => boolean,
): Promise<void> => {
    if (history.archiveEndLt === undefined) return;
    const now = Date.now();
    const entries = Object.entries(history.events).filter(([id, {latest}]) => {
        const row = history.rows[id];
        return isArchivedAccountUnavailable(history, id) && !(row.orderInfo?.expiresAt.getTime() < now)
            && (row.accountReadFailed || latest.creationExpiresAt * 1000 >= now);
    });
    if (!entries.length) return;
    const info = currentMultisigInfo;
    const previous = new Map(entries.map(([id]) => [id, history.rows[id]]));
    const events = new Map(entries);
    const orders = await readMultisigOrders([...events.values()], info, MULTISIG_ORDER_CODE, IS_TESTNET, history.controller.signal,
        {previousRows: previous, batchEndpoint});
    await queueMultisigOrders(history, () => {
        if (!isCurrent() || !sameOrderConfig(info, currentMultisigInfo)) return;
        const updated = orders.filter(order => {
            const id = order.order.id.toString();
            const prior = previous.get(id);
            return order !== prior && history.rows[id] === prior && history.events[id] === events.get(id);
        });
        if (updated.length) publishMultisigOrders(currentMultisigInfo, history, updated, isCurrent, true);
    });
};

const loadOlderMultisigOrders = async (
    address: AddressInfo, history: MultisigHistory, isCurrent: () => boolean,
): Promise<void> => {
    if (history.loadingOlder || (!history.older && history.archiveEndLt === undefined)) return;
    history.loadingOlder = true;
    const batchEndpoint = {available: true};
    try {
        await refreshArchivedUnavailableOrders(history, batchEndpoint, isCurrent);
        for (let cursor = history.older; cursor && isCurrent(); cursor = history.older) {
            const page = await readMultisigHistoryPage(address, MULTISIG_ORDER_CODE, IS_TESTNET, history.controller.signal, cursor);
            for (let published = false; !published && isCurrent(); ) {
                const info = currentMultisigInfo;
                const changed = mergeMultisigOrderEvents(history.events, page.events);
                const previous = new Map(Object.keys(changed).map(id => [id, {entry: history.events[id], row: history.rows[id]}]));
                const toRead = Object.entries(changed).filter(([id, {latest}]) => {
                    const prior = previous.get(id);
                    return prior?.entry?.latest !== latest || !prior.row?.orderInfo || prior.row.orderInfo.isExecuted;
                });
                const orders = await readMultisigOrders(toRead.map(([, entry]) => entry), info, MULTISIG_ORDER_CODE, IS_TESTNET, history.controller.signal,
                    {batchEndpoint});
                await queueMultisigOrders(history, () => {
                    if (!isCurrent()) return;
                    const latest = currentMultisigInfo;
                    if ([...previous].some(([id, {entry}]) => history.events[id] !== entry)
                        || (orders.some(order => order.orderInfo) && !sameOrderConfig(info, latest))) return;
                    Object.assign(history.events, changed);
                    history.older = page.next;
                    const currentOrders = orders.filter(order => {
                        const id = order.order.id.toString();
                        return history.rows[id] === previous.get(id)?.row;
                    }).map(order => preserveOrderOnReadFailure(order, previous.get(order.order.id.toString())?.row));
                    if (currentOrders.length) publishMultisigOrders(latest, history, currentOrders, isCurrent, true);
                    if (!history.older) fillSuggestedOrderId();
                    published = true;
                });
            }
        }
    } catch (error) {
        if (isCurrent()) console.error('Failed to load older multisig transactions', error);
    } finally {
        history.loadingOlder = false;
    }
};

const updateMultisig = async (multisigAddress: string, isFirst: boolean, revision: number, queuedOrderId?: bigint): Promise<void> => {
    const isCurrent = () => multisigRevision === revision && currentMultisigAddress === multisigAddress;
    if (!isCurrent()) return;
    const address = Address.parseFriendly(multisigAddress);
    const history = currentMultisigHistory;
    const signal = history.controller.signal;
    void setDisplayAddress($('#mulisig_address'), address.address, IS_TESTNET, isCurrent);
    try {
        const multisigInfo = await checkMultisig(address, MULTISIG_CODE, IS_TESTNET, false,
            {signal, onSigningConfigRead: onMultisigSigningConfigRead(revision)});

        if (!isCurrent()) return;
        const signerCount = multisigInfo.signers.length;
        const formats = getAddressFormats([...multisigInfo.signers, ...multisigInfo.proposers].map(a => a.address), IS_TESTNET);
        let events: LastOrder[] = [];
        let head: bigint | undefined;
        let older: MultisigHistoryCursor | null;
        let refreshFailed = false;
        try {
            const firstPage = await readMultisigHistoryPage(address, MULTISIG_ORDER_CODE, IS_TESTNET, signal, undefined, history.head);
            events = firstPage.events;
            head = firstPage.head;
            older = firstPage.next;
            if (head !== undefined && head > (history.head ?? 0n)) history.deltaIncomplete = true;
            if (history.head !== undefined) {
                for (let cursor = firstPage.next; cursor && isCurrent(); ) {
                    const page = await readMultisigHistoryPage(address, MULTISIG_ORDER_CODE, IS_TESTNET, signal, cursor, history.head);
                    events.push(...page.events);
                    cursor = page.next;
                }
            }
        } catch (error) {
            if (!isCurrent()) return;
            if (!currentMultisigInfo) throw error;
            console.error('Failed to load newer multisig transactions', error);
            refreshFailed = true;
            history.deltaIncomplete = true;
            events = [];
            head = undefined;
        }

        await queueMultisigOrders(history, async () => {
            if (!isCurrent()) return;
            const changed = mergeMultisigOrderEvents(history.events, events);
            const all = {...history.events, ...changed};
            const now = Date.now();
            const toRead = Object.values(all).filter(({latest}) => {
                const id = latest.order.id.toString();
                const previous = history.rows[id];
                if (!changed[id] && isArchivedAccountUnavailable(history, id)) return false;
                const knownExpired = latest.creationExpiresAt * 1000 < now && previous?.type === 'executed'
                    && !previous.errorMessage && previous.orderInfo && !previous.orderInfo.isExecuted
                    && previous.orderInfo.expiresAt.getTime() < now;
                return changed[id] || !knownExpired;
            });
            const orders = await readMultisigOrders(toRead, multisigInfo, MULTISIG_ORDER_CODE, IS_TESTNET, signal);
            const formatted = await formats;
            if (!isCurrent()) return;
            multisigInfo.signers = formatted.slice(0, signerCount);
            multisigInfo.proposers = formatted.slice(signerCount);
            history.events = all;
            if (history.head === undefined && !refreshFailed) {
                history.older = older;
                history.archiveEndLt = older?.endLt;
            }
            history.head = head ?? history.head;
            const wasIncomplete = history.deltaIncomplete;
            history.deltaIncomplete = refreshFailed || (currentMultisigSigningConfig?.lastTransactionLt ?? 0n) > (history.head ?? 0n);
            const updated = orders.map(order => {
                const id = order.order.id.toString();
                const previous = history.rows[id];
                if (changed[id] || !previous) return order;
                if (history.deltaIncomplete && order.accountInactive) return previous;
                return preserveOrderOnReadFailure(order, previous);
            });
            publishMultisigOrders(multisigInfo, history, updated, isCurrent);
            if (wasIncomplete && !history.deltaIncomplete && !history.older) fillSuggestedOrderId();
            toggle($('#multisig_content'), true);
            toggle($('#multisig_error'), false);
        });

    } catch (e) {
        console.error(e);

        // Render error if still relevant
        if (!isCurrent()) return;
        if (isFirst || !e?.message?.startsWith('Timeout')) {
            toggle($('#multisig_content'), false);
            toggle($('#multisig_error'), true);
            $('#multisig_error').innerText = e.message;
        }
    }

    if (!isCurrent()) return;
    const orderIdToOpen = currentMultisigInfo ? queuedOrderId : undefined;
    const retryOrderId = orderIdToOpen === undefined ? queuedOrderId : undefined;
    clearTimeout(updateMultisigTimeoutId);
    updateMultisigTimeoutId = setTimeout(() => updateMultisig(multisigAddress, false, revision, retryOrderId), 5000);

    const opening = orderIdToOpen !== undefined ? setOrderId(orderIdToOpen) : undefined;
    if (!opening && isFirst) showScreen('multisigScreen');
    void loadOlderMultisigOrders(address, history, isCurrent);
    await opening;
}

const setMultisigAddress = async (newMultisigAddress: string, queuedOrderId?: bigint): Promise<void> => {
    showScreen('loadingScreen');
    clearMultisig();
    clearOrder();

    currentMultisigAddress = newMultisigAddress;
    currentMultisigHistory = {
        controller: new AbortController(), loadingOlder: false, updates: Promise.resolve(), events: {}, rows: {}, traceQueue: new Map(),
    };
    localStorage.setItem('multisigAddress', newMultisigAddress);
    pushUrlState(newMultisigAddress, queuedOrderId);

    await updateMultisig(newMultisigAddress, true, multisigRevision, queuedOrderId);
}

$('#multisig_logoutButton').addEventListener('click', () => {
    localStorage.removeItem('multisigAddress');
    clearMultisig();
    showScreen('startScreen');
});

$('#multisig_createNewOrderButton').addEventListener('click', () => {
    showScreen('newOrderScreen');
});

$('#multisig_updateButton').addEventListener('click', () => {
    showNewMultisigScreen('update');
});

// ORDER SCREEN

let currentOrderId: bigint | undefined = undefined;
let currentOrderInfo: MultisigOrderInfo | undefined = undefined;
let updateOrderTimeoutId: any = -1;
let orderRevision = 0;
let checkingApproval = false;
let approvalNotice: 'changed' | 'execution' | undefined;

const clearOrder = (): void => {
    orderRevision++;
    currentOrderId = undefined;
    currentOrderInfo = undefined;
    checkingApproval = false;
    approvalNotice = undefined;
    clearTimeout(updateOrderTimeoutId);
}
const updateApproveButton = (isApproving: boolean, isLastApprove: boolean): void => {
    if (isLastApprove) {
        $('#order_approveButton').innerText = isApproving ? 'Executing..' : 'Execute';
    } else {
        $('#order_approveButton').innerText = isApproving ? 'Approving..' : 'Approve';
    }
    ($('#order_approveButton') as HTMLButtonElement).disabled = isApproving || checkingApproval;
}

const renderOrderMismatch = (): void => {
    if (!currentOrderInfo || !currentMultisigSigningConfig) return;
    const {threshold, signers, isExecuted} = currentOrderInfo;
    const {isMismatchThreshold, isMismatchSigners} = getMultisigOrderMismatch(currentMultisigSigningConfig, {
        threshold,
        signers: signers.map(signer => signer.address),
        isExecuted,
    });
    $('#order_thresholdError').innerText = isMismatchThreshold ? 'Multisig threshold do not match order threshold' : '';
    $('#order_signersError').innerText = isMismatchSigners ? 'Multisig signers do not match order signers' : '';
};

const renderCurrentOrderInfo = (): void => {
    const {
        tonBalance,
        actions,
        isExecuted,
        approvalsNum,
        approvalsMask,
        threshold,
        signers,
        expiresAt,
    } = currentOrderInfo;

    const isExpired = (new Date()).getTime() > expiresAt.getTime();

    $('#order_tonBalance').innerText = fromNano(tonBalance) + ' GRAM';

    let executedTxLink = '';
    if (isExecuted) {
        const lastOrder = currentMultisigInfo.lastOrders.find(lo => lo.order.id === currentOrderInfo.orderId && lo.executionStatus !== undefined);
        if (lastOrder) {
            executedTxLink += ` — <a href="${transactionExplorerUrl(lastOrder.transactionHash)}" target="_blank">Tx Link</a>`;
        }
    }

    $('#order_executed').innerHTML = isExecuted ? 'Yes' + executedTxLink : 'Not yet';


    $('#order_approvals').innerText = approvalsNum + '/' + threshold;
    $('#order_expiresAt').innerText = ((isExpired && !isExecuted) ? '❌ EXPIRED - ' : '') + expiresAt.toString();

    let isApprovedByMe = false;
    let signersHTML = '';
    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i];
        const addressString = makeAddressLink(signer, IS_TESTNET);
        const mask = 1n << BigInt(i);
        const isSigned = approvalsMask & mask;
        if (myAddress && isSigned && signer.address.equals(myAddress)) {
            isApprovedByMe = true;
        }
        signersHTML += (`<div>#${i + 1} — ${addressString} — ${isSigned ? '✅' : '❌'}${equalsMsgAddresses(signer.address, myAddress) ? YOU_BADGE : ''}</div>`);
    }
    $('#order_signersList').innerHTML = signersHTML;

    renderOrderMismatch();

    let actionsHTML = '';
    for (const action of actions) {
        actionsHTML += action;
    }

    if (actions.length === 0) {
        $('#order_actionsTitle').innerText = 'No actions';
    } else if (actions.length === 1) {
        $('#order_actionsTitle').innerText = 'One action:';
    } else {
        $('#order_actionsTitle').innerText = actions.length + ' actions:';
    }
    $('#order_actions').innerHTML = actionsHTML;

    let approvingTime = Number(localStorage.getItem(currentMultisigAddress + '_' + currentOrderId + '_approve'));

    if (Date.now() - approvingTime > 120000 && !isApprovedByMe) {
        approvingTime = 0;
        localStorage.removeItem(currentMultisigAddress + '_' + currentOrderId + '_approve');
    }

    const canApprove = !isExecuted && !isExpired && !isApprovedByMe;
    const isLastApprove = approvalsNum === threshold - 1;
    const notice = $('#order_approvalNotice');
    if (approvalNotice === 'changed') {
        notice.innerText = 'The order has changed. Review the updated details before continuing.';
    } else if (approvalNotice === 'execution' && canApprove && isLastApprove &&
        signers.some(signer => equalsMsgAddresses(signer.address, myAddress))) {
        notice.innerText = 'The order has changed. Your approval will now trigger execution.';
    } else {
        notice.innerText = '';
    }
    toggle(notice, Boolean(notice.innerText));

    updateApproveButton(!!approvingTime, isLastApprove);
    toggle($('#order_approveButton'), canApprove);
    toggle($('#order_approveNote'), canApprove);
}

const updateOrder = async (orderAddress: AddressInfo, orderId: bigint, isFirstTime: boolean, revision = orderRevision, parentRevision = multisigRevision): Promise<void> => {
    const isCurrent = () => orderRevision === revision && multisigRevision === parentRevision && currentOrderId === orderId;
    if (!isCurrent()) return;
    void setDisplayAddress($('#order_address'), orderAddress.address, IS_TESTNET, isCurrent);
    try {
        // Load

        const orderInfo = await checkMultisigOrder(orderAddress, MULTISIG_ORDER_CODE, currentMultisigInfo, IS_TESTNET, false);

        // Render  if still relevant
        if (!isCurrent()) return;
        currentOrderInfo = orderInfo;

        renderCurrentOrderInfo();
        toggle($('#order_content'), true);
        toggle($('#order_error'), false);

    } catch (e) {
        console.error(e);

        // Render error if still relevant
        if (!isCurrent()) return;
        if (isFirstTime || !e?.message?.startsWith('Timeout')) {
            toggle($('#order_content'), false);
            toggle($('#order_error'), true);
            $('#order_error').innerText = e.message;
        }
    }

    clearTimeout(updateOrderTimeoutId);
    updateOrderTimeoutId = setTimeout(() => updateOrder(orderAddress, orderId, false, revision, parentRevision), 5000);

    if (isFirstTime) {
        showScreen('orderScreen');
    }
}

const setOrderId = async (newOrderId: bigint, newOrderAddress?: string): Promise<void> => {
    if (!currentMultisigInfo) throw new Error('setOrderId: no multisig info');

    showScreen('loadingScreen');
    clearOrder();
    currentOrderId = newOrderId;
    pushUrlState(currentMultisigAddress, newOrderId);

    if (newOrderAddress === undefined) {
        const tempOrder = Order.createFromConfig({
            multisig: Address.parseFriendly(currentMultisigAddress).address,
            orderSeqno: newOrderId
        }, MULTISIG_ORDER_CODE);

        newOrderAddress = formatContractAddress(tempOrder.address);
    }

    $('#order_id').innerText = '#' + currentOrderId;

    const orderAddress = Address.parseFriendly(newOrderAddress);
    orderAddress.isBounceable = true;
    orderAddress.isTestOnly = IS_TESTNET;

    await updateOrder(orderAddress, newOrderId, true);
}

$('#order_backButton').addEventListener('click', () => {
    pushUrlState(currentMultisigAddress);
    clearOrder();
    showScreen('multisigScreen');
});

$('#order_approveButton').addEventListener('click', async () => {
    const button = $('#order_approveButton') as HTMLButtonElement;
    if (!currentMultisigAddress || !currentOrderInfo || button.disabled) return;

    const multisigAddress = currentMultisigAddress;
    const reviewed = currentOrderInfo;
    const wallet = tonConnectUI.account;

    if (!wallet) {
        alert('Please connect wallet');
        return;
    }

    const walletAddress = Address.parseRaw(wallet.address);
    const mySignerIndex = reviewed.signers.findIndex(signer => signer.address.equals(walletAddress));

    if (mySignerIndex == -1) {
        alert('You are not signer');
        return;
    }

    const revision = ++orderRevision;
    const parentRevision = multisigRevision;
    const isCurrent = () => orderRevision === revision && multisigRevision === parentRevision;
    clearTimeout(updateOrderTimeoutId);
    checkingApproval = true;
    button.disabled = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let orderInfo: MultisigOrderInfo;
    let isExecution: boolean;
    try {
        const parent = await checkMultisig(Address.parseFriendly(multisigAddress), MULTISIG_CODE, IS_TESTNET, false, {
                signal: controller.signal,
                onSigningConfigRead: onMultisigSigningConfigRead(parentRevision),
            });
        if (!isCurrent() || tonConnectUI.account !== wallet) return;

        const fresh = await checkMultisigOrder(reviewed.address, MULTISIG_ORDER_CODE, parent,
            IS_TESTNET, false, false, controller.signal);
        if (!isCurrent() || tonConnectUI.account !== wallet) return;
        const orderChanged = fresh.orderHash !== reviewed.orderHash || fresh.expirationDate !== reviewed.expirationDate ||
            fresh.threshold !== reviewed.threshold ||
            !equalsAddressLists(fresh.signers.map(s => s.address), reviewed.signers.map(s => s.address));

        orderInfo = orderChanged ? fresh : {...fresh, signers: reviewed.signers, actions: reviewed.actions};
        currentOrderInfo = orderInfo;
        toggle($('#order_error'), false);

        if (orderChanged) {
            approvalNotice = 'changed';
            return;
        }
        if (orderInfo.isExecuted || Date.now() > orderInfo.expirationDate * 1000 ||
            (orderInfo.approvalsMask & (1n << BigInt(mySignerIndex)))) return;

        isExecution = orderInfo.approvalsNum === orderInfo.threshold - 1;
        if (isExecution && reviewed.approvalsNum !== reviewed.threshold - 1) {
            approvalNotice = 'execution';
            return;
        }
        approvalNotice = undefined;
    } catch (error) {
        console.error(error);
        if (isCurrent()) {
            $('#order_error').innerText = error.message;
            toggle($('#order_error'), true);
        }
        return;
    } finally {
        clearTimeout(timeout);
        if (isCurrent()) {
            checkingApproval = false;
            renderCurrentOrderInfo();
            updateOrderTimeoutId = setTimeout(() => updateOrder(reviewed.address, reviewed.orderId, false, revision, parentRevision), 5000);
        }
    }

    if (button.disabled) return;

    const orderAddressString = addressToString(orderInfo.address);
    const amount = DEFAULT_AMOUNT.toString();
    const payload = beginCell().storeUint(0, 32).storeStringTail('approve').endCell().toBoc().toString('base64');

    console.log({orderAddressString, amount})

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
        messages: [
            {
                address: orderAddressString,
                amount: amount,
                payload: payload,  // raw one-cell BoC encoded in Base64
            }
        ]
    }

    updateApproveButton(true, isExecution);
    localStorage.setItem(multisigAddress + '_' + orderInfo.orderId + '_approve', Date.now().toString());

    try {
        const result = await tonConnectUI.sendTransaction(transaction);
    } catch (e) {
        console.error(e);
        localStorage.removeItem(multisigAddress + '_' + orderInfo.orderId + '_approve');

        if (currentMultisigAddress === multisigAddress && currentOrderId === orderInfo.orderId && currentOrderInfo) {
            renderCurrentOrderInfo();
        }
    }
});

// NEW ORDER

type FieldType = 'TON' | 'Jetton' | 'Address' | 'URL' | 'Status' | 'String' | 'BOC';

interface ValidatedValue {
    value?: any;
    error?: string;
}

const validateValue = (fieldName: string, value: string, fieldType: FieldType): ValidatedValue => {
    const makeError = (s: string): ValidatedValue => {
        return {error: fieldName + ': ' + s};
    }

    const makeValue = (x: any): ValidatedValue => {
        return {value: x};
    }

    const parseBigInt = (inputAmount: string): ValidatedValue => {
        try {
            const units = BigInt(inputAmount);

            if (units <= 0) {
                return makeError('Enter positive amount');
            }

            return makeValue(units);
        } catch (e: any) {
            return makeError('Invalid amount');
        }
    }

    const parseAmount = (inputAmount: string, decimals: number): ValidatedValue => {
        try {
            const units = toUnits(inputAmount, decimals);

            if (units <= 0) {
                return makeError('Enter positive amount');
            }

            return makeValue(units);
        } catch (e: any) {
            return makeError('Invalid amount');
        }
    }

    if (fieldType !== 'String' && (value === null || value === undefined || value === '')) {
        return makeError(`Empty`);
    }

    switch (fieldType) {
        case 'String':
            return {
                value,
                error: undefined
            };

        case 'TON':
            return parseAmount(value, 9);

        case 'Jetton':
            return parseBigInt(value);

        case 'Address':
            if (!Address.isFriendly(value)) {
                return makeError('Invalid Address');
            }
            const address = Address.parseFriendly(value);
            if (address.isTestOnly && !IS_TESTNET) {
                return makeError("Please enter mainnet address");
            }
            return makeValue(address);

        case 'URL':
            if (!value.startsWith('https://')) {
                return makeError('Invalid URL');
            }
            return makeValue(value);

        case 'Status':
            if (LOCK_TYPES.indexOf(value) > -1) {
                return makeValue(value);
            } else {
                return makeError('Invalid status. Please use: ' + LOCK_TYPES.join(', '));
            }

        case 'BOC':
            try {
                return makeValue(Cell.fromBase64(value));
            } catch (error) {
                return makeError('Invalid BOC');
            }
    }
}

interface OrderField {
    name: string;
    type: FieldType;
}

interface MakeMessageResult {
    toAddress: AddressInfo;
    tonAmount: bigint;
    body: Cell;
}

interface OrderType {
    name: string;
    fields: { [key: string]: OrderField };
    check?: (values: { [key: string]: any }) => Promise<ValidatedValue>;
    makeMessage: (values: { [key: string]: any }) => Promise<MakeMessageResult>;
}

const AMOUNT_TO_SEND = toNano('0.2'); // 0.2 TON
const DEFAULT_AMOUNT = toNano('0.1'); // 0.1 TON
const DEFAULT_INTERNAL_AMOUNT = toNano('0.05'); // 0.05 TON

const checkJettonMinterAdmin = async (values: { [key: string]: any }): Promise<ValidatedValue> => {
    try {
        const multisigInfo = currentMultisigInfo;

        const jettonMinterInfo = await checkJettonMinter(values.jettonMinterAddress, IS_TESTNET, false);

        if (!multisigInfo.address.address.equals(jettonMinterInfo.adminAddress)) {
            return {error: "Multisig is not admin of this jetton"};
        }

        return {value: jettonMinterInfo};
    } catch (e: any) {
        console.error(e);
        return {error: 'Jetton-minter check error'};
    }
}

const checkJettonMinterNextAdmin = async (values: { [key: string]: any }): Promise<ValidatedValue> => {
    try {
        const multisigInfo = currentMultisigInfo;

        const jettonMinterInfo = await checkJettonMinter(values.jettonMinterAddress, IS_TESTNET, true);

        if (!jettonMinterInfo.nextAdminAddress || !multisigInfo.address.address.equals(jettonMinterInfo.nextAdminAddress)) {
            return {error: "Multisig is not next-admin of this jetton"};
        }

        return {value: jettonMinterInfo};
    } catch (e: any) {
        console.error(e);
        return {error: 'Jetton-minter check error'};
    }
}

const checkExistingOrderId = async (orderId: bigint): Promise<ValidatedValue> => {
    try {
        const orderAddress = await currentMultisigInfo.multisigContract.getOrderAddress(currentMultisigInfo.provider, orderId);
        const result = await sendToIndex('account', {address: orderAddress.toRawString()}, IS_TESTNET);
        if (result.status === 'uninit') {
            return {value: true};
        } else {
            return {error: `Order ${orderId} already exists`};
        }
    } catch (e) {
        console.error(e);
        return {error: 'Possibly connectivity error'};
    }
}

const orderTypes: OrderType[] = [
    {
        name: 'Transfer GRAM',
        fields: {
            amount: {
                name: 'GRAM Amount',
                type: 'TON'
            },
            toAddress: {
                name: 'Destination Address',
                type: 'Address'
            },
            comment: {
                name: 'Optional comment',
                type: 'String'
            }
        },
        makeMessage: async (values) => {
            const body = !values.comment ? beginCell().endCell() : beginCell().storeUint(0, 32).storeStringTail(values.comment).endCell();

            return {
                toAddress: values.toAddress,
                tonAmount: values.amount,
                body: body
            };
        }
    },

    {
        name: 'Transfer Jetton',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            amount: {
                name: 'Jetton Amount (in units)',
                type: 'Jetton'
            },
            toAddress: {
                name: 'To Address',
                type: 'Address'
            },
            comment: {
                name: 'Optional comment',
                type: 'String'
            }
        },
        makeMessage: async (values): Promise<MakeMessageResult> => {
            const jettonMinterAddress: Address = values.jettonMinterAddress.address;
            const multisigAddress = currentMultisigInfo.address.address;
            const jettonMinter = JettonMinter.createFromAddress(jettonMinterAddress);
            const provider = new MyNetworkProvider(jettonMinterAddress, IS_TESTNET);

            const jettonWalletAddress = await jettonMinter.getWalletAddress(provider, multisigAddress);

            const forwardPayload = !values.comment ? null : beginCell().storeUint(0, 32).storeStringTail(values.comment).endCell();

            return {
                toAddress: {address: jettonWalletAddress, isBounceable: true, isTestOnly: IS_TESTNET},
                tonAmount: DEFAULT_AMOUNT,
                body: JettonWallet.transferMessage(values.amount, values.toAddress.address, multisigAddress, null, 0n, forwardPayload)
            }
        }
    },

    {
        name: 'Mint Jetton',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            amount: {
                name: 'Jetton Amount (in units)',
                type: 'Jetton'
            },
            toAddress: {
                name: 'To Address',
                type: 'Address'
            }
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.mintMessage(values.toAddress.address, values.amount, values.jettonMinterAddress.address, currentMultisigInfo.address.address, null, 0n, DEFAULT_INTERNAL_AMOUNT)
            };
        }
    },

    {
        name: 'Change Jetton Admin',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            newAdminAddress: {
                name: 'New Admin Address',
                type: 'Address'
            },
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.changeAdminMessage(values.newAdminAddress.address)
            };
        }
    },

    {
        name: 'Claim Jetton Admin',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
        },
        check: checkJettonMinterNextAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.claimAdminMessage()
            }
        }
    },

    {
        name: 'Top-up Jetton Minter',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            amount: {
                name: 'GRAM Amount',
                type: 'TON'
            },
        },
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: values.amount,
                body: JettonMinter.topUpMessage()
            }
        }
    },

    {
        name: 'Change Jetton Metadata URL',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            newMetadataUrl: {
                name: 'New Metadata URL',
                type: 'URL'
            }
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.changeContentMessage({
                    uri: values.newMetadataUrl
                })
            };
        }
    },

    {
        name: 'Force Burn Jetton',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            amount: {
                name: 'Jetton Amount (in units)',
                type: 'Jetton'
            },
            fromAddress: {
                name: 'User Address',
                type: 'Address'
            }
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.forceBurnMessage(values.amount, values.fromAddress.address, currentMultisigInfo.address.address, DEFAULT_INTERNAL_AMOUNT)
            };
        }
    },

    {
        name: 'Force Transfer Jetton',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            amount: {
                name: 'Jetton Amount (in units)',
                type: 'Jetton'
            },
            fromAddress: {
                name: 'From Address',
                type: 'Address'
            },
            toAddress: {
                name: 'To Address',
                type: 'Address'
            }
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.forceTransferMessage(values.amount, values.toAddress.address, values.fromAddress.address, values.jettonMinterAddress.address, null, 0n, null, DEFAULT_INTERNAL_AMOUNT)
            }
        }
    },

    {
        name: 'Set status for Jetton Wallet',
        fields: {
            jettonMinterAddress: {
                name: 'Jetton Minter Address',
                type: 'Address'
            },
            userAddress: {
                name: 'User Address',
                type: 'Address'
            },
            newStatus: {
                name: `New Status (${LOCK_TYPES.join(', ')})`,
                type: 'Status'
            }
        },
        check: checkJettonMinterAdmin,
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.lockWalletMessage(values.userAddress.address, lockTypeToInt(values.newStatus), DEFAULT_INTERNAL_AMOUNT)
            }
        }
    },
    {
        name: 'Single nominator pool: Withdraw',
        fields: {
            amount: {
                name: 'GRAM Amount for gas',
                type: 'TON'
            },
            toAddress: {
                name: 'Pool Address',
                type: 'Address'
            },
            withdrawAmount: {
                name: 'Withdraw GRAM amount',
                type: 'TON'
            },
        },
        makeMessage: async (values) => {
            const body = beginCell()
                .storeUint(SINGLE_NOMINATOR_POOL_OP_WITHDRAW, 32)
                .storeUint(0, 64) // query id
                .storeCoins(values.withdrawAmount)
                .endCell();

            return {
                toAddress: values.toAddress,
                tonAmount: values.amount,
                body: body
            };
        }
    },

    {
        name: 'Single nominator pool: Change Validator Address',
        fields: {
            amount: {
                name: 'GRAM Amount for gas',
                type: 'TON'
            },
            toAddress: {
                name: 'Pool Address',
                type: 'Address'
            },
            validatorAddress: {
                name: 'New Validator Address',
                type: 'Address'
            }
        },
        makeMessage: async (values) => {
            const validatorAddress: Address = values.validatorAddress.address;

            const body = beginCell()
                .storeUint(SINGLE_NOMINATOR_POOL_OP_CHANGE_VALIDATOR_ADDRESS, 32)
                .storeUint(0, 64) // query id
                .storeAddress(validatorAddress)
                .endCell();

            return {
                toAddress: values.toAddress,
                tonAmount: values.amount,
                body: body
            };
        }
    },

    {
        name: 'Vesting: Send From Vesting (0.1 GRAM for gas)',
        fields: {
            vestingAddress: {
                name: 'Vesting Address',
                type: 'Address'
            },
            destinationAddress: {
                name: 'Destination Address',
                type: 'Address'
            },
            amount: {
                name: 'GRAM Amount',
                type: 'TON'
            },
            comment: { // todo: Add support for base64/hex/boc payload
                name: 'Optional comment',
                type: 'String'
            }
        },
        makeMessage: async (values) => {
            const destinationAddress: Address = values.destinationAddress.address;

            const body = beginCell()
                .storeUint(VESTING_INTERNAL_TRANSFER, 32)
                .storeUint(0, 64) // query_id
                .storeUint(3, 8) // send_mode
                .storeRef(
                    beginCell()
                        .store(
                            storeMessageRelaxed({
                                info: {
                                    type: 'internal',
                                    ihrDisabled: true,
                                    bounce: true, // we can send only bounceable messages from non-expired vesting
                                    bounced: false,
                                    dest: destinationAddress,
                                    value: {
                                        coins: values.amount
                                    },
                                    ihrFee: 0n,
                                    forwardFee: 0n,
                                    createdLt: 0n,
                                    createdAt: 0
                                },
                                body: values.comment ? beginCell().storeUint(0, 32).storeStringTail(values.comment).endCell() : beginCell().endCell()
                            })
                        ).endCell()
                )
                .endCell();

            return {
                toAddress: values.vestingAddress,
                tonAmount: toNano('0.1'), // 0.1 TON for gas
                body: body
            };
        }
    },
    {
        name: 'Arbitrary order',
        fields: {
            order: {
                name: 'Order BOC (body cell in Base64)',
                type: 'BOC'
            },
            amount: {
                name: 'GRAM Amount',
                type: 'TON'
            },
            toAddress: {
                name: 'Destination Address',
                type: 'Address'
            }
        },
        makeMessage: async (values): Promise<MakeMessageResult> => {
            return {
                toAddress: values.toAddress,
                tonAmount: values.amount,
                body: values.order
            };
        }
    },
]

const getOrderTypesHTML = (): string => {
    let html = '';
    for (let i = 0; i < orderTypes.length; i++) {
        const orderType = orderTypes[i];
        html += `<option value="${i}">${orderType.name}</option>`;
    }
    return html;
}

const newOrderTypeSelect: HTMLSelectElement = $('#newOrder_typeInput') as HTMLSelectElement;
newOrderTypeSelect.innerHTML = getOrderTypesHTML();

const renderNewOrderFields = (orderTypeIndex: number): void => {
    const orderType = orderTypes[orderTypeIndex];

    let html = '';

    for (let fieldId in orderType.fields) {
        if (orderType.fields.hasOwnProperty(fieldId)) {
            const field = orderType.fields[fieldId];
            html += `<div class="label">${field.name}:</div>`

            if (field.type === 'Status') {
                html += `<select id="newOrder_${orderTypeIndex}_${fieldId}">`
                for (let i = 0; i < LOCK_TYPES.length; i++) {
                    const lockType: LockType = LOCK_TYPES[i] as LockType;
                    html += `<option value="${lockType}">${lockTypeToDescription(lockType)}</option>`;
                }
                html += `</select>`
            } else {
                html += `<input id="newOrder_${orderTypeIndex}_${fieldId}">`
            }
        }
    }

    $('#newOrder_fieldsContainer').innerHTML = html;
}

newOrderTypeSelect.addEventListener('change', (e) => {
    renderNewOrderFields(newOrderTypeSelect.selectedIndex)
});

renderNewOrderFields(0);

let newOrderMode: 'fill' | 'confirm' = 'fill';
let transactionToSent: {
    orderId: bigint,
    multisigAddress: Address,
    message: { address: string, amount: string, stateInit?: string, payload?: string }
} | undefined = undefined;

const getNewOrderId = (): string => {
    if (!currentMultisigInfo || currentMultisigHistory?.older || currentMultisigHistory?.deltaIncomplete) return '';

    if (currentMultisigInfo.lastOrders.length === 0) {
        return '1';
    }

    let highestOrderId = -1n;
    currentMultisigInfo.lastOrders.forEach(lastOrder => {
        if (lastOrder.order.id > highestOrderId) {
            highestOrderId = lastOrder.order.id;
        }
    });
    const nextId = highestOrderId + 1n;
    return highestOrderId === -1n || nextId >= (1n << 256n) ? '' : nextId.toString();
}

const fillSuggestedOrderId = (): void => {
    const input = currentScreen === 'newOrderScreen' && newOrderMode === 'fill'
        ? $('#newOrder_orderId') as HTMLInputElement
        : currentScreen === 'newMultisigScreen' && newMultisigMode === 'update' && newMultisigStatus === 'fill'
            ? newMultisigOrderIdInput : undefined;
    if (input && !input.value) input.value = getNewOrderId();
};

const newOrderClear = () => {
    setNewOrderMode('fill');
    transactionToSent = undefined;

    newOrderTypeSelect.selectedIndex = 0;
    renderNewOrderFields(0);

    ($('#newOrder_orderId') as HTMLInputElement).value = getNewOrderId();
}

const updateNewOrderButtons = (isDisabled: boolean) => {
    ($('#newOrder_createButton') as HTMLButtonElement).disabled = isDisabled;
    ($('#newOrder_backButton') as HTMLButtonElement).disabled = isDisabled;
}

const setNewOrderDisabled = (isDisabled: boolean) => {
    const orderTypeIndex = newOrderTypeSelect.selectedIndex;
    const orderType = orderTypes[orderTypeIndex];

    newOrderTypeSelect.disabled = isDisabled;

    ($('#newOrder_orderId') as HTMLInputElement).disabled = isDisabled

    for (let fieldId in orderType.fields) {
        if (orderType.fields.hasOwnProperty(fieldId)) {
            const input: HTMLInputElement = $(`#newOrder_${orderTypeIndex}_${fieldId}`) as HTMLInputElement;
            input.disabled = isDisabled;
        }
    }

    updateNewOrderButtons(isDisabled);
}
const setNewOrderMode = (mode: 'fill' | 'confirm') => {
    if (mode == 'fill') {
        setNewOrderDisabled(false);
        $('#newOrder_createButton').innerHTML = 'Create';
        $('#newOrder_backButton').innerHTML = 'Back';
    } else {
        setNewOrderDisabled(true);
        $('#newOrder_createButton').innerHTML = 'Send Transaction';
        $('#newOrder_backButton').innerHTML = 'Cancel';
    }
    newOrderMode = mode;
}

$('#newOrder_createButton').addEventListener('click', async () => {
    if (!myAddress) {
        alert('Please connect wallet');
        return;
    }

    // Confirm & Send Transaction

    if (newOrderMode === 'confirm') {
        if (!transactionToSent) throw new Error('');

        try {
            const result = await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
                messages: [
                    transactionToSent.message
                ]
            });
            if (currentMultisigAddress === formatContractAddress(transactionToSent.multisigAddress)) {
                setOrderId(transactionToSent.orderId);
            }
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const orderId = getBigIntFromInput($('#newOrder_orderId') as HTMLInputElement);
    if (orderId === null || orderId === undefined || orderId < 0) {
        alert('Invalid Order ID');
        return;
    }

    const orderTypeIndex = newOrderTypeSelect.selectedIndex;
    const orderType = orderTypes[orderTypeIndex];

    const values: { [key: string]: any } = {};

    for (let fieldId in orderType.fields) {
        if (orderType.fields.hasOwnProperty(fieldId)) {
            const field = orderType.fields[fieldId];
            const input: HTMLInputElement = $(`#newOrder_${orderTypeIndex}_${fieldId}`) as HTMLInputElement;
            const value = input.value;
            const validated = validateValue(field.name, value, field.type);
            if (validated.error) {
                alert(validated.error)
                return;
            }
            values[fieldId] = validated.value;
        }
    }

    setNewOrderDisabled(true);

    const orderIdChecked = await checkExistingOrderId(orderId);
    if (orderIdChecked.error) {
        alert(orderIdChecked.error)
        setNewOrderMode('fill')
        return;
    }

    if (orderType.check) {
        const checked = await orderType.check(values);
        if (checked.error) {
            alert(checked.error)
            setNewOrderMode('fill')
            return;
        }
    }

    const messageParams = await orderType.makeMessage(values);

    const myProposerIndex = currentMultisigInfo.proposers.findIndex(address => address.address.equals(myAddress));
    const mySignerIndex = currentMultisigInfo.signers.findIndex(address => address.address.equals(myAddress));

    if (myProposerIndex === -1 && mySignerIndex === -1) {
        alert('Error: you are not proposer and not signer');
        setNewOrderMode('fill')
        return;
    }

    const isSigner = mySignerIndex > -1;

    const toAddress = messageParams.toAddress;
    const tonAmount = messageParams.tonAmount;
    const payloadCell = messageParams.body;
    const expireAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 1 month

    const actions = Multisig.packOrder([
        {
            type: 'transfer',
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            message: {
                info: {
                    type: 'internal',
                    ihrDisabled: false,
                    bounce: true,
                    bounced: false,
                    dest: toAddress.address,
                    value: {
                        coins: tonAmount
                    },
                    ihrFee: 0n,
                    forwardFee: 0n,
                    createdLt: 0n,
                    createdAt: 0
                },
                body: payloadCell
            }
        }
    ]);

    const message = Multisig.newOrderMessage(actions, expireAt, isSigner, isSigner ? mySignerIndex : myProposerIndex, orderId, 0n)
    const messageBase64 = message.toBoc().toString('base64');

    console.log({
        toAddress,
        tonAmount,
        payloadCell,
        message,
        orderId
    })

    const multisigAddressString = currentMultisigAddress;
    const amount = AMOUNT_TO_SEND.toString();

    transactionToSent = {
        multisigAddress: Address.parseFriendly(multisigAddressString).address,
        orderId: orderId,
        message: {
            address: multisigAddressString,
            amount: amount,
            payload: messageBase64,  // raw one-cell BoC encoded in Base64
        }
    };

    setNewOrderMode('confirm')
    updateNewOrderButtons(false);
});

$('#newOrder_backButton').addEventListener('click', () => {
    if (newOrderMode == 'fill') {
        showScreen('multisigScreen');
    } else {
        setNewOrderMode('fill');
    }
});

// NEW MULTISIG / EDIT MULTISIG

const getIntFromInput = (input: HTMLInputElement): null | number => {
    if (input.value === '') {
        return null;
    }
    try {
        const i = parseInt(input.value);
        if (isNaN(i)) {
            return null;
        }
        return i;
    } catch (e) {
        return null;
    }
}

const getBigIntFromInput = (input: HTMLInputElement): null | bigint => {
    if (input.value === '') {
        return null;
    }
    try {
        const i = BigInt(input.value);
        return i;
    } catch (e) {
        return null;
    }
}

const newMultisigTreshoildInput = $('#newMultisig_threshold') as HTMLInputElement;
const newMultisigOrderIdInput = $('#newMultisig_orderId') as HTMLInputElement;

let newMultisigMode: 'create' | 'update' = 'create';
let newMultisigStatus: 'fill' | 'confirm' = 'fill';

interface NewMultisigInfo {
    signersCount: number;
    proposersCount: number;
}

let newMultisigInfo: NewMultisigInfo | undefined = undefined;
let newMultisigTransactionToSend: {
    orderId?: bigint,
    multisigAddress: Address,
    message: { address: string, amount: string, stateInit?: string, payload?: string }
} | undefined = undefined;

const showNewMultisigScreen = (mode: 'create' | 'update'): void => {
    newMultisigMode = mode;
    showScreen('newMultisigScreen'); // show screen invokes newMultisigClear
}

const newMultisigClear = (): void => {
    newMultisigStatus = 'fill';
    newMultisigInfo = {
        signersCount: 0,
        proposersCount: 0
    };
    newMultisigTransactionToSend = undefined;

    $('#newMultisig_signersContainer').innerHTML = '';
    $('#newMultisig_proposersContainer').innerHTML = '';
    newMultisigOrderIdInput.value = getNewOrderId();
    newMultisigTreshoildInput.value = '';

    toggle($('#newMultisig_orderIdLabel'), newMultisigMode === 'update');
    toggle($('#newMultisig_orderId'), newMultisigMode === 'update');

    if (newMultisigMode === 'create') {
        addSignerInput(0);
        newMultisigInfo.signersCount = 1;
    } else {
        newMultisigInfo.signersCount = currentMultisigInfo.signers.length;
        for (let i = 0; i < newMultisigInfo.signersCount; i++) {
            addSignerInput(i, addressToString(currentMultisigInfo.signers[i]));
        }
        newMultisigInfo.proposersCount = currentMultisigInfo.proposers.length;
        for (let i = 0; i < newMultisigInfo.proposersCount; i++) {
            addProposerInput(i, addressToString(currentMultisigInfo.proposers[i]));
        }
        newMultisigTreshoildInput.value = currentMultisigInfo.threshold.toString();
    }

    updateNewMultisigDeleteButtons();
    updateNewMultisigStatus();
}

const updateNewMultisigDeleteButtons = () => {
    const deleteButton = $(`#newMultisig_deleteSigner0`);
    toggle(deleteButton, newMultisigInfo.signersCount > 1);
}

const addSignerInput = (i: number, value?: string): void => {
    const element = document.createElement('div');
    element.classList.add('address-input');
    element.innerHTML = `<div class="address-input-num">#${i + 1}.</div> <input id="newMultisig_signer${i}"><button id="newMultisig_deleteSigner${i}">—</button>`;
    $('#newMultisig_signersContainer').appendChild(element);
    ($(`#newMultisig_signer${i}`) as HTMLInputElement).value = value === undefined ? '' : value;
    element.querySelector(`#newMultisig_deleteSigner${i}`).addEventListener('click', onSignerDeleteClick);
}
const addProposerInput = (i: number, value?: string): void => {
    const element = document.createElement('div');
    element.classList.add('address-input');
    element.innerHTML = `<div class="address-input-num">#${i + 1}.</div> <input id="newMultisig_proposer${i}"><button id="newMultisig_deleteProposer${i}">—</button>`;
    $('#newMultisig_proposersContainer').appendChild(element);
    ($(`#newMultisig_proposer${i}`) as HTMLInputElement).value = value === undefined ? '' : value;
    element.querySelector(`#newMultisig_deleteProposer${i}`).addEventListener('click', onProposerDeleteClick);
}

const onSignerDeleteClick = (event: MouseEvent): void => {
    const button = event.target as HTMLButtonElement;
    const index = Number(button.id.slice('newMultisig_deleteSigner'.length));
    if (isNaN(index)) throw new Error();

    const signers: string[] = [];
    for (let i = 0; i < newMultisigInfo.signersCount; i++) {
        const input = $(`#newMultisig_signer${i}`) as HTMLInputElement;
        signers.push(input.value);
    }
    signers.splice(index, 1);
    newMultisigInfo.signersCount--;
    $('#newMultisig_signersContainer').innerHTML = '';
    for (let i = 0; i < newMultisigInfo.signersCount; i++) {
        addSignerInput(i, signers[i]);
    }

    updateNewMultisigDeleteButtons();
}
const onProposerDeleteClick = (event: MouseEvent): void => {
    const button = event.target as HTMLButtonElement;
    const index = Number(button.id.slice('newMultisig_deleteProposer'.length));
    if (isNaN(index)) throw new Error();

    const proposers: string[] = [];
    for (let i = 0; i < newMultisigInfo.proposersCount; i++) {
        const input = $(`#newMultisig_proposer${i}`) as HTMLInputElement;
        proposers.push(input.value);
    }
    proposers.splice(index, 1);
    newMultisigInfo.proposersCount--;
    $('#newMultisig_proposersContainer').innerHTML = '';
    for (let i = 0; i < newMultisigInfo.proposersCount; i++) {
        addProposerInput(i, proposers[i]);
    }
}

$('#newMultisig_addSignerButton').addEventListener('click', async () => {
    addSignerInput(newMultisigInfo.signersCount);
    newMultisigInfo.signersCount++;
    updateNewMultisigDeleteButtons();
});

$('#newMultisig_addProposerButton').addEventListener('click', async () => {
    addProposerInput(newMultisigInfo.proposersCount);
    newMultisigInfo.proposersCount++;
});

const updateNewMultisigStatus = (): void => {
    const isDisabled = newMultisigStatus === 'confirm';

    newMultisigOrderIdInput.disabled = isDisabled;
    newMultisigTreshoildInput.disabled = isDisabled;

    toggle($('#newMultisig_addSignerButton'), !isDisabled);
    toggle($('#newMultisig_addProposerButton'), !isDisabled);

    for (let i = 0; i < newMultisigInfo.signersCount; i++) {
        const input = $(`#newMultisig_signer${i}`) as HTMLInputElement;
        input.disabled = isDisabled;
        const deleteButton = $(`#newMultisig_deleteSigner${i}`);
        toggle(deleteButton, !isDisabled && (newMultisigInfo.signersCount > 1));
    }
    for (let i = 0; i < newMultisigInfo.proposersCount; i++) {
        const input = $(`#newMultisig_proposer${i}`) as HTMLInputElement;
        input.disabled = isDisabled;
        const deleteButton = $(`#newMultisig_deleteProposer${i}`);
        toggle(deleteButton, !isDisabled);
    }
    updateNewMultisigCreateButton(false);
}

$('#newMultisig_backButton').addEventListener('click', () => {
    if (newMultisigStatus === 'fill') {
        if (newMultisigMode === 'create') {
            showScreen('startScreen');
        } else {
            showScreen('multisigScreen');
        }
    } else {
        newMultisigStatus = 'fill';
        updateNewMultisigStatus();
    }
});

const updateNewMultisigCreateButtonTitle = () => {
    $('#newMultisig_createButton').innerText = newMultisigStatus === 'confirm' ? 'Confirm' : (newMultisigMode === 'update' ? 'Update' : 'Create');
}

const updateNewMultisigCreateButton = (isLoading: boolean): void => {
    ($('#newMultisig_createButton') as HTMLButtonElement).disabled = isLoading;
    if (isLoading) {
        ($('#newMultisig_createButton') as HTMLButtonElement).innerText = 'Checking..';
    } else {
        updateNewMultisigCreateButtonTitle();
    }
    $('#newMultisigScreen').style.pointerEvents = isLoading ? 'none' : 'auto';

}

$('#newMultisig_createButton').addEventListener('click', async () => {
    if (!myAddress) {
        alert('Please connect wallet');
        return;
    }

    // Confirm & Send Transaction

    if (newMultisigStatus === 'confirm') {
        try {
            const orderId = newMultisigTransactionToSend.orderId;
            const multisigAddress = newMultisigTransactionToSend.multisigAddress;

            const result = await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
                messages: [
                    newMultisigTransactionToSend.message
                ]
            });

            if (newMultisigMode === 'update') {
                if (currentMultisigAddress === formatContractAddress(multisigAddress)) {
                    setOrderId(orderId);
                }
            } else {
                setMultisigAddress(formatContractAddress(multisigAddress));
            }
        } catch (e) {
            console.error(e);
        }

        return;
    }

    // Get parameters

    const threshold = getIntFromInput(newMultisigTreshoildInput);
    if (threshold === null || threshold === undefined || threshold <= 0 || threshold > newMultisigInfo.signersCount) {
        alert('Threshold count: not valid number');
        return;
    }

    let orderId: bigint | undefined = undefined;
    if (newMultisigMode === 'update') {
        orderId = getBigIntFromInput(newMultisigOrderIdInput);
        if (orderId === null || orderId === undefined || orderId < 0) {
            alert('Invalid order Id');
            return;
        }

        updateNewMultisigCreateButton(true);
        const orderIdChecked = await checkExistingOrderId(orderId);
        updateNewMultisigCreateButton(false);
        if (orderIdChecked.error) {
            alert(orderIdChecked.error)
            return;
        }
    }

    const addressMap: { [key: string]: boolean } = {};

    const signersAddresses: Address[] = [];
    for (let i = 0; i < newMultisigInfo.signersCount; i++) {
        const input = $(`#newMultisig_signer${i}`) as HTMLInputElement;
        if (input.value === '') {
            alert(`Signer ${i}: empty field`);
            return;
        }

        const addressString = input.value;
        const error = validateUserFriendlyAddress(addressString, IS_TESTNET);
        if (error) {
            alert(`Signer ${i}: ${error}`);
            return;
        }
        const address = Address.parseFriendly(addressString).address;
        if (addressMap[address.toRawString()]) {
            alert('Duplicate ' + addressString);
            return;
        }
        addressMap[address.toRawString()] = true;
        signersAddresses.push(address);
    }

    const proposersAddresses: Address[] = [];
    for (let i = 0; i < newMultisigInfo.proposersCount; i++) {
        const input = $(`#newMultisig_proposer${i}`) as HTMLInputElement;
        if (input.value === '') {
            alert(`Proposer ${i}: empty field`);
            return;
        }

        const addressString = input.value;
        const error = validateUserFriendlyAddress(addressString, IS_TESTNET);
        if (error) {
            alert(`Proposer ${i}: ${error}`);
            return;
        }
        const address = Address.parseFriendly(addressString).address;
        if (addressMap[address.toRawString()]) {
            alert('Duplicate ' + addressString);
            return;
        }
        addressMap[address.toRawString()] = true;
        proposersAddresses.push(address);
    }

    // Make Transaction

    if (newMultisigMode === 'create') {

        const newMultisig = Multisig.createFromConfig({
            threshold: threshold,
            signers: signersAddresses,
            proposers: proposersAddresses,
            allowArbitrarySeqno: true
        }, MULTISIG_CODE);

        const newMultisigAddress = newMultisig.address;
        const amount = toNano('1').toString() // 1 TON

        const stateInitCell = beginCell();
        storeStateInit({
            code: newMultisig.init.code as any,
            data: newMultisig.init.data as any
        })(stateInitCell as any);

        newMultisigTransactionToSend = {
            multisigAddress: newMultisigAddress,
            message:
                {
                    address: newMultisigAddress.toString({urlSafe: true, bounceable: true, testOnly: IS_TESTNET}),
                    amount: amount,
                    stateInit: stateInitCell.endCell().toBoc().toString('base64'),  // raw one-cell BoC encoded in Base64
                }

        }

        newMultisigStatus = 'confirm';
        updateNewMultisigStatus();

    } else {
        const myProposerIndex = currentMultisigInfo.proposers.findIndex(address => address.address.equals(myAddress));
        const mySignerIndex = currentMultisigInfo.signers.findIndex(address => address.address.equals(myAddress));

        if (myProposerIndex === -1 && mySignerIndex === -1) {
            alert('Error: you are not proposer and not signer');
            return;
        }

        const isSigner = mySignerIndex > -1;

        if (!equalsAddressLists(signersAddresses, currentMultisigInfo.signers.map(a => a.address)) || currentMultisigInfo.threshold < threshold) {
            const hasPendingOrder = currentMultisigInfo.lastOrders.some(order => order.type === 'pending');
            if (hasPendingOrder && !confirm('You have pending orders and change the multisig configuration. These pending orders can no longer be executed. Do you want to continue?')) return;
            const now = Date.now();
            const ordersUnverified = currentMultisigHistory.older || currentMultisigHistory.deltaIncomplete
                || currentMultisigInfo.lastOrders.some(order => {
                    const latest = currentMultisigHistory.events[order.order.id.toString()]?.latest;
                    const expiresAt = order.accountReadFailed
                        ? order.orderInfo?.expiresAt.getTime() : latest?.creationExpiresAt * 1000;
                    return (order.accountReadFailed || (order.accountInactive && latest?.type === 'new'))
                        && !(expiresAt < now);
                });
            if (!hasPendingOrder && ordersUnverified
                && !confirm('Some orders are still being checked. Changing the multisig configuration can prevent pending orders from being executed. Do you want to continue?')) return;
        }

        const expireAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 1 month

        const actions = Multisig.packOrder([
            {
                type: 'update',
                threshold: threshold,
                signers: signersAddresses,
                proposers: proposersAddresses
            }
        ]);

        const message = Multisig.newOrderMessage(actions, expireAt, isSigner, isSigner ? mySignerIndex : myProposerIndex, orderId, 0n)
        const messageBase64 = message.toBoc().toString('base64');

        const multisigAddressString = currentMultisigAddress;
        const amount = DEFAULT_AMOUNT.toString();

        newMultisigTransactionToSend = {
            multisigAddress: Address.parseFriendly(multisigAddressString).address,
            orderId: orderId,
            message: {
                address: multisigAddressString,
                amount: amount,
                payload: messageBase64,  // raw one-cell BoC encoded in Base64
            }
        };

        newMultisigStatus = 'confirm';
        updateNewMultisigStatus();
    }
});

// START

const tryLoadMultisigFromLocalStorage = () => {
    const multisigAddress: string = localStorage.getItem('multisigAddress');

    if (!multisigAddress) {
        showScreen('startScreen');
    } else {
        setMultisigAddress(multisigAddress);
    }
}

const parseAddressFromUrl = (url: string): undefined | AddressInfo => {
    if (!Address.isFriendly(url)) {
        return undefined;
    }
    return Address.parseFriendly(url);
}

const parseBigIntFromUrl = (url: string): undefined | bigint => {
    try {
        const orderId = BigInt(url);
        if (orderId < 0) return undefined;
        return orderId;
    } catch (e) {
        return undefined;
    }
}

interface ParsedUrl {
    multisigAddress?: AddressInfo;
    orderId?: bigint;
}

const parseUrl = (url: string): ParsedUrl => {
    if (url.indexOf('/') > -1) {
        const arr = url.split('/');
        if (arr.length !== 2) {
            return {};
        }
        const multisigAddress = parseAddressFromUrl(arr[0]);
        if (multisigAddress === undefined) {
            return {};
        }

        const orderId = parseBigIntFromUrl(arr[1]);
        if (orderId === undefined) {
            return {};
        }

        return {
            multisigAddress: multisigAddress,
            orderId: orderId
        };
    } else {
        return {
            multisigAddress: parseAddressFromUrl(url)
        };
    }
}

const processUrl = async () => {
    clearMultisig();
    clearOrder();

    const urlPostfix = window.location.hash.substring(1);

    if (urlPostfix) {
        const {multisigAddress, orderId} = parseUrl(urlPostfix);

        console.log(multisigAddress, orderId);

        if (multisigAddress === undefined) {
            alert('Invalid URL');
            showScreen('startScreen');
        } else {
            const newMultisigAddress = formatContractAddress(multisigAddress.address);
            await setMultisigAddress(newMultisigAddress, orderId);
        }
    } else {
        tryLoadMultisigFromLocalStorage();
    }
}

processUrl();

window.onpopstate = () => processUrl();
