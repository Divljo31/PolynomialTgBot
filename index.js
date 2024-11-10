require('dotenv').config();
const { HermesClient } = require('@pythnetwork/hermes-client');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const { Chain, createPublicClient, http, Hex, parseUnits, maxUint128, stringToBytes, } = require('viem');
const { ethers } = require("ethers");
const { parse } = require('path');


//Global constants
const polyContractAddress = '0x52Fdc981472485232587E334c5Ca27F241CbA9AA';
const fxUSDContractAddress = '0xE814499181A80B0E4b88FF6af5D12eA2D4d23688';
 
const TESTNET_RPC = 'https://rpc-polynomial-network-testnet-x0tryg8u1c.t.conduit.xyz';
const provider = new ethers.JsonRpcProvider(TESTNET_RPC);
let signer; 
let polyContract;
let accountId;
const alertTargets = {}; // Store target prices for alerts by chatId
let previousETHprice;


// Initialize the HermesClient with the desired endpoint
const hermes = new HermesClient('https://hermes.pyth.network');
// Define the price feed ID for ETH/USD
const ethFeed = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

// Define the ABI for the PolynomialContract interface
const polyContractABI = [
  "function createAccount() external returns (uint128)",
  "event AccountCreated(uint128 indexed accountId, address indexed owner)",
  "function modifyCollateral(uint128 accountId, uint128 collateralId, int256 amountDelta) external",
  "function getAccountOpenPositions(uint128 accountId) external view returns (uint256[] memory)",
  "function getMarkets() external view returns (uint256[] memory marketIds)",
  "function metadata(uint128 marketId) external view returns (string memory name, string memory symbol)",
  "function getAvailableMargin(uint128 accountId) external view returns (int256 availableMargin)",
  "function requiredMarginForOrder(uint128 marketId,uint128 accountId,int128 sizeDelta) external view returns (uint256 requiredMargin)",
  "function getOpenPosition(uint128 accountId, uint128 marketId) external view returns (int256 totalPnl, int256 accruedFunding, int128 positionSize, uint256 owedInterest)",
  "function commitOrder((uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer)) external returns ((uint256 commitmentTime, uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer ), uint256 fees)",
  "function getOrder(uint128 accountId) external view returns ((uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer))"
];
  
const fxUSDABI = [
  "function approve(address spender, uint256 amount) public returns (bool)"
];


// Function to create wallet from Telegram ID
function createWalletFromTelegramID(telegramId) {
  // Hash the Telegram ID to get a consistent, unique seed
  const hash = ethers.keccak256(ethers.toUtf8Bytes(telegramId.toString()));

  // Use the hash to create a new wallet
  signer = new ethers.Wallet(hash, provider);

      // Create an instance of the contract
  polyContract = new ethers.Contract(
        polyContractAddress,
        polyContractABI,
        signer
      );
  
  
  return signer.address;
}


// Function to approve spending fxUSD
async function approveSpending(spenderAddress) {
    //Creating fxUSD contract instance
    const fxUSDContract = new ethers.Contract(
      fxUSDContractAddress,
      fxUSDABI,
      signer
      );
  
  try {

    // Send the approve transaction
    const tx = await fxUSDContract.approve(spenderAddress, ethers.MaxUint256);
    // Wait for the transaction to be confirmed
    const receipt = await tx.wait();
    return receipt;

  } catch (error) {

    console.error("Approval failed:", error);
    throw error;
  }
}


//function to create new TradingAccount
async function createNewAccount() {
  

    try {
      // Call the createAccount function
      const tx = await polyContract.createAccount();
  
      // Wait for the transaction to be confirmed
      const receipt = await tx.wait();      
  
    } catch (error) {
      console.error("Error calling createAccount:", error);
    }
          
    return; // Return receipt details for confirmation
      
  } 
  
// function that gets accountID from the ownerAddress, returns accountId
async function getAccountId(ownerAddress) {

    const url = `https://perps-api-testnet.polynomial.finance/accounts?owner=${ownerAddress}&ownershipType=Direct`;

    try {
      const response = await axios.get(url);
      const accountId = response.data[0].accountId;
      return accountId;
    } catch (error) {
      console.error('Error fetching accountId:', error);
  }
}


//function that gets currently available Margin for trading, returns amount available
async function getAvailableMargin(accountId){
  try{

    const availableMargin = await polyContract.getAvailableMargin(accountId);
    //console.log(availableMargin);
    return availableMargin;

  } catch (error){

    console.error("Error fetching available Margin:", error);

  }
}
  
