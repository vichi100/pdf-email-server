const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || "mongodb://realto:realto123@207.180.239.115:27017/realtodb";

let client;

async function connectToDB() {
    if (!client) {
        client = new MongoClient(uri);
        await client.connect();
    }
    return client;
}

async function getDatabase(dbName) {
    const client = await connectToDB();
    return client.db(dbName);
}

async function closeDBConnection() {
    if (client) {
        await client.close();
        client = null;
    }
}

module.exports = { connectToDB, getDatabase, closeDBConnection };