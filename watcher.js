// ====== PACKAGES
const ethers = require("ethers");
require('dotenv').config();
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');

// ============ PROVIDER
// dobrze byloby uniezaleznic sie od infury i zamiast brac KEY, lepiej brac caly URL
const INFURA_ID = process.env.PROVIDER_API_KEY;
const provider = new ethers.providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${INFURA_ID}`);

// ========= MongoDB 
// Connection URL
// korzystniej jest stworzyc baze danych w chmurze zamiast lokalnie.
// po pierwsze dlatego, ze docelowo skrypt tez bedzie dzialal w chmurze
// i bedziesz mogl przenosic go z boxa na box nie muszac martwic sie o przenoszenie db,
// po drugie, bedziesz mial dostep do db z kazdego miejsca bez koniecznosci 
// logowania sie na box i sprawdzania co jest w db
// sprawdz sobie: https://account.mongodb.com/account/login
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);

// Database Name
const dbName = 'myTokens';
const collNameRaw = 'rawLogs';
const collNameTokens = 'tokensDB';

// =========== TG
const tokenTG = process.env.TG_TOKEN;
const chatId = -702606660;

// Created instance of TelegramBot
const botTK = new TelegramBot(tokenTG, { 
    polling: false
});

// ========== FUNCTIONS 
/*
*  find wallet name for given address - from json file
*/
function findWalletName(receiver){
    // proponuje przeniesc dbToListen.json do db w chmurze. wtedy bedzie mozna latwo dodawac/usuwac adresy
    const premiumReceiversList = require('./dbToListen.json');
    //for (i=0;i<premiumReceiversList.length;i++){
    //    if (receiver.toLowerCase() == premiumReceiversList[i].address.toLowerCase())        
    //    return premiumReceiversList[i].walletName;
    //}
    return premiumReceiversList
        .find(premiumReceiver => receiver.toLowerCase() === premiumReceiver.address.toLowerCase())?.walletName;
}
/*
* check if token already in tokenDB collection
*/
async function checkTokenInMongoDB(client, tokenToCheck) {

    //console.log('Connected successfully to MongoDB server');
    const db = client.db(dbName);
    const collection = db.collection(collNameTokens);
    const result = await collection.findOne({ address: tokenToCheck });

    if (result) {
        console.log(`Found a token ${tokenToCheck} = ${result.name}'`);
        //console.log(result);
        return result.name;
    } else {
        console.log(`No token found with addr '${tokenToCheck}'`);
        return null;
    }
}

/*
*  add unknown token to tokenDB collection
*/
async function addTokenToMongoDB(client, token) {
    //console.log('Connected successfully to MongoDB server');
    const db = client.db(dbName);
    const collection = db.collection(collNameTokens);

    // uzyj upsert, zeby nie dodawac duplikatow
    const insertResult =  await collection.insertOne(token);
    return insertResult;
}

/*
* delet token log from Logs collection
*/

async function deleteLogInMongo(client, logData) {
    //const obj = await client.db(dbName).collection(collNameTokens).findOne({ name: "USDC"   });
    const result = await client.db(dbName).collection(collNameRaw).deleteOne({ _id: logData._id });
    console.log(`${result.deletedCount} document(s) was deleted.`);
    return result;
}

/*
* format display data for TG
*/

function formatDataToTG(tokenData) {
    // sprobuj formatowac message w HTML. 
    // bedziesz mogl tworzyc linki w ktore da sie kliknac, skracajac tekst
    // https://core.telegram.org/bots/api#sendmessage
    // spojrz na parse_mode -> formatting options
    // https://core.telegram.org/bots/api#html-style

    //var dateFormat = new Date(obj.date);
    let tempChat ="  Wallet Name => " + tokenData.wallet;
    tempChat += "\n Token Name => " + tokenData.name;
    tempChat += "\n Token Type => " + tokenData.type;
    tempChat += "\n Token Address => " + tokenData.address;

    if (tokenData.type == "ERC20")
    tempChat += "\n Explorer  => " + "https://etherscan.io/address/" + tokenData.address;
    else
    tempChat += "\n Explorer  => " + "https://opensea.io/assets/ethereum/"+ tokenData.address;

    tempChat += "\n Amount/ID => " + tokenData.amount;
    tempChat += "\n TX Hash => " + "https://etherscan.io/tx/" + tokenData.hash;
    return tempChat;
}


