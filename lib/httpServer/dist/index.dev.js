"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var express = require('express');

var bodyParser = require('body-parser');

var session = require('express-session');

var swaggerUi = require('swagger-ui-express');

var R = require('ramda');

var path = require('path');

var swaggerDocument = require('./swagger.json');

var Block = require('../blockchain/block');

var Transaction = require('../blockchain/transaction');

var TransactionAssertionError = require('../blockchain/transactionAssertionError');

var BlockAssertionError = require('../blockchain/blockAssertionError');

var HTTPError = require('./httpError');

var ArgumentError = require('../util/argumentError');

var CryptoUtil = require('../util/cryptoUtil');

var timeago = require('timeago.js');

var HttpServer =
/*#__PURE__*/
function () {
  function HttpServer(node, blockchain, operator, miner) {
    _classCallCheck(this, HttpServer);

    this.app = express();

    var projectWallet = function projectWallet(wallet) {
      return {
        id: wallet.id,
        addresses: R.map(function (keyPair) {
          return keyPair.publicKey;
        }, wallet.keyPairs)
      };
    };

    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({
      extended: true
    }));
    this.app.use(session({
      secret: 'my secret',
      resave: false,
      saveUninitialized: true,
      cookie: {
        secure: false,
        maxAge: 300000
      }
    }));
    this.app.set('view engine', 'pug');
    this.app.set('views', path.join(__dirname, 'views'));
    this.app.locals.formatters = {
      time: function time(rawTime) {
        var timeInMS = new Date(rawTime * 1000);
        return "".concat(timeInMS.toLocaleString(), " - ").concat(timeago().format(timeInMS));
      },
      hash: function hash(hashString) {
        return hashString != '0' ? "".concat(hashString.substr(0, 5), "...").concat(hashString.substr(hashString.length - 5, 5)) : '<empty>';
      },
      amount: function amount(_amount) {
        return _amount.toLocaleString();
      }
    };
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    this.app.get('/', function (req, res) {
      res.render('index');
    });
    this.app.get('/login', function (req, res) {
      res.render('login');
    }); // Handle login form submission

    this.app.post('/login', function (req, res) {
      var password = req.body.password;
      var wallets = operator.getWallets();
      var walletFound = operator.getWalletById(walletId);

      if (walletFound == null) {
        return res.render('login', {
          error: 'Wallet ID not found'
        });
      }

      if (CryptoUtil.hash(password) !== walletFound.passwordHash) {
        return res.render('login', {
          error: 'Invalid password'
        });
      }

      req.session.walletId = walletId;
      res.redirect("/wallet");
    }); // New route for sign-up page

    this.app.get('/signup', function (req, res) {
      res.render('signup');
    }); // Handle sign-up form submission

    this.app.post('/signup', function (req, res) {
      var password = req.body.password;

      if (R.match(/\w+/g, password).length <= 4) {
        return res.render('signup', {
          error: 'Password must contain more than 4 words'
        });
      }

      var newWallet = operator.createWalletFromPassword(password);
      var projectedWallet = projectWallet(newWallet);
      var walletId = newWallet.id;
      console.debug("New wallet created: ".concat(projectedWallet)); // res.status(200).send(projectedWallet);

      res.render('signup-success', {
        walletId: walletId
      });
    });
    this.app.get('/wallet', function (req, res) {
      if (!req.session.walletId) {
        return res.redirect('/login');
      }

      var walletId = req.session.walletId;
      var walletFound = operator.getWalletById(walletId);

      if (walletFound == null) {
        return res.render('wallet', {
          error: 'Wallet not found'
        });
      } // let projectedWallet = projectWallet(walletFound);


      res.render('wallet', {
        id: walletFound.id,
        addresses: walletFound.getAddresses()
      });
    });
    this.app.post('/wallet/create-address', function (req, res) {
      if (!req.session.walletId) {
        return res.redirect('/login');
      }

      var walletId = req.session.walletId;
      var walletFound = operator.getWalletById(walletId);

      if (walletFound == null) {
        return res.render('wallet', {
          error: 'Wallet not found'
        });
      }

      var newAddress = operator.generateAddressForWallet(walletId);
      res.render('wallet', {
        id: walletFound.id,
        addresses: walletFound.getAddresses()
      });
    });
    this.app.post('/wallet/address', function (req, res) {
      if (!req.session.walletId) {
        return res.redirect('/login');
      }

      var address = req.body.address;
      req.session.address = address;
      res.render('address', {
        address: address
      });
    });
    this.app.get('/wallet/attendance', function (req, res) {
      var transactionFromBlock = blockchain.getRegistrationTransactionByStudentId('21100052d');
      if (transactionFromBlock == null) throw new HTTPError(404, "Transaction not found with student ID '21100052d'");
      res.status(200).send(transactionFromBlock);
    });
    this.app.post('/wallet/address/attendance', function (req, res) {
      if (!req.session.walletId || !req.session.address) {
        return res.redirect('/login');
      }

      var _req$body = req.body,
          studentId = _req$body.studentId,
          eventId = _req$body.eventId;
      console.debug("studentId: ".concat(studentId, ", eventId: ").concat(eventId));
      var walletId = req.session.walletId;
      var publicKey = req.session.address;
      var timeStamp = new Date().getTime() / 1000; // let registrastion = blockchain.getRegistrationTransactionByStudentId(studentId);
      // if (registrastion == null) {
      //     let errorMsg = `Registration not found with student ID '${studentId}'`;
      //     return res.render('address', { error: errorMsg });
      // }
      // let publicKey = registrastion.data.publicKey;

      try {
        var newAttendance = operator.createAttendance(walletId, publicKey, studentId, eventId, timeStamp);
        newAttendance.check();
        console.debug("attendance checked");
        var t = Transaction.fromJson(newAttendance);
        console.debug("attendance: ".concat(JSON.stringify(t)));
        var attendanceCreated = blockchain.addTransaction(Transaction.fromJson(newAttendance));
        res.render('address', {
          attSuccess: 'Attendance Taken Successfully'
        });
      } catch (ex) {
        res.render('address', {
          attError: ex.message
        });
      }
    });
    this.app.get('/query-attendance-list', function (req, res) {
      var attendanceList = blockchain.getAttendanceListForId('21100052d');
      if (attendanceList == null) throw new HTTPError(404, "Attendance list not found with student ID '21100052d'");
      res.status(200).send(attendanceList);
    });
    this.app.post('/wallet/address/registration', function (req, res) {
      if (!req.session.walletId || !req.session.address) {
        return res.redirect('/login');
      }

      var studentId = req.body.studentId;
      console.debug("studentId: ".concat(studentId));
      var walletId = req.session.walletId;
      var address = req.session.address;
      var newRegistration = operator.createRegistration(walletId, address, studentId);
      newRegistration.check();
      console.debug("registration checked");
      var registrationCreated = blockchain.addTransaction(Transaction.fromJson(newRegistration));
      res.render('address', {
        regSuccess: 'Registration successful'
      });
    });
    this.app.get('/blockchain', function (req, res) {
      if (req.headers['accept'] && req.headers['accept'].includes('text/html')) res.render('blockchain/index.pug', {
        pageTitle: 'Blockchain',
        blocks: blockchain.getAllBlocks()
      });else throw new HTTPError(400, 'Accept content not supported');
    });
    this.app.get('/blockchain/blocks', function (req, res) {
      res.status(200).send(blockchain.getAllBlocks());
    });
    this.app.get('/blockchain/blocks/latest', function (req, res) {
      var lastBlock = blockchain.getLastBlock();
      if (lastBlock == null) throw new HTTPError(404, 'Last block not found');
      res.status(200).send(lastBlock);
    });
    this.app.put('/blockchain/blocks/latest', function (req, res) {
      var requestBlock = Block.fromJson(req.body);
      var result = node.checkReceivedBlock(requestBlock);
      if (result == null) res.status(200).send('Requesting the blockchain to check.');else if (result) res.status(200).send(requestBlock);else throw new HTTPError(409, 'Blockchain is update.');
    });
    this.app.get('/blockchain/blocks/:hash([a-zA-Z0-9]{64})', function (req, res) {
      var blockFound = blockchain.getBlockByHash(req.params.hash);
      if (blockFound == null) throw new HTTPError(404, "Block not found with hash '".concat(req.params.hash, "'"));
      res.status(200).send(blockFound);
    });
    this.app.get('/blockchain/blocks/:index', function (req, res) {
      var blockFound = blockchain.getBlockByIndex(parseInt(req.params.index));
      if (blockFound == null) throw new HTTPError(404, "Block not found with index '".concat(req.params.index, "'"));
      res.status(200).send(blockFound);
    });
    this.app.get('/blockchain/blocks/transactions/:transactionId([a-zA-Z0-9]{64})', function (req, res) {
      var transactionFromBlock = blockchain.getTransactionFromBlocks(req.params.transactionId);
      if (transactionFromBlock == null) throw new HTTPError(404, "Transaction '".concat(req.params.transactionId, "' not found in any block"));
      res.status(200).send(transactionFromBlock);
    });
    this.app.get('/blockchain/transactions', function (req, res) {
      if (req.headers['accept'] && req.headers['accept'].includes('text/html')) res.render('blockchain/transactions/index.pug', {
        pageTitle: 'Unconfirmed Transactions',
        transactions: blockchain.getAllTransactions()
      });else res.status(200).send(blockchain.getAllTransactions());
    });
    this.app.post('/blockchain/transactions', function (req, res) {
      var requestTransaction = Transaction.fromJson(req.body);
      var transactionFound = blockchain.getTransactionById(requestTransaction.id);
      if (transactionFound != null) throw new HTTPError(409, "Transaction '".concat(requestTransaction.id, "' already exists"));

      try {
        var newTransaction = blockchain.addTransaction(requestTransaction);
        res.status(201).send(newTransaction);
      } catch (ex) {
        if (ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, requestTransaction, ex);else throw ex;
      }
    });
    this.app.get('/blockchain/transactions/unspent', function (req, res) {
      res.status(200).send(blockchain.getUnspentTransactionsForAddress(req.query.address));
    });
    this.app.get('/operator/wallets', function (req, res) {
      var wallets = operator.getWallets();
      var projectedWallets = R.map(projectWallet, wallets);
      res.status(200).send(projectedWallets);
    });
    this.app.post('/operator/wallets', function (req, res) {
      var password = req.body.password;
      if (R.match(/\w+/g, password).length <= 4) throw new HTTPError(400, 'Password must contain more than 4 words');
      var newWallet = operator.createWalletFromPassword(password);
      var projectedWallet = projectWallet(newWallet);
      res.status(201).send(projectedWallet);
    });
    this.app.get('/operator/wallets/:walletId', function (req, res) {
      var walletFound = operator.getWalletById(req.params.walletId);
      if (walletFound == null) throw new HTTPError(404, "Wallet not found with id '".concat(req.params.walletId, "'"));
      var projectedWallet = projectWallet(walletFound);
      res.status(200).send(projectedWallet);
    });
    this.app.post('/operator/wallets/:walletId/transactions', function (req, res) {
      var walletId = req.params.walletId;
      var password = req.headers.password;
      if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
      var passwordHash = CryptoUtil.hash(password);

      try {
        if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, "Invalid password for wallet '".concat(walletId, "'"));
        var newTransaction = operator.createTransaction(walletId, req.body.fromAddress, req.body.toAddress, req.body.amount, req.body['changeAddress'] || req.body.fromAddress);
        newTransaction.check();
        var transactionCreated = blockchain.addTransaction(Transaction.fromJson(newTransaction));
        res.status(201).send(transactionCreated);
      } catch (ex) {
        if (ex instanceof ArgumentError || ex instanceof TransactionAssertionError) throw new HTTPError(400, ex.message, walletId, ex);else throw ex;
      }
    });
    this.app.get('/operator/wallets/:walletId/addresses', function (req, res) {
      var walletId = req.params.walletId;

      try {
        var addresses = operator.getAddressesForWallet(walletId);
        res.status(200).send(addresses);
      } catch (ex) {
        if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);else throw ex;
      }
    });
    this.app.post('/operator/wallets/:walletId/addresses', function (req, res) {
      var walletId = req.params.walletId;
      var password = req.headers.password;
      if (password == null) throw new HTTPError(401, 'Wallet\'s password is missing.');
      var passwordHash = CryptoUtil.hash(password);

      try {
        if (!operator.checkWalletPassword(walletId, passwordHash)) throw new HTTPError(403, "Invalid password for wallet '".concat(walletId, "'"));
        var newAddress = operator.generateAddressForWallet(walletId);
        res.status(201).send({
          address: newAddress
        });
      } catch (ex) {
        if (ex instanceof ArgumentError) throw new HTTPError(400, ex.message, walletId, ex);else throw ex;
      }
    });
    this.app.get('/operator/:addressId/balance', function (req, res) {
      var addressId = req.params.addressId;

      try {
        var balance = operator.getBalanceForAddress(addressId);
        res.status(200).send({
          balance: balance
        });
      } catch (ex) {
        if (ex instanceof ArgumentError) throw new HTTPError(404, ex.message, {
          addressId: addressId
        }, ex);else throw ex;
      }
    });
    this.app.get('/node/peers', function (req, res) {
      res.status(200).send(node.peers);
    });
    this.app.post('/node/peers', function (req, res) {
      var newPeer = node.connectToPeer(req.body);
      res.status(201).send(newPeer);
    });
    this.app.get('/node/transactions/:transactionId([a-zA-Z0-9]{64})/confirmations', function (req, res) {
      node.getConfirmations(req.params.transactionId).then(function (confirmations) {
        res.status(200).send({
          confirmations: confirmations
        });
      });
    });
    this.app.post('/miner/mine', function (req, res, next) {
      miner.mine(req.body.rewardAddress, req.body['feeAddress'] || req.body.rewardAddress).then(function (newBlock) {
        console.debug("New block mined: ".concat(JSON.stringify(newBlock)));
        newBlock = Block.fromJson(newBlock);
        console.debug("converted to block");
        blockchain.addBlock(newBlock);
        res.status(201).send(newBlock);
      })["catch"](function (ex) {
        if (ex instanceof BlockAssertionError && ex.message.includes('Invalid index')) next(new HTTPError(409, 'A new block were added before we were able to mine one'), null, ex);else next(ex);
      });
    });
    this.app.use(function (err, req, res, next) {
      // eslint-disable-line no-unused-vars
      if (err instanceof HTTPError) res.status(err.status);else res.status(500);
      res.send(err.message + (err.cause ? ' - ' + err.cause.message : ''));
    });
  }

  _createClass(HttpServer, [{
    key: "listen",
    value: function listen(host, port) {
      var _this = this;

      return new Promise(function (resolve, reject) {
        _this.server = _this.app.listen(port, host, function (err) {
          if (err) reject(err);
          console.info("Listening http on port: ".concat(_this.server.address().port, ", to access the API documentation go to http://").concat(host, ":").concat(_this.server.address().port, "/api-docs/"));
          resolve(_this);
        });
      });
    }
  }, {
    key: "stop",
    value: function stop() {
      var _this2 = this;

      return new Promise(function (resolve, reject) {
        _this2.server.close(function (err) {
          if (err) reject(err);
          console.info('Closing http');
          resolve(_this2);
        });
      });
    }
  }]);

  return HttpServer;
}();

module.exports = HttpServer;