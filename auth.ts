import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as readline from "readline";
import * as fs from "fs";

const OAUTH_TOKENS_PATH = "oauth_tokens.json";
export async function googleAuth(): Promise<OAuth2Client> {
  const clientSecrets = JSON.parse(
    fs.readFileSync("client_secret.json", "utf8")
  );
  const clientId = clientSecrets.installed.client_id;
  const clientSecret = clientSecrets.installed.client_secret;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, "http://localhost");

  if (fs.existsSync(OAUTH_TOKENS_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(OAUTH_TOKENS_PATH, "utf8"));

    if(tokens.expiry_date < Date.now()) {
      oauth2Client.setCredentials(tokens);
      const {credentials} = await oauth2Client.refreshAccessToken();
      fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(credentials));
      oauth2Client.setCredentials(credentials);
    } else {
      oauth2Client.setCredentials(tokens);
    }


    return oauth2Client;
  }

  // Generate a url that asks permissions for Google Photos scopes
  const scopes = [
    "https://www.googleapis.com/auth/photoslibrary",
    "https://www.googleapis.com/auth/photoslibrary.sharing",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  console.log("Authorize this app by visiting this url:", url);

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Read the code from the command line
  const code = await new Promise<string>((resolve) => {
    rl.question("Enter the code from that page here: ", (code) => {
      resolve(code);
      rl.close();
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(tokens));

  return oauth2Client;
}
