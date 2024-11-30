const EventEmitter = require('events');
const R = require('ramda');
const Db = require('../util/db');
const Blocks = require('./blocks');
const Block = require('./block');
const Transactions = require('./transactions');
const TransactionAssertionError = require('./transactionAssertionError');
const ArgumentError = require('./argumentError');
const BlockAssertionError = require('./blockAssertionError');
const BlockchainAssertionError = require('./blockchainAssertionError');
const CryptoUtil = require('../util/cryptoUtil');
const CryptoEdDSAUtil = require('../util/cryptoEdDSAUtil');
const Config = require('../config');

// Database settings
const BLOCKCHAIN_FILE = 'blocks.json';
const TRANSACTIONS_FILE = 'transactions.json';

class Blockchain {
    constructor(dbName) {
        this.blocksDb = new Db('data/' + dbName + '/' + BLOCKCHAIN_FILE, new Blocks());
        this.transactionsDb = new Db('data/' + dbName + '/' + TRANSACTIONS_FILE, new Transactions());

        // INFO: In this implementation the database is a file and every time data is saved it rewrites the file, probably it should be a more robust database for performance reasons
        this.blocks = this.blocksDb.read(Blocks);
        this.transactions = this.transactionsDb.read(Transactions);

        // Some places uses the emitter to act after some data is changed
        this.emitter = new EventEmitter();
        this.init();
    }

    init() {
        // Create the genesis block if the blockchain is empty
        if (this.blocks.length == 0) {
            console.info('Blockchain empty, adding genesis block');
            this.blocks.push(Block.genesis);
            this.blocksDb.write(this.blocks);
        }

        // Remove transactions that are in the blockchain
        console.info('Removing transactions that are in the blockchain');
        R.forEach(this.removeBlockTransactionsFromTransactions.bind(this), this.blocks);
    }

    getAllBlocks() {
        return this.blocks;
    }

    getBlockByIndex(index) {
        return R.find(R.propEq('index', index), this.blocks);
    }

    getBlockByHash(hash) {
        return R.find(R.propEq('hash', hash), this.blocks);
    }

    getLastBlock() {
        return R.last(this.blocks);
    }

    getDifficulty(index) {        
        // Calculates the difficulty based on the index since the difficulty value increases every X blocks.
        return Config.pow.getDifficulty(this.blocks, index);        
    }

    getAllTransactions() {
        return this.transactions;
    }

    getTransactionById(id) {
        return R.find(R.propEq('id', id), this.transactions);
    }

    getTransactionFromBlocks(transactionId) {
        return R.find(R.compose(R.find(R.propEq('id', transactionId)), R.prop('transactions')), this.blocks);
    }

    getStudentIdByPublicKey(publicKey) {
        let registration = this.getRegistrationTransactionByPublicKey(publicKey);
        if (registration === null || registration === undefined) {
            return null;
        }
        return registration.data.studentId;
    }

    getRegistrationTransactionByPublicKeyInBlocks(publicKey, referenceBlockchain = this.blocks) {
        return R.compose(
            R.find(
                R.both(
                    R.propEq('type', 'registration'),
                    R.pathEq(['data', 'publicKey'], publicKey)
                )
            ),
            R.flatten,
            R.map(R.prop('transactions'))
        )(referenceBlockchain);
    }

    getRegistrationTransactionByPublicKey(publicKey) {
        let registration = R.compose(
            R.find(
                R.both(
                    R.propEq('type', 'registration'),
                    R.pathEq(['data', 'publicKey'], publicKey)
                )
            ),
            R.flatten,
            R.map(R.prop('transactions'))
        )(this.blocks);
        if (registration === null || registration === undefined) {
            for (let i = 0; i < this.transactions.length; i++) {
                if (this.transactions[i].type === 'registration' && this.transactions[i].data.publicKey === publicKey) {
                    return this.transactions[i];
                }
            }
            return null;
        }
        return registration;

    }

    getRegistrationTransactionByStudentIdInBlocks(studentId, referenceBlockchain = this.blocks) {
        return R.compose(
            R.find(
                R.both(
                    R.propEq('type', 'registration'),
                    R.pathEq(['data', 'studentId'], studentId)
                )
            ),
            R.flatten,
            R.map(R.prop('transactions'))
        )(referenceBlockchain);
    }

