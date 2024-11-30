const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const swaggerUi = require('swagger-ui-express');
const R = require('ramda');
const path = require('path');
const swaggerDocument = require('./swagger.json');
const Block = require('../blockchain/block');
const Transaction = require('../blockchain/transaction');
const TransactionAssertionError = require('../blockchain/transactionAssertionError');
const BlockAssertionError = require('../blockchain/blockAssertionError');
const HTTPError = require('./httpError');
const ArgumentError = require('../util/argumentError');
const CryptoUtil = require('../util/cryptoUtil');
const timeago = require('timeago.js');
const { setMaxIdleHTTPParsers } = require('http');

class HttpServer {
    constructor(node, blockchain, operator, miner) {
        this.app = express();

        const projectWallet = (wallet) => {
            return {
                id: wallet.id,
                addresses: R.map((keyPair) => {
                    return keyPair.publicKey;
                }, wallet.keyPairs)
            };
        };

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.use(session({
            secret: 'my secret',
            resave: false,
            saveUninitialized: true,
            cookie: { secure: false }
        }));

        this.app.set('view engine', 'pug');
        this.app.set('views', path.join(__dirname, 'views'));
        this.app.locals.formatters = {
            time: (rawTime) => {
                const timeInMS = new Date(rawTime * 1000);
                return `${timeInMS.toLocaleString()} - ${timeago().format(timeInMS)}`;
            },
            hash: (hashString) => {
                return hashString != '0' ? `${hashString.substr(0, 5)}...${hashString.substr(hashString.length - 5, 5)}` : '<empty>';
            },
            amount: (amount) => amount.toLocaleString()
        };
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

        this.app.get('/test', (req, res) => {
            res.render('test');
        });

        this.app.get('/', (req, res) => {
            let wallets = operator.getWallets();
            if (wallets === null || wallets.length === 0) {
                return res.redirect('/signup');
            }
            return res.redirect('/login');
        });

        this.app.get('/login', (req, res) => {
            let wallets = operator.getWallets();
            if (wallets === null || wallets.length === 0) {
                return res.redirect('/signup');
            }
            return res.render('login');
        });

        // Handle login form submission
        this.app.post('/login', (req, res) => {
            const { password } = req.body;
            let wallets = operator.getWallets();
            if (wallets === null || wallets.length === 0) {
                return res.redirect('/signup');
            }
            
            let walletFound = wallets[0];

            if (CryptoUtil.hash(password) !== walletFound.passwordHash) {
                return res.render('login', { error: 'Invalid password'});
            }

            req.session.walletId = walletFound.id;

            return res.redirect(`/home`);
        });

        // New route for sign-up page
        this.app.get('/signup', (req, res) => {
            let wallets = operator.getWallets();
            if (wallets !== null && wallets.length > 0) {
                return res.redirect('/login');
            }
            return res.render('signup');
        });

        // Handle sign-up form submission
        this.app.post('/signup', (req, res) => {
            const { password } = req.body;

            if (R.match(/\w+/g, password).length <= 4) {
                return res.render('signup', { error: 'Password must contain more than 4 words'});
            }

            let newWallet = operator.createWalletFromPassword(password);

            let projectedWallet = projectWallet(newWallet);
            let walletId = newWallet.id;
            req.session.walletId = walletId;
            console.debug(`New wallet created: ${projectedWallet}`);
            let newAddress = operator.generateAddressForWallet(walletId);
            return res.redirect(`/home`);
        });

        this.app.get('/home', (req, res) => {
            if (!req.session.walletId) {
                return res.redirect('/');
            }
            const walletId = req.session.walletId;
            let walletFound = operator.getWalletById(walletId);
            if (walletFound == null) {
                return res.render('signup', { error: 'Wallet not found or created' });
            }
            
            let user = blockchain.getStudentIdByPublicKey(walletFound.getAddresses()[0]);
            let addressBalance = operator.getBalanceForAddressHome(walletFound.getAddresses()[0]);
            addressBalance = addressBalance / 1000000000;
            return res.render('home', { walletId: walletFound.id, address: walletFound.getAddresses()[0], balance: addressBalance, user: user });
        });

        this.app.post('/take-attendance', (req, res) => {
            console.debug(`take-attendance`);
            if (!req.session.walletId) {
                return res.redirect('/login');
            }
            const { studentId: studentId, eventId } = req.body;
            console.debug(`studentId: ${studentId}, eventId: ${eventId}`);
            const walletId = req.session.walletId;
            let walletFound = operator.getWalletById(walletId);
            const publicKey = walletFound.getAddresses()[0];
            let timeStamp = new Date().getTime() / 1000;
            let balance = operator.getBalanceForAddressHome(publicKey) / 1000000000;
            let user = blockchain.getStudentIdByPublicKey(walletFound.getAddresses()[0]);
            try {
                let newAttendance = operator.createAttendance(walletId, publicKey, studentId, eventId, timeStamp);
                newAttendance.check();
                console.debug(`attendance checked`);
                let t = Transaction.fromJson(newAttendance);
                console.debug(`attendance: ${JSON.stringify(t)}`);
                let attendanceCreated = blockchain.addTransaction(Transaction.fromJson(newAttendance));
                res.render('home', { notification: 'Attendance Taken Successfully', walletId: walletId, address: publicKey, balance: balance, user: user });
            } catch (ex) {
                res.render('home', { error: ex.message, walletId: walletId, address: publicKey, balance: balance, user: user });
            }

        });


        this.app.get('/query', (req, res) => {
            let attendanceList = blockchain.getAttendanceListById("21100052d");
            res.render('query', { attendanceList: attendanceList });
        });


        this.app.post('/query', (req, res) => {
            let { date } = req.body;
            console.debug(`date: ${date}`);
            date = new Date(date).getTime() / 1000;
            console.debug(`date: ${date}`);
            res.render('query');
        });

        this.app.get('/query-attendance-by-time', (req, res) => {
            return res.render('query-time');
        });

        this.app.post('/query-attendance-by-time', (req, res) => {
            let { startDate, endDate  } = req.body;
            let startDateObj = new Date(startDate);
            let endDateObj = new Date(endDate);
            let startTimestamp = (startDateObj.getTime() + startDateObj.getTimezoneOffset()*60000) / 1000;
            let endTimestamp = (endDateObj.getTime() + endDateObj.getTimezoneOffset()*60000) / 1000;
            console.debug(`startDate: ${startDate}, endDate: ${endDate}`);
            console.debug(`startDate: ${startTimestamp}, endDate: ${endTimestamp}`);
            if (startTimestamp >= endTimestamp) {
                return res.render('query-time', { error: 'Start date must be before end date' });
            }
            let attendanceList = blockchain.getAttendanceListByTime(startTimestamp, endTimestamp);
            console.debug(`attendanceList: ${attendanceList}`);
            if (attendanceList.length === 0) {
                console.debug(`Attendance not found from ${startDate} to ${endDate}`);
                return res.render('query-time', { error: `Attendance not found from ${startDate} to ${endDate}` });
            }
           return res.render('query-time', { attendanceList });
        });

        this.app.get('/query-attendance-by-id', (req, res) => {
            return res.render('query-id');
        });

        this.app.post('/query-attendance-by-id', (req, res) => {
            let { studentId } = req.body;
            try{
                let attendanceList = blockchain.getAttendanceListById(studentId);
                if (attendanceList.length === 0) {
                    console.debug(`Attendance not found with student ID '${studentId}' from ${startDate} to ${endDate}`);
                    return res.render('query-id', { error: `Attendance not found with student ID '${studentId}'` });
                }
                return res.render('query-id', { attendanceList });
            } catch (ex) {
                return res.render('query-id', { error: ex.message });
            }
        });

        this.app.get('/query-attendance-by-event', (req, res) => {
            return res.render('query-event');
        });

        this.app.post('/query-attendance-by-event', (req, res) => {
            let { eventId } = req.body;
            try {
                let attendanceList = blockchain.getAttendanceListByEventId(eventId);
                if (attendanceList.length === 0) {
                    console.debug(`Attendance not found with event ID '${eventId}'`);
                    return res.render('query-event', { error: `Attendance not found with event ID '${eventId}'` });
                }
                return res.render('query-event', { attendanceList });
            } catch (ex) {
                return res.render('query-event', { error: ex.message });
            }
        });

        this.app.get('/mint', (req, res) => {
            return res.render('mint');
        });   

        this.app.post('/mint', (req, res, next) => {
            
            let { address } = req.body;
            miner.mine(address, address)
                .then((newBlock) => {
                    console.debug(`New block mined: ${JSON.stringify(newBlock)}`);
                    newBlock = Block.fromJson(newBlock);
                    console.debug(`converted to block`)
                    blockchain.addBlock(newBlock);
                    let blockMined = blockchain.getLastBlock();
                    return res.render('mint', { block: blockMined });
                })
                .catch((ex) => {
                    if (ex instanceof BlockAssertionError && ex.message.includes('Invalid index')) next(new HTTPError(409, 'A new block were added before we were able to mine one'), null, ex);
                    else next(ex);
                });
        });   

        this.app.get('/query-attendance-by-id-time', (req, res) => {
            return res.render('query-id-time');
        });

        this.app.post('/query-attendance-by-id-time', (req, res) => {
            let { studentId, startDate, endDate  } = req.body;
            let startDateObj = new Date(startDate);
            let endDateObj = new Date(endDate);
            let startTimestamp = (startDateObj.getTime() + startDateObj.getTimezoneOffset()*60000) / 1000;
            let endTimestamp = (endDateObj.getTime() + endDateObj.getTimezoneOffset()*60000) / 1000;
            console.debug(`studentId: ${studentId}, startDate: ${startDate}, endDate: ${endDate}`);
            console.debug(`studentId: ${studentId}, startDate: ${startTimestamp}, endDate: ${endTimestamp}`);
            if (startTimestamp >= endTimestamp) {
                return res.render('query-id-time', { error: 'Start date must be before end date' });
            }
            let attendanceList = blockchain.getAttendanceListForIdByTime(studentId, startTimestamp, endTimestamp);
            console.debug(`attendanceList: ${attendanceList}`);
            if (attendanceList.length === 0) {
                console.debug(`Attendance not found with student ID '${studentId}' from ${startDate} to ${endDate}`);
                return res.render('query-id-time', { error: `Attendance not found with student ID '${studentId}' from ${startDate} to ${endDate}` });
            }
           return res.render('query-id-time', { attendanceList });
        });


        this.app.post('/studentId-registration', (req, res) => {
            if (!req.session.walletId) {
                return res.redirect('/');
            }
            const { studentId } = req.body;
            console.debug(`studentId: ${studentId}`);
            const walletId = req.session.walletId;
            let walletFound = operator.getWalletById(walletId);
            const address = walletFound.getAddresses()[0];
            let balance = operator.getBalanceForAddressHome(address) / 1000000000;
            let user = blockchain.getStudentIdByPublicKey(walletFound.getAddresses()[0]);
            try {
                let newRegistration = operator.createRegistration(walletId, address, studentId);
                newRegistration.check();
                console.debug(`registration checked`);
                let registrationCreated = blockchain.addTransaction(Transaction.fromJson(newRegistration));
                res.render('home', { notification: 'Registration Successful', walletId: walletId, address: address, balance: balance, user });
            } catch (ex) {
                res.render('home', { error: ex.message, walletId: walletId, address: address, balance: balance, user: user });
            }
        });
    

        this.app.get('/blockchain', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('blockchain/index.pug', {
                    pageTitle: 'Blockchain',
                    blocks: blockchain.getAllBlocks()
                });
            else
                throw new HTTPError(400, 'Accept content not supported');
        });

