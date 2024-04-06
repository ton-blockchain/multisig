import {Address, beginCell, Cell, fromNano, SendMode, toNano} from "@ton/core";
import {THEME, TonConnectUI} from '@tonconnect/ui'
import {
    AddressInfo,
    addressToString,
    formatAddressAndUrl,
    makeAddressLink,
    validateUserFriendlyAddress
} from "./utils/utils";
import {checkMultisig, MultisigInfo} from "./multisig/MultisigChecker";
import {checkMultisigOrder, MultisigOrderInfo} from "./multisig/MultisigOrderChecker";
import {JettonMinter, LOCK_TYPES, LockType, lockTypeToDescription, lockTypeToInt} from "./jetton/JettonMinter";
import {Multisig} from "./multisig/Multisig";
import {toUnits} from "./utils/units";
import {checkJettonMinter} from "./jetton/JettonMinterChecker";
import {storeStateInit} from "@ton/core/src/types/StateInit";
import {sendToIndex} from "./utils/MyNetworkProvider";

// UI COMMON

const $ = (selector: string): HTMLElement | null => document.querySelector(selector);

const $$ = (selector: string): NodeListOf<HTMLElement> => document.querySelectorAll(selector);

const toggle = (element: HTMLElement, isVisible: boolean) => {
    element.style.display = isVisible ? 'flex' : 'none';
}

function onInput(input: HTMLInputElement, handler: () => void) {
    input.addEventListener('change', handler);
    input.addEventListener('input', handler);
    input.addEventListener('cut', handler);
    input.addEventListener('paste', handler);
}

const checkHTML = (s: string) => {
    if (s.indexOf('<') > -1 || s.indexOf('>') > -1) throw new Error('html injection');
}

type ScreenType =
    'startScreen'
    | 'importScreen'
    | 'multisigScreen'
    | 'newOrderScreen'
    | 'orderScreen'
    | 'newMultisigScreen1'
    | 'newMultisigScreen2'
    | 'loadingScreen';

let currentScreen: ScreenType = 'startScreen';

const showScreen = (name: ScreenType) => {
    const screens = ['startScreen', 'importScreen', 'multisigScreen', 'newOrderScreen', 'orderScreen', 'loadingScreen', 'newMultisigScreen1', 'newMultisigScreen2']
    currentScreen = name;
    for (const screen of screens) {
        toggle($('#' + screen), screen === name);
    }

    if (currentScreen === 'importScreen') {
        ($('#import_input') as HTMLInputElement).value = '';
    }


    if (currentScreen === 'newOrderScreen') {
        if (newOrderTypeSelect) {
            newOrderClear();
        }
    }
}

const browserLang: string = navigator.language;
const lang = (browserLang === 'ru-RU') || (browserLang === 'ru') || (browserLang === 'be-BY') || (browserLang === 'be') || (browserLang === 'kk-KZ') || (browserLang === 'kk') ? 'ru' : 'en';

const IS_TESTNET = window.location.href.indexOf('testnet=true') > -1;

if (IS_TESTNET) {
    $('.testnet-badge').style.display = 'block';
    document.body.classList.add('testnet-padding');
}

// TONCONNECT

const tonConnectUI = new TonConnectUI({
    manifestUrl: 'https://multisig.ton.org/tonconnect-manifest.json',
    buttonRootId: 'tonConnectButton'
});

tonConnectUI.uiOptions = {
    uiPreferences: {
        theme: THEME.LIGHT
    }
};

let myAddress: Address | null;

const tonConnectUnsubscribe = tonConnectUI.onStatusChange(info => {
    if (info === null) { // wallet disconnected
        myAddress = null;
    } else if (info.account) {
        myAddress = Address.parseRaw(info.account.address);
    }
});

// START SCREEN

