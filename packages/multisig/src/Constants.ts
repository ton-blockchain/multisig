import { Cell } from "@ton/core";

export const MULTISIG_CODE = Cell.fromBase64(
  "te6cckECEgEABJUAART/APSkE/S88sgLAQIBYgIDAsrQM9DTAwFxsJJfA+D6QDAi10nAAJJfA+AC0x8BIMAAkl8E4AHTPwHtRNDT/wEB0wcBAdTTBwEB9ATSAAEB0SiCEPcYUQ+64w8FREPIUAYBy/9QBAHLBxLMAQHLB/QAAQHKAMntVAQFAgEgDA0BnjgG0/8BKLOOEiCE/7qSMCSWUwW68uPw4gWkBd4B0gABAdMHAQHTLwEB1NEjkSaRKuJSMHj0Dm+h8uPvHscF8uPvIPgjvvLgbyD4I6FUbXAGApo2OCaCEHUJf126jroGghCjLFm/uo6p+CgYxwXy4GUD1NEQNBA2RlD4AH+OjSF49HxvpSCRMuMNAbPmWxA1UDSSNDbiUFQT4w1AFVAzBAoJAdT4BwODDPlBMAODCPlBMPgHUAahgSf4AaBw+DaBEgZw+DaggSvscPg2oIEdmHD4NqAipgYioIEFOSagJ6Bw+DgjpIECmCegcPg4oAOmBliggQbgUAWgUAWgQwNw+DdZoAGgHL7y4GT4KFADBwK4AXACyFjPFgEBy//JiCLIywH0APQAywDJcCH5AHTIywISygfL/8nQyIIQnHP7olgKAssfyz8mAcsHUlDMUAsByy8bzCoBygAKlRkBywcIkTDiECRwQImAGIBQ2zwRCACSjkXIWAHLBVAFzxZQA/oCVHEjI+1E7UXtR59byFADzxfJE3dQA8trzMztZ+1l7WR0f+0RmHYBy2vMAc8X7UHt8QHy/8kB+wDbBgLiNgTT/wEB0y8BAdMHAQHT/wEB1NH4KFAFAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQG8cF8uBlJvkAGrpRk74ZsPLgZgf4I77y4G9EFFBW+AB/jo0hePR8b6UgkTLjDQGz5lsRCgH6AtdM0NMfASCCEPE4Hlu6jmqCEB0M+9O6jl5sRNMHAQHUIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsISDCAPLgbiPCAPLgbVMwu/LgbQH0BCF/cI4XURJ49HxvpTIhmVMCuvLgZwKkAt4BsxLmbCEw0VUjkTDi4w0LABAw0wfUAvsA0QFDv3T/aiaGn/gIDpg4CA6mmDgID6AmkAAIDoiBqvgoD8EdDA4CAWYPEADC+AcDgwz5QTADgwj5QTD4B1AGoYEn+AGgcPg2gRIGcPg2oIEr7HD4NqCBHZhw+DagIqYGIqCBBTkmoCegcPg4I6SBApgnoHD4OKADpgZYoIEG4FAFoFAFoEMDcPg3WaABoADxsMr7UTQ0/8BAdMHAQHU0wcBAfQE0gABAdEjf3COF1ESePR8b6UyIZlTArry4GcCpALeAbMS5mwhUjC68uBsIX9wjhdREnj0fG+lMiGZUwK68uBnAqQC3gGzEuZsITAiwgDy4G4kwgDy4G1SQ7vy4G0BkjN/kQPiA4AFZsMn+CgBAXACyFjPFgEBy//JiCLIywH0APQAywDJcAH5AHTIywISygfL/8nQgEQhCAmMFqAYchWwszwXcsN9YFccUdYcFZ8q18EnjQLz1klHzYNH/nQ==",
);
export const MULTISIG_ORDER_CODE = Cell.fromBase64(
  "te6cckEBAQEAIwAIQgJjBagGHIVsLM8F3LDfWBXHFHWHBWfKtfBJ40C89ZJR80AoJo0=",
);

export abstract class Op {
  static readonly multisig = {
    new_order: 0xf718510f,
    execute: 0x75097f5d,
    execute_internal: 0xa32c59bf,
  };

  static readonly order = {
    approve: 0xa762230f,
    expired: 0x6,
    approve_rejected: 0xafaf283e,
    approved: 0x82609bf6,
    init: 0x9c73fba2,
  };

  static readonly actions = {
    send_message: 0xf1381e5b,
    update_multisig_params: 0x1d0cfbd3,
  };
}

export abstract class Errors {
  static readonly multisig = {
    unauthorized_new_order: 1007,
    invalid_new_order: 1008,
    not_enough_ton: 100,
    unauthorized_execute: 101,
    singers_outdated: 102,
    invalid_dictionary_sequence: 103,
    expired: 111,
  };

  static readonly order = {
    unauthorized_init: 104,
    already_approved: 107,
    already_inited: 105,
    unauthorized_sign: 106,
    expired: 111,
    unknown_op: 0xffff,
    already_executed: 112,
  };
}

export abstract class Params {
  static readonly bitsize = {
    op: 32,
    queryId: 64,
    orderSeqno: 256,
    signerIndex: 8,
    actionIndex: 8,
    time: 48,
  };
}
