/* eslint-disable */
import {
    AddressInfo,
    addressToString,
    assert,
    equalsAddressLists,
    formatAddressAndUrl,
    getAddressFormat, sanitizeHTML,
} from "utils";
import {Address, Cell, Dictionary, fromNano, loadMessageRelaxed, CommonMessageInfoRelaxedInternal, beginCell} from "@ton/core";
import {cellToArray, endParse} from "./Multisig";
import {Order, parseOrderData} from "./Order";
import {MultisigInfo} from "./MultisigChecker";
import {MyNetworkProvider, sendToIndex} from "utils";
import {intToLockType, JettonMinter, lockTypeToDescription} from "jetton";

export interface MultisigOrderInfo {
    address: AddressInfo;
    tonBalance: bigint;
    orderId: bigint;
    isExecuted: boolean;
    approvalsNum: number;
    approvalsMask: number;
    threshold: number;
    signers: AddressInfo[];
    expiresAt: Date;
    actions: string[];
    stateInitMatches: boolean;
    rawActions?: Cell[]
    signersCell: Cell
    orderCell: Cell
    errors: string[]
}

const checkNumber = (n: number) => {
    if (n === null) throw new Error('Invalid number');
    if (n === undefined) throw new Error('Invalid number');
    if (isNaN(n)) throw new Error('Invalid number');
    if (n < 0) throw new Error('Invalid number');
}

