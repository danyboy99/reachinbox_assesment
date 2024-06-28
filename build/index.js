"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// setup server
const express_1 = __importDefault(require("express"));
const executeTool_1 = require("./executeTool");
const app = (0, express_1.default)();
let refreshToken = "";
app.get("/", (req, res) => {
    const authUrl = (0, executeTool_1.activateOauth)();
    return res.send(`<a href= ${authUrl}> sign in with google</a>`);
});
app.get("/execute");
app.get("/google/callback", executeTool_1.execute);
console.log(`token_1 : ${refreshToken}`);
const port = process.env.PORT || 1888;
app.listen(port, () => {
    console.log(`app is running on port ${port}`);
});