// function that gets currently available marketIds returns list of marketIds
async function getMarketIds(){

    try{
    
      const marketIds = await polyContract.getMarkets();
      return marketIds; // This returns an array of market IDs
    
    } catch (error) { 
      console.error("Error fetching market IDs:", error);
    }
}

// function that gets MarketMetada from marketId, returns Name and symbol
async function getMarketMetadata(marketId){

  try{

    const marketMetadata = await polyContract.metadata(marketId);
    return marketMetadata;

  } catch(error){
    console.error("Error fetching market metadata");
  }
}

//function that modifies available collateral, positive value adds collateral / negative withdraws it
async function modifyCollateral(amountDelta){

  try {
    const tx = await polyContract.modifyCollateral(accountId, 0, amountDelta);
    await tx.wait();
    return `Collateral modified successfully. Transaction hash: ${tx.hash}`;

} catch (error) {
    return `Failed to modify collateral: ${error.message}`;
  }
}

// Fetch the latest price updates for the specified feed //hardcoded for ethFeed returns eth value
async function fetchPriceUpdate() {
  try {
    const data = await hermes.getLatestPriceUpdates([ethFeed]);
    const price = data.parsed[0].price.price;
    return price;
  } catch (error) {
    console.error('Error fetching price update:', error);
  }
}

// function that gets Order info from the accountId
async function getOrder(accountId){
  try{

    const orderInfo = await polyContract.getOrder(accountId);
    return orderInfo;

} catch (error) {
    return `Failed to get orderInfo: ${error.message}`;
  }
}

// function that fetches Account open positions 
async function getAccountOpenPositions(accountId){
  try{

    const openPositions = await polyContract.getAccountOpenPositions(accountId);
    return openPositions;

} catch (error) {

    return `Failed to get positions: ${error.message}`;

  }
}

//returns openPosition these are the values totalPnl, accruedFunding, positionSize, owedInterest
async function getAccountOpenPosition(accountId, marketId){
  try{

    const openPosition = await polyContract.getOpenPosition(accountId, 200n);
    console.log(openPosition);
    return openPosition;

} catch (error) {

    return `Failed to get positions: ${error.message}`;
  }
}

//function that calculates required margin for opening trade
async function getRequiredMarginForOrder(){
  try{

    const requiredMargin = await polyContract.requiredMarginForOrder(accountId, 200n, 1000000000000000000n)
    console.log(requiredMargin);
    return requiredMargin;

} catch (error) {

    return `Failed to get positions: ${error.message}`;
  }  
}

// Function that check the price fo eth and trigers alert
async function checkPriceAlerts() {
  const currentPrice = await fetchPriceUpdate();
  if (!currentPrice) return;

  Object.keys(alertTargets).forEach(chatId => {
    const targetPrice = alertTargets[chatId];
    if ((currentPrice >= targetPrice && previousETHprice < targetPrice) || // Upwards alert
        (currentPrice <= targetPrice && previousETHprice > targetPrice)) { // Downwards alert
      bot.sendMessage(chatId, `Alert! ETH has reached your target price of ${ethers.formatUnits(targetPrice, 8)} USD. Current price: ${ethers.formatUnits(currentPrice, 8)} USD`);
      delete alertTargets[chatId]; // Remove the alert after notification
    }
  });

  previousETHprice = currentPrice; // Update for the next check
}


//Initialialize bot 
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });


// bot function that creates wallet from tgID
// /example /get_started
bot.onText(/\/get_started/, async (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || "there"; // Get the user's first name
    const tgId = msg.from.id;
  
    const address = createWalletFromTelegramID(tgId);

    // Send a greeting message
    bot.sendMessage(chatId, `Hello, ${name}! Tjis is your public address ${address} . Please deposit funds`);
    
});

// bot function that triggers createAccount function and creates trading account
// example /create_account 
bot.onText(/\/create_account/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const account = await createNewAccount();
      accountId = await getAccountId(signer.address);
      bot.sendMessage(chatId, `New account created with ID: ${accountId}`);
    } catch (error) {
      bot.sendMessage(chatId, `Failed to create account: ${error.message}`);
    }
});

// bot function that fetches open positions
// /get_positions returns open positions format totalPnl, accruedFunding, positionSize, owedInterest
bot.onText(/\/get_positions/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const openPosition = await getAccountOpenPosition(accountId, 100n);
    bot.sendMessage(chatId, `Returned positions: ${openPosition}`);
  } catch (error) {
    bot.sendMessage(chatId, `Failed to return positions: ${error.message}`);
  }
});

