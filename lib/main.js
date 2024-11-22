const Blockchain = require('./blockchain');
const Operator = require('./operator');
const Miner = require('./miner');
const Node = require('./node');
const Block = require('./blockchain/block');

const blockchain = new Blockchain("3");
const miner = new Miner(blockchain, 6);
// let diff = blockchain.getDifficulty(0);
// console.log(diff);
// let blocks = blockchain.getAllBlocks();
// console.log(blocks);


miner.mine()
    .then((newBlock) => {
        newBlock = Block.fromJson(newBlock);
        blockchain.addBlock(newBlock);
        console.log(newBlock);
        // console.log(blockchain.getDifficulty());
    })
