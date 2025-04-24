"use strict";

// Required: npm install blind-signatures
const blindSignatures = require('blind-signatures');
const { Coin, COIN_RIS_LENGTH, IDENT_STR, BANK_STR } = require('./coin.js');
const utils = require('./utils.js');

// ======== BANK SETUP ========
const BANK_KEY = blindSignatures.keyGeneration({ b: 2048 });
const N = BANK_KEY.keyPair.n.toString();
const E = BANK_KEY.keyPair.e.toString();

// ======== FUNCTIONS ========

/**
 * Signs a blinded coin hash on behalf of the bank.
 * @param {string} blindedCoinHash 
 * @returns {string} bank's signature
 */
function signCoin(blindedCoinHash) {
    return blindSignatures.sign({
        blinded: blindedCoinHash,
        key: BANK_KEY,
    });
}

/**
 * Parses coin string and returns left/right identity hash arrays.
 * @param {string} s 
 * @returns {[string[], string[]]}
 */
function parseCoin(s) {
    const [cnst, amt, guid, leftHashes, rightHashes] = s.split('-');

    if (cnst !== BANK_STR) {
        throw new Error(`Invalid identity string: expected ${BANK_STR}, got ${cnst}`);
    }

    return [
        leftHashes ? leftHashes.split(',') : [],
        rightHashes ? rightHashes.split(',') : []
    ];
}

/**
 * Simulates merchant acceptance of a coin.
 * @param {Coin} coin 
 * @returns {string[]} Revealed Identity Strings (RIS)
 */
function acceptCoin(coin) {
  console.log("coin.hash:", coin.hash);
    const message = Buffer.isBuffer(coin.hash)
        ? coin.hash
        : Buffer.from(coin.hash, 'hex');

    const isValid = blindSignatures.verify({
        unblinded: coin.signature,
        message,
        key: { n: coin.n, e: coin.e }
    });

    if (!isValid) {
        throw new Error("Invalid signature. Coin is not valid.");
    }

    const [leftHashes, rightHashes] = parseCoin(coin.toString());

    if (leftHashes.length !== COIN_RIS_LENGTH || rightHashes.length !== COIN_RIS_LENGTH) {
        throw new Error(`Invalid RIS length: expected ${COIN_RIS_LENGTH}, got left=${leftHashes.length}, right=${rightHashes.length}`);
    }

    if (!coin.leftIdent || !coin.rightIdent) {
        throw new Error("Coin is missing leftIdent or rightIdent.");
    }

    const selectLeft = Math.random() < 0.5;
    const ris = [];

    for (let i = 0; i < COIN_RIS_LENGTH; i++) {
        const selectedHash = selectLeft ? leftHashes[i] : rightHashes[i];
        const preimage = coin.getRis(selectLeft, i);

        if (!preimage) {
            throw new Error(`Missing preimage at index ${i} for ${selectLeft ? 'left' : 'right'}Ident`);
        }

        const hashed = utils.hash(preimage);
        if (hashed !== selectedHash) {
            throw new Error(`Hash mismatch at index ${i}: expected ${selectedHash}, got ${hashed}`);
        }

        ris.push(preimage);
    }

    console.log(`Coin accepted: GUID=${coin.guid}, Amount=${coin.amount}, Side=${selectLeft ? 'left' : 'right'}`);
    return ris;
}

/**
 * Determines who double-spent the coin based on RIS from two merchants.
 * @param {string} guid 
 * @param {string[]} ris1 
 * @param {string[]} ris2 
 */
function determineCheater(guid, ris1, ris2) {
    if (ris1.join(',') === ris2.join(',')) {
        console.log(`Merchant is cheating with coin ${guid}`);
        return;
    }

    for (let i = 0; i < COIN_RIS_LENGTH; i++) {
        const xorResult = utils.decryptOTP({
            key: Buffer.from(ris1[i]),
            ciphertext: Buffer.from(ris2[i]),
            returnType: 'string'
        });
        if (xorResult.startsWith(IDENT_STR)) {
            const cheaterId = xorResult.slice(IDENT_STR.length + 1);
            console.log(`Double spending detected for coin ${guid}! Cheater is ${cheaterId}`);
            return;
        }
    }

    console.log(`Unable to identify cheater for coin ${guid}`);
}

// ======== DEMO FLOW ========
(function main() {
    let coin = new Coin('alice', 20, N, E);
    console.log(`Coin created: GUID=${coin.guid}, Amount=${coin.amount}`);

    coin.signature = signCoin(coin.blinded);
    coin.unblind();

    const ris1 = acceptCoin(coin);
    const ris2 = acceptCoin(coin);

    determineCheater(coin.guid, ris1, ris2);  // Expect: user cheating
    console.log();
    determineCheater(coin.guid, ris1, ris1);  // Expect: merchant cheating
})();