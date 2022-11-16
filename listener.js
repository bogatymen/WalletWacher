// ====== PACKAGES
const ethers = require("ethers");
require('dotenv').config();
const { MongoClient } = require('mongodb');

// ============ PROVIDER
const INFURA_ID = process.env.PROVIDER_API_KEY;
const provider = new ethers.providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${INFURA_ID}`);

// ========= MongoDB 
// Connection URL
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);
// Database Name
const dbName = 'myTokens';
const collNameRaw = 'rawLogs';

// ========== lista Premium Wallets
// const premiumReceivers = [
//     "0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2",
//     "0xE8c060F8052E07423f71D445277c61AC5138A2e5"
// ];
const premiumReceiversList = require('./dbToListen.json');

// generate (formated by hexZeroPad) wallet' array to listen. 
//var listenArray = [];
//var len = premiumReceiversList.length;
//for (var i = 0; i < len; i++) {
//    listenArray.push(
//        ethers.utils.hexZeroPad(premiumReceiversList[i].address, 32),
//    );
//}
var listenArray = premiumReceiversList.map(premiumReceiver => ethers.utils.hexZeroPad(premiumReceiver.address, 32))

// ========== FUNCTIONS 

// ========= MAIN
const main = async () => {
  
  try{
    await client.connect();
    //console.log('Connected successfully to MongoDB server');
    const db = client.db(dbName);
    const collection = db.collection(collNameRaw);
    
    // setUp event filter
    const topicSets = [
      ethers.utils.id("Transfer(address,address,uint256)"),
      null,
      listenArray,
      // [
      //      ethers.utils.hexZeroPad(premiumReceivers[0], 32),
      //     ethers.utils.hexZeroPad(premiumReceivers[1], 32),
      // ],
    ];
    
    // listen 
    provider.on(topicSets, async (log, event) => {
      // Emitted any token is sent TO either address
      const tokenAddress = log.address.toLowerCase();
      const txHash = log.transactionHash.toLowerCase();
      // get more TX info
      const txInfo = await provider.getTransaction(txHash);
      // insert to mongoDB
      const insertResult = await collection.insertOne(log);
      // display token transfers    
      console.log(`Wallet got token ${tokenAddress}\n TX hash = ${txHash}`);
    })
    
  } catch(e){
    console.log(e);
  } finally {
    await client.close();
  }

}
// ===========
main();
