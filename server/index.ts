// setup server
import express, { Request, Response } from "express";
import googleOauth from "./googleOauth";

const app = express();

googleOauth();

app.get("/google/callback", (req: Request, res: Response) => {
  const code = req.query.code as string;
  return res.json({
    msg: "successful",
    code: code,
  });
});

const port = process.env.PORT || 1888;
app.listen(port);
