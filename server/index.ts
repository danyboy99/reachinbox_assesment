// setup server
import express, { Request, Response } from "express";
import { activateOauth, execute } from "./executeTool";

const app = express();
let refreshToken = "";
app.get("/", (req: Request, res: Response) => {
  const authUrl = activateOauth();

  return res.send(`<a href= ${authUrl}> sign in with google</a>`);
});

app.get("/execute");

app.get("/google/callback", execute);
console.log(`token_1 : ${refreshToken}`);

const port = process.env.PORT || 1888;
app.listen(port, () => {
  console.log(`app is running on port ${port}`);
});