$('#createMultisigButton').addEventListener('click', () => {
    newMultisigClear();
    newMultisigMode = 'create';
    showScreen('newMultisigScreen1');
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

// MULTISIG SCREEN

const MULTISIG_CODE = Cell.fromBase64("te6cckECEgEABJUAART/APSkE/S88sgLAQIBYgIDAsrQM9DTAwFxsJJfA+D6QDAi10nAAJJfA+AC0x8BIMAAkl8E4AHTPwHtRNDT/wEB0wcBAdTTBwEB9ATSAAEB0SiCEPcYUQ+64w8FREPIUAYBy/9QBAHLBxLMAQHLB/QAAQHKAMntVAQFAgEgDA0BnjgG0/8BKLOOEiCE/7qSMCSWUwW68uPw4gWkBd4B0gABAdMHAQHTLwEB1NEjkSaRKuJSMHj0Dm+h8uPvHscF8uPvIPgjvvLgbyD4I6FUbXAGApo2OCaCEHUJf126jroGghCjLFm/uo6p+CgYxwXy4GUD1NEQNBA2RlD4AH+OjSF49HxvpSCRMuMNAbPmWxA1UDSSNDbiUFQT4w1AFVAzBAoJAdT4BwODDPlBMAODCPlBMPgHUAahgSf4AaBw+DaBEgZw+DaggSvscPg2oIEdmHD4NqAipgYioIEFOSagJ6Bw+DgjpIECmCegcPg4oAOmBliggQbgUAWgUAWgQwNw+DdZoAGgHL7y4GT4KFADBwK4AXACyFjPFgEBy//JiCLIywH0APQAywDJcCH5AHTIywISygfL/8nQyIIQnHP7olgKAssfyz8mAcsHUlDMUAsByy8bzCoBygAKlRkBywcIkTDiECRwQImAGIBQ2zwRCACSjkXIWAHLBVAFzxZQA/oCVHEjI+1E7UXtR59byFADzxfJE3dQA8trzMztZ+1l7WR0f+0RmHYBy2vMAc8X7UHt8QHy/8kB+wDbBgLiNgTT/wEB0y8BAdMHAQHT/wEB1NH4KFAFAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQG8cF8uBlJvkAGrpRk74ZsPLgZgf4I77y4G9EFFBW+AB/jo0hePR8b6UgkTLjDQGz5lsRCgH6AtdM0NMfASCCEPE4Hlu6jmqCEB0M+9O6jl5sRNMHAQHUIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsISDCAPLgbiPCAPLgbVMwu/LgbQH0BCF/cI4XURJ49HxvpTIhmVMCuvLgZwKkAt4BsxLmbCEw0VUjkTDi4w0LABAw0wfUAvsA0QFDv3T/aiaGn/gIDpg4CA6mmDgID6AmkAAIDoiBqvgoD8EdDA4CAWYPEADC+AcDgwz5QTADgwj5QTD4B1AGoYEn+AGgcPg2gRIGcPg2oIEr7HD4NqCBHZhw+DagIqYGIqCBBTkmoCegcPg4I6SBApgnoHD4OKADpgZYoIEG4FAFoFAFoEMDcPg3WaABoADxsMr7UTQ0/8BAdMHAQHU0wcBAfQE0gABAdEjf3COF1ESePR8b6UyIZlTArry4GcCpALeAbMS5mwhUjC68uBsIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsITAiwgDy4G4kwgDy4G1SQ7vy4G0BkjN/kQPiA4AFZsMn+CgBAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQgEQhCAmMFqAYchWwszwXcsN9YFccUdYcFZ8q18EnjQLz1klHzYNH/nQ==");
const MULTISIG_ORDER_CODE = Cell.fromBase64('te6cckEBAQEAIwAIQgJjBagGHIVsLM8F3LDfWBXHFHWHBWfKtfBJ40C89ZJR80AoJo0=');

let currentMultisigInfo: MultisigInfo | null = null;

const setMultisigAddress = async (newMultisigAddress: string) => {
    showScreen('loadingScreen');

    const multisigAddress = Address.parseFriendly(newMultisigAddress);
    multisigAddress.isBounceable = true;
    multisigAddress.isTestOnly = IS_TESTNET;

    $('#mulisig_address').innerHTML = makeAddressLink(multisigAddress);

    localStorage.setItem('multisigAddress', newMultisigAddress);

    toggle($('#multisig_content'), false);
    toggle($('#multisig_error'), false);

    try {
        currentMultisigInfo = await checkMultisig(Address.parseFriendly(newMultisigAddress), MULTISIG_CODE, IS_TESTNET, true);

        const {
            tonBalance,
            threshold,
            signers,
            proposers,
            allowArbitraryOrderSeqno,
            nextOderSeqno,
            lastOrders
        } = currentMultisigInfo;


        $('#multisig_tonBalance').innerText = fromNano(tonBalance) + ' TON';

        $('#multisig_threshold').innerText = threshold + '/' + signers.length;

        let signersHTML = '';
        for (let i = 0; i < signers.length; i++) {
            const signer = signers[i];
            const addressString = await formatAddressAndUrl(signer, IS_TESTNET)
            signersHTML += (`<div>#${i} - ${addressString}</div>`);
        }
        $('#multisig_signersList').innerHTML = signersHTML;

        if (proposers.length > 0) {
            let proposersHTML = '';
            for (let i = 0; i < proposers.length; i++) {
                const proposer = proposers[i];
                const addressString = await formatAddressAndUrl(proposer, IS_TESTNET)
                proposersHTML += (`<div>#${i} - ${addressString}</div>`);
            }
            $('#multisig_proposersList').innerHTML = proposersHTML;
        } else {
            $('#multisig_proposersList').innerHTML = 'No proposers';
        }

        $('#multisig_orderId').innerText = allowArbitraryOrderSeqno ? 'Arbitrary' : nextOderSeqno.toString();

        let lastOrdersHTML = '';

        for (const lastOrder of lastOrders) {
            if (!lastOrder.errorMessage) {
                lastOrdersHTML += `<div class="multisig_lastOrder" order-address="${addressToString(lastOrder.order.address)}">${lastOrder.type === 'new' ? 'New order' : 'Executed order'} #${lastOrder.order.id}</div>`
            }
        }

        $('#mainScreen_ordersList').innerHTML = lastOrdersHTML;

        $$('.multisig_lastOrder').forEach(div => {
            div.addEventListener('click', (e) => {
                const orderAddressString = (e.currentTarget as HTMLElement).attributes.getNamedItem('order-address').value;
                setOrderAddress(orderAddressString);
            })
        })

        showScreen('multisigScreen');
        toggle($('#multisig_content'), true);

    } catch (e) {
        console.error(e);
        showScreen('multisigScreen');

        toggle($('#multisig_error'), true);
        $('#multisig_error').innerText = e.message;
    }
}


$('#multisig_logoutButton').addEventListener('click', () => {
    localStorage.removeItem('multisigAddress');
    showScreen('startScreen');
});

$('#multisig_createNewOrderButton').addEventListener('click', () => {
    showScreen('newOrderScreen');
});

// ORDER SCREEN

let currentOrderInfo: MultisigOrderInfo | null = null;

const setOrderAddress = async (newOrderAddress: string) => {
    showScreen('loadingScreen');

    const orderAddress = Address.parseFriendly(newOrderAddress);
    orderAddress.isBounceable = true;
    orderAddress.isTestOnly = IS_TESTNET;

    $('#order_address').innerHTML = makeAddressLink(orderAddress);

    toggle($('#order_content'), false);
    toggle($('#order_error'), false);

    try {
        currentOrderInfo = await checkMultisigOrder(orderAddress, MULTISIG_ORDER_CODE, currentMultisigInfo, IS_TESTNET);

        const {
            tonBalance,
            actions,
            orderId,
            isExecuted,
            approvalsNum,
            approvalsMask,
            threshold,
            signers,
            expiresAt
        } = currentOrderInfo;

        const isExpired = (new Date()).getTime() > expiresAt.getTime();

        $('#order_id').innerText = '#' + orderId;
        $('#order_tonBalance').innerText = fromNano(tonBalance) + ' TON';
        $('#order_executed').innerText = isExecuted ? 'Yes' : 'Not yet';
        $('#order_approvals').innerText = approvalsNum + '/' + threshold;
        $('#order_expiresAt').innerText = (isExpired ? '❌ EXPIRED - ' : '') + expiresAt.toString();

        let signersHTML = '';
        for (let i = 0; i < signers.length; i++) {
            const signer = signers[i];
            const addressString = await formatAddressAndUrl(signer, IS_TESTNET)
            const mask = 1 << i;
            const isSigned = approvalsMask & mask;
            signersHTML += (`<div>#${i} - ${addressString} - ${isSigned ? '✅' : '❌'}</div>`);
        }
        $('#order_signersList').innerHTML = signersHTML;

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

        toggle($('#order_approveButton'), !isExecuted && !isExpired);
        toggle($('#order_approveNote'), !isExecuted && !isExpired);

        showScreen('orderScreen');
        toggle($('#order_content'), true);

    } catch (e) {
        console.error(e);
        showScreen('orderScreen');

        toggle($('#order_error'), true);
        $('#order_error').innerText = e.message;
    }
}

$('#order_backButton').addEventListener('click', () => {
    showScreen('multisigScreen');
});


$('#order_approveButton').addEventListener('click', async () => {
    if (!myAddress) {
        alert('Please connect wallet');
        return;
    }

    const mySignerIndex = currentOrderInfo.signers.findIndex(address => address.equals(myAddress));

    if (mySignerIndex == -1) {
        alert('You are not signer');
        return;
    }

    const orderAddressString = addressToString(currentOrderInfo.address);
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

    try {
        const result = await tonConnectUI.sendTransaction(transaction);
        await setOrderAddress(orderAddressString); // reload order page
    } catch (e) {
        console.error(e);
    }
});

// NEW ORDER

type FieldType = 'TON' | 'Jetton' | 'Address' | 'URL' | 'Status';

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

    if (value === null || value === undefined || value === '') {
        return makeError(`Empty`);
    }

    switch (fieldType) {
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
    }
}

interface OrderField {
    name: string;
    type: FieldType;
}

interface OrderType {
    name: string;
    fields: { [key: string]: OrderField };
    check?: (values: { [key: string]: any }) => Promise<ValidatedValue>;
    makeMessage: (values: { [key: string]: any }) => {
        toAddress: AddressInfo,
        tonAmount: bigint,
        body: Cell
    };
}

const AMOUNT_TO_SEND = toNano('0.2'); // 0.2 TON
const DEFAULT_AMOUNT = toNano('0.1'); // 0.1 TON
const DEFAULT_INTERNAL_AMOUNT = toNano('0.05'); // 0.05 TON

const checkJettonMinterAdmin = async (values: { [key: string]: any }): Promise<ValidatedValue> => {
    try {
        const jettonMinterInfo = await checkJettonMinter(values.jettonMinterAddress, IS_TESTNET, false);

        if (!currentMultisigInfo.address.address.equals(jettonMinterInfo.adminAddress)) {
            return {error: "Multisig is not admin of this jetton"};
        }

        return {value: jettonMinterInfo};
    } catch (e: any) {
        return {error: 'Jetton-minter check error'};
    }
}

const checkJettonMinterNextAdmin = async (values: { [key: string]: any }): Promise<ValidatedValue> => {
    try {
        const jettonMinterInfo = await checkJettonMinter(values.jettonMinterAddress, IS_TESTNET, true);

        if (!currentMultisigInfo.address.address.equals(jettonMinterInfo.nextAdminAddress)) {
            return {error: "Multisig is not next-admin of this jetton"};
        }

        return {value: jettonMinterInfo};
    } catch (e: any) {
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
        return {error: 'Possibly connectivity error'};
    }
}

const orderTypes: OrderType[] = [
    {
        name: 'Transfer TON',
        fields: {
            amount: {
                name: 'TON Amount',
                type: 'TON'
            },
            toAddress: {
                name: 'Destination Address',
                type: 'Address'
            }
        },
        makeMessage: (values) => {
            return {
                toAddress: values.toAddress,
                tonAmount: values.amount,
                body: beginCell().endCell()
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
        makeMessage: (values) => {
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
        makeMessage: (values) => {
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
                name: 'TON Amount',
                type: 'TON'
            },
        },
        makeMessage: (values) => {
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
        makeMessage: (values) => {
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
        makeMessage: (values) => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.mintMessage(values.toAddress.address, values.amount, values.jettonMinterAddress.address, currentMultisigInfo.address.address, null, 0n, DEFAULT_INTERNAL_AMOUNT)
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
        makeMessage: (values) => {
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
        makeMessage: (values) => {
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
        makeMessage: (values) => {
            return {
                toAddress: values.jettonMinterAddress,
                tonAmount: DEFAULT_AMOUNT,
                body: JettonMinter.lockWalletMessage(values.userAddress.address, lockTypeToInt(values.newStatus), DEFAULT_INTERNAL_AMOUNT)
            }
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

const setDisabledButtons = (isDisabled: boolean) => {
    ($('#newOrder_createButton') as HTMLButtonElement).disabled = isDisabled;
    ($('#newOrder_backButton') as HTMLButtonElement).disabled = isDisabled;
}

const setDisabled = (isDisabled: boolean) => {
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

    setDisabledButtons(isDisabled);
}

let newOrderMode: 'fill' | 'confirm' = 'fill';
let transactionToSent: any = null;

const setNewOrderMode = (mode: 'fill' | 'confirm') => {
    if (mode == 'fill') {
        setDisabled(false);
        $('#newOrder_createButton').innerHTML = 'Create';
        $('#newOrder_backButton').innerHTML = 'Back';
    } else {
        $('#newOrder_createButton').innerHTML = 'Send Transaction';
        $('#newOrder_backButton').innerHTML = 'Cancel';
    }
    newOrderMode = mode;
}

$('#newOrder_createButton').addEventListener('click', async () => {
    if (newOrderMode === 'confirm') {
        if (!transactionToSent) throw new Error('')

        try {
            const result = await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
                messages: [
                    transactionToSent
                ]
            });
            showScreen('multisigScreen');
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const orderId = BigInt(($('#newOrder_orderId') as HTMLInputElement).value);

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

    setDisabled(true);

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

    const messageParams = orderType.makeMessage(values);

    const myProposerIndex = currentMultisigInfo.proposers.findIndex(address => address.equals(myAddress));
    const mySignerIndex = currentMultisigInfo.signers.findIndex(address => address.equals(myAddress));

    if (myProposerIndex === -1 && mySignerIndex === -1) {
        alert('Error: you are not proposer and not signer');
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

    const multisigAddressString = addressToString(currentMultisigInfo.address);
    const amount = AMOUNT_TO_SEND.toString();

    transactionToSent = {
        address: multisigAddressString,
        amount: amount,
        payload: messageBase64,  // raw one-cell BoC encoded in Base64
    };

    setNewOrderMode('confirm')
    setDisabledButtons(false);
});

$('#newOrder_backButton').addEventListener('click', () => {
    if (newOrderMode == 'fill') {
        showScreen('multisigScreen');
    } else {
        setNewOrderMode('fill');
    }
});

const newOrderClear = () => {
    setNewOrderMode('fill');
    transactionToSent = null;
    newOrderTypeSelect.selectedIndex = 0;
    renderNewOrderFields(0);
}


// NEW MULTISIG / EDIT MULTISIG

const newMultisigSignersCountInput = $('#newMultisig_signersCount') as HTMLInputElement;
const newMultisigProposersCountInput = $('#newMultisig_proposersCount') as HTMLInputElement;
const newMultisigTreshoildInput = $('#newMultisig_threshold') as HTMLInputElement;
const newMultisigOrderIdInput = $('#newMultisig_orderId') as HTMLInputElement;

const newMultisigClear = () => {
    newMultisigSignersCountInput.value = '';
    newMultisigProposersCountInput.value = '';
    newMultisigTreshoildInput.value = '';

    toggle($('#newMultisig_orderIdLabel'), newMultisigMode === 'update');
    toggle($('#newMultisig_orderId'), newMultisigMode === 'update');
}

const getIntFromInput = (input: HTMLInputElement) => {
    if (input.value == '') {
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

const getBigIntFromInput = (input: HTMLInputElement) => {
    if (input.value == '') {
        return null;
    }
    try {
        const i = BigInt(input.value);
        return i;
    } catch (e) {
        return null;
    }
}

let newMultisigMode: 'create' | 'update' = 'create';

interface NewMultisigInfo {
    signersCount: number;
    proposersCount: number;
    threshold: number;
    orderId?: bigint;
}

let newMultisigInfo: NewMultisigInfo | null = null;

$('#newMultisig1_nextButton').addEventListener('click', async () => {
    ($('#newMultisig1_nextButton') as HTMLButtonElement).disabled = true;
    $('#newMultisigScreen1').style.pointerEvents = 'none';

    const signersCount = getIntFromInput(newMultisigSignersCountInput);
    if (signersCount === null || signersCount <= 0) {
        alert('Signers count: not valid number');
        return;
    }
    const proposersCount = getIntFromInput(newMultisigProposersCountInput);
    if (proposersCount === null || proposersCount < 0) {
        alert('Proposers count: not valid number');
        return;
    }
    const threshold = getIntFromInput(newMultisigTreshoildInput);
    if (threshold === null || threshold <= 0 || threshold > signersCount) {
        alert('Threshold count: not valid number');
        return;
    }

    let orderId: bigint | undefined = undefined;
    if (newMultisigMode === 'update') {
        orderId = getBigIntFromInput(newMultisigOrderIdInput);
        if (orderId === null || orderId < 0) {
            alert('Invalid order Id');
            return;
        }
    }

    const orderIdChecked = await checkExistingOrderId(orderId);
    ($('#newMultisig1_nextButton') as HTMLButtonElement).disabled = false;
    $('#newMultisigScreen1').style.pointerEvents = 'auto';
    if (orderIdChecked.error) {
        alert(orderIdChecked.error)
        return;
    }

    newMultisigInfo = {
        signersCount,
        proposersCount,
        threshold,
        orderId
    };

    let signersHTML = '';
    for (let i = 0; i < signersCount; i++) {
        signersHTML += `<div class="address-input"><div class="address-input-num">#${i}.</div> <input id="newMultisig_signer${i}"></div>`;
    }
    $('#newMultisig_signers').innerHTML = signersHTML;

    let proposersHTML = '';
    for (let i = 0; i < proposersCount; i++) {
        proposersHTML += `<div class="address-input"><div class="address-input-num">#${i}.</div> <input id="newMultisig_proposer${i}"></div>`;
    }
    $('#newMultisig_proposers').innerHTML = proposersHTML;

    $('#newMultisig2_createButton').innerText = newMultisigMode === 'create' ? 'Create' : 'Update';
    showScreen('newMultisigScreen2');
});

$('#newMultisig1_backButton').addEventListener('click', () => {
    if (newMultisigMode === 'create') {
        showScreen('startScreen');
    } else {
        showScreen('multisigScreen');
    }
});

$('#newMultisig2_createButton').addEventListener('click', async () => {
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

    if (newMultisigMode === 'create') {

        const newMultisig = Multisig.createFromConfig({
            threshold: newMultisigInfo.threshold,
            signers: signersAddresses,
            proposers: proposersAddresses,
            allowArbitrarySeqno: true
        }, MULTISIG_CODE);

        const newMultisigAddress = newMultisig.address;
        const amount = toNano('1').toString() // 1 TON

        console.log({
            code: newMultisig.init.code,
            data: newMultisig.init.data,
        })

        const stateInitCell = beginCell();
        storeStateInit({
            code: newMultisig.init.code as any,
            data: newMultisig.init.data as any
        })(stateInitCell as any);

        console.log({stateInitCell: stateInitCell.endCell()})

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
            messages: [
                {
                    address: newMultisigAddress.toString({urlSafe: true, bounceable: true, testOnly: IS_TESTNET}),
                    amount: amount,
                    stateInit: stateInitCell.endCell().toBoc().toString('base64'),  // raw one-cell BoC encoded in Base64
                }
            ]
        }

        try {
            const result = await tonConnectUI.sendTransaction(transaction);
            setMultisigAddress(addressToString({
                address: newMultisigAddress,
                isBounceable: true,
                isTestOnly: IS_TESTNET
            }));
        } catch (e) {
            console.error(e);
        }
    } else {
        const myProposerIndex = currentMultisigInfo.proposers.findIndex(address => address.equals(myAddress));
        const mySignerIndex = currentMultisigInfo.signers.findIndex(address => address.equals(myAddress));

        if (myProposerIndex === -1 && mySignerIndex === -1) {
            alert('Error: you are not proposer and not signer');
            return;
        }

        const isSigner = mySignerIndex > -1;

        const expireAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 1 month

        const actions = Multisig.packOrder([
            {
                type: 'update',
                threshold: newMultisigInfo.threshold,
                signers: signersAddresses,
                proposers: proposersAddresses
            }
        ]);

        const message = Multisig.newOrderMessage(actions, expireAt, isSigner, isSigner ? mySignerIndex : myProposerIndex, newMultisigInfo.orderId!, 0n)
        const messageBase64 = message.toBoc().toString('base64');

        const multisigAddressString = addressToString(currentMultisigInfo.address);
        const amount = DEFAULT_AMOUNT.toString();

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 60, // 1 minute
            messages: [{
                address: multisigAddressString,
                amount: amount,
                payload: messageBase64,  // raw one-cell BoC encoded in Base64
            }]
        };

        try {
            const result = await tonConnectUI.sendTransaction(transaction);
            setMultisigAddress(multisigAddressString);
        } catch (e) {
            console.error(e);
        }
    }
});

$('#newMultisig2_backButton').addEventListener('click', () => {
    showScreen('newMultisigScreen1');
});

// UPDATE

$('#multisig_updateButton').addEventListener('click', () => {
    newMultisigMode = 'update';
    newMultisigClear();
    showScreen('newMultisigScreen1');
});

// INIT

let multisigAddress: string = localStorage.getItem('multisigAddress');

if (!multisigAddress) {
    showScreen('startScreen');
} else {
    setMultisigAddress(multisigAddress);
}
