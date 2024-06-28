import { google, gmail_v1 } from "googleapis";
import dotenv from "dotenv";
import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { Request, Response } from "express";
import { analyzeEmailContent, generateResponse } from "./openai";

dotenv.config();
//google api config
const googleOauth2Client = new google.auth.OAuth2(
  process.env.googleClientId,
  process.env.googleClientSecret,
  process.env.googleRedirectUrl
);
//activate googleapi Oauth
export const activateOauth = () => {
  // Generate the URL to request authorization
  const authUrl = googleOauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
  });

  return authUrl;
};

function decodeBase64Url(data: string): string {
  let decodedData = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(decodedData, "base64").toString("utf-8");
}

// Function to fetch new emails
async function fetchGmailEmails(): Promise<string[]> {
  try {
    const gmail = google.gmail({
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
      } else {
        return Promise.resolve(null); // Handle the case where message.id is null
      }
    });

    const emailDetails = await Promise.all(emailDetailsPromises);

    // Filter out any null results and extract the message data
    const emails = emailDetails
      .filter((detail): detail is gmail_v1.Schema$Message => detail !== null)
      .map((detail) => {
        const payload = detail.payload;
        if (payload && payload.body && payload.body.data) {
          return decodeBase64Url(payload.body.data);
        } else if (payload && payload.parts) {
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
  } catch (err) {
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
  } else {
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
  } else {
    console.log("No new emails to process.");
    return null; // Return null when there are no new emails
  }
};

// Create a Redis connection
const connection = new IORedis({
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Create queues
const fetchEmailQueue = new Queue("fetchEmail", { connection });
const analyzeEmailQueue = new Queue("analyzeEmail", { connection });
const sendEmailQueue = new Queue("sendEmail", { connection });

// Create queue event
const fetchEmailEvents = new QueueEvents("fetchEmail", { connection });
const analyzeEmailEvents = new QueueEvents("analyzeEmail", { connection });
const sendEmailEvents = new QueueEvents("sendEmail", { connection });

// Function to send an email using Gmail API
const sendEmail = async (to: string, subject: string, body: string) => {
  const gmail = google.gmail({ version: "v1", auth: googleOauth2Client });

  const emailContent = [`To: ${to}`, "Subject: " + subject, "", body].join(
    "\n"
  );

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
  } catch (error) {
    console.error("Error sending email:", error);
  }
};
// to execute tools
export const execute = async (req: Request, res: Response) => {
  const code = req.query.code as string;

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
    const analysis = await analyzeEmailContent(newEmail);

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
    fetchEmailQueue.add(
      "fetchEmailJob",
      {},
      {
        repeat: { count: 50000 },
      }
    );

    // Worker for fetching emails
    new Worker(
      "fetchEmail",
      async () => {
        const emails = await fetchGmailEmails();
        for (const emailContent of emails) {
          await analyzeEmailQueue.add("analyzeEmailJob", { emailContent });
        }
      },
      { connection }
    );

    // Worker for analyzing emails
    new Worker(
      "analyzeEmail",
      async (job) => {
        const { emailContent } = job.data;
        const analysis = await analyzeEmailContent(emailContent);
        await sendEmailQueue.add("sendEmailJob", { emailContent, analysis });
      },
      { connection }
    );

    // Worker for sending emails
    new Worker(
      "sendEmail",
      async (job) => {
        const { emailContent, analysis } = job.data;
        const response: any = await generateResponse(analysis, emailContent);
        if (response) {
          const recipientEmail = "recipient@example.com"; // Replace with actual recipient email
          const subject = "Re: Your recent email";
          await sendEmail(recipientEmail, subject, response);
        }
      },
      { connection }
    );
    return res.json({ msg: "tool activated !!!" });
  } catch (err) {
    console.error("Error retrieving access token", err);
    return res.json("Error retrieving access token");
  }
};
