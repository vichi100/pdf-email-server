const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || "mongodb://realto:realto123@207.180.239.115:27017/realtodb";

async function connectToDB() {
    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("[DB] Connected to MongoDB successfully.");
    } catch (error) {
        console.error("[DB Error] Failed to connect to MongoDB:", error);
        throw error;
    }
}

async function closeDBConnection() {
    try {
        await mongoose.disconnect();
        console.log("[DB] MongoDB connection closed.");
    } catch (error) {
        console.error("[DB Error] Failed to close MongoDB connection:", error);
        throw error;
    }
}

module.exports = { connectToDB, closeDBConnection };