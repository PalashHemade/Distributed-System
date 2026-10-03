const mongoose = require('mongoose');

async function connectRequired(label) {
  if (!process.env.MONGODB_URI) {
    console.error(`[${label}] MONGODB_URI is not set. MongoDB is required to run this application — aborting startup.`);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`[${label}] Connected to MongoDB.`);
  } catch (err) {
    console.error(`[${label}] Failed to connect to MongoDB at startup:`, err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn(`[${label}] MongoDB connection lost. Local state remains available; writes will queue and retry until it reconnects.`);
  });

  mongoose.connection.on('reconnected', () => {
    console.log(`[${label}] MongoDB reconnected.`);
  });
}

module.exports = { connectRequired };