        this.app.get('/blockchain/blocks', (req, res) => {
            res.status(200).send(blockchain.getAllBlocks());
        });

        this.app.get('/blockchain/blocks/latest', (req, res) => {
            let lastBlock = blockchain.getLastBlock();
            if (lastBlock == null) throw new HTTPError(404, 'Last block not found');

            res.status(200).send(lastBlock);
        });

        this.app.put('/blockchain/blocks/latest', (req, res) => {
            let requestBlock = Block.fromJson(req.body);
            let result = node.checkReceivedBlock(requestBlock);

            if (result == null) res.status(200).send('Requesting the blockchain to check.');
            else if (result) res.status(200).send(requestBlock);
            else throw new HTTPError(409, 'Blockchain is update.');
        });

        this.app.get('/blockchain/blocks/:hash([a-zA-Z0-9]{64})', (req, res) => {
            let blockFound = blockchain.getBlockByHash(req.params.hash);
            if (blockFound == null) throw new HTTPError(404, `Block not found with hash '${req.params.hash}'`);

            res.status(200).send(blockFound);
        });

        this.app.get('/blockchain/blocks/:index', (req, res) => {
            let blockFound = blockchain.getBlockByIndex(parseInt(req.params.index));
            if (blockFound == null) throw new HTTPError(404, `Block not found with index '${req.params.index}'`);

            res.status(200).send(blockFound);
        });