// bot function that gets orders
// /get_orders
bot.onText(/\/get_orders/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const order = await getOrder(accountId);
    bot.sendMessage(chatId, `Returned order: ${order}`);
  } catch (error) {
    bot.sendMessage(chatId, `Failed to get orders: ${error.message}`);
  }
});

// bot function that checks balance
// /get_balance
bot.onText(/\/get_balance/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const balance = await getAvailableMargin(accountId);
    bot.sendMessage(chatId, `Available balance: ${balance}`);
  } catch (error) {
    bot.sendMessage(chatId, `Failed to get balance: ${error.message}`);
  }
});


// bot function that approves spending fxUSD balance
// /approve approves spending fxUSD
bot.onText(/\/approve/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const balance = await approveSpending(polyContract);
    bot.sendMessage(chatId, `Funds approved. TxHash: ${balance.transactionHash}`);
  } catch (error) {
    bot.sendMessage(chatId, `failed to approve: ${error.message}`);
  }
});

// bot function that sets alert on ETH price
// example /set_alert 3200 trigers message when eth price hits 3200
bot.onText(/\/set_alert (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const targetPrice = ethers.parseUnits(match[1], 8);

  if (targetPrice === null) {
    bot.sendMessage(chatId, 'Invalid price. Please provide a valid target price.');
  } else {
    alertTargets[chatId] = targetPrice;
    bot.sendMessage(chatId, `Alert set! You will be notified when ETH reaches ${match[1]}.`);
  }
});



//bot function that calls modifyCollateral function to addCollateral to account
// example /add_collateral usd amount
bot.onText(/\/add_collateral (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  let amount = ethers.parseUnits(match[1], 18); // Converts 1 to 1 * 10^18

  try {
  
    const tx = await modifyCollateral(amount);
    bot.sendMessage(chatId, `Collateral succesfully added`);

  } catch (error) {

    bot.sendMessage(chatId, `Failed to add collateral}`);

  }
});

//bot function that calls modifyCollateral function to withdrawCollateral to account
// example /withdraw_collateral usd amount
bot.onText(/\/withdraw_collateral (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  let amount = ethers.parseUnits(match[1], 18) * BigInt(-1); // Converts 1 to 1 * 10^18
  amount = BigInt(amount);
  try {

    const tx = await modifyCollateral(amount);
    bot.sendMessage(chatId, `Collateral succesfully withdrawn`);

  } catch (error) {

    bot.sendMessage(chatId, `Failed to withdraw collateral`);

  }
});

// bot function that places order
// atributes long/short 1/2
// market based on market id, example 2 iz 200n that's ETH
// size in fxUSD 
// example call place_order 1 2 10, places order to long 10usd on eth

bot.onText(/\/place_order (\d+) (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    try {

        const orderType = parseInt(match[1]); // This could be 1 or 2
        const marketId = ethers.parseUnits(match[2], 2); // Converts 2 to 200n
        let sizeDelta = ethers.parseUnits(match[3], 10); // Converts 1 to 1 * 10^18
        let acceptablePrice = await fetchPriceUpdate() - 2000000000000000000n; // current price - 2usd
        if(orderType === 2){
          sizeDelta = parseUnits(-sizeDelta, 18);
          let acceptablePrice = acceptablePrice + 4000000000000000000n;
        }
        
        // Additional parameters for commitmentData
        const settlementStrategyId = 0n; 
        const trackingCode = stringToBytes("BOT", {size: 32}); // Tracking code for trades from the homepage
        const referrer = "0xCdC9D1569233F0503fc6EEB6A1A64E7a34F2D669"; 

        
        // Create the commitmentData object
        const commitmentData = {
            marketId,
            accountId,
            sizeDelta,
            settlementStrategyId,
            acceptablePrice,
            trackingCode,
            referrer
          }; 

        //Step 2: Commit the order using the smart contract
        const transaction = await polyContract.commitOrder(commitmentData);
        await transaction.wait();

        //  Step 3: Send confirmation to the user
        bot.sendMessage(chatId, `Trade committed successfully! Transaction hash: ${transaction.hash}`);

    } catch (error) {
        console.error("Error placing order:", error);
        bot.sendMessage(chatId, "Failed to place order. Please check your input and try again.");
    }
});

// Set an interval to check for price alerts every 2 seconds
setInterval(checkPriceAlerts, 2000); // Check every 2 seconds
