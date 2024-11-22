// Do not change these configurations after the blockchain is initialized
module.exports = {
    // INFO: The mining reward could decreases over time like bitcoin. See https://en.bitcoin.it/wiki/Mining#Reward.
    MINING_REWARD: 5000000000,
    // INFO: Usually it's a fee over transaction size (not quantity)
    FEE_PER_TRANSACTION: 1,
    // INFO: Usually the limit is determined by block size (not quantity)
    TRANSACTIONS_PER_BLOCK: 2,
    genesisBlock: {
        index: 0,
        previousHash: '0',
        timestamp: 1465154705,
        target: 9007199254740991,
        nonce: 0,
        transactions: [
            {
                id: '63ec3ac02f822450039df13ddf7c3c0f19bab4acd4dc928c62fcd78d5ebc6dba',
                hash: null,
                type: 'regular',
                data: {
                    inputs: [],
                    outputs: []
                }
            }
        ]
    },
    pow: {
        getDifficulty: (blocks, index) => {
            // Proof-of-work difficulty settings
            // const BASE_DIFFICULTY = Number.MAX_SAFE_INTEGER;
            const EVERY_X_BLOCKS = 5;
            const TARGET_BLOCK_TIME = 60; // 1 minute
            // const POW_CURVE = 5;
            const LAST_BLOCK = blocks[index || blocks.length - 1];

            if ((index || blocks.length - 1) % EVERY_X_BLOCKS !== 0 || (index || blocks.length - 1) === 0) {
                return LAST_BLOCK.getTarget()
            }

            
            const OLD_TARGET = LAST_BLOCK.getTarget();
            const LAST_ADJUSTED_BLOCK = blocks[(index || blocks.length - 1) + 1 - EVERY_X_BLOCKS];

            const TIME_SPENT = LAST_BLOCK.timestamp - LAST_ADJUSTED_BLOCK.timestamp; // actual time spent to mind 5 blocks
            const TARGET_TIME = EVERY_X_BLOCKS * TARGET_BLOCK_TIME; // expected time to mine 5 blocks

            let newTarget = Math.floor(OLD_TARGET * TIME_SPENT / TARGET_TIME); // new target based on time spent

            if (newTarget > Number.MAX_SAFE_INTEGER) {
                return Number.MAX_SAFE_INTEGER;
            }
            if (newTarget < 1) {
                return 1;
            }
            return newTarget;


            // 0 - 1 - 2 - 3 - 4 - 5 - 6 - 7 - 8 - 9 - 10

            // INFO: The difficulty is the formula that naivecoin choose to check the proof a work, this number is later converted to base 16 to represent the minimal initial hash expected value.
            // INFO: This could be a formula based on time. Eg.: Check how long it took to mine X blocks over a period of time and then decrease/increase the difficulty based on that. See https://en.bitcoin.it/wiki/Difficulty
            // return Math.max(
            //     Math.floor(
            //         BASE_DIFFICULTY / Math.pow(
            //             Math.floor(((index || blocks.length) + 1) / EVERY_X_BLOCKS) + 1
            //             , POW_CURVE)
            //     )
            //     , 0);
        }
    }
};