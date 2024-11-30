const R = require('ramda');
const Wallets = require('./wallets');
const Wallet = require('./wallet');
const Transaction = require('../blockchain/transaction');
const TransactionBuilder = require('./transactionBuilder');
const Db = require('../util/db');
const ArgumentError = require('../util/argumentError');
const Config = require('../config');

const OPERATOR_FILE = 'wallets.json';

class Operator {
    constructor(dbName, blockchain) {
        this.db = new Db('data/' + dbName + '/' + OPERATOR_FILE, new Wallets());

        // INFO: In this implementation the database is a file and every time data is saved it rewrites the file, probably it should be a more robust database for performance reasons
        this.wallets = this.db.read(Wallets);
        this.blockchain = blockchain;
    }

    addWallet(wallet) {
        this.wallets.push(wallet);
        this.db.write(this.wallets);
        return wallet;
    }

    createWalletFromPassword(password) {
        let newWallet = Wallet.fromPassword(password);
        return this.addWallet(newWallet);
    }    

    checkWalletPassword(walletId, passwordHash) {
        let wallet = this.getWalletById(walletId);
        if (wallet == null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        return wallet.passwordHash == passwordHash;
    }

    getWallets() {
        return this.wallets;
    }

    getWalletById(walletId) {
        return R.find((wallet) => { return wallet.id == walletId; }, this.wallets);
    }

    generateAddressForWallet(walletId) {
        let wallet = this.getWalletById(walletId);
        if (wallet == null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        let address = wallet.generateAddress();
        this.db.write(this.wallets);
        return address;
    }

    getAddressesForWallet(walletId) {
        let wallet = this.getWalletById(walletId);
        if (wallet == null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        let addresses = wallet.getAddresses();
        return addresses;
    }    

    getBalanceForAddress(addressId) {        
        let utxo = this.blockchain.getUnspentTransactionsForAddress(addressId);

        if (utxo == null || utxo.length == 0) throw new ArgumentError(`No transactions found for address '${addressId}'`);
        // if (utxo == null || utxo.length == 0) return 0;
        return R.sum(R.map(R.prop('amount'), utxo));
    }

    getBalanceForAddressHome(addressId) {
        let utxo = this.blockchain.getUnspentTransactionsForAddress(addressId);

        if (utxo == null || utxo.length == 0) return 0;
        return R.sum(R.map(R.prop('amount'), utxo));
    }

    createAttendance(walletId, publicKey, studentId, eventId, timeStamp) {
        // fromAddressId is the same as publicKey
        // toAddressId is the same as publicKey
        // changeAddressId is the same as publicKey
        // amount is 0
        let utxo = this.blockchain.getUnspentTransactionsForAddress(publicKey);
        let wallet = this.getWalletById(walletId);

        if (wallet == null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        let secretKey = wallet.getSecretKeyByAddress(publicKey);

        if (secretKey == null) throw new ArgumentError(`Secret key not found with Wallet id '${walletId}' and address '${publicKey}'`);

        const amount = 0;

        let tx = new TransactionBuilder();
        tx.from(utxo);
        tx.to(publicKey, amount);
        tx.change(publicKey);
        tx.fee(Config.FEE_PER_TRANSACTION);
        tx.sign(secretKey);
        tx.toType('attendance');
        tx.toPublicKey(publicKey);
        tx.toStudentId(studentId);
        tx.toEventId(eventId);
        tx.toTimeStamp(timeStamp);

        return Transaction.fromJson(tx.build());
    }

    createRegistration(walletId, publicKey, studentId) {
        // fromAddressId is the same as publicKey
        // toAddressId is the same as publicKey
        // changeAddressId is the same as publicKey
        // amount is 0
        let utxo = this.blockchain.getUnspentTransactionsForAddress(publicKey);
        let wallet = this.getWalletById(walletId);

        if (wallet === null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        let secretKey = wallet.getSecretKeyByAddress(publicKey);

        if (secretKey === null) throw new ArgumentError(`Secret key not found with Wallet id '${walletId}' and address '${publicKey}'`);

        let registrationId = this.blockchain.getRegistrationTransactionByStudentId(studentId);
        console.debug(`registrationId: ${registrationId}`);
        if (registrationId) throw new ArgumentError(`Student id '${studentId}' already registered`);
        let registrationPublicKey = this.blockchain.getRegistrationTransactionByPublicKey(publicKey);
        if (registrationPublicKey) throw new ArgumentError(`Public key '${publicKey}' already registered`);

        const amount = 0;

        let tx = new TransactionBuilder();
        tx.from(utxo);
        tx.to(publicKey, amount);
        tx.change(publicKey);
        tx.fee(Config.FEE_PER_TRANSACTION);
        tx.sign(secretKey);
        tx.toType('registration');
        tx.toPublicKey(publicKey);
        tx.toStudentId(studentId);

        return Transaction.fromJson(tx.build());

    }

    createTransaction(walletId, fromAddressId, toAddressId, amount, changeAddressId) {
        let utxo = this.blockchain.getUnspentTransactionsForAddress(fromAddressId);
        let wallet = this.getWalletById(walletId);

        if (wallet == null) throw new ArgumentError(`Wallet not found with id '${walletId}'`);

        let secretKey = wallet.getSecretKeyByAddress(fromAddressId);

        if (secretKey == null) throw new ArgumentError(`Secret key not found with Wallet id '${walletId}' and address '${fromAddressId}'`);

        let tx = new TransactionBuilder();
        tx.from(utxo);
        tx.to(toAddressId, amount);
        tx.change(changeAddressId || fromAddressId);
        tx.fee(Config.FEE_PER_TRANSACTION);
        tx.sign(secretKey);        

        return Transaction.fromJson(tx.build());
    }
}

module.exports = Operator;