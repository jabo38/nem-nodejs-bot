/**
 * Part of the evias/nem-nodejs-bot package.
 *
 * NOTICE OF LICENSE
 *
 * Licensed under MIT License.
 *
 * This source file is subject to the MIT License that is
 * bundled with this package in the LICENSE file.
 *
 * @package    evias/nem-nodejs-bot
 * @author     Grégory Saive <greg@evias.be> (https://github.com/evias)
 * @license    MIT License
 * @copyright  (c) 2017, Grégory Saive <greg@evias.be>
 * @link       https://github.com/evias/nem-nodejs-bot
 */

(function() {

var nemSDK = require("nem-sdk").default,
    nemAPI = require("nem-api"),
    PaymentProcessor = require("./payment-processor.js").PaymentProcessor,
    MultisigCosignatory = require("./multisig-cosignatory.js").MultisigCosignatory;

/**
 * class service provide a business layer for
 * blockchain data queries used in the NEM bot.
 *
 * @author  Grégory Saive <greg@evias.be> (https://github.com/evias)
 */
var service = function(config, logger)
{
    // initialize the current running bot's blockchain service with
    // the NEM blockchain. This will create the endpoint for the given
    // network and port (testnet, mainnet, mijin) and will then initialize
    // a common object using the configured private key.
    this.nem_  = nemSDK;
    this.conf_ = config;
    this.logger_ = logger;
    this.db_ = null;
    this.cliSocketIo_ = null;

    this.isTestMode = config.nem.isTestMode;
    this.envSuffix  = this.isTestMode ? "_TEST" : "";
    this.confSuffix = this.isTestMode ? "_test" : "";

    // connect to the blockchain with the NEM SDK
    this.nemHost = process.env["NEM_HOST" + this.envSuffix] || this.conf_.nem["nodes" + this.confSuffix][0].host;
    this.nemPort = process.env["NEM_PORT" + this.envSuffix] || this.conf_.nem["nodes" + this.confSuffix][0].port;
    this.node_   = this.nem_.model.objects.create("endpoint")(this.nemHost, this.nemPort);

    // following is our bot's XEM wallet address
    this.botMode_ = process.env["BOT_MODE"] || this.conf_.bot.mode;
    this.botReadWallet_   = (process.env["BOT_READ_WALLET"] || this.conf_.bot.read.walletAddress).replace(/-/g, "");
    this.botSignMultisig_ = (process.env["BOT_MULTISIG_WALLET"] || this.conf_.bot.sign.multisigAddress).replace(/-/g, "");
    this.botSignWallet_   = (process.env["BOT_SIGN_WALLET"] || this.conf_.bot.sign.cosignatory.walletAddress).replace(/-/g, "");
    this.botTipperWallet_ = (process.env["BOT_TIPPER_WALLET"] || this.conf_.bot.tipper.walletAddress).replace(/-/g, "");

    this.paymentProcessor_    = undefined;
    this.multisigCosignatory_ = undefined;

    // define a helper for development debug of websocket
    this.socketLog = function(msg, type)
    {
        var logMsg = "[" + type + "] " + msg;
        this.logger_.info("src/blockchain/service.js", __line, logMsg);
    };

    // define a helper for ERROR of websocket
    this.socketError = function(msg, type)
    {
        var logMsg = "[" + type + "] " + msg;
        this.logger_.error("src/blockchain/service.js", __line, logMsg);
    };

    this.nem = function()
    {
        return this.nem_;
    };

    this.endpoint = function()
    {
        return this.node_;
    };

    this.logger = function()
    {
        return this.logger_;
    };

    this.isMode = function(mode)
    {
        if (typeof this.conf_.bot.mode == "string")
            return this.conf_.bot.mode == mode || this.conf_.bot.mode == "all";

        for (var i in this.conf_.bot.mode) {
            var current = this.conf_.bot.mode[i];
            if (mode == current || "all" == current)
                return true;
        }

        return false;
    };

    this.isReadBot = function()
    {
        return this.isMode("read");
    };

    this.isSignBot = function()
    {
        return this.isMode("sign");
    };

    this.isTipperBot = function()
    {
        return this.isMode("tip");
    };

    /**
     * Get this bot's READ Wallet Address
     *
     * This is the address for which the bot will listen to transactions.
     *
     * @return string   XEM account address for the Bot
     */
    this.getBotReadWallet = function()
    {
        return this.botReadWallet_;
    };

    /**
     * Get this bot's SIGNING Wallet Address
     *
     * This is the wallet used for Co-Signing Multi Signature Transactions,
     * the privateKey must be set for this feature to work.
     *
     * @return string   XEM account address for the Bot
     */
    this.getBotSignWallet = function()
    {
        return this.botSignWallet_;
    };

    /**
     * Get this bot's Multi Signature Wallet Address
     *
     * This is the Multi Signature account holding funds.
     *
     * @return string   XEM account address for the Bot
     */
    this.getBotSignMultisigWallet = function()
    {
        return this.botSignMultisig_;
    };

    /**
     * Get this bot's secret Private Key.
     *
     * @return string   XEM account address for the Bot
     */
    this.getBotSignSecret = function()
    {
        var pkey = (process.env["BOT_SIGN_PKEY"] || this.conf_.bot.sign.cosignatory.privateKey);
        return pkey;
    };

    /**
     * Get this bot's TIPPER Wallet Address
     *
     * This is the wallet used for Tipper Bot features,
     * the privateKey must be set for this feature to work.
     *
     * @return string   XEM account address for the Bot
     */
    this.getBotTipperWallet = function()
    {
        return this.botTipperWallet_;
    };

    /**
     * Get the Network details. This will return the currently
     * used config for the NEM node (endpoint).
     *
     * @return Object
     */
    this.getNetwork = function()
    {
        var isTest  = this.conf_.nem.isTestMode;
        var isMijin = this.conf_.nem.isMijin;

        return {
            "host": this.node_.host,
            "port": this.node_.port,
            "label": isTest ? "Testnet" : isMijin ? "Mijin" : "Mainnet",
            "config": isTest ? this.nem_.model.network.data.testnet : isMijin ? this.nem_.model.network.data.mijin : this.nem_.model.network.data.mainnet,
            "isTest": isTest,
            "isMijin": isMijin
        };
    };

    this.setDatabaseAdapter = function(db)
    {
        this.db_ = db;
        return this;
    };

    this.getDatabaseAdapter = function()
    {
        return this.db_;
    };

    this.setCliSocketIo = function(cliSocketIo)
    {
        this.cliSocketIo_ = cliSocketIo;
        return this;
    };

    this.getCliSocketIo = function()
    {
        return this.cliSocketIo_;
    };

    this.getPaymentProcessor = function()
    {
        if (! this.paymentProcessor_) {
            this.paymentProcessor_ = new PaymentProcessor(this);
        }

        return this.paymentProcessor_;
    };

    this.getMultisigCosignatory = function()
    {
        if (! this.multisigCosignatory_) {
            this.multisigCosignatory_ = new MultisigCosignatory(this);
        }

        return this.multisigCosignatory_;
    };

    /**
     * Read the Transaction Hash from a given TransactionMetaDataPair
     * object (gotten from NEM websockets or API).
     *
     * @param  [TransactionMetaDataPair]{@link http://bob.nem.ninja/docs/#transactionMetaDataPair} transactionMetaDataPair
     * @return {string}
     */
    this.getTransactionHash = function(transactionMetaDataPair)
    {
        var meta    = transactionMetaDataPair.meta;
        var content = transactionMetaDataPair.transaction;

        var trxHash = meta.hash.data;
        if (meta.innerHash.data && meta.innerHash.data.length)
            trxHash = meta.innerHash.data;

        return trxHash;
    };

    /**
     * Read the Transaction XEM Amount.
     *
     * @param  [TransactionMetaDataPair]{@link http://bob.nem.ninja/docs/#transactionMetaDataPair} transactionMetaDataPair
     * @return {[type]}                         [description]
     */
    this.getTransactionAmount = function(transactionMetaDataPair)
    {
        var meta    = transactionMetaDataPair.meta;
        var content = transactionMetaDataPair.transaction;

        var isMultiSig  = content.type === this.nem_.model.transactionTypes.multisigTransaction;
        var realContent = isMultiSig ? content.otherTrans : content;
        var isMosaic    = realContent.mosaics && realContent.mosaics.length > 0;

        if (isMosaic) {
            // read mosaics to find XEM, `content.amount` is now a multiplier!

            var multiplier = realContent.amount / 1000000; // from microXEM to XEM
            for (var i in realContent.mosaics) {
                var mosaic = realContent.mosaics[i];
                var isXEM  = mosaic.mosaicId.namespaceId == "nem" && mosaic.mosaicId.name == "xem";

                if (!isXEM)
                    continue;

                // XEM divisibility is 10^6
                return (multiplier * mosaic.quantity).toFixed(6);
            }

            // no XEM in transaction.
            return 0;
        }
        else {
            // not a mosaic transer, `content.amount` is our XEM amount.
            return realContent.amount;
        }
    };

    /**
     * Read the Transaction XEM Fee amount.
     *
     * @param  [TransactionMetaDataPair]{@link http://bob.nem.ninja/docs/#transactionMetaDataPair} transactionMetaDataPair
     * @return {[type]}                         [description]
     */
    this.getTransactionFee = function(transactionMetaDataPair)
    {
        var meta    = transactionMetaDataPair.meta;
        var content = transactionMetaDataPair.transaction;

        return content.fee;
    };

    var self = this;
    {
        // nothing more done on instanciation
    }
};

module.exports.service = service;
}());
