const R = require('ramda');
const CryptoUtil = require('../util/cryptoUtil');
const CryptoEdDSAUtil = require('../util/cryptoEdDSAUtil');
const ArgumentError = require('../util/argumentError');
const Transaction = require('../blockchain/transaction');

class TransactionBuilder {
    constructor() {
        this.listOfUTXO = null;
        this.outputAddresses = null;
        this.totalAmount = null;
        this.changeAddress = null;
        this.feeAmount = 0;
        this.secretKey = null;
        this.type = 'regular';
        this.publicKey = null;
        this.studentId = null;
        this.eventId = null;
        this.timeStamp = null;
    }

    from(listOfUTXO) {
        this.listOfUTXO = listOfUTXO;
        return this;
    }

    toPublicKey(publicKey) {
        this.publicKey = publicKey;
        return this;
    }

    toStudentId(studentId) {
        this.studentId = studentId;
        return this;
    }

    to(address, amount) {
        this.outputAddress = address;
        this.totalAmount = amount;
        return this;
    }

    change(changeAddress) {
        this.changeAddress = changeAddress;
        return this;
    }

    fee(amount) {
        this.feeAmount = amount;
        return this;
    }

    sign(secretKey) {
        this.secretKey = secretKey;
        return this;
    }

    toType(type) {
        this.type = type;
        return this;
    }

    toEventId(eventId) {
        this.eventId = eventId;
        return this;
    }

    toTimeStamp(timeStamp) {
        this.timeStamp = timeStamp;
        return this;
    }

    build() {
        // Check required information
        if (this.listOfUTXO == null) throw new ArgumentError('It\'s necessary to inform a list of unspent output transactions.');
        if (this.outputAddress == null) throw new ArgumentError('It\'s necessary to inform the destination address.');
        if (this.totalAmount == null) throw new ArgumentError('It\'s necessary to inform the transaction value.');

        // Calculates the change amount
        let totalAmountOfUTXO = R.sum(R.pluck('amount', this.listOfUTXO));
        let changeAmount = totalAmountOfUTXO - this.totalAmount - this.feeAmount;

        // For each transaction input, calculates the hash of the input and sign the data.
        let self = this;
        let inputs = R.map((utxo) => {
            let txiHash = CryptoUtil.hash({
                transaction: utxo.transaction,
                index: utxo.index,
                address: utxo.address
            });
            utxo.signature = CryptoEdDSAUtil.signHash(CryptoEdDSAUtil.generateKeyPairFromSecret(self.secretKey), txiHash);
            return utxo;
        }, this.listOfUTXO);

        let outputs = [];

        // Add target receiver
        outputs.push({
            amount: this.totalAmount,
            address: this.outputAddress
        });

        // Add change amount
        if (changeAmount > 0) {
            outputs.push({
                amount: changeAmount,
                address: this.changeAddress
            });
        } else {
            throw new ArgumentError('The sender does not have enough to pay for the transaction.');
        }        

        // The remaining value is the fee to be collected by the block's creator.
        
        if (this.type === 'registration') {
            let regHash = CryptoUtil.hash({
                publicKey: this.publicKey,
                studentId: this.studentId
            });
            let signature = CryptoEdDSAUtil.signHash(CryptoEdDSAUtil.generateKeyPairFromSecret(this.secretKey), regHash);
            return Transaction.fromJson({
                id: CryptoUtil.randomId(64),
                hash: null,
                type: 'registration',
                data: {
                    inputs: inputs,
                    outputs: outputs,
                    publicKey: this.publicKey,
                    studentId: this.studentId,
                    signature: signature
                }
            });}
        if (this.type === 'attendance') {
            let attHash = CryptoUtil.hash({
                studentId: this.studentId,
                eventId: this.eventId,
                timeStamp: this.timeStamp
            });
            let signature = CryptoEdDSAUtil.signHash(CryptoEdDSAUtil.generateKeyPairFromSecret(this.secretKey), attHash);
            return Transaction.fromJson({
                id: CryptoUtil.randomId(64),
                hash: null,
                type: 'attendance',
                data: {
                    inputs: inputs,
                    outputs: outputs,
                    publicKey: this.publicKey,
                    studentId: this.studentId,
                    eventId: this.eventId,
                    timeStamp: this.timeStamp,
                    signature: signature
                }
            });
        }

        return Transaction.fromJson({
            id: CryptoUtil.randomId(64),
            hash: null,
            type: this.type,
            data: {
                inputs: inputs,
                outputs: outputs
            }
        });
    }
}

module.exports = TransactionBuilder;