export const checkMultisigOrder = async (
    multisigOrderAddress: AddressInfo,
    multisigOrderCode: Cell,
    multisigInfo: MultisigInfo,
    isTestnet: boolean,
    needAdditionalChecks: boolean,
): Promise<MultisigOrderInfo> => {
    const errors: string[] = [];

    // Account State and Data

    const result = await sendToIndex('account', {address: addressToString(multisigOrderAddress)}, isTestnet);
    if (result.status !== 'active') {
        errors.push("Contract not active. If you have just created an order it should appear within ~30 seconds.");
    }

    if (!Cell.fromBase64(result.code).equals(multisigOrderCode)) {
        errors.push('The contract code DOES NOT match the multisig-order code from this repository');
    }

    const tonBalance = result.balance;

    const data = Cell.fromBase64(result.data);
    const parsedData = parseOrderData(data);

    checkNumber(parsedData.threshold);
    if (parsedData.threshold <= 0) {
        errors.push("Threshold not positive");
    }
    if (parsedData.threshold > parsedData.signers.length) {
        errors.push("Invalid threshold");
    }
    checkNumber(parsedData.approvalsMask);
    checkNumber(parsedData.approvalsNum);
    if (parsedData.approvalsNum > parsedData.signers.length) {
        errors.push("Invalid approvalsNum");
    }
    checkNumber(parsedData.expirationDate);

    const signersFormatted = [];
    for (const signer of parsedData.signers) {
        signersFormatted.push(await getAddressFormat(signer, isTestnet));
    }

    // Check in multisig

    if (!parsedData.multisigAddress.equals(multisigInfo.address.address)) {
        errors.push("Multisig address does not match");
    }

    const multisigOrderToCheck = Order.createFromConfig({
        multisig: multisigInfo.address.address,
        orderSeqno: parsedData.orderSeqno
    }, multisigOrderCode);

    if (!multisigOrderToCheck.address.equals(multisigOrderAddress.address)) {
        errors.push("Fake multisig-order");
    }

    if (!parsedData.isExecuted) {
        if (multisigInfo.threshold > parsedData.threshold) {
            errors.push("Multisig threshold do not match order threshold");
        }
        if (!equalsAddressLists(multisigInfo.signers.map(a => a.address), parsedData.signers)) {
            errors.push("Multisig signers do not match order signers");
        }
    }

    if (needAdditionalChecks) {
        // Get-methods

        const provider = new MyNetworkProvider(multisigOrderAddress.address, isTestnet);
        const multisigOrderContract: Order = Order.createFromAddress(multisigOrderAddress.address);
        const getData = await multisigOrderContract.getOrderDataStrict(provider);

        if (!getData.multisig.equals(parsedData.multisigAddress)) {
            errors.push("Invalid multisigAddress");
        }
        if (getData.order_seqno !== parsedData.orderSeqno) {
            errors.push("Invalid orderSeqno");
        }
        if (getData.threshold !== parsedData.threshold) {
            errors.push("Invalid threshold");
        }
        if (getData.executed !== parsedData.isExecuted) {
            errors.push("Invalid isExecuted");
        }
        if (!equalsAddressLists(getData.signers, parsedData.signers)) {
            errors.push("Invalid signers");
        }
        if (getData._approvals !== BigInt(parsedData.approvalsMask)) {
            errors.push("Invalid approvalsMask");
        }
        if (getData.approvals_num !== parsedData.approvalsNum) {
            errors.push("Invalid approvalsNum");
        }
        if (getData.expiration_date !== BigInt(parsedData.expirationDate)) {
            errors.push("Invalid expirationDate");
        }
        if (!getData.order.hash().equals(parsedData.order.hash())) {
            errors.push("Invalid order");
        }
    }

    // StateInit

    const multisigOrderAddress3 = Order.createFromConfig({
        multisig: parsedData.multisigAddress,
        orderSeqno: parsedData.orderSeqno
    }, multisigOrderCode);

    const stateInitMatches = multisigOrderAddress3.address.equals(multisigOrderAddress.address);

    // Actions

    const actions = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Cell(), parsedData.order);

    const parseActionBody = async (cell: Cell): Promise<string> => {
        try {
            const slice = cell.beginParse();
            if (slice.remainingBits === 0 && slice.remainingRefs == 0) {
                return "Send Toncoins from multisig without comment";
            }
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const op = slice.loadUint(32);
            if (op == 0) {
                const text = slice.loadStringTail();
                return `Send Toncoins from multisig with comment "${sanitizeHTML(text)}"`;
            }
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseMintMessage(slice);
            if (parsed.internalMessage.forwardPayload.remainingBits !== 0 || parsed.internalMessage.forwardPayload.remainingRefs !== 0) {
                throw new Error('Mint forward payload not supported');
            }
            const toAddress = await formatAddressAndUrl(parsed.toAddress, isTestnet)
            return `Mint ${parsed.internalMessage.jettonAmount} jettons (in units) to ${toAddress}; ${fromNano(parsed.tonAmount)} TON for gas`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseTopUp(slice);
            return `Top Up`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseChangeAdmin(slice);
            const newAdminAddress = await formatAddressAndUrl(parsed.newAdminAddress, isTestnet)
            return `Change Admin to ${newAdminAddress}`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseClaimAdmin(slice);
            return `Claim Admin`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseChangeContent(slice);
            return `Change metadata URL to "${sanitizeHTML(parsed.newMetadataUrl)}"`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseTransfer(slice);
            if (parsed.customPayload) throw new Error('Transfer custom payload not supported');
            if (parsed.forwardPayload.remainingBits !== 0 || parsed.forwardPayload.remainingRefs !== 0) {
                throw new Error('Transfer forward payload not supported');
            }
            const toAddress = await formatAddressAndUrl(parsed.toAddress, isTestnet)
            return `Transfer ${parsed.jettonAmount} jettons (in units) from multisig to user ${toAddress};`;
        } catch (e) {
        }


        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseCallTo(slice, JettonMinter.parseSetStatus);
            const userAddress = await formatAddressAndUrl(parsed.toAddress, isTestnet)
            const lockType = intToLockType(parsed.action.newStatus);
            return `Lock jetton wallet of user ${userAddress}. Set status "${lockType}" - "${lockTypeToDescription(lockType)}"; ${fromNano(parsed.tonAmount)} TON for gas`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseCallTo(slice, JettonMinter.parseTransfer);
            if (parsed.action.customPayload) throw new Error('Force transfer custom payload not supported');
            if (parsed.action.forwardPayload.remainingBits !== 0 || parsed.action.forwardPayload.remainingRefs !== 0) {
                throw new Error('Force transfer forward payload not supported');
            }
            const fromAddress = await formatAddressAndUrl(parsed.toAddress, isTestnet)
            const toAddress = await formatAddressAndUrl(parsed.action.toAddress, isTestnet)
            return `Force transfer ${parsed.action.jettonAmount} jettons (in units) from user ${fromAddress} to ${toAddress}; ${fromNano(parsed.tonAmount)} TON for gas`;
        } catch (e) {
        }

        try {
            const slice = cell.beginParse();
            const parsed = JettonMinter.parseCallTo(slice, JettonMinter.parseBurn);
            if (parsed.action.customPayload) throw new Error('Burn custom payload not supported');
            const userAddress = await formatAddressAndUrl(parsed.toAddress, isTestnet)
            return `Force burn ${parsed.action.jettonAmount} jettons (in units) from user ${userAddress}; ${fromNano(parsed.tonAmount)} TON for gas`;
        } catch (e) {
        }

        // throw new Error('Unsupported action')

    }

    let parsedActions: string[] = [];

    const actionsKeys = actions.keys();
    for (let key of actionsKeys) {
        let actionString = `<div class="label">Action #${key}:</div>`;

        const action = actions.get(key);
        const slice = action!.beginParse();
        const actionOp = slice.loadUint(32);
        if (actionOp === 0xf1381e5b) { // send message
            const sendMode = slice.loadUint(8);

            let sendModeString = [];
            let allBalance = false;

            if (sendMode & 1) {
                sendModeString.push('Pays fees separately');
            }
            if (sendMode & 2) {
                sendModeString.push('Ignore sending errors');
            }
            if (sendMode & 128) {
                allBalance = true;
                sendModeString.push('CARRY ALL BALANCE');
            }
            if (sendMode & 64) {
                sendModeString.push('Carry all the remaining value of the inbound message');
            }
            if (sendMode & 32) {
                sendModeString.push('DESTROY ACCOUNT');
            }


            const actionBody = slice.loadRef();
            endParse(slice);
            const messageRelaxed = loadMessageRelaxed(actionBody.beginParse());
            console.log(messageRelaxed);

            const info: CommonMessageInfoRelaxedInternal = messageRelaxed.info as any;

            const destAddress = await formatAddressAndUrl(info.dest, isTestnet);
            actionString += `<div>Send ${allBalance ? 'ALL BALANCE' : fromNano(info.value.coins)} TON to ${destAddress}</div>`
            actionString += `<div>${await parseActionBody(messageRelaxed.body)}</div>`
            if (sendMode) {
                actionString += `<div>Send mode: ${sendModeString.join(', ')}.</div>`
            }

        } else if (actionOp === 0x1d0cfbd3) { // update_multisig_params
            const newThreshold = slice.loadUint(8);
            const newSigners = cellToArray(slice.loadRef());
            const newProposers = slice.loadUint(1) ? cellToArray(slice.loadRef()) : [];
            endParse(slice);

            assert(newSigners.length > 0, 'Invalid new signers')
            assert(newThreshold > 0, 'Invalid new threshold')
            assert(newThreshold <= newSigners.length, 'Invalid new threshold')

            actionString += `<div>Update Multisig Params</div>`
            actionString += `<div>New threshold : ${newThreshold.toString()}</div>`

            actionString += '<div>New signers:</div>'
            for (let i = 0; i < newSigners.length; i++) {
                const signer = newSigners[i];
                const addressString = await formatAddressAndUrl(signer, isTestnet)
                actionString += (`<div>#${i + 1} - ${addressString}</div>`);
            }

            actionString += '<div>New proposers:</div>'
            if (newProposers.length > 0) {
                for (let i = 0; i < newProposers.length; i++) {
                    const proposer = newProposers[i];
                    const addressString = await formatAddressAndUrl(proposer, isTestnet)
                    actionString += (`<div>#${i + 1} - ${addressString}</div>`);
                }
            } else {
                actionString += '<div>No proposers</div>'
            }

        } else {
            throw new Error('Unknown action')
        }

        parsedActions.push(actionString);
    }

    return {
        address: multisigOrderAddress,
        tonBalance,
        orderId: parsedData.orderSeqno,
        isExecuted: parsedData.isExecuted,
        approvalsNum: parsedData.approvalsNum,
        approvalsMask: parsedData.approvalsMask,
        threshold: parsedData.threshold,
        signers: signersFormatted,
        expiresAt: new Date(parsedData.expirationDate * 1000),
        actions: parsedActions,
        rawActions: actions.values(),
        stateInitMatches,
        orderCell: parsedData.order,
        signersCell: parsedData.signersRef,
        errors,
    }
}
