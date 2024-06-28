import { google, gmail_v1 } from "googleapis";
import dotenv from "dotenv";
import Bull from "bull";
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

const decodeBase64Url = (data: string) => {
  let decodedData = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(decodedData, "base64").toString("utf-8");
};

// Function to fetch new emails

// async function fetchGmailEmails(): Promise<string[]> {
const fetchGmailEmails: any = async () => {
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
    const emails: any = emailDetails
      .filter((detail): detail is gmail_v1.Schema$Message => detail !== null)
      .map((detail) => {
        const payload = detail.payload;
        let emailContent = "";
        let recipientEmail = "";

        if (payload) {
          if (payload.body && payload.body.data) {
            emailContent = decodeBase64Url(payload.body.data);
          } else if (payload.parts) {
            for (const part of payload.parts) {
              if (part.body && part.body.data) {
                emailContent = decodeBase64Url(part.body.data);
                break;
              }
            }
          }

          const headers = payload.headers || [];
          const toHeader = headers.find((header) => header.name === "To");
          if (toHeader && toHeader.value) {
            recipientEmail = toHeader.value;
          }
        }

        return { emailContent, recipientEmail };
      });

    return emails;
  } catch (err) {
    console.error("Error fetching emails:", err);
    throw err;
  }
};
const getAll10Emall = async () => {
  const newEmails = await fetchGmailEmails();
  if (newEmails.length > 0) {
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
    return newEmails[0].emailContent;
    // Send the emails to OpenAI for analysis
  } else {
    console.log("No new emails to process.");
    return null; // Return null when there are no new emails
  }
};

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

    // Create queues
    const fetchEmailQueue = new Bull("fetchEmail", {
      redis: {
        host: "127.0.0.1",
        port: 6379,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    });

    const analyzeEmailQueue = new Bull("analyzeEmail", {
      redis: {
        host: "127.0.0.1",
        port: 6379,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    });

    const sendEmailQueue = new Bull("sendEmail", {
      redis: {
        host: "127.0.0.1",
        port: 6379,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    });

    // Schedule fetchEmailQueue to run every 5 minutes
    fetchEmailQueue.add(
      "fetchEmailJob",
      {},
      {
        repeat: { cron: "*/5 * * * *" },
      }
    );

    // Processor for fetching emails
    fetchEmailQueue.process(async () => {
      const emails: any = await fetchGmailEmails();
      for (const emailContent of emails) {
        await analyzeEmailQueue.add("analyzeEmailJob", { emailContent });
      }
    });

    // Processor for analyzing emails
    analyzeEmailQueue.process(async (job) => {
      const { emailContent } = job.data;
      const analysis = await analyzeEmailContent(emailContent.emailContent);
      await sendEmailQueue.add("sendEmailJob", { emailContent, analysis });
    });

    // Processor for sending emails
    sendEmailQueue.process(async (job) => {
      const { emailContent, analysis } = job.data;
      const response: any = await generateResponse(
        analysis,
        emailContent.emailContent
      );
      if (response) {
        const recipientEmail = "";
        const subject = "Re: Your recent email";
        await sendEmail(emailContent.recipientEmail, subject, response);
      }
    });
    return res.json({ msg: "tool activated !!!" });
  } catch (err) {
    console.error("Error retrieving access token", err);
    return res.json("Error retrieving access token");
  }
};