        this.app.get('/blockchain/blocks/transactions/:transactionId([a-zA-Z0-9]{64})', (req, res) => {
            let transactionFromBlock = blockchain.getTransactionFromBlocks(req.params.transactionId);
            if (transactionFromBlock == null) throw new HTTPError(404, `Transaction '${req.params.transactionId}' not found in any block`);

            res.status(200).send(transactionFromBlock);
        });

        this.app.get('/blockchain/transactions', (req, res) => {
            if (req.headers['accept'] && req.headers['accept'].includes('text/html'))
                res.render('blockchain/transactions/index.pug', {
                    pageTitle: 'Unconfirmed Transactions',
                    transactions: blockchain.getAllTransactions()
                });
            else
                res.status(200).send(blockchain.getAllTransactions());
        });

        this.app.post('/blockchain/transactions', (req, res) => {
            let requestTransaction = Transaction.fromJson(req.body);
            let transactionFound = blockchain.getTransactionById(requestTransaction.id);

            if (transactionFound != null) throw new HTTPError(409, `Transaction '${requestTransaction.id}' already exists`);

            try {
                let newTransaction = blockchain.addTransaction(requestTransaction);
                res.status(201).send(newTransaction);
            } catch (ex) {
                if (ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, requestTransaction, ex);
                else throw ex;
            }
        });

