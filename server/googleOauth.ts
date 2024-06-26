import { google } from "googleapis";
import dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

const activateOauth = () => {
  const googleOauth2Client = new google.auth.OAuth2(
    process.env.googleClientId,
    process.env.googleClientSecret,
    process.env.googleRedirectUrl
  );
  // Generate the URL to request authorization
  const authUrl = googleOauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  console.log("Authorize this app by visiting this url:", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let refreshedToken = "";
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    googleOauth2Client.getToken(code, (err: any, tokens: any) => {
      if (err) {
        console.error("Error retrieving access token", err);
        return;
      }
      googleOauth2Client.setCredentials(tokens);
      console.log("Tokens acquired:", tokens);
      refreshedToken = tokens.refresh_token;

      // Get access tokens
      googleOauth2Client.setCredentials({
        refresh_token: refreshedToken,
      });
      async function fetchGmailEmails() {
        const gmail = google.gmail({ version: "v1", auth: googleOauth2Client });
        const res = await gmail.users.messages.list({ userId: "me" });
        // Process emails
        const messages = res.data.messages;
        console.log("emailEx:", messages);
      }
      fetchGmailEmails();
    });
  });
};

export default activateOauth;
