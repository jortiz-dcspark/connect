/* @flow */
'use strict';

import AbstractMethod from './AbstractMethod';
import { validateParams, validateCoinPath } from './helpers/paramsValidator';
import { getEthereumNetwork } from '../../data/CoinInfo';
import Discovery from './helpers/Discovery';
import * as UI from '../../constants/ui';
import { NO_COIN_INFO } from '../../constants/errors';

import {
    validatePath,
    getAccountLabel,
    getSerializedPath,
} from '../../utils/pathUtils';
import { create as createDeferred } from '../../utils/deferred';

import Account, { create as createAccount } from '../../account';
import BlockBook, { create as createBackend } from '../../backend';
import { getCoinInfoByCurrency, fixCoinInfoNetwork, getCoinInfoFromPath } from '../../data/CoinInfo';
import { UiMessage } from '../../message/builder';
import type { EthereumNetworkInfo, UiPromiseResponse } from 'flowtype';
import type { AccountInfo, HDNodeResponse } from '../../types/trezor';
import type { Deferred, CoreMessage } from '../../types';
import type { EthereumAccount } from '../../types/ethereum';

type Params = {
    accounts: Array<EthereumAccount>,
    coinInfo: EthereumNetworkInfo,
    bundledResponse: boolean,
}

export default class EthereumGetAccountInfo extends AbstractMethod {
    params: Params;
    confirmed: boolean = false;
    backend: BlockBook;
    discovery: ?Discovery;

    constructor(message: CoreMessage) {
        super(message);
        this.requiredPermissions = [];
        this.info = 'Export ethereum account info';
        this.useDevice = false;
        this.useUi = false;

        const payload: Object = message.payload;
        let bundledResponse: boolean = true;
        // create a bundle with only one batch
        if (!payload.hasOwnProperty('accounts')) {
            payload.accounts = [ ...payload.account ];
            bundledResponse = false;
        }

        // validate incoming parameters
        validateParams(payload, [
            { name: 'accounts', type: 'array', obligatory: true },
            { name: 'coin', type: 'string', obligatory: true },
        ]);

        payload.accounts.forEach(batch => {
            validateParams(batch, [
                { name: 'address', type: 'string', obligatory: true },
                { name: 'block', type: 'number', obligatory: true },
                { name: 'transactions', type: 'number', obligatory: true },
            ]);
        });

        const network: ?EthereumNetworkInfo = getEthereumNetwork(payload.coin);
        if (!network) {
            throw NO_COIN_INFO;
        }

        this.params = {
            accounts: payload.accounts,
            coinInfo: network,
            bundledResponse
        };
    }

    async run(): Promise<EthereumAccount | Array<EthereumAccount>> {
        // initialize backend
        this.backend = await createBackend(this.params.coinInfo);

        const blockchain = this.backend.blockchain;
        const { height } = await blockchain.lookupSyncStatus();

        const responses: Array<EthereumAccount> = [];

        for (let i = 0; i < this.params.accounts.length; i++) {
            const account = this.params.accounts[i];
            const method = 'getAddressHistory';
            const params = [
                [account.address],
                {
                    start: height,
                    end: account.block,
                    from: 0,
                    to: 0,
                    queryMempol: false,
                    queryMempoolOnly: false
                }
            ];
            const socket = await blockchain.socket.promise;
            const confirmed = await socket.send({method, params});

            delete params[1].queryMempol;
            params[1].queryMempoolOnly = true;

            const pendingCount = await socket.send({method, params});
            const pendingTransactions = []
            if (pendingCount.totalCount > 0) {
                params[1].to = pendingCount.totalCount;
                const pendingTxs = await socket.send({method, params});
                pendingTransactions.concat(pendingTxs.items);
            }

            responses.push({
                address: account.address,
                transactions: confirmed.totalCount,
                pending: pendingTransactions,
                block: height
            });
        }

        // const addresses: Array<string> = this.params.accounts.map(a => a.address);

        // const socket = await blockchain.socket.promise;
        // const method = 'getAddressHistory';
        // const params = [
        //     addresses,
        //     {
        //         start: height,
        //         end: 0,
        //         from: 0,
        //         to: 0,
        //         queryMempol: true
        //     }
        // ];
        // const txs = await socket.send({method, params});

        return this.params.bundledResponse ? responses : responses[0];
    }
}