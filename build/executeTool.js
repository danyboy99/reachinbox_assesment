"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.execute = exports.activateOauth = void 0;
const googleapis_1 = require("googleapis");
const dotenv_1 = __importDefault(require("dotenv"));
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const openai_1 = require("./openai");
dotenv_1.default.config();
//google api config
const googleOauth2Client = new googleapis_1.google.auth.OAuth2(process.env.googleClientId, process.env.googleClientSecret, process.env.googleRedirectUrl);
//activate googleapi Oauth
const activateOauth = () => {
    // Generate the URL to request authorization
    const authUrl = googleOauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/gmail.modify"],
    });
    return authUrl;
};
exports.activateOauth = activateOauth;
function decodeBase64Url(data) {
    let decodedData = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(decodedData, "base64").toString("utf-8");
}
// Function to fetch new emails
async function fetchGmailEmails() {
    try {
        const gmail = googleapis_1.google.gmail({
            version: "v1",
            auth: googleOauth2Client,
        });
        // Fetch the list of messages
        const res = await gmail.users.messages.list({
            userId: "me",
            labelIds: ["INBOX"], // Specify the label ID to filter emails
            q: "is:unread", // Filter for unread emails
            maxResults: 10, // Specify the number of emails to fetch
        });
        const messages = res.data.messages;
        if (!messages || messages.length === 0) {
            console.log("No new messages found.");
            return [];
        }
        console.log("Fetched emails:", messages);
        // Fetch the full details of each message
        const emailDetailsPromises = messages.map((message) => {
            if (message.id) {
                // Ensure message.id is defined
                return gmail.users.messages
                    .get({
                    userId: "me",
                    id: message.id,
                })
                    .then((res) => res.data); // Extract the data property
            }
            else {
                return Promise.resolve(null); // Handle the case where message.id is null
            }
        });
        const emailDetails = await Promise.all(emailDetailsPromises);
        // Filter out any null results and extract the message data
        const emails = emailDetails
            .filter((detail) => detail !== null)
            .map((detail) => {
            const payload = detail.payload;
            if (payload && payload.body && payload.body.data) {
                return decodeBase64Url(payload.body.data);
            }
            else if (payload && payload.parts) {
                // If the body is not directly in the payload, it might be in parts
                for (const part of payload.parts) {
                    if (part.body && part.body.data) {
                        return decodeBase64Url(part.body.data);
                    }
                }
            }
            return "";
        });
        return emails;
    }
    catch (err) {
        console.error("Error fetching emails:", err);
        throw err;
    }
}
const getAll10Emall = async () => {
    const newEmails = await fetchGmailEmails();
    if (newEmails.length > 0) {
        // Save the decoded emails to files for easier inspection
        newEmails.forEach((email, index) => {
            console.log("index:", index, "emailOriginal:", email);
        });
        return newEmails;
        // Send the emails to OpenAI for analysis
    }
    else {
        console.log("No new emails to process.");
        return []; // Return an empty array when there are no new emails
    }
};
const getNewEmall = async () => {
    const newEmails = await fetchGmailEmails();
    if (newEmails.length > 0) {
        // Save the decoded emails to files for easier inspection
        newEmails.forEach((email, index) => {
            console.log("index:", index, "emailOriginal:", email);
        });
        return newEmails[0];
        // Send the emails to OpenAI for analysis
    }
    else {
        console.log("No new emails to process.");
        return null; // Return null when there are no new emails
    }
};
// Create a Redis connection
const connection = new ioredis_1.default({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
// Create queues
const fetchEmailQueue = new bullmq_1.Queue("fetchEmail", { connection });
const analyzeEmailQueue = new bullmq_1.Queue("analyzeEmail", { connection });
const sendEmailQueue = new bullmq_1.Queue("sendEmail", { connection });
// Create queue event
const fetchEmailEvents = new bullmq_1.QueueEvents("fetchEmail", { connection });
const analyzeEmailEvents = new bullmq_1.QueueEvents("analyzeEmail", { connection });
const sendEmailEvents = new bullmq_1.QueueEvents("sendEmail", { connection });
// Function to send an email using Gmail API
const sendEmail = async (to, subject, body) => {
    const gmail = googleapis_1.google.gmail({ version: "v1", auth: googleOauth2Client });
    const emailContent = [`To: ${to}`, "Subject: " + subject, "", body].join("\n");
    const encodedMessage = Buffer.from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    try {
        await gmail.users.messages.send({
            userId: "me",
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log("Email sent successfully.");
    }
    catch (error) {
        console.error("Error sending email:", error);
    }
};
// to execute tools
const execute = async (req, res) => {
    const code = req.query.code;
    try {
        if (!code) {
            return res.json({
                msg: "you have to validate google Oauth first ",
            });
        }
        const { tokens } = await googleOauth2Client.getToken(code);
        googleOauth2Client.setCredentials(tokens);
        console.log("Tokens acquired:", tokens);
        if (!tokens.refresh_token) {
            console.error("No refresh token received.");
            return "No refresh token received.";
        }
        googleOauth2Client.setCredentials({
            refresh_token: tokens.refresh_token,
        });
        const newEmail = await getNewEmall();
        console.log("pass google process successfuly");
        const analysis = await (0, openai_1.analyzeEmailContent)(newEmail);
        // Handle queue events
        fetchEmailEvents.on("completed", ({ jobId }) => {
            console.log(`Job ${jobId} in fetchEmail queue completed.`);
        });
        analyzeEmailEvents.on("completed", ({ jobId }) => {
            console.log(`Job ${jobId} in analyzeEmail queue completed.`);
        });
        sendEmailEvents.on("completed", ({ jobId }) => {
            console.log(`Job ${jobId} in sendEmail queue completed.`);
        });
        // Schedule fetchEmailQueue to run every 5 minutes
        fetchEmailQueue.add("fetchEmailJob", {}, {
            repeat: { count: 50000 },
        });
        // Worker for fetching emails
        new bullmq_1.Worker("fetchEmail", async () => {
            const emails = await fetchGmailEmails();
            for (const emailContent of emails) {
                await analyzeEmailQueue.add("analyzeEmailJob", { emailContent });
            }
        }, { connection });
        // Worker for analyzing emails
        new bullmq_1.Worker("analyzeEmail", async (job) => {
            const { emailContent } = job.data;
            const analysis = await (0, openai_1.analyzeEmailContent)(emailContent);
            await sendEmailQueue.add("sendEmailJob", { emailContent, analysis });
        }, { connection });
        // Worker for sending emails
        new bullmq_1.Worker("sendEmail", async (job) => {
            const { emailContent, analysis } = job.data;
            const response = await (0, openai_1.generateResponse)(analysis, emailContent);
            if (response) {
                const recipientEmail = "recipient@example.com"; // Replace with actual recipient email
                const subject = "Re: Your recent email";
                await sendEmail(recipientEmail, subject, response);
            }
        }, { connection });
        return res.json({ msg: "tool activated !!!" });
    }
    catch (err) {
        console.error("Error retrieving access token", err);
        return res.json("Error retrieving access token");
    }
};
exports.execute = execute;