/*
* get token Type from Log - topics , data
*/
function getTokenDetails(tempLog){
    let tokenDetails ={};
    let value, tokenType;
    let eventSig, sender, receiver,eventData ;

    if (tempLog.data =="0x") eventData = ethers.BigNumber.from(0);
    else eventData = ethers.BigNumber.from(tempLog.data);

    switch (tempLog.topics.length) {
        case 1:
            eventSig = tempLog.topics[0];
            break;
        case 2:
            break;
        case 3:
            sender = "0x" + tempLog.topics[1].slice(-40);
            receiver = "0x" + tempLog.topics[2].slice(-40);
            if (eventData > 10000) tokenType = "ERC20";
            else tokenType = "ERC721";
            tokenDetails.tokenType = tokenType;

            // powinienes uzyc funkcji formatUnits z odpowiednia wartoscia decimals
            // w przeciwnym razie jesli decimals != 18 bedziesz mial zle wyniki
            tokenDetails.value = ethers.utils.formatEther(eventData);
            break;
        case 4:
            // The ERC-721 standard defines the Transfer() event with 3 indexed arguments. 
            // topics[1] is the address sender, topics[2] is the address recipient, 
            // and topics[3] is the uint256 token ID. (And topics[0] is the event signature).
            sender = "0x" + tempLog.topics[1].slice(-40);
            receiver = "0x" + tempLog.topics[2].slice(-40);
            tokenID = "0x" + tempLog.topics[3].slice(-40);
            tokenDetails.value = tokenID;
            tokenDetails.tokenType = "ERC721";
            break;
        default:
            break;
        
    }

    return  tokenDetails;
}
 

// ========= MAIN
async function main() {
    // trzeba znalezc sposob aby nie przeciazac RPC. moim zdaniem przede wszystkim musisz skupic sie 
    // na cachowaniu i sprawdzic czy to wystarczy. jesli nie, trzeba bedzie zaimplementowac request
    // counter, zliczac requesty i oczekiwac jesli przekroczono limit

    try{
        // polaczenie z baza danych jest stabilne i mozesz utrzymywac je przez caly czas dzialania
        // skryptu. nie ma potrzeby bys laczyl sie z db za kazdym razem gdy wykonujesz funkcje i
        // zamykal polaczenie. utrzymujac caly czas jedno polaczenie wszystko bedzie dzialac szybciej
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collNameRaw);
        const logArray =  await collection.find({}).toArray();

        //process the logs
        for (let i=0; i < logArray.length; i++){

            if(i >= 1){break;}

            // get single token LOG
            let tempLog = logArray[i];
            console.log(`Loop NR = ${i}`);
            console.log(tempLog);

            const tokenAddress = tempLog.address.toLowerCase();

            // data container for TG
            var logData = {};
            logData.address = tokenAddress;
            logData.hash = tempLog.transactionHash.toLowerCase();

            //const eventSig = tempLog.topics[0];
            //const sender = "0x" + tempLog.topics[1].slice(-40);
            const receiver = "0x" + tempLog.topics[2].slice(-40);
            //console.log(receiver);

            //const tokenType = getTokenDetails(tempLog);
            //logData.type = tokenType;
            //console.log(tokenType);

            // find wallet name for given address
            const walletName = findWalletName(receiver);
            //console.log(walletName);

            let eventData = ethers.utils.formatEther( ethers.BigNumber.from(tempLog.data) );
            let cos = getTokenDetails(tempLog);
            logData.type = cos.tokenType;
            eventData  = cos.value;
            //console.log(transferData);

            //check if Token in MongoDB
            const tokenName = await checkTokenInMongoDB(client, tokenAddress);

            if (tokenName != null){
                console.log(`\nToken ${tokenAddress} = ${tokenName} in database \n `);
                logData.name = tokenName;
            } else {
                console.log(`\nUnknown token ${tokenAddress} \n `);
                // process unknown token on-chain
                const abi_erc20 = [
                    // Read-Only Functions
                    "function balanceOf(address owner) view returns (uint256)",
                    "function decimals() view returns (uint8)",
                    "function symbol() view returns (string)",
                ];
                // setUP the abstract Contract to get data from
                const erc20 = new ethers.Contract(tokenAddress, abi_erc20, provider);
                // get token symbol
                const tokenSymbol = await erc20.symbol(); 
                console.log(`Token ${tokenSymbol} added to database \n `);
                logData.name = tokenSymbol;
                            // token data for mongoDB
                const tokenDataToDB ={
                    "name": tokenSymbol ,
                    "address": tokenAddress,
                    "tokenType" :logData.type,
                }
                //add token to cache => tokenDB
                const addedToken = await addTokenToMongoDB(client, tokenDataToDB);
            }
            
            // generate data for TG
            logData.amount = eventData
            logData.name = tokenName;
            logData.wallet = walletName;

            // remove LOG from rawLOGs => remove from the queue to process
            let logRemoved = await deleteLogInMongo(client,tempLog);
            // prepare message for TG.
            const messageTG = formatDataToTG(logData);
            // sent TG message
            await botTK.sendMessage(chatId, messageTG );

        }

    } catch(err){
        console.log(err);
    } finally{
        await client.close();
    }
}

main();
