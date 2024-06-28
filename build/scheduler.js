"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
// Create a Redis connection
const connection = new ioredis_1.default();
// Create queues
const fetchEmailQueue = new bullmq_1.Queue("fetchEmail", { connection });
const analyzeEmailQueue = new bullmq_1.Queue("analyzeEmail", { connection });
const sendEmailQueue = new bullmq_1.Queue("sendEmail", { connection });
// Create queue event
const fetchEmailEvents = new bullmq_1.QueueEvents("fetchEmail", { connection });
const analyzeEmailEvents = new bullmq_1.QueueEvents("analyzeEmail", { connection });
const sendEmailEvents = new bullmq_1.QueueEvents("sendEmail", { connection });