        this.app.get('/blockchain/transactions/unspent', (req, res) => {
            res.status(200).send(blockchain.getUnspentTransactionsForAddress(req.query.address));
        });

        this.app.get('/operator/wallets', (req, res) => {
            let wallets = operator.getWallets();

            let projectedWallets = R.map(projectWallet, wallets);

            res.status(200).send(projectedWallets);
        });

        this.app.post('/operator/wallets', (req, res) => {
            let password = req.body.password;
            if (R.match(/\w+/g, password).length <= 4) throw new HTTPError(400, 'Password must contain more than 4 words');

            let newWallet = operator.createWalletFromPassword(password);

            let projectedWallet = projectWallet(newWallet);

            res.status(201).send(projectedWallet);
        });

        this.app.get('/operator/wallets/:walletId', (req, res) => {
            let walletFound = operator.getWalletById(req.params.walletId);
            if (walletFound == null) throw new HTTPError(404, `Wallet not found with id '${req.params.walletId}'`);

            let projectedWallet = projectWallet(walletFound);

            res.status(200).send(projectedWallet);
        });

        this.app.post('/operator/wallets/:walletId/transactions', (req, res) => {
            let walletId = req.params.walletId;
            let password = req.headers.password;

            if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
            let passwordHash = CryptoUtil.hash(password);

            try {
                if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, `Invalid password for wallet '${walletId}'`);

                let newTransaction = operator.createTransaction(walletId, req.body.fromAddress, req.body.toAddress, req.body.amount, req.body['changeAddress'] || req.body.fromAddress);

                newTransaction.check();

                let transactionCreated = blockchain.addTransaction(Transaction.fromJson(newTransaction));
                res.status(201).send(transactionCreated);
            } catch (ex) {
                if (ex instanceof ArgumentError || ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.get('/operator/wallets/:walletId/addresses', (req, res) => {
            let walletId = req.params.walletId;
            try {
                let addresses = operator.getAddressesForWallet(walletId);
                res.status(200).send(addresses);
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.post('/operator/wallets/:walletId/addresses', (req, res) => {
            let walletId = req.params.walletId;
            let password = req.headers.password;

            if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
            let passwordHash = CryptoUtil.hash(password);

            try {
                if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, `Invalid password for wallet '${walletId}'`);

                let newAddress = operator.generateAddressForWallet(walletId);
                res.status(201).send({ address: newAddress });
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);
                else throw ex;
            }
        });

        this.app.get('/operator/:addressId/balance', (req, res) => {
            let addressId = req.params.addressId;

            try {
                let balance = operator.getBalanceForAddress(addressId);
                res.status(200).send({ balance: balance });
            } catch (ex) {
                if (ex instanceof ArgumentError) throw new HTTPError(404, ex.message, { addressId }, ex);
                else throw ex;
            }
        });

        this.app.get('/node/peers', (req, res) => {
            res.status(200).send(node.peers);
        });

        this.app.post('/node/peers', (req, res) => {
            let newPeer = node.connectToPeer(req.body);
            res.status(201).send(newPeer);
        });

        this.app.get('/node/transactions/:transactionId([a-zA-Z0-9]{64})/confirmations', (req, res) => {
            node.getConfirmations(req.params.transactionId)
                .then((confirmations) => {
                    res.status(200).send({ confirmations: confirmations });
                });
        });

        this.app.post('/miner/mine', (req, res, next) => {
            miner.mine(req.body.rewardAddress, req.body['feeAddress'] || req.body.rewardAddress)
                .then((newBlock) => {
                    console.debug(`New block mined: ${JSON.stringify(newBlock)}`);
                    newBlock = Block.fromJson(newBlock);
                    console.debug(`converted to block`)
                    blockchain.addBlock(newBlock);
                    res.status(201).send(newBlock);
                })
                .catch((ex) => {
                    if (ex instanceof BlockAssertionError && ex.message.includes('Invalid index')) next(new HTTPError(409, 'A new block were added before we were able to mine one'), null, ex);
                    else next(ex);
                });
        });

        this.app.use(function (err, req, res, next) {  // eslint-disable-line no-unused-vars
            if (err instanceof HTTPError) res.status(err.status);
            else res.status(500);
            res.send(err.message + (err.cause ? ' - ' + err.cause.message : ''));
        });
    }

    listen(host, port) {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, host, (err) => {
                if (err) reject(err);
                console.info(`Listening http on port: ${this.server.address().port}, to access the API documentation go to http://${host}:${this.server.address().port}/api-docs/`);
                resolve(this);
            });
        });
    }

    stop() {
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                console.info('Closing http');
                resolve(this);
            });
        });
    }
}

module.exports = HttpServer;