    getRegistrationTransactionByStudentId(studentId) {
        let registration = R.compose(
            R.find(
                R.both(
                    R.propEq('type', 'registration'),
                    R.pathEq(['data', 'studentId'], studentId)
                )
            ),
            R.flatten,
            R.map(R.prop('transactions'))
        )(this.blocks);
        if (registration === null || registration === undefined) {
            for (let i = 0; i < this.transactions.length; i++) {
                if (this.transactions[i].type === 'registration' && this.transactions[i].data.studentId === studentId) {
                    return this.transactions[i];
                }
            }
            return null;
        }
        return registration;
    }

    getCumulativeDifficulty(newBLocks) {
        let cumulativeDiff = 0;
        for (let i = 0; i < newBLocks.length; i++) {
            cumulativeDiff += (newBLocks[i].target+1) / Number.MAX_SAFE_INTEGER
        }
        return cumulativeDiff;
    }

    replaceChain(newBlockchain) {
        // It doesn't make sense to replace this blockchain by a smaller one
        if (this.getCumulativeDifficulty(newBlockchain) <= this.getCumulativeDifficulty(this.blocks)) {
            console.error('Blockchain difficulty is lower than the current blockchain');
            throw new BlockchainAssertionError('Blockchain difficulty is lower than the current blockchain');
        }


        // Find the common ancestor
        let commonAncestorIndex = -1;
        for (let i = 0; i < this.blocks.length; i++) {
            if (this.blocks[i].hash === newBlockchain[i].hash) {
                commonAncestorIndex = i;
            } else {
                break;
            }
        }

        if (commonAncestorIndex === -1) {
            console.error('No common ancestor found');
            throw new BlockchainAssertionError('No common ancestor found');
        }

        // Get the blocks that diverges from our blockchain
        let newBlocks = R.takeLast(newBlockchain.length - commonAncestorIndex - 1, newBlockchain);

        // Verify if the new blockchain is correct
        this.checkChain(this.blocks.concat(newBlocks));

        //Get the stale blocks
        let staleBlocks = this.blocks.slice(commonAncestorIndex + 1);
        console.debug(`Stale blocks: ${staleBlocks}`);

        // Revert to the common ancestor
        this.blocks = this.blocks.slice(0, commonAncestorIndex + 1);
        console.debug(`Reverted to block ${commonAncestorIndex}`);

        // Apply the new chain
        console.info('Received blockchain is valid. Replacing current blockchain with received blockchain');
        console.debug(`newBlocks length: ${newBlocks.length}`);

        // Add each new block to the blockchain
        R.forEach((block) => {
            console.debug(`Adding block: ${JSON.stringify(block)}`);
            this.addBlock(block, false);
        }, newBlocks);

        this.addStaleBlockTransactionsToPool(staleBlocks);

        this.emitter.emit('blockchainReplaced', newBlocks);
    }

    checkChain(blockchainToValidate) {
        // Check if the genesis block is the same
        if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(Block.genesis)) {
            console.error('Genesis blocks aren\'t the same');
            throw new BlockchainAssertionError('Genesis blocks aren\'t the same');
        }

        // Compare every block to the previous one (it skips the first one, because it was verified before)
        try {
            for (let i = 1; i < blockchainToValidate.length; i++) {
                this.checkBlock(blockchainToValidate[i], blockchainToValidate[i - 1], blockchainToValidate.slice(0, i));
            }
        } catch (ex) {
            console.error('Invalid block sequence');
            throw new BlockchainAssertionError('Invalid block sequence', null, ex);
        }
        return true;
    }

    addBlock(newBlock, emit = true) {
        // It only adds the block if it's valid (we need to compare to the previous one)
        if (this.checkBlock(newBlock, this.getLastBlock())) {
            this.blocks.push(newBlock);
            this.blocksDb.write(this.blocks);

            // After adding the block it removes the transactions of this block from the list of pending transactions
            this.removeBlockTransactionsFromTransactions(newBlock);

            console.info(`Block added: ${newBlock.hash}`);
            console.debug(`Block added: ${JSON.stringify(newBlock)}`);
            if (emit) this.emitter.emit('blockAdded', newBlock);

            return newBlock;
        }
    }

    addTransaction(newTransaction, emit = true) {
        // It only adds the transaction if it's valid
        if (this.checkTransaction(newTransaction, this.blocks)) {
            this.transactions.push(newTransaction);
            this.transactionsDb.write(this.transactions);

            console.info(`Transaction added: ${newTransaction.id}`);
            console.debug(`Transaction added: ${JSON.stringify(newTransaction)}`);
            if (emit) this.emitter.emit('transactionAdded', newTransaction);

            return newTransaction;
        }
    }

    removeBlockTransactionsFromTransactions(newBlock) {
        this.transactions = R.reject((transaction) => { return R.find(R.propEq('id', transaction.id), newBlock.transactions); }, this.transactions);
        this.transactionsDb.write(this.transactions);
    }

    addStaleBlockTransactionsToPool(staleBlocks) {
        R.forEach((block) => {
            R.forEach((transaction) => {
                if (transaction.type === 'regular' && !R.find(R.propEq('id', transaction.id), this.transactions)) {
                    // Verify if all input transactions exist in the blockchain
                    let noInputsExist = R.all((txInput) => {
                        return R.all((block) => {
                            return R.none(R.propEq('id', txInput.transaction), block.transactions);
                        }, this.blocks);
                    }, transaction.data.inputs);
                    if (noInputsExist) {
                        console.error(`Not all inputs exist for transaction '${transaction.id}'`);
                        throw new TransactionAssertionError(`Not all inputs exist for transaction '${transaction.id}'`, transaction.data.inputs);
                    }
                    console.debug(`Adding transaction to pool: ${transaction.id}`);
                    this.addTransaction(transaction, true);
                }
            }, block.transactions);
            }, staleBlocks);
    }

    checkBlock(newBlock, previousBlock, referenceBlockchain = this.blocks) {
        const blockHash = newBlock.toHash();

        if (previousBlock.index + 1 !== newBlock.index) { // Check if the block is the last one
            console.error(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
            throw new BlockAssertionError(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
        } else if (previousBlock.hash !== newBlock.previousHash) { // Check if the previous block is correct
            console.error(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
            throw new BlockAssertionError(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
        } else if (blockHash !== newBlock.hash) { // Check if the hash is correct
            console.error(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
            throw new BlockAssertionError(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
        } else if (newBlock.getDifficulty() >= newBlock.getTarget()) { // If the difficulty level of the proof-of-work challenge is correct
            console.error(`Invalid proof-of-work difficulty: expected '${newBlock.getDifficulty()}' to be smaller than '${this.getDifficulty(newBlock.index)}'`);
            throw new BlockAssertionError(`Invalid proof-of-work difficulty: expected '${newBlock.getDifficulty()}' be smaller than '${this.getDifficulty()}'`);
        }

        // INFO: Here it would need to check if the block follows some expectation regarging the minimal number of transactions, value or data size to avoid empty blocks being mined.

        // For each transaction in this block, check if it is valid
        console.debug(`referenceBlockchain: ${JSON.stringify(referenceBlockchain)}`);
        // R.forEach(this.checkTransaction.bind(this), newBlock.transactions, referenceBlockchain);
        for (let i = 0; i < newBlock.transactions.length; i++) {
            this.checkTransaction(newBlock.transactions[i], referenceBlockchain);
        }

        // Check if the sum of output transactions are equal the sum of input transactions + MINING_REWARD (representing the reward for the block miner)
        let sumOfInputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('inputs'), R.prop('data')), newBlock.transactions))) + Config.MINING_REWARD;
        let sumOfOutputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('outputs'), R.prop('data')), newBlock.transactions)));

        let isInputsAmountGreaterOrEqualThanOutputsAmount = R.gte(sumOfInputsAmount, sumOfOutputsAmount);

        if (!isInputsAmountGreaterOrEqualThanOutputsAmount) {
            console.error(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`);
            throw new BlockAssertionError(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`, { sumOfInputsAmount, sumOfOutputsAmount });
        }

        // Check if there is double spending
        let listOfTransactionIndexInputs = R.flatten(R.map(R.compose(R.map(R.compose(R.join('|'), R.props(['transaction', 'index']))), R.prop('inputs'), R.prop('data')), newBlock.transactions));
        let doubleSpendingList = R.filter((x) => x >= 2, R.map(R.length, R.groupBy(x => x)(listOfTransactionIndexInputs)));

        if (R.keys(doubleSpendingList).length) {
            console.error(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
            throw new BlockAssertionError(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
        }

        // Check if there is only 1 fee transaction and 1 reward transaction;
        let transactionsByType = R.countBy(R.prop('type'), newBlock.transactions);
        if (transactionsByType.fee && transactionsByType.fee > 1) {
            console.error(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
            throw new BlockAssertionError(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
        }

        if (transactionsByType.reward && transactionsByType.reward > 1) {
            console.error(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
            throw new BlockAssertionError(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
        }

        return true;
    }

    checkTransaction(transaction, referenceBlockchain = this.blocks) {

        // Check the transaction
        transaction.check(transaction);

        console.debug(`Checking transaction: ${transaction.id}`);
        console.debug(`referenceBlockchain: ${JSON.stringify(referenceBlockchain)}`);

        // Verify if the transaction isn't already in the blockchain
        let isNotInBlockchain = R.all((block) => {
            return R.none(R.propEq('id', transaction.id), block.transactions);
        }, referenceBlockchain);

        if (!isNotInBlockchain) {
            console.error(`Transaction '${transaction.id}' is already in the blockchain`);
            throw new TransactionAssertionError(`Transaction '${transaction.id}' is already in the blockchain`, transaction);
        }

        // Verify if all input transactions are unspent in the blockchain
        let isInputTransactionsUnspent = R.all(R.equals(false), R.flatten(R.map((txInput) => {
            return R.map(
                R.pipe(
                    R.prop('transactions'),
                    R.map(R.pipe(
                        R.path(['data', 'inputs']),
                        R.contains({ transaction: txInput.transaction, index: txInput.index })
                    ))
                ), referenceBlockchain);
        }, transaction.data.inputs)));

        if (!isInputTransactionsUnspent) {
            console.error(`Not all inputs are unspent for transaction '${transaction.id}'`);
            throw new TransactionAssertionError(`Not all inputs are unspent for transaction '${transaction.id}'`, transaction.data.inputs);
        }

        if (transaction.type === 'registration') {
            let registrationId = this.getRegistrationTransactionByStudentIdInBlocks(transaction.data.studentId, referenceBlockchain);
            if (registrationId) {
                console.error(`Student id '${transaction.data.studentId}' already registered`);
                throw new TransactionAssertionError(`Student id '${transaction.data.studentId}' already registered`, transaction.data.studentId);
            }
            let registrationPublicKey = this.getRegistrationTransactionByPublicKeyInBlocks(transaction.data.publicKey, referenceBlockchain);
            if (registrationPublicKey) {
                console.error(`Public key '${transaction.data.publicKey}' already registered`);
                throw new TransactionAssertionError(`Public key '${transaction.data.publicKey}' already registered`, transaction.data.publicKey);
            }
        }

        if (transaction.type === 'attendance') {
            // Check if the signature of the transaction is correct
            let registration = this.getRegistrationTransactionByStudentId(transaction.data.studentId);
            if (!registration) {
                console.error(`No registration found for student id '${transaction.data.studentId}'`);
                throw new TransactionAssertionError(`No registration found for student id '${transaction.data.studentId}'`, transaction.data.studentId);
            }
            let regHash = CryptoUtil.hash({
                studentId: transaction.data.studentId,
                eventId: transaction.data.eventId,
                timeStamp: transaction.data.timeStamp
            });
            console.info(`registration: ${JSON.stringify(registration)}`);
            let isValidSignature = CryptoEdDSAUtil.verifySignature(registration.data.publicKey, transaction.data.signature, regHash);

            if (!isValidSignature) {
                console.error(`Invalid transaction registration signature '${JSON.stringify(transaction.data)}'`);
                throw new TransactionAssertionError(`Invalid transaction registration signature }'`);
            }
        }

        return true;
    }

    getAttendanceListById(studentId) {
        let registration = this.getRegistrationTransactionByStudentId(studentId);
        if (registration === null || registration === undefined) {
            console.error(`No registration found for student id '${studentId}'`);
            throw new ArgumentError(`No registration found for student id '${studentId}'`);
        }
        return this.getAttendanceListByAddress(registration.data.publicKey);
    }

    getAttendanceListByAddress(address) {
        const selectAtts = (transaction) => {
            R.forEach((tx) => {
                if (address && tx.type === 'attendance' && tx.data.inputs[0].address === address){
                    console.debug(`tx.type: ${tx.type}`);
                    console.debug(`tx.data.inputs[0].address: ${tx.data.inputs[0].address}`);
                    attendanceList.push({
                        transaction: tx.id,
                        studentId: tx.data.studentId,
                        eventId: tx.data.eventId,
                        timeStamp: tx.data.timeStamp
                    });
                }
            }, transaction);
        }

        let attendanceList = [];
        R.forEach(R.pipe(R.prop('transactions'), selectAtts), this.blocks);
        selectAtts(this.transactions);

        return attendanceList;
    }

    getAttendanceListByTime(fromTime, toTime) {
        const selectAtts = (transaction) => {
            R.forEach((tx) => {
                if (tx.type === 'attendance' && tx.data.timeStamp >= fromTime && tx.data.timeStamp <= toTime){
                    console.debug(`tx.type: ${tx.type}`);
                    console.debug(`tx.data.inputs[0].address: ${tx.data.inputs[0].address}`);
                    attendanceList.push({
                        transaction: tx.id,
                        studentId: tx.data.studentId,
                        eventId: tx.data.eventId,
                        timeStamp: tx.data.timeStamp
                    });
                }
            }, transaction);
        }

        let attendanceList = [];
        R.forEach(R.pipe(R.prop('transactions'), selectAtts), this.blocks);
        selectAtts(this.transactions);

        return attendanceList;
    }

    getAttendanceListForIdByTime(studentId, fromTime, toTime) {
        let tempAttendanceList = this.getAttendanceListById(studentId);
        let attendanceListByTime = [];
        R.forEach((attendance) => {
            if (attendance.timeStamp >= fromTime && attendance.timeStamp <= toTime) {
                attendanceListByTime.push(attendance);
            }
        }, tempAttendanceList);
        return attendanceListByTime;
    }

    getAttendanceListByEventId(eventId) {
        const selectAtts = (transaction) => {
            R.forEach((tx) => {
                if (eventId && tx.type === 'attendance' && tx.data.eventId === eventId){
                    console.debug(`tx.type: ${tx.type}`);
                    console.debug(`tx.data.eventId: ${tx.data.eventId}`);
                    attendanceList.push({
                        transaction: tx.id,
                        studentId: tx.data.studentId,
                        eventId: tx.data.eventId,
                        timeStamp: tx.data.timeStamp
                    });
                }
            }, transaction);
        }

        let attendanceList = [];
        R.forEach(R.pipe(R.prop('transactions'), selectAtts), this.blocks);
        selectAtts(this.transactions);

        return attendanceList;
    }

    getUnspentTransactionsForAddress(address) {
        const selectTxs = (transaction) => {
            let index = 0;
            // Create a list of all transactions outputs found for an address (or all).
            R.forEach((txOutput) => {
                if (address && txOutput.address == address) {
                    txOutputs.push({
                        transaction: transaction.id,
                        index: index,
                        amount: txOutput.amount,
                        address: txOutput.address
                    });
                }
                index++;
            }, transaction.data.outputs);

            // Create a list of all transactions inputs found for an address (or all).            
            R.forEach((txInput) => {
                if (address && txInput.address != address) return;

                txInputs.push({
                    transaction: txInput.transaction,
                    index: txInput.index,
                    amount: txInput.amount,
                    address: txInput.address
                });
            }, transaction.data.inputs);
        };

        // Considers both transactions in block and unconfirmed transactions (enabling transaction chain)
        let txOutputs = [];
        let txInputs = [];
        R.forEach(R.pipe(R.prop('transactions'), R.forEach(selectTxs)), this.blocks);
        R.forEach(selectTxs, this.transactions);

        // Cross both lists and find transactions outputs without a corresponding transaction input
        let unspentTransactionOutput = [];
        R.forEach((txOutput) => {
            if (!R.any((txInput) => txInput.transaction == txOutput.transaction && txInput.index == txOutput.index, txInputs)) {
                unspentTransactionOutput.push(txOutput);
            }
        }, txOutputs);

        return unspentTransactionOutput;
    }
}

module.exports = Blockchain